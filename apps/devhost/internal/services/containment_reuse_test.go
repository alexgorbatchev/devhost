package services

import (
	"errors"
	"io/fs"
	"maps"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"slices"
	"strconv"
	"sync"
	"syscall"
	"testing"
	"time"
)

// otherHolderIdentity is the start identity these tests give a process that held a PID before or after the process
// that has it now. No real process has it: a real identity is a start time, or a boot ID and a start time.
const otherHolderIdentity = "another process that had this PID"

// reuseTestGracePeriod bounds each stop in these tests. The services they stop end on the first signal, so the period
// runs out only when a stop waits for a process that is not the service's.
const reuseTestGracePeriod = 2 * time.Second

// snapshotRewriter reads real snapshots and lists the processes a test names where the test says. It stands in for
// the snapshots read before the system gave a PID to another process, which listed the PID's earlier holder.
type snapshotRewriter struct {
	mu     sync.Mutex
	listed []fakeProcess
	last   processSnapshot
}

func (r *snapshotRewriter) read() (processSnapshot, error) {
	snapshot, err := readProcessSnapshot()
	if err != nil {
		return processSnapshot{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	for _, process := range r.listed {
		if current, ok := snapshot.processes[process.pid]; ok {
			siblings := snapshot.childrenByParent[current.parentPID]
			snapshot.childrenByParent[current.parentPID] = slices.DeleteFunc(siblings, func(pid int) bool { return pid == process.pid })
		}
		// A listed process stands for another holder of its PID, so the children of the process that has the PID now
		// are not its own. Leaving them out keeps every real process outside the test's out of the service's tree,
		// even for PID 1, whose children are most processes on the machine.
		delete(snapshot.childrenByParent, process.pid)
	}
	for _, process := range r.listed {
		snapshot.add(process.pid, processRecord{parentPID: process.parentPID, startIdentity: process.identity, exited: process.exited})
	}
	r.last = snapshot

	return snapshot, nil
}

// list makes every later snapshot list processes as given; with none, snapshots list the table as it is.
func (r *snapshotRewriter) list(processes ...fakeProcess) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.listed = processes
}

func (r *snapshotRewriter) lastSnapshot() processSnapshot {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.last
}

// useSnapshotRewriter makes the services a test starts report to a monitor that reads snapshots through a rewriter and
// refreshes only when asked, and puts the shared monitor back when the test ends.
func useSnapshotRewriter(t *testing.T) *snapshotRewriter {
	t.Helper()

	rewriter := &snapshotRewriter{}
	monitor := newProcessTreeMonitor(time.Hour, rewriter.read)
	shared := sharedProcessTreeMonitor
	sharedProcessTreeMonitor = monitor
	t.Cleanup(func() {
		sharedProcessTreeMonitor = shared
		monitor.close()
	})

	return rewriter
}

// unrelatedProcess is a process no service started. It logs each SIGHUP, SIGINT, and SIGTERM it receives and keeps
// running, so a test can tell whether anything signalled it.
type unrelatedProcess struct {
	pid      int
	identity string
	logPath  string
}

// startUnrelatedProcess starts an unrelated process in a process group of its own, as a child of the test.
func startUnrelatedProcess(t *testing.T) unrelatedProcess {
	t.Helper()

	directory := t.TempDir()
	readyPath := filepath.Join(directory, "ready")
	logPath := filepath.Join(directory, "signals.log")
	command := exec.Command(os.Args[0], "-test.run=TestServiceHelperProcess", "--")
	command.Env = append(os.Environ(),
		"GO_WANT_HELPER_PROCESS=1",
		"DEVHOST_HELPER_MODE=log-signals",
		"READY_FILE_PATH="+readyPath,
		"SIGNAL_LOG_PATH="+logPath,
	)
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := command.Start(); err != nil {
		t.Fatalf("start unrelated process: %v", err)
	}
	t.Cleanup(func() {
		_ = command.Process.Kill() // the test's own unreaped child, so its PID still names it
		_ = command.Wait()
	})

	waitForCondition(t, stackChangeTimeout, func() bool {
		_, err := os.Stat(readyPath)
		return err == nil
	})
	process, ok := readProcessRecord(command.Process.Pid)
	if !ok {
		t.Fatalf("read unrelated process %d: not in the process table", command.Process.Pid)
	}

	return unrelatedProcess{pid: command.Process.Pid, identity: process.startIdentity, logPath: logPath}
}

// assertUntouched fails the test when the process has stopped or has received a signal.
func (p unrelatedProcess) assertUntouched(t *testing.T) {
	t.Helper()

	if !processMatches(p.pid, p.identity) {
		t.Fatalf("unrelated process %d stopped, want it running", p.pid)
	}
	logged, err := os.ReadFile(p.logPath)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("read the signals unrelated process %d received: %v", p.pid, err)
	}
	if received := nonEmptyLines(string(logged)); len(received) > 0 {
		t.Fatalf("unrelated process %d received %v, want no signal", p.pid, received)
	}
}

