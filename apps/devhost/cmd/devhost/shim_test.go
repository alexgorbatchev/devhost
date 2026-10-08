package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// shimPath is where the shim sits in the app directory, and so in a fixture.
var shimPath = filepath.Join("scripts", "runFromSource.sh")

// shimFixtureProgram stands in for devhost: it reports the file it embeds, the
// directory it runs in, and the arguments it received.
const shimFixtureProgram = `package main

import (
	_ "embed"
	"fmt"
	"os"
	"strings"
)

//go:embed asset.txt
var asset string

func main() {
	cwd, err := os.Getwd()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	fmt.Printf("asset=%s\n", strings.TrimSpace(asset))
	fmt.Printf("cwd=%s\n", cwd)
	fmt.Printf("args=%s\n", strings.Join(os.Args[1:], " "))
}
`

func TestShimRebuildsWhenAnEmbeddedFileChanges(t *testing.T) {
	t.Parallel()

	checkoutPath := createShimFixture(t)
	assetPath := filepath.Join(checkoutPath, "cmd", "devhost", "asset.txt")

	if got := shimOutputValue(t, runShim(t, checkoutPath, checkoutPath), "asset"); got != "first" {
		t.Fatalf("first run embedded %q, want %q", got, "first")
	}

	writeShimFixtureFile(t, assetPath, "second\n", 0o644)

	if got := shimOutputValue(t, runShim(t, checkoutPath, checkoutPath), "asset"); got != "second" {
		t.Fatalf("run after the embedded file changed embedded %q, want %q", got, "second")
	}
}

func TestShimLeavesTheCompiledBinaryInPlace(t *testing.T) {
	t.Parallel()

	const compiledBinary = "the binary `just devhost compile` wrote"

	checkoutPath := createShimFixture(t)
	compiledBinaryPath := filepath.Join(checkoutPath, "bin", "devhost")
	writeShimFixtureFile(t, compiledBinaryPath, compiledBinary, 0o755)

	runShim(t, checkoutPath, checkoutPath)

	got, err := os.ReadFile(compiledBinaryPath)
	if err != nil {
		t.Fatalf("read the compiled binary: %v", err)
	}

	if string(got) != compiledBinary {
		t.Fatalf("the shim replaced the compiled binary at %s", compiledBinaryPath)
	}
}

func TestShimRunsInTheCallingDirectory(t *testing.T) {
	t.Parallel()

	checkoutPath := createShimFixture(t)
	callerPath := physicalPath(t, t.TempDir())

	tests := []struct {
		name      string
		arguments []string
	}{
		{name: "the first run, which builds the binary", arguments: []string{"start", "-m", "./devhost.toml"}},
		{name: "a later run, which reuses it", arguments: []string{"start", "--manifest", "./devhost.toml"}},
	}

	for _, tc := range tests {
		output := runShim(t, checkoutPath, callerPath, tc.arguments...)

		if got := physicalPath(t, shimOutputValue(t, output, "cwd")); got != callerPath {
			t.Fatalf("%s ran in %q, want the calling directory %q", tc.name, got, callerPath)
		}

		if got, want := shimOutputValue(t, output, "args"), strings.Join(tc.arguments, " "); got != want {
			t.Fatalf("%s received arguments %q, want %q", tc.name, got, want)
		}
	}
}

// createShimFixture lays out a checkout the shim can build: the real shim beside
// a module whose command embeds a file.
func createShimFixture(t *testing.T) string {
	t.Helper()

	shim, err := os.ReadFile(filepath.Join("..", "..", shimPath))
	if err != nil {
		t.Fatalf("read the shim: %v", err)
	}

	checkoutPath := t.TempDir()
	writeShimFixtureFile(t, filepath.Join(checkoutPath, shimPath), string(shim), 0o755)
	writeShimFixtureFile(t, filepath.Join(checkoutPath, "go.mod"), "module shimfixture\n\ngo 1.26\n", 0o644)
	writeShimFixtureFile(t, filepath.Join(checkoutPath, "cmd", "devhost", "main.go"), shimFixtureProgram, 0o644)
	writeShimFixtureFile(t, filepath.Join(checkoutPath, "cmd", "devhost", "asset.txt"), "first\n", 0o644)

	return checkoutPath
}

func writeShimFixtureFile(t *testing.T, filePath string, content string, mode os.FileMode) {
	t.Helper()

	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		t.Fatalf("create %s: %v", filepath.Dir(filePath), err)
	}

	if err := os.WriteFile(filePath, []byte(content), mode); err != nil {
		t.Fatalf("write %s: %v", filePath, err)
	}
}

func runShim(t *testing.T, checkoutPath string, callerPath string, arguments ...string) string {
	t.Helper()

	var stderr bytes.Buffer
	command := exec.CommandContext(t.Context(), filepath.Join(checkoutPath, shimPath), arguments...)
	command.Dir = callerPath
	command.Stderr = &stderr

	output, err := command.Output()
	if err != nil {
		t.Fatalf("run the shim with %q: %v\n%s", arguments, err, stderr.String())
	}

	return string(output)
}

func shimOutputValue(t *testing.T, output string, key string) string {
	t.Helper()

	for line := range strings.SplitSeq(output, "\n") {
		if value, found := strings.CutPrefix(line, key+"="); found {
			return value
		}
	}

	t.Fatalf("shim output has no %q line:\n%s", key, output)
	return ""
}

// physicalPath resolves symbolic links, because the fixture reports the
// directory the kernel gives it while t.TempDir can sit behind one.
func physicalPath(t *testing.T, path string) string {
	t.Helper()

	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatalf("resolve %s: %v", path, err)
	}

	return resolved
}
