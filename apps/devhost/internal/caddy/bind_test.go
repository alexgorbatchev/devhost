package caddy

import "testing"

func TestResolveManagedCaddyBindDirective(t *testing.T) {
	t.Parallel()

	if got, error := ResolveManagedCaddyBindDirective("darwin", defaultManagedCaddyBindHost); error != nil || got != "" {
		t.Fatalf("ResolveManagedCaddyBindDirective(...) = %q, %v, want empty directive and nil error", got, error)
	}

	if got, error := ResolveManagedCaddyBindDirective("linux", defaultManagedCaddyBindHost); error != nil || got != "    default_bind 127.0.0.1 [::1]" {
		t.Fatalf("ResolveManagedCaddyBindDirective(...) = %q, %v, want %q", got, error, "    default_bind 127.0.0.1 [::1]")
	}

	if got, error := ResolveManagedCaddyBindDirective("linux", "0.0.0.0"); error != nil || got != "    default_bind 0.0.0.0 [::]" {
		t.Fatalf("ResolveManagedCaddyBindDirective(...) = %q, %v, want %q", got, error, "    default_bind 0.0.0.0 [::]")
	}
}
