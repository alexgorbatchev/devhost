package caddy

// ResolveManagedCaddyRouteOptions binds sparse/default votes to the running
// settings. Explicit non-default requests remain votes, so conflicting stacks
// are still rejected by global settings resolution.
func ResolveManagedCaddyRouteOptions(options ActivateRouteOptions, settings ManagedCaddyGlobalSettings) ActivateRouteOptions {
	if ResolveManagedCaddyAdminAddress(options.CaddyAdminAddress) == DefaultManagedCaddyAdminAddress {
		options.CaddyAdminAddress = settings.AdminAddress
	}
	if options.CaddyBindHost == "" || options.CaddyBindHost == defaultManagedCaddyBindHost {
		options.CaddyBindHost = settings.BindHost
	}
	if options.CaddyHTTPPort == 0 || options.CaddyHTTPPort == defaultManagedCaddyHTTPPort {
		options.CaddyHTTPPort = settings.HTTPPort
	}
	if options.CaddyHTTPSPort == 0 || options.CaddyHTTPSPort == defaultManagedCaddyHTTPSPort {
		options.CaddyHTTPSPort = settings.HTTPSPort
	}
	return options
}