// startContainedService starts command as a service through devhost's own launch path and stops it when the test ends.
func startContainedService(t *testing.T, command []string, environment map[string]string) *startedService {
	t.Helper()

	started, err := startTestServiceProcess(newResolvedManifest(t.TempDir(), "127.0.0.1:20197"), ResolvedService{
		Command: command,
		Cwd:     t.TempDir(),
		Env:     environment,
		Health:  ResolvedHealthConfig{Kind: "process"},
		Name:    "worker",
	}, processStartOptions{environment: map[string]string{}, stderrWriter: ioDiscard{}, stdoutWriter: ioDiscard{}})
	if err != nil {
		t.Fatalf("start service: %v", err)
	}
	// A second stop finds nothing left to signal, so this is harmless after the test stopped the service itself.
	t.Cleanup(func() { _ = stopStartedService(started, reuseTestGracePeriod) })

	return started
}

// helperServiceEnvironment is the environment that runs a service command from helperCommand in mode.
func helperServiceEnvironment(mode string, values map[string]string) map[string]string {
	environment := map[string]string{"GO_WANT_HELPER_PROCESS": "1", "DEVHOST_HELPER_MODE": mode}
	maps.Copy(environment, values)
	return environment
}

// trackedChild is a process a service started, with the start identity its tracker recorded.
type trackedChild struct {
	pid      int
	identity string
}

// waitForTrackedChild reads the PID a service's process wrote to pidPath and waits until the service's tracker tracks
// that process. When the test ends, it stops the process if it still runs, and collects it if it is the test's.
func waitForTrackedChild(t *testing.T, started *startedService, pidPath string) trackedChild {
	t.Helper()

	pid := readPIDFile(pidPath)
	if pid <= 0 {
		t.Fatalf("service wrote no child PID to %s", pidPath)
	}

	tracker := started.containment.tracker
	var identity string
	waitForCondition(t, stackChangeTimeout, func() bool {
		_ = tracker.refresh()
		var tracked bool
		identity, tracked = tracker.trackedProcesses()[pid]
		return tracked
	})
	t.Cleanup(func() { stopLeftoverProcess(pid, identity) })

	return trackedChild{pid: pid, identity: identity}
}

// stopLeftoverProcess kills a process a test left running, after checking that pid still names it, and collects it
// when this test process adopted it, as devhost's subreaper does on Linux.
func stopLeftoverProcess(pid int, identity string) {
	process, ok := readProcessRecord(pid)
	if !ok || process.startIdentity != identity {
		return
	}
	if !process.exited {
		_ = syscall.Kill(pid, syscall.SIGKILL)
	}
	if process.parentPID == os.Getpid() {
		_, _ = syscall.Wait4(pid, nil, 0, nil)
	}
}

func stopServiceWithStackShutdown(started *startedService) error {
	return stopStartedServices([]*startedService{started}, reuseTestGracePeriod, nil)
}

