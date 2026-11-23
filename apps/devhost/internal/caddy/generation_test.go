package caddy

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/procid"
)

func TestGenerationRejectsDowngradeBeforeConfigurationMutation(t *testing.T) {
	paths := CreateManagedCaddyPaths(t.TempDir())
	settings := DefaultManagedCaddyGlobalSettings()
	if err := EnsureManagedCaddyConfig(paths, settings, "linux"); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(paths.CaddyfilePath)
	if err != nil {
		t.Fatal(err)
	}
	record := managedCaddyRuntime{Generation: managedCaddyRestartGeneration + 1, ManagedCaddyProcess: ManagedCaddyProcess{PID: 1, StartIdentity: "newer-process"}}
	text, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(managedCaddyRuntimePath(paths), text, 0o600); err != nil {
		t.Fatal(err)
	}
	for _, operation := range []func() error{
		func() error { return EnsureManagedCaddyConfig(paths, settings, "linux") },
		func() error {
			_, err := ApplyManagedCaddySettings(paths, settings, RouteCommandOutputWriters{})
			return err
		},
		func() error {
			return SyncManagedHostRoute("test.localhost", paths.RoutesDirectoryPath, RouteCommandOutputWriters{})
		},
		func() error { _, err := EnsureManagedCaddyRuntime(paths, settings, io.Discard, true); return err },
	} {
		if err := operation(); err == nil || !strings.Contains(err.Error(), "Upgrade this devhost instance") {
			t.Fatalf("downgrade error: %v", err)
		}
	}
	after, err := os.ReadFile(paths.CaddyfilePath)
	if err != nil || string(after) != string(before) {
		t.Fatalf("downgrade mutated Caddyfile: %v", err)
	}
}

