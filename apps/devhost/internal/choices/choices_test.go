package choices

import "testing"

func TestFormat(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name   string
		values []string
		want   string
	}{
		{"one value", []string{"pi"}, "pi"},
		{"two values", []string{"foreground", "daemon"}, "foreground or daemon"},
		{"three values", []string{"cursor", "neovim", "vscode"}, "cursor, neovim, or vscode"},
		{"four values", []string{"127.0.0.1", "0.0.0.0", "::1", "::"}, "127.0.0.1, 0.0.0.0, ::1, or ::"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := Format(tc.values); got != tc.want {
				t.Fatalf("Format(%q) = %q, want %q", tc.values, got, tc.want)
			}
		})
	}
}
