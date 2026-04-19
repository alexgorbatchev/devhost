package caddy

import (
	"encoding/json"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type managedRouteRegistration struct {
	Host string
	Path string
}

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

var managedCaddyNotFoundPageCSS = `:root {
  color-scheme: dark;
  font-family: "Maple Mono Normal NF", "JetBrainsMono Nerd Font", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --surface-base: #0b0f19;
  --surface-subtle: #161d2b;
  --surface-raised: #121826;
  --surface-inverse: #f8fafc;
  --text-strong: #f8fafc;
  --text-muted: #aab4c6;
  --text-subtle: #8792a6;
  --text-inverse: #111827;
  --background: var(--surface-base);
  --foreground: var(--text-strong);
  --card: var(--surface-raised);
  --card-foreground: var(--text-strong);
  --popover: var(--surface-raised);
  --popover-foreground: var(--text-strong);
  --muted: var(--surface-subtle);
  --muted-foreground: var(--text-muted);
  --accent: #20293a;
  --accent-foreground: var(--text-strong);
  --secondary: var(--surface-subtle);
  --secondary-foreground: var(--text-strong);
  --primary: var(--surface-inverse);
  --primary-foreground: var(--text-inverse);
  --border: #273247;
  --border-subtle: #20293a;
  --border-strong: #334155;
  --input: #2b364a;
  --ring: #7aa2f7;
  --terminal: #0f1420;
  --terminal-foreground: #e5ecf5;
  --page-spotlight: radial-gradient(circle at top, rgba(148, 163, 184, 0.14), transparent 42%);
  --selection-background: rgba(122, 162, 247, 0.28);
  --selection-foreground: #f8fafc;
  --shadow-soft: 0 1px 2px rgba(2, 6, 23, 0.32);
  --shadow-raised: 0 18px 38px rgba(2, 6, 23, 0.28);
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 7px;
}

@media (prefers-color-scheme: light) {
  :root {
    color-scheme: light;
    --surface-base: #fcfcfd;
    --surface-subtle: #f5f7fb;
    --surface-raised: #ffffff;
    --surface-inverse: #111827;
    --text-strong: #111827;
    --text-muted: #667085;
    --text-subtle: #98a2b3;
    --text-inverse: #f8fafc;
    --background: var(--surface-base);
    --foreground: var(--text-strong);
    --card: var(--surface-raised);
    --card-foreground: var(--text-strong);
    --popover: var(--surface-raised);
    --popover-foreground: var(--text-strong);
    --muted: var(--surface-subtle);
    --muted-foreground: var(--text-muted);
    --accent: #eef2f7;
    --accent-foreground: var(--text-strong);
    --secondary: #f8fafc;
    --secondary-foreground: var(--text-strong);
    --primary: var(--surface-inverse);
    --primary-foreground: var(--text-inverse);
    --border: #e5e7eb;
    --border-subtle: #eceff3;
    --border-strong: #d7dce5;
    --input: #d7dce5;
    --ring: #3b82f6;
    --terminal: #111827;
    --terminal-foreground: #f8fafc;
    --page-spotlight: radial-gradient(circle at top, rgba(17, 24, 39, 0.06), transparent 42%);
    --selection-background: rgba(59, 130, 246, 0.18);
    --selection-foreground: #111827;
    --shadow-soft: 0 1px 2px rgba(15, 23, 42, 0.04);
    --shadow-raised: 0 12px 24px rgba(15, 23, 42, 0.08);
  }
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
}

body {
  min-height: 100vh;
  padding: 24px;
  display: grid;
  place-items: center;
  background: var(--page-spotlight), var(--background);
  background-attachment: fixed;
  color: var(--foreground);
  font-family: var(--font-mono, "Maple Mono Normal NF", "JetBrainsMono Nerd Font", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
}

.devhost-not-found {
  width: min(760px, 100%);
  padding: 40px 32px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg, 12px);
  background: var(--card);
  box-shadow: var(--shadow-raised);
  text-align: center;
}

.devhost-not-found__code {
  margin: 0;
  font-size: clamp(5rem, 18vw, 8rem);
  line-height: 0.92;
  letter-spacing: -0.06em;
  font-weight: 700;
  color: var(--foreground);
}

.devhost-not-found__title {
  margin: 16px 0 0;
  font-size: clamp(1.8rem, 4vw, 2.5rem);
  line-height: 1.08;
  font-weight: 600;
  color: var(--foreground);
}

.devhost-not-found__body {
  max-width: 42rem;
  margin: 16px auto 0;
  color: var(--text-muted);
  font-size: 1rem;
  line-height: 1.65;
}

.devhost-not-found__routes {
  margin-top: 32px;
  text-align: left;
}

.devhost-not-found__label {
  margin: 0 0 12px;
  color: var(--text-muted);
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.devhost-not-found__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}

.devhost-not-found__link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md, 8px);
  background: var(--surface-subtle);
  color: inherit;
  text-decoration: none;
  transition:
    transform 120ms ease,
    border-color 120ms ease,
    background-color 120ms ease,
    box-shadow 120ms ease;
}

.devhost-not-found__link:hover,
.devhost-not-found__link:focus-visible {
  transform: translateY(-1px);
  border-color: var(--ring);
  background: var(--surface-base);
  box-shadow: var(--shadow-soft);
}

.devhost-not-found__link:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 3px;
}

.devhost-not-found__route {
  min-width: 0;
  overflow-wrap: anywhere;
  font-weight: 600;
  color: var(--foreground);
}

.devhost-not-found__arrow {
  flex: none;
  color: var(--ring);
  font-size: 1.1rem;
}

.devhost-not-found__empty {
  margin: 0;
  padding: 20px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md, 8px);
  color: var(--text-muted);
  background: var(--surface-subtle);
}

@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .devhost-not-found {
    padding: 32px 20px;
  }
}
`

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
	routeLinks, error := readActiveRouteLinks(routesDirectoryPath, httpsPort)
	if error != nil {
		return error
	}

	if error := os.MkdirAll(sitePaths.DirectoryPath, 0o755); error != nil {
		return fmt.Errorf("create managed caddy not-found directory %s: %w", sitePaths.DirectoryPath, error)
	}

	if error := os.WriteFile(sitePaths.PagePath, []byte(renderManagedCaddyNotFoundPage(routeLinks)), 0o644); error != nil {
		return fmt.Errorf("write managed caddy not-found page %s: %w", sitePaths.PagePath, error)
	}

	if error := os.WriteFile(sitePaths.StylesheetPath, []byte(managedCaddyNotFoundPageCSS), 0o644); error != nil {
		return fmt.Errorf("write managed caddy not-found stylesheet %s: %w", sitePaths.StylesheetPath, error)
	}

	return nil
}