func stopServiceWithRestart(started *startedService) error {
	return stopStartedService(started, reuseTestGracePeriod)
}

// The system gives a tracked PID to another process once the service's process that had it exits. Only snapshots read
// before that listed the PID in the service's tree, so the test stands in for them by listing an unrelated process
// there under another identity. No path that stops a service may signal that process.
func TestStopPathsSignalNoProcessThatReusedATrackedPID(t *testing.T) {
	stops := []struct {
		name string
		stop func(*startedService) error
	}{
		{name: "stack shutdown", stop: stopServiceWithStackShutdown},
		{name: "service restart", stop: stopServiceWithRestart},
		{name: "Ctrl-C", stop: func(started *startedService) error {
			forwardStartedServicesSignal([]*startedService{started}, syscall.SIGINT, func(string) {})
			return stopServiceWithStackShutdown(started)
		}},
		{name: "idle timeout", stop: func(started *startedService) error {
			forwardStartedServicesSignal([]*startedService{started}, syscall.SIGTERM, func(string) {})
			return stopServiceWithStackShutdown(started)
		}},
	}
	listings := []struct {
		name string
		// untilStop lists the unrelated process in the service's tree in every snapshot up to and during the stop, so
		// only the identity read right before each signal tells it from the service's process.
		untilStop bool
	}{
		{name: "listed once", untilStop: false},
		{name: "listed until the stop", untilStop: true},
	}

	for _, stop := range stops {
		for _, listing := range listings {
			t.Run(stop.name+"/"+listing.name, func(t *testing.T) {
				rewriter := useSnapshotRewriter(t)
				unrelated := startUnrelatedProcess(t)
				childPIDPath := filepath.Join(t.TempDir(), "child.pid")
				started := startContainedService(t, helperCommand(), helperServiceEnvironment("start-detached-sleeper-and-wait", map[string]string{"CHILD_PID_PATH": childPIDPath}))
				// The child is in a process group of its own, so only its tracker can stop it: the stop must still
				// signal the service's own processes.
				child := waitForTrackedChild(t, started, childPIDPath)

				rewriter.list(fakeProcess{pid: unrelated.pid, parentPID: started.cmd.Process.Pid, identity: otherHolderIdentity})
				tracker := started.containment.tracker
				if err := tracker.refresh(); err != nil {
					t.Fatalf("tracker.refresh() error = %v", err)
				}
				if identity, tracked := tracker.trackedProcesses()[unrelated.pid]; !tracked || identity != otherHolderIdentity {
					t.Fatalf("tracker holds %d as %q (tracked: %t), want the earlier holder's identity", unrelated.pid, identity, tracked)
				}
				if !listing.untilStop {
					rewriter.list()
				}

				if err := stop.stop(started); err != nil {
					t.Fatalf("stop error = %v, want nil", err)
				}

				if processMatches(child.pid, child.identity) {
					t.Fatalf("service child %d still runs after the stop, want it stopped", child.pid)
				}
				unrelated.assertUntouched(t)
			})
		}
	}
}

// A service whose root exits on its own keeps its tracker until it is restarted or the stack stops. Meanwhile the
// system can give the root's PID to an unrelated process, whose children the table then lists under that PID. They
// are not the service's, and neither path that stops it may signal them.
func TestStopPathsSignalNothingUnderTheReusedPIDOfAnExitedService(t *testing.T) {
	stops := []struct {
		name string
		stop func(*startedService) error
	}{
		{name: "service restart", stop: stopServiceWithRestart},
		{name: "stack shutdown", stop: stopServiceWithStackShutdown},
	}

	for _, stop := range stops {
		t.Run(stop.name, func(t *testing.T) {
			rewriter := useSnapshotRewriter(t)
			unrelated := startUnrelatedProcess(t)
			started := startContainedService(t, []string{"/bin/sleep", "0"}, nil)
			<-started.exited
			rootPID := started.cmd.Process.Pid

			rewriter.list(
				fakeProcess{pid: rootPID, parentPID: 1, identity: otherHolderIdentity},
				fakeProcess{pid: unrelated.pid, parentPID: rootPID, identity: unrelated.identity},
			)
			tracker := started.containment.tracker
			if err := tracker.refresh(); err != nil {
				t.Fatalf("tracker.refresh() error = %v", err)
			}
			if tracked := tracker.trackedProcesses(); len(tracked) > 0 {
				t.Fatalf("tracker holds %v under the reused PID %d, want nothing", tracked, rootPID)
			}

			if err := stop.stop(started); err != nil {
				t.Fatalf("stop error = %v, want nil", err)
			}
			unrelated.assertUntouched(t)
		})
	}
}

