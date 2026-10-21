package caddy

import (
	"fmt"
	"slices"
)

const defaultManagedCaddyBindHost = "0.0.0.0"

// IsSupportedManagedCaddyBindHost reports whether the managed Caddy can listen
// on bindHost: a loopback or wildcard address of either IP family.
func IsSupportedManagedCaddyBindHost(bindHost string) bool {
	return slices.Contains(SupportedManagedCaddyBindHosts, bindHost)
}

// SupportedManagedCaddyBindHosts are the addresses the managed Caddy can listen on.
var SupportedManagedCaddyBindHosts = []string{"127.0.0.1", "0.0.0.0", "::1", "::"}

func ResolveManagedCaddyBindDirective(runtimeOS string, bindHost string) (string, error) {
	if bindHost == "" {
		bindHost = defaultManagedCaddyBindHost
	}

	if runtimeOS == "darwin" && bindHost == "127.0.0.1" {
		return "", nil
	}

	switch bindHost {
	case "127.0.0.1":
		return "    default_bind 127.0.0.1 [::1]", nil
	case "0.0.0.0":
		return "    default_bind 0.0.0.0 [::]", nil
	case "::1":
		return "    default_bind [::1]", nil
	case "::":
		return "    default_bind [::]", nil
	default:
		return "", fmt.Errorf("Unsupported managed Caddy bind host: %s", bindHost)
	}
}