func readActiveRouteLinks(routesDirectoryPath string, httpsPort int) ([]managedCaddyNotFoundRouteLink, error) {
	registrationsDirectoryPath := filepath.Join(routesDirectoryPath, ".registrations")
	entries, error := os.ReadDir(registrationsDirectoryPath)
	if error != nil {
		return nil, fmt.Errorf("read managed caddy registrations directory %s: %w", registrationsDirectoryPath, error)
	}

	routeLinksByHost := map[string]managedCaddyNotFoundRouteLink{}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		registrationPath := filepath.Join(registrationsDirectoryPath, entry.Name())
		registrationText, error := os.ReadFile(registrationPath)
		if error != nil {
			return nil, fmt.Errorf("read managed route registration %s: %w", registrationPath, error)
		}

		registration, error := parseManagedRouteRegistration(registrationText)
		if error != nil {
			return nil, fmt.Errorf("parse managed route registration %s: %w", registrationPath, error)
		}

		routeFilePath, error := readRouteFilePath(registration.Host, entry.Name(), routesDirectoryPath)
		if error != nil {
			return nil, error
		}
		if !pathExists(routeFilePath) {
			continue
		}

		candidateLink := managedCaddyNotFoundRouteLink{
			Host: registration.Host,
			Path: registration.Path,
			URL:  CreateManagedCaddyURL("https", registration.Host, httpsPort, normalizeManagedRoutePath(registration.Path)),
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
			`<p class="devhost-not-found__empty">`,
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
		`    <main class="devhost-not-found">`,
		`      <p class="devhost-not-found__code">404</p>`,
		`      <h1 class="devhost-not-found__title">No active devhost route matched this hostname.</h1>`,
		`      <p class="devhost-not-found__body">`,
		`        The request reached the managed devhost Caddy instance, but this hostname is not currently mapped to an`,
		`        active route. If you expected an app here, check that the stack is running and that the service has claimed`,
		`        the correct host.`,
		`      </p>`,
		`      <section class="devhost-not-found__routes" aria-labelledby="devhost-not-found-routes">`,
		`        <h2 class="devhost-not-found__label" id="devhost-not-found-routes">Active hostnames</h2>`,
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
			fmt.Sprintf(`  <a class="devhost-not-found__link" href="%s">`, html.EscapeString(routeLink.URL)),
			fmt.Sprintf(`    <span class="devhost-not-found__route">%s</span>`, html.EscapeString(routeLink.Host)),
			`    <span class="devhost-not-found__arrow" aria-hidden="true">&#8599;</span>`,
			"  </a>",
			"</li>",
		}, "\n"))
	}

	return strings.Join([]string{
		`<ul class="devhost-not-found__list">`,
		indentLines(strings.Join(items, "\n"), "  "),
		`</ul>`,
	}, "\n")
}

func parseManagedRouteRegistration(registrationText []byte) (managedRouteRegistration, error) {
	var value map[string]any
	if error := json.Unmarshal(registrationText, &value); error != nil {
		return managedRouteRegistration{}, error
	}

	host, ok := value["host"].(string)
	if !ok {
		return managedRouteRegistration{}, fmt.Errorf("Managed route registration is malformed.")
	}

	path, hasPath := value["path"].(string)
	if !hasPath {
		path = "/"
	}

	return managedRouteRegistration{Host: host, Path: normalizeManagedRoutePath(path)}, nil
}

func normalizeManagedRoutePath(path string) string {
	if path == "/" || path == "/*" {
		return "/"
	}

	return path
}

func compareManagedRouteLinks(left managedCaddyNotFoundRouteLink, right managedCaddyNotFoundRouteLink) int {
	if hostComparison := strings.Compare(left.Host, right.Host); hostComparison != 0 {
		return hostComparison
	}

	return strings.Compare(left.Path, right.Path)
}

func readRouteFilePath(host string, registrationFileName string, routesDirectoryPath string) (string, error) {
	hostRoutePath := filepath.Join(routesDirectoryPath, fmt.Sprintf("%s.caddy", encodeManagedPathSegment(host)))
	if pathExists(hostRoutePath) {
		return hostRoutePath, nil
	}

	return filepath.Join(routesDirectoryPath, strings.TrimSuffix(registrationFileName, ".json")+".caddy"), nil
}

func encodeManagedPathSegment(value string) string {
	return strings.ReplaceAll(value, ":", "_")
}

func pathExists(path string) bool {
	_, error := os.Stat(path)
	return error == nil
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
