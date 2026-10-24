package statuspage

// RouteLink is a hostname and its navigable route.
type RouteLink struct {
	Host string `json:"host"`
	URL  string `json:"url"`
}

// NotFoundPage renders the managed proxy page for live routes or development previews.
func NotFoundPage(routeLinks []RouteLink, stylesheetURL string) (string, error) {
	return Render(Page{
		Kind: "not-found", Status: 404,
		Title:   "No active devhost route matched this hostname.",
		Message: "The request reached the managed devhost Caddy instance, but this hostname is not currently mapped to an active route. If you expected an app here, check that the stack is running and that the service has claimed the correct host.",
		Routes:  routeLinks,
	}, stylesheetURL)
}
