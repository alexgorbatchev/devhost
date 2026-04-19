package caddy

import (
	"fmt"
	"strconv"
	"strings"
)

type renderManagedCaddyfileOptions struct {
	AdminAddress string
	BindHost     string
	EnableHTTP   bool
	HTTPPort     int
	HTTPSPort    int
	Paths        Paths
	RuntimeOS    string
}

func renderManagedCaddyfile(options renderManagedCaddyfileOptions) (string, error) {
	adminAddress := ResolveManagedCaddyAdminAddress(options.AdminAddress)
	bindHost := options.BindHost
	if bindHost == "" {
		bindHost = defaultManagedCaddyBindHost
	}
	httpPort := options.HTTPPort
	if httpPort == 0 {
		httpPort = defaultManagedCaddyHTTPPort
	}
	httpsPort := options.HTTPSPort
	if httpsPort == 0 {
		httpsPort = defaultManagedCaddyHTTPSPort
	}

	bindDirective, error := ResolveManagedCaddyBindDirective(options.RuntimeOS, bindHost)
	if error != nil {
		return "", error
	}

	notFoundSitePaths := createManagedCaddyNotFoundSitePaths(options.Paths.CaddyDirectoryPath)
	routesGlobPath := filepathQuote(options.Paths.RoutesDirectoryPath + "/*.caddy")

	globalLines := []string{
		"{",
		fmt.Sprintf("    admin %s", adminAddress),
		"    auto_https disable_redirects",
	}
	if bindDirective != "" {
		globalLines = append(globalLines, bindDirective)
	}
	globalLines = append(globalLines,
		"    persist_config off",
		fmt.Sprintf("    storage file_system %s", filepathQuote(options.Paths.StorageDirectoryPath)),
		"}",
	)

	sections := []string{strings.Join(globalLines, "\n"), fmt.Sprintf("import %s", routesGlobPath)}
	if options.EnableHTTP {
		sections = append(sections, renderFallbackSiteBlock("http", httpPort, notFoundSitePaths.DirectoryPath, false))
	}
	sections = append(sections, renderFallbackSiteBlock("https", httpsPort, notFoundSitePaths.DirectoryPath, true))

	return strings.Join(sections, "\n\n") + "\n", nil
}

func renderFallbackSiteBlock(protocol string, port int, directoryPath string, includeTLS bool) string {
	lines := []string{fmt.Sprintf("%s {", FormatManagedCaddySiteAddress(protocol, port, ""))}
	if includeTLS {
		lines = append(lines,
			"    tls internal {",
			"        on_demand",
			"    }",
			"",
		)
	}

	lines = append(lines,
		fmt.Sprintf("    root * %s", filepathQuote(directoryPath)),
		"",
		"    @devhost_route_not_found_asset file {path}",
		"    handle @devhost_route_not_found_asset {",
		"        file_server",
		"    }",
		"",
		"    handle {",
		"        error 404",
		"    }",
		"",
		"    handle_errors 404 {",
		"        rewrite /index.html",
		"        file_server",
		"    }",
		"}",
	)

	return strings.Join(lines, "\n")
}

func filepathQuote(value string) string {
	return strconv.Quote(value)
}
