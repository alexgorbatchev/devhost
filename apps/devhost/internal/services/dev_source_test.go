package services

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveDevSourceDirectory(t *testing.T) {
	t.Parallel()

	manifestDirectoryPath := filepath.Join(string(filepath.Separator), "projects", "devhost")

	tests := []struct {
		name  string
		value string
		want  string
	}{
		{name: "disabled when unset", value: "", want: ""},
		{name: "keeps an absolute checkout path", value: "/src/devhost", want: "/src/devhost"},
		{name: "resolves a relative path against the manifest directory", value: "../devhost-src", want: filepath.Join(string(filepath.Separator), "projects", "devhost-src")},
		{name: "resolves the manifest directory itself", value: ".", want: manifestDirectoryPath},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			environment := map[string]string{devSourceDirectoryEnvironmentVariable: tc.value}
			if got := resolveDevSourceDirectory(environment, manifestDirectoryPath); got != tc.want {
				t.Fatalf("resolveDevSourceDirectory(%q) = %q, want %q", tc.value, got, tc.want)
			}
		})
	}
}

func TestLoadDevSourceCheckout(t *testing.T) {
	t.Parallel()

	validCheckoutPath := t.TempDir()
	writeDevSourceFile(t, filepath.Join(validCheckoutPath, "packages", "devhost-ui", "src", "devtools", "main.ts"))
	writeDevSourceFile(t, filepath.Join(validCheckoutPath, "apps", "devhost", "justfile"))

	otherCheckoutPath := t.TempDir()
	writeDevSourceFile(t, filepath.Join(otherCheckoutPath, "packages", "devhost-ui", "src", "devtools", "main.ts"))
	writeDevSourceFile(t, filepath.Join(otherCheckoutPath, "apps", "devhost", "justfile"))
	missingCheckoutPath := filepath.Join(t.TempDir(), "not-devhost")

	tests := []struct {
		name         string
		value        string
		builtIn      string
		wantCheckout string
		wantWarning  string
		wantError    string
	}{
		{name: "disabled when unset", value: ""},
		{name: "loads a devhost checkout", value: validCheckoutPath, wantCheckout: validCheckoutPath},
		{name: "rejects a path that is not a devhost checkout", value: missingCheckoutPath, wantError: devSourceDirectoryEnvironmentVariable},
		{name: "loads the checkout a development build names", builtIn: validCheckoutPath, wantCheckout: validCheckoutPath},
		{name: "prefers the variable over the development build", value: otherCheckoutPath, builtIn: validCheckoutPath, wantCheckout: otherCheckoutPath},
		{name: "warns and serves embedded assets when the built-in checkout is gone", builtIn: missingCheckoutPath, wantWarning: missingCheckoutPath},
	}

	for _, tt := range tests {
		tc := tt
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			environment := map[string]string{devSourceDirectoryEnvironmentVariable: tc.value}
			checkout, warning, err := loadDevSourceCheckout(environment, t.TempDir(), tc.builtIn)

			if tc.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantError) {
					t.Fatalf("loadDevSourceCheckout(%q) error = %v, want it to name %s", tc.value, err, tc.wantError)
				}
				return
			}

			if err != nil {
				t.Fatalf("loadDevSourceCheckout(%q, built-in %q) unexpected error = %v", tc.value, tc.builtIn, err)
			}

			gotCheckout := ""
			if checkout != nil {
				gotCheckout = checkout.RootPath()
			}
			if gotCheckout != tc.wantCheckout {
				t.Fatalf("loadDevSourceCheckout(%q, built-in %q) checkout = %q, want %q", tc.value, tc.builtIn, gotCheckout, tc.wantCheckout)
			}

			if (warning == "") != (tc.wantWarning == "") || !strings.Contains(warning, tc.wantWarning) {
				t.Fatalf("loadDevSourceCheckout(%q, built-in %q) warning = %q, want one naming %q", tc.value, tc.builtIn, warning, tc.wantWarning)
			}
		})
	}
}

func writeDevSourceFile(t *testing.T, path string) {
	t.Helper()

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create %s: %v", filepath.Dir(path), err)
	}

	if err := os.WriteFile(path, nil, 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