// A tracked PID can come to name a process of another user, which devhost may not signal. It is not the service's, so
// stopping the service neither waits for it nor names it.
func TestStoppingAServiceWaitsForNoOtherUsersProcessThatReusedATrackedPID(t *testing.T) {
	// The test lists PID 1 in the service's tree only where this process may not signal it, so not even a tracker that
	// signalled it could reach it.
	if err := syscall.Kill(1, 0); !errors.Is(err, syscall.EPERM) {
		t.Skipf("needs a process this test may not signal: signal 0 to PID 1 returned %v", err)
	}

	rewriter := useSnapshotRewriter(t)
	started := startContainedService(t, []string{"/bin/sleep", "300"}, nil)
	rewriter.list(fakeProcess{pid: 1, parentPID: started.cmd.Process.Pid, identity: otherHolderIdentity})
	tracker := started.containment.tracker
	if err := tracker.refresh(); err != nil {
		t.Fatalf("tracker.refresh() error = %v", err)
	}
	if _, tracked := tracker.trackedProcesses()[1]; !tracked {
		t.Fatal("tracker does not hold PID 1, want it held as the earlier holder's PID")
	}
	rewriter.list()

	// The service ends on the first signal, so a grace period it could never use up shows whether the stop waited.
	const unreachableGracePeriod = 10 * time.Second
	startedAt := time.Now()
	err := stopStartedServices([]*startedService{started}, unreachableGracePeriod, nil)
	if elapsed := time.Since(startedAt); elapsed >= unreachableGracePeriod {
		t.Fatalf("stop took %s, want it to end within the %s grace period", elapsed, unreachableGracePeriod)
	}
	if err != nil {
		t.Fatalf("stop error = %v, want nil", err)
	}
}

