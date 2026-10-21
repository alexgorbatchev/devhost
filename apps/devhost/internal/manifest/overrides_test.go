package manifest

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func writeOverrideFixture(t *testing.T) (string, string) {
	t.Helper()
	directory := t.TempDir()
	rootPath := filepath.Join(directory, "devhost.toml")
	includePath := filepath.Join(directory, "api.toml")
	if err := os.WriteFile(rootPath, []byte("name = \"stack\"\nincludes = [\"api.toml\"]\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(includePath, []byte("[services.api]\ncommand = [\"echo\", \"api\"]\nport = 8080\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return rootPath, includePath
}

func TestReadManifestWithOverridesReadsUnsavedContentInsteadOfTheFile(t *testing.T) {
	t.Parallel()
	rootPath, includePath := writeOverrideFixture(t)
	unsaved := []byte("[services.web]\ncommand = [\"echo\", \"web\"]\nport = 8081\n")

	raw, err := ReadManifestWithOverrides(rootPath, map[string][]byte{includePath: unsaved})
	if err != nil {
		t.Fatal(err)
	}
	validated, err := ValidateManifest(rootPath, raw)
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for name := range validated.Services {
		names = append(names, name)
	}
	if !slices.Equal(names, []string{"web"}) {
		t.Fatalf("services = %v, want [web] from the unsaved content", names)
	}
	onDisk, err := os.ReadFile(includePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(onDisk) == string(unsaved) {
		t.Fatal("reading with an override wrote the file")
	}
}

func TestReadManifestParseErrorsKeepTheirPosition(t *testing.T) {
	t.Parallel()
	rootPath, includePath := writeOverrideFixture(t)

	_, err := ReadManifestWithOverrides(rootPath, map[string][]byte{includePath: []byte("[services.api]\ncommand = [\n")})
	var parseError *ParseError
	if !errors.As(err, &parseError) {
		t.Fatalf("error = %v, want a *ParseError", err)
	}
	if parseError.Path != includePath || parseError.Line != 2 || parseError.Column != 12 {
		t.Fatalf("parse error at %s:%d:%d, want %s:2:12", parseError.Path, parseError.Line, parseError.Column, includePath)
	}
	if want := "Failed to parse " + includePath + ": "; !strings.HasPrefix(err.Error(), want) {
		t.Fatalf("message = %q, want prefix %q", err.Error(), want)
	}
}

func TestValidateManifestReportsEachIssue(t *testing.T) {
	t.Parallel()
	rootPath, includePath := writeOverrideFixture(t)
	unsaved := []byte("name = \"stack\"\nincludes = [\"api.toml\"]\nextra = true\n")
	included := []byte("[services.api]\ncommand = [\"echo\", \"api\"]\nport = 8080\nunknown = true\n")

	raw, err := ReadManifestWithOverrides(rootPath, map[string][]byte{rootPath: unsaved, includePath: included})
	if err != nil {
		t.Fatal(err)
	}
	_, err = ValidateManifest(rootPath, raw)
	var validationError *ValidationError
	if !errors.As(err, &validationError) {
		t.Fatalf("error = %v, want a *ValidationError", err)
	}
	want := []string{
		`manifest Unrecognized key: "extra"`,
		`services.api Unrecognized key: "unknown"`,
	}
	if !slices.Equal(validationError.Issues, want) {
		t.Fatalf("issues = %q, want %q", validationError.Issues, want)
	}
}