func TestRuntimeRecordRejectsMalformedState(t *testing.T) {
	for _, text := range []string{"{", "{}", `{"restartGeneration":-1,"pid":2,"startIdentity":"x"}`, `{"restartGeneration":1,"pid":0,"startIdentity":"x"}`, `{"restartGeneration":1,"pid":2}`} {
		t.Run(text, func(t *testing.T) {
			paths := CreateManagedCaddyPaths(t.TempDir())
			if err := os.MkdirAll(paths.CaddyDirectoryPath, 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(managedCaddyRuntimePath(paths), []byte(text), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := readManagedCaddyRuntime(paths); err == nil {
				t.Fatal("accepted malformed runtime")
			}
		})
	}
}

func TestRuntimeIdentityCannotAuthorizeStoppingUnrelatedProcess(t *testing.T) {
	paths := CreateManagedCaddyPaths(t.TempDir())
	settings := DefaultManagedCaddyGlobalSettings()
	if err := EnsureManagedCaddyConfig(paths, settings, "linux"); err != nil {
		t.Fatal(err)
	}
	identity, err := procid.StartIdentity(os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	owner := ManagedCaddyProcess{PID: os.Getpid(), StartIdentity: identity}
	if err := os.WriteFile(paths.PidFilePath, []byte(strconv.Itoa(owner.PID)), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, staleRecord := range []bool{false, true} {
		if staleRecord {
			stale := owner
			stale.StartIdentity = "a-previous-process"
			if err := writeManagedCaddyRuntime(paths, stale); err != nil {
				t.Fatal(err)
			}
		}
		_, err := RunManagedCaddyLifecycleCommand(LifecycleStart, io.Discard, paths, settings, ManagedCaddyLifecycleDependencies{
			IsManagedCaddyAvailable: func() bool { return true },
			RunManagedCaddyCommand: func([]string, ManagedCaddyCommandOptions) CommandResult {
				t.Fatal("stopped unrelated process")
				return CommandResult{}
			},
		})
		if err == nil || !strings.Contains(err.Error(), "refusing automatic restart") {
			t.Fatalf("unrelated process accepted: %v", err)
		}
	}
}

func TestStartRecordsGenerationOnlyAfterReadinessAndIdentity(t *testing.T) {
	for _, failure := range []string{"command", "readiness", "identity", "record", "none"} {
		t.Run(failure, func(t *testing.T) {
			paths := CreateManagedCaddyPaths(t.TempDir())
			settings := DefaultManagedCaddyGlobalSettings()
			started := false
			owner := ManagedCaddyProcess{PID: 123, StartIdentity: "fresh"}
			_, err := RunManagedCaddyLifecycleCommand(LifecycleStart, io.Discard, paths, settings, ManagedCaddyLifecycleDependencies{
				IsManagedCaddyAvailable: func() bool { return started && failure != "readiness" },
				ReadManagedCaddyProcess: func() (ManagedCaddyProcess, error) {
					if failure == "identity" {
						return ManagedCaddyProcess{}, errors.New("identity unavailable")
					}
					return owner, nil
				},
				ReadRootCertificateTrust: func() (RootCertificateTrust, error) { return RootCertificateTrusted, nil },
				RunManagedCaddyCommand: func(arguments []string, _ ManagedCaddyCommandOptions) CommandResult {
					if arguments[0] != "start" {
						t.Fatalf("unexpected command %v", arguments)
					}
					started = true
					if failure == "record" {
						if err := os.Mkdir(managedCaddyRuntimePath(paths)+".tmp", 0o700); err != nil {
							t.Fatal(err)
						}
					}
					return CommandResult{Success: failure != "command"}
				},
			})
			if failure == "none" {
				if err != nil {
					t.Fatal(err)
				}
				record, err := readManagedCaddyRuntime(paths)
				if err != nil || record.ManagedCaddyProcess != owner || record.Generation != managedCaddyRestartGeneration {
					t.Fatalf("runtime: %+v, %v", record, err)
				}
			} else {
				if err == nil {
					t.Fatal("start unexpectedly succeeded")
				}
				if _, err := os.Stat(managedCaddyRuntimePath(paths)); !os.IsNotExist(err) {
					t.Fatalf("failed start recorded generation: %v", err)
				}
			}
		})
	}
}

func TestReadManagedCaddyProcessRejectsBadPID(t *testing.T) {
	paths := CreateManagedCaddyPaths(t.TempDir())
	if err := os.MkdirAll(paths.CaddyDirectoryPath, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"0", "-2", "garbage", "999999999"} {
		if err := os.WriteFile(paths.PidFilePath, []byte(value), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := readManagedCaddyProcess(paths); err == nil {
			t.Fatalf("accepted PID %s", value)
		}
	}
	if err := os.Remove(paths.PidFilePath); err != nil {
		t.Fatal(err)
	}
	if _, err := readManagedCaddyProcess(paths); err == nil {
		t.Fatal("accepted missing PID")
	}
}

func TestRuntimePersistsAcrossStop(t *testing.T) {
	paths := CreateManagedCaddyPaths(t.TempDir())
	if err := os.MkdirAll(filepath.Dir(paths.PidFilePath), 0o700); err != nil {
		t.Fatal(err)
	}
	owner := ManagedCaddyProcess{PID: 123, StartIdentity: "old"}
	if err := writeManagedCaddyRuntime(paths, owner); err != nil {
		t.Fatal(err)
	}
	l := managedCaddyLifecycle{paths: paths, removeManagedPidFile: func() error { return nil }}
	if err := l.forget(); err != nil {
		t.Fatal(err)
	}
	if err := checkManagedCaddyGeneration(paths); err != nil {
		t.Fatal(err)
	}
	record, err := readManagedCaddyRuntime(paths)
	if err != nil || record.ManagedCaddyProcess != owner {
		t.Fatalf("lost generation floor: %+v, %v", record, err)
	}
}

func TestGenerationRestartFailuresRemainRetryable(t *testing.T) {
	for _, failure := range []string{"stop", "start", "same process", "none"} {
		t.Run(failure, func(t *testing.T) {
			paths := CreateManagedCaddyPaths(t.TempDir())
			settings := DefaultManagedCaddyGlobalSettings()
			if err := EnsureManagedCaddyConfig(paths, settings, "linux"); err != nil {
				t.Fatal(err)
			}
			owner := ManagedCaddyProcess{PID: 123, StartIdentity: "old"}
			record := managedCaddyRuntime{Generation: 0, ManagedCaddyProcess: owner}
			text, err := json.Marshal(record)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(managedCaddyRuntimePath(paths), text, 0o600); err != nil {
				t.Fatal(err)
			}
			available := true
			var commands []string
			_, err = RunManagedCaddyLifecycleCommand(LifecycleStart, io.Discard, paths, settings, ManagedCaddyLifecycleDependencies{
				HasManagedPidFile:        func() bool { return true },
				IsManagedCaddyAvailable:  func() bool { return available },
				ReadManagedCaddyProcess:  func() (ManagedCaddyProcess, error) { return owner, nil },
				ReadRootCertificateTrust: func() (RootCertificateTrust, error) { return RootCertificateTrusted, nil },
				RunManagedCaddyCommand: func(arguments []string, _ ManagedCaddyCommandOptions) CommandResult {
					commands = append(commands, arguments[0])
					if arguments[0] == failure {
						return CommandResult{Stderr: []byte("injected failure")}
					}
					if arguments[0] == "stop" {
						available = false
					}
					if arguments[0] == "start" {
						available = true
						if failure != "same process" {
							owner = ManagedCaddyProcess{PID: 124, StartIdentity: "new"}
						}
					}
					return CommandResult{Success: true}
				},
			})
			after, readErr := readManagedCaddyRuntime(paths)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if failure == "none" {
				if err != nil || after.Generation != managedCaddyRestartGeneration || after.ManagedCaddyProcess != owner {
					t.Fatalf("restart: %+v, %v", after, err)
				}
			} else {
				if err == nil || after != record {
					t.Fatalf("failed restart advanced proof: %+v, %v", after, err)
				}
			}
			want := "stop start"
			if failure == "stop" {
				want = "stop"
			}
			if strings.Join(commands, " ") != want {
				t.Fatalf("command sequence %v, want %s", commands, want)
			}
		})
	}
}

func TestCurrentGenerationReloadPreservesProofAndRollsBackRejectedSettings(t *testing.T) {
	for _, success := range []bool{false, true} {
		t.Run(strconv.FormatBool(success), func(t *testing.T) {
			paths := CreateManagedCaddyPaths(t.TempDir())
			running := DefaultManagedCaddyGlobalSettings()
			settings := running
			settings.AdminAddress = "127.0.0.1:22009"
			settings.HTTPSPort = 8443
			if err := EnsureManagedCaddyConfig(paths, running, "linux"); err != nil {
				t.Fatal(err)
			}
			if err := writeAppliedManagedCaddySettings(paths, running); err != nil {
				t.Fatal(err)
			}
			owner := ManagedCaddyProcess{PID: 123, StartIdentity: "existing"}
			if err := writeManagedCaddyRuntime(paths, owner); err != nil {
				t.Fatal(err)
			}
			before, err := readManagedCaddyRuntime(paths)
			if err != nil {
				t.Fatal(err)
			}
			_, err = RunManagedCaddyLifecycleCommand(LifecycleStart, io.Discard, paths, settings, ManagedCaddyLifecycleDependencies{
				HasManagedPidFile:        func() bool { return true },
				IsManagedCaddyAvailable:  func() bool { return true },
				ReadManagedCaddyProcess:  func() (ManagedCaddyProcess, error) { return owner, nil },
				ReadRootCertificateTrust: func() (RootCertificateTrust, error) { return RootCertificateTrusted, nil },
				RunManagedCaddyCommand: func(arguments []string, options ManagedCaddyCommandOptions) CommandResult {
					if strings.Join(arguments, " ") != "reload" || options.AdminAddress != running.AdminAddress {
						t.Fatalf("reload must reach old admin address: %v %+v", arguments, options)
					}
					return CommandResult{Success: success}
				},
			})
			if (err == nil) != success {
				t.Fatalf("reload success=%t: %v", success, err)
			}
			after, readErr := readManagedCaddyRuntime(paths)
			if readErr != nil || after != before {
				t.Fatalf("reload changed runtime proof: %+v, %v", after, readErr)
			}
			want := running
			if success {
				want = settings
			}
			applied, ok, err := ReadAppliedManagedCaddySettings(paths)
			if err != nil || !ok || applied != want {
				t.Fatalf("applied settings %+v, want %+v: %v", applied, want, err)
			}
			config, err := os.ReadFile(paths.CaddyfilePath)
			if err != nil || !strings.Contains(string(config), "admin "+want.AdminAddress) {
				t.Fatalf("rendered settings did not follow reload result: %v", err)
			}
		})
	}
}
