package caddy

import (
	"encoding/json"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/statuspage"
)

type managedCaddyNotFoundSitePaths struct {
	DirectoryPath  string
	PagePath       string
	StylesheetPath string
}

type managedCaddyNotFoundRouteLink struct {
	Host string
	Path string
	URL  string
}

var managedCaddyNotFoundPageCSS = statuspage.CSS

func createManagedCaddyNotFoundSitePaths(caddyDirectoryPath string) managedCaddyNotFoundSitePaths {
	directoryPath := filepath.Join(caddyDirectoryPath, "route-not-found")
	return managedCaddyNotFoundSitePaths{
		DirectoryPath:  directoryPath,
		PagePath:       filepath.Join(directoryPath, "index.html"),
		StylesheetPath: filepath.Join(directoryPath, "devhost-route-not-found.css"),
	}
}

func syncManagedCaddyNotFoundSite(routesDirectoryPath string, httpsPort int) error {
	caddyDirectoryPath := filepath.Join(routesDirectoryPath, "..")
	sitePaths := createManagedCaddyNotFoundSitePaths(caddyDirectoryPath)
	routeLinks, err := readActiveRouteLinks(routesDirectoryPath, httpsPort)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(sitePaths.DirectoryPath, 0o755); err != nil {
		return fmt.Errorf("create managed caddy not-found directory %s: %w", sitePaths.DirectoryPath, err)
	}

	if err := os.WriteFile(sitePaths.PagePath, []byte(renderManagedCaddyNotFoundPage(routeLinks)), 0o644); err != nil {
		return fmt.Errorf("write managed caddy not-found page %s: %w", sitePaths.PagePath, err)
	}

	if err := os.WriteFile(sitePaths.StylesheetPath, []byte(managedCaddyNotFoundPageCSS), 0o644); err != nil {
		return fmt.Errorf("write managed caddy not-found stylesheet %s: %w", sitePaths.StylesheetPath, err)
	}

	return nil
}

func readActiveRouteLinks(routesDirectoryPath string, httpsPort int) ([]managedCaddyNotFoundRouteLink, error) {
	registrationsDirectoryPath := filepath.Join(routesDirectoryPath, ".registrations")
	entries, err := os.ReadDir(registrationsDirectoryPath)
	if err != nil {
		return nil, fmt.Errorf("read managed caddy registrations directory %s: %w", registrationsDirectoryPath, err)
	}

	routeLinksByHost := map[string]managedCaddyNotFoundRouteLink{}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		registrationPath := filepath.Join(registrationsDirectoryPath, entry.Name())
		registrationText, err := os.ReadFile(registrationPath)
		if err != nil {
			return nil, fmt.Errorf("read managed route registration %s: %w", registrationPath, err)
		}

		registration, err := parseManagedRouteLinkRegistration(registrationText)
		if err != nil {
			return nil, fmt.Errorf("parse managed route registration %s: %w", registrationPath, err)
		}

		routeFilePath, err := readRouteFilePath(registration.Host, entry.Name(), routesDirectoryPath)
		if err != nil {
			return nil, err
		}
		if !pathExists(routeFilePath) {
			continue
		}

		candidateLink := managedCaddyNotFoundRouteLink{
			Host: registration.Host,
			Path: registration.Path,
			URL:  CreateManagedCaddyURL("https", registration.Host, httpsPort, normalizeRoutePath(registration.Path)),
		}

		existingLink, ok := routeLinksByHost[registration.Host]
		if !ok || compareManagedRouteLinks(candidateLink, existingLink) < 0 {
			routeLinksByHost[registration.Host] = candidateLink
		}
	}

	routeLinks := make([]managedCaddyNotFoundRouteLink, 0, len(routeLinksByHost))
	for _, routeLink := range routeLinksByHost {
		routeLinks = append(routeLinks, routeLink)
	}

	sort.Slice(routeLinks, func(left int, right int) bool {
		return compareManagedRouteLinks(routeLinks[left], routeLinks[right]) < 0
	})
	return routeLinks, nil
}

func renderManagedCaddyNotFoundPage(routeLinks []managedCaddyNotFoundRouteLink) string {
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
		`    <link rel="stylesheet" href="/devhost-route-not-found.css">`,
		"  </head>",
		"  <body>",
		`    <main class="devhost-status">`,
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

func renderManagedRouteList(routeLinks []managedCaddyNotFoundRouteLink) string {
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

func parseManagedRouteLinkRegistration(registrationText []byte) (managedRouteRecord, error) {
	var value map[string]any
	if err := json.Unmarshal(registrationText, &value); err != nil {
		return managedRouteRecord{}, err
	}

	host, ok := value["host"].(string)
	if !ok {
		return managedRouteRecord{}, fmt.Errorf("Managed route registration is malformed.")
	}

	path, hasPath := value["path"].(string)
	if !hasPath {
		path = "/"
	}

	return managedRouteRecord{Host: host, Path: normalizeRoutePath(path)}, nil
}

func compareManagedRouteLinks(left managedCaddyNotFoundRouteLink, right managedCaddyNotFoundRouteLink) int {
	if hostComparison := strings.Compare(left.Host, right.Host); hostComparison != 0 {
		return hostComparison
	}

	return strings.Compare(left.Path, right.Path)
}

func readRouteFilePath(host string, registrationFileName string, routesDirectoryPath string) (string, error) {
	hostRoutePath := filepath.Join(routesDirectoryPath, fmt.Sprintf("%s.caddy", encodePathSegment(host)))
	if pathExists(hostRoutePath) {
		return hostRoutePath, nil
	}

	return filepath.Join(routesDirectoryPath, strings.TrimSuffix(registrationFileName, ".json")+".caddy"), nil
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
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
