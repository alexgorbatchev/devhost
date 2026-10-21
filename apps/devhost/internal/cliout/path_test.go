package cliout

import (
	"os/exec"
	"testing"
)

func TestDisplayPath(t *testing.T) {
	t.Setenv("HOME", "/home/dev")
	for _, tc := range []struct{ path, want string }{
		{"/home/dev", "~"},
		{"/home/dev/project/devhost.toml", "~/project/devhost.toml"},
		{"/home/developer/devhost.toml", "/home/developer/devhost.toml"},
		{"/srv/devhost.toml", "/srv/devhost.toml"},
	} {
		if got := DisplayPath(tc.path); got != tc.want {
			t.Errorf("DisplayPath(%q) = %q, want %q", tc.path, got, tc.want)
		}
	}
}

func TestShellPathRoundTrip(t *testing.T) {
	t.Setenv("HOME", "/home/dev")
	for _, path := range []string{"/home/dev", "/home/dev/my project/devhost.toml", "/home/dev/it's $(exit 9) `exit 8`/devhost.toml", "/srv/my project/devhost.toml"} {
		command := exec.Command("sh", "-c", "printf '%s' "+ShellPath(path))
		got, err := command.Output()
		if err != nil || string(got) != path {
			t.Errorf("shell round trip %q = %q, %v", path, got, err)
		}
	}
}

func TestFoldPaths(t *testing.T) {
	t.Setenv("HOME", "/home/dev")
	for _, tc := range []struct{ message, want string }{
		{"/home/dev", "~"},
		{"open /home/dev/my project/file: missing", "open ~/my project/file: missing"},
		{"path=\"/home/dev/file\"", "path=\"~/file\""},
		{"/home/developer/file /srv/home/dev/file", "/home/developer/file /srv/home/dev/file"},
		{"home (/home/dev); next '/home/dev/child'", "home (~); next '~/child'"},
	} {
		if got := FoldPaths(tc.message); got != tc.want {
			t.Errorf("FoldPaths(%q) = %q, want %q", tc.message, got, tc.want)
		}
	}
}
