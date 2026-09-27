package caddy

import "testing"

func TestResolveManagedCaddyBindDirective(t *testing.T) {
	t.Parallel()

	if got, err := ResolveManagedCaddyBindDirective("darwin", defaultManagedCaddyBindHost); err != nil || got != "" {
		t.Fatalf("ResolveManagedCaddyBindDirective(...) = %q, %v, want empty directive and nil error", got, err)
	}

	if got, err := ResolveManagedCaddyBindDirective("linux", defaultManagedCaddyBindHost); err != nil || got != "    default_bind 127.0.0.1 [::1]" {
		t.Fatalf("ResolveManagedCaddyBindDirective(...) = %q, %v, want %q", got, err, "    default_bind 127.0.0.1 [::1]")
	}

	if got, err := ResolveManagedCaddyBindDirective("linux", "0.0.0.0"); err != nil || got != "    default_bind 0.0.0.0 [::]" {
		t.Fatalf("ResolveManagedCaddyBindDirective(...) = %q, %v, want %q", got, err, "    default_bind 0.0.0.0 [::]")
	}
}
