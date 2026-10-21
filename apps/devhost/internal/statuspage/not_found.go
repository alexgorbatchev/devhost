package statuspage

import (
	"fmt"
	"html"
	"strings"
)

// RouteLink is a hostname and its navigable route.
type RouteLink struct{ Host, URL string }

// NotFoundPage renders the managed proxy page for live routes or development previews.
func NotFoundPage(routeLinks []RouteLink, stylesheetURL string) string {
	renderedRoutes := renderManagedRouteList(routeLinks)
	if len(routeLinks) == 0 {
		renderedRoutes = strings.Join([]string{
			`<p class="devhost-status__empty">`,
			`  No devhost hostnames are active right now. Start a stack and the available hostnames will appear here.`,
			`</p>`,
		}, "\n")
	}

	return strings.Join([]string{
		"<!doctype html>",
		`<html lang="en">`,
		"  <head>",
		`    <meta charset="utf-8">`,
		`    <meta name="viewport" content="width=device-width, initial-scale=1">`,
		`    <title>devhost route not found</title>`,
		`    <script>` + ThemeScript + `</script>`,
		`    <link rel="stylesheet" href="` + html.EscapeString(stylesheetURL) + `">`,
		"  </head>",
		"  <body>",
		`    <main class="devhost-status">`,
		`      <p class="devhost-status__brand">devhost / routing</p>`,
		`      <p class="devhost-status__code">404</p>`,
		`      <h1 class="devhost-status__title">No active devhost route matched this hostname.</h1>`,
		`      <p class="devhost-status__body">`,
		`        The request reached the managed devhost Caddy instance, but this hostname is not currently mapped to an`,
		`        active route. If you expected an app here, check that the stack is running and that the service has claimed`,
		`        the correct host.`,
		`      </p>`,
		`      <section class="devhost-status__routes" aria-labelledby="devhost-status-routes">`,
		`        <h2 class="devhost-status__label" id="devhost-status-routes">Active hostnames</h2>`,
		indentLines(renderedRoutes, "        "),
		`      </section>`,
		`    </main>`,
		"  </body>",
		"</html>",
		"",
	}, "\n")
}

func renderManagedRouteList(routeLinks []RouteLink) string {
	if len(routeLinks) == 0 {
		return ""
	}

	items := make([]string, 0, len(routeLinks))
	for _, routeLink := range routeLinks {
		items = append(items, strings.Join([]string{
			"<li>",
			fmt.Sprintf(`  <a class="devhost-status__link" href="%s">`, html.EscapeString(routeLink.URL)),
			fmt.Sprintf(`    <span class="devhost-status__route">%s</span>`, html.EscapeString(routeLink.Host)),
			`    <span class="devhost-status__arrow" aria-hidden="true">&#8599;</span>`,
			"  </a>",
			"</li>",
		}, "\n"))
	}

	return strings.Join([]string{
		`<ul class="devhost-status__list">`,
		indentLines(strings.Join(items, "\n"), "  "),
		`</ul>`,
	}, "\n")
}

func indentLines(text string, indent string) string {
	if text == "" {
		return text
	}

	lines := strings.Split(text, "\n")
	for index, line := range lines {
		if line == "" {
			continue
		}
		lines[index] = indent + line
	}

	return strings.Join(lines, "\n")
}