// A daemon leaves its service's process tree when the process that started it exits, and init or launchd adopts it
// (on Linux, devhost's subreaper). It still belongs to the service, so stopping the service stops it.
func TestStoppingAServiceStopsTheDaemonItLeftBehind(t *testing.T) {
	directory := t.TempDir()
	daemonPIDPath := filepath.Join(directory, "daemon.pid")
	releasePath := filepath.Join(directory, "release")
	started := startContainedService(t, helperCommand(), helperServiceEnvironment("launch-daemon-and-wait", map[string]string{
		"CHILD_PID_PATH": daemonPIDPath,
		"RELEASE_PATH":   releasePath,
	}))
	daemon := waitForTrackedChild(t, started, daemonPIDPath)
	launched, ok := readProcessRecord(daemon.pid)
	if !ok {
		t.Fatalf("read daemon %d: not in the process table", daemon.pid)
	}

	if err := os.WriteFile(releasePath, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	waitForCondition(t, stackChangeTimeout, func() bool {
		process, ok := readProcessRecord(daemon.pid)
		return ok && process.parentPID != launched.parentPID
	})
	tracker := started.containment.tracker
	if err := tracker.refresh(); err != nil {
		t.Fatalf("tracker.refresh() error = %v", err)
	}
	if identity, tracked := tracker.trackedProcesses()[daemon.pid]; !tracked || identity != daemon.identity {
		t.Fatalf("tracker holds daemon %d as %q (tracked: %t) after its launcher exited, want %q", daemon.pid, identity, tracked, daemon.identity)
	}

	if err := stopServiceWithStackShutdown(started); err != nil {
		t.Fatalf("stop error = %v, want nil", err)
	}
	if processMatches(daemon.pid, daemon.identity) {
		t.Fatalf("daemon %d still runs after its service stopped, want it stopped", daemon.pid)
	}
}

// A service that starts a short-lived child for each job shows its tracker a new PID in nearly every snapshot. The
// tracker holds only the children that still run, however many have come and gone.
func TestTrackerHoldsOnlyTheServiceChildrenThatRun(t *testing.T) {
	rewriter := useSnapshotRewriter(t)
	started := startContainedService(t, []string{"/bin/sh", "-c", "while :; do /bin/sleep 0.01; done"}, nil)
	tracker := started.containment.tracker

	const wantChildren = 20
	seen := map[int]bool{}
	waitForCondition(t, stackChangeTimeout, func() bool {
		if err := tracker.refresh(); err != nil {
			t.Fatalf("tracker.refresh() error = %v", err)
		}

		snapshot := rewriter.lastSnapshot()
		for pid, identity := range tracker.trackedProcesses() {
			process, listed := snapshot.processes[pid]
			if !listed || process.exited || process.startIdentity != identity {
				t.Fatalf("tracker holds %d as %q, which the snapshot it just read lists as %+v (listed: %t)", pid, identity, process, listed)
			}
			seen[pid] = true
		}
		return len(seen) >= wantChildren
	})
}

// runLogSignalsHelper logs each SIGHUP, SIGINT, and SIGTERM it receives and keeps running.
func runLogSignalsHelper() {
	signals := make(chan os.Signal, 8)
	signal.Notify(signals, syscall.SIGHUP, syscall.SIGINT, syscall.SIGTERM)
	if err := os.WriteFile(os.Getenv("READY_FILE_PATH"), []byte("ready"), 0o644); err != nil {
		panic(err)
	}
	for received := range signals {
		appendTraceLine(os.Getenv("SIGNAL_LOG_PATH"), received.String())
	}
}

// runStartDetachedSleeperAndWaitHelper starts a child in a process group of its own, records its PID, and waits.
func runStartDetachedSleeperAndWaitHelper() {
	sleeper := exec.Command("/bin/sleep", "300")
	sleeper.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := sleeper.Start(); err != nil {
		panic(err)
	}
	if err := os.WriteFile(os.Getenv("CHILD_PID_PATH"), []byte(strconv.Itoa(sleeper.Process.Pid)), 0o644); err != nil {
		panic(err)
	}

	// A pending timer keeps the runtime from reporting the blocked process as deadlocked.
	time.Sleep(time.Hour)
}

// runLaunchDaemonAndWaitHelper runs a launcher that starts a daemon, waits for the launcher to exit, and keeps running.
func runLaunchDaemonAndWaitHelper() {
	launcher := exec.Command(os.Args[0], "-test.run=TestServiceHelperProcess", "--")
	launcher.Env = append(os.Environ(), "DEVHOST_HELPER_MODE=start-daemon-and-exit-on-release")
	if err := launcher.Run(); err != nil {
		panic(err)
	}

	// A pending timer keeps the runtime from reporting the blocked process as deadlocked.
	time.Sleep(time.Hour)
}

// runStartDaemonAndExitOnReleaseHelper starts a daemon in a session of its own, records its PID, and exits without
// waiting for it once the test creates RELEASE_PATH, which leaves the daemon to whatever adopts orphans.
func runStartDaemonAndExitOnReleaseHelper() {
	daemon := exec.Command("/bin/sleep", "300")
	daemon.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := daemon.Start(); err != nil {
		panic(err)
	}
	if err := os.WriteFile(os.Getenv("CHILD_PID_PATH"), []byte(strconv.Itoa(daemon.Process.Pid)), 0o644); err != nil {
		panic(err)
	}

	for {
		if _, err := os.Stat(os.Getenv("RELEASE_PATH")); err == nil {
			os.Exit(0)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
