package caddy

import (
	"encoding/json"
	"fmt"
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

var managedCaddyNotFoundPageCSS = statuspage.PageCSS

func createManagedCaddyNotFoundSitePaths(caddyDirectoryPath string) managedCaddyNotFoundSitePaths {
	directoryPath := filepath.Join(caddyDirectoryPath, "route-not-found")
	return managedCaddyNotFoundSitePaths{
		DirectoryPath:  directoryPath,
		PagePath:       filepath.Join(directoryPath, "index.html"),
		StylesheetPath: filepath.Join(directoryPath, "devhost-route-not-found.css"),
	}
}

func syncManagedCaddyNotFoundSite(routesDirectoryPath string, settings ManagedCaddyGlobalSettings) error {
	caddyDirectoryPath := filepath.Join(routesDirectoryPath, "..")
	sitePaths := createManagedCaddyNotFoundSitePaths(caddyDirectoryPath)
	routeLinks, err := readActiveRouteLinks(routesDirectoryPath, settings.HTTPSPort)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(sitePaths.DirectoryPath, 0o755); err != nil {
		return fmt.Errorf("create managed caddy not-found directory %s: %w", sitePaths.DirectoryPath, err)
	}

	document, err := renderManagedCaddyNotFoundPage(routeLinks)
	if err != nil {
		return err
	}
	if err := os.WriteFile(sitePaths.PagePath, []byte(document), 0o644); err != nil {
		return fmt.Errorf("write managed caddy not-found page %s: %w", sitePaths.PagePath, err)
	}

	if err := os.WriteFile(sitePaths.StylesheetPath, []byte(managedCaddyNotFoundPageCSS), 0o644); err != nil {
		return fmt.Errorf("write managed caddy not-found stylesheet %s: %w", sitePaths.StylesheetPath, err)
	}

	return syncStackDirectorySite(CreateManagedCaddyPathsForRoutesDirectory(routesDirectoryPath), settings)
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

func renderManagedCaddyNotFoundPage(routeLinks []managedCaddyNotFoundRouteLink) (string, error) {
	links := make([]statuspage.RouteLink, 0, len(routeLinks))
	for _, route := range routeLinks {
		links = append(links, statuspage.RouteLink{Host: route.Host, URL: route.URL})
	}
	return statuspage.NotFoundPage(links, "/devhost-route-not-found.css")
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
