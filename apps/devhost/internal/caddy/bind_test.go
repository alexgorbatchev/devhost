package caddy

import "testing"

func TestResolveManagedCaddyBindDirective(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct{ os, bind, want string }{
		{"linux", "", "    default_bind 0.0.0.0 [::]"},
		{"darwin", "", "    default_bind 0.0.0.0 [::]"},
		{"linux", "0.0.0.0", "    default_bind 0.0.0.0 [::]"},
		{"linux", "127.0.0.1", "    default_bind 127.0.0.1 [::1]"},
		{"darwin", "127.0.0.1", ""},
	} {
		if got, err := ResolveManagedCaddyBindDirective(tc.os, tc.bind); err != nil || got != tc.want {
			t.Fatalf("ResolveManagedCaddyBindDirective(%q, %q) = %q, %v, want %q", tc.os, tc.bind, got, err, tc.want)
		}
	}
}
