package caddy

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestDownloadCaddy(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name                 string
		runtimeArch          string
		runtimeOS            string
		response             *http.Response
		wantChmodPath        string
		wantError            string
		wantFetchURL         string
		wantLog              string
		wantMkdirPath        string
		wantWriteDestination string
		wantWriteMode        uint32
	}{
		{
			name:                 "downloads darwin arm64",
			runtimeArch:          "arm64",
			runtimeOS:            "darwin",
			response:             newResponse(200, "OK", []byte("darwin-binary")),
			wantChmodPath:        "/tmp/caddy/caddy",
			wantFetchURL:         "https://caddyserver.com/api/download?os=darwin&arch=arm64",
			wantLog:              "Downloading Caddy for darwin-arm64 from https://caddyserver.com/api/download?os=darwin&arch=arm64...\nCaddy downloaded to /tmp/caddy/caddy\n",
			wantMkdirPath:        "/tmp/caddy",
			wantWriteDestination: "/tmp/caddy/caddy",
			wantWriteMode:        0o755,
		},
		{
			name:                 "downloads linux amd64",
			runtimeArch:          "x64",
			runtimeOS:            "linux",
			response:             newResponse(200, "OK", []byte("linux-binary")),
			wantChmodPath:        "/tmp/caddy/caddy",
			wantFetchURL:         "https://caddyserver.com/api/download?os=linux&arch=amd64",
			wantLog:              "Downloading Caddy for linux-amd64 from https://caddyserver.com/api/download?os=linux&arch=amd64...\nCaddy downloaded to /tmp/caddy/caddy\n",
			wantMkdirPath:        "/tmp/caddy",
			wantWriteDestination: "/tmp/caddy/caddy",
			wantWriteMode:        0o755,
		},
		{
			name:                 "downloads windows arm",
			runtimeArch:          "arm",
			runtimeOS:            "windows",
			response:             newResponse(200, "OK", []byte("windows-binary")),
			wantFetchURL:         "https://caddyserver.com/api/download?os=windows&arch=arm",
			wantLog:              "Downloading Caddy for windows-arm from https://caddyserver.com/api/download?os=windows&arch=arm...\nCaddy downloaded to /tmp/caddy/caddy.exe\n",
			wantMkdirPath:        "/tmp/caddy",
			wantWriteDestination: "/tmp/caddy/caddy.exe",
			wantWriteMode:        0o755,
		},
		{
			name:        "rejects unsupported os",
			runtimeArch: "amd64",
			runtimeOS:   "freebsd",
			wantError:   "Unsupported OS: freebsd",
		},
		{
			name:        "rejects unsupported architecture",
			runtimeArch: "mips",
			runtimeOS:   "darwin",
			wantError:   "Unsupported Architecture: mips",
		},
		{
			name:        "rejects non ok response",
			runtimeArch: "arm64",
			runtimeOS:   "darwin",
			response:    newResponse(404, "Not Found", nil),
			wantError:   "Failed to download Caddy: 404 404 Not Found",
		},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			transport := &recordingRoundTripper{response: tc.response}
			client := &http.Client{Transport: transport}
			paths := Paths{CaddyDirectoryPath: "/tmp/caddy", ExecutablePath: "/tmp/caddy/caddy"}
			mkdirCalls := []string{}
			writeDestination := ""
			writeMode := os.FileMode(0)
			chmodCalls := []string{}
			var logOutput bytes.Buffer

			error := DownloadCaddy(&logOutput, tc.runtimeOS, tc.runtimeArch, paths, DownloadDependencies{
				Chmod: func(path string, mode os.FileMode) error {
					chmodCalls = append(chmodCalls, fmt.Sprintf("%s:%#o", path, mode))
					return nil
				},
				Client: client,
				MkdirAll: func(path string, mode os.FileMode) error {
					mkdirCalls = append(mkdirCalls, fmt.Sprintf("%s:%#o", path, mode))
					return nil
				},
				WriteFile: func(path string, data []byte, mode os.FileMode) error {
					writeDestination = path
					writeMode = mode
					return nil
				},
			})

			if tc.wantError != "" {
				if error == nil {
					t.Fatalf("DownloadCaddy(...) error = nil, want %q", tc.wantError)
				}

				if error.Error() != tc.wantError {
					t.Fatalf("DownloadCaddy(...) error = %q, want %q", error.Error(), tc.wantError)
				}

				return
			}

			if error != nil {
				t.Fatalf("DownloadCaddy(...) unexpected error = %v", error)
			}

			if transport.lastRequestURL != tc.wantFetchURL {
				t.Fatalf("DownloadCaddy(...) fetch url = %q, want %q", transport.lastRequestURL, tc.wantFetchURL)
			}

			if len(mkdirCalls) != 1 || mkdirCalls[0] != fmt.Sprintf("%s:%#o", tc.wantMkdirPath, os.FileMode(0o755)) {
				t.Fatalf("DownloadCaddy(...) mkdir calls = %#v, want path %q", mkdirCalls, tc.wantMkdirPath)
			}

			if writeDestination != tc.wantWriteDestination {
				t.Fatalf("DownloadCaddy(...) write destination = %q, want %q", writeDestination, tc.wantWriteDestination)
			}

			if uint32(writeMode) != tc.wantWriteMode {
				t.Fatalf("DownloadCaddy(...) write mode = %#o, want %#o", writeMode, tc.wantWriteMode)
			}

			if tc.wantChmodPath == "" {
				if len(chmodCalls) != 0 {
					t.Fatalf("DownloadCaddy(...) chmod calls = %#v, want none", chmodCalls)
				}
			} else {
				wantChmod := fmt.Sprintf("%s:%#o", tc.wantChmodPath, os.FileMode(0o755))
				if len(chmodCalls) != 1 || chmodCalls[0] != wantChmod {
					t.Fatalf("DownloadCaddy(...) chmod calls = %#v, want %q", chmodCalls, wantChmod)
				}
			}

			if logOutput.String() != tc.wantLog {
				t.Fatalf("DownloadCaddy(...) log output = %q, want %q", logOutput.String(), tc.wantLog)
			}
		})
	}
}

type recordingRoundTripper struct {
	lastRequestURL string
	response       *http.Response
}

func (r *recordingRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	r.lastRequestURL = request.URL.String()
	if r.response == nil {
		return nil, fmt.Errorf("no response configured")
	}

	return r.response, nil
}

func newResponse(statusCode int, statusText string, body []byte) *http.Response {
	status := fmt.Sprintf("%d %s", statusCode, statusText)
	return &http.Response{
		Status:     status,
		StatusCode: statusCode,
		Body:       io.NopCloser(strings.NewReader(string(body))),
	}
}
