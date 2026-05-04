package caddy

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"syscall"
	"time"
)

type ClaimFixedPortOptions struct {
	BindHost                string
	ManifestPath            string
	Port                    int
	PortClaimsDirectoryPath string
}

type ClaimHostOptions struct {
	Host                       string
	ManifestPath               string
	RegistrationsDirectoryPath string
}

type ActivateRouteOptions struct {
	AppBindHost           string
	AppPort               int
	CaddyAdminAddress     string
	CaddyBindHost         string
	CaddyOutputWriters    RouteCommandOutputWriters
	CaddyHTTPPort         int
	CaddyHTTPSPort        int
	DevtoolsControlPort   int
	DocumentInjectionPort int
	Host                  string
	HTTPEnabled           bool
	Path                  string
	ServiceName           string
}

type RouteCommandOutputWriters struct {
	StderrWriter io.Writer
	StdoutWriter io.Writer
}

type hostClaim struct {
	CreatedAt    string `json:"createdAt"`
	Host         string `json:"host"`
	ManifestPath string `json:"manifestPath"`
	OwnerPID     int    `json:"ownerPid"`
}

type fixedPortClaim struct {
	BindHost     string `json:"bindHost"`
	CreatedAt    string `json:"createdAt"`
	ManifestPath string `json:"manifestPath"`
	OwnerPID     int    `json:"ownerPid"`
	Port         int    `json:"port"`
}

type routeRegistration struct {
	AppBindHost           string  `json:"appBindHost"`
	AppPort               int     `json:"appPort"`
	CreatedAt             string  `json:"createdAt"`
	Host                  string  `json:"host"`
	ManifestPath          string  `json:"manifestPath"`
	OwnerPID              int     `json:"ownerPid"`
	Path                  string  `json:"path"`
	ServiceName           string  `json:"serviceName"`
	DevtoolsControlPort   *int    `json:"devtoolsControlPort,omitempty"`
	DocumentInjectionPort *int    `json:"documentInjectionPort,omitempty"`
	HTTPEnabled           *bool   `json:"httpEnabled,omitempty"`
	CaddyAdminAddress     *string `json:"caddyAdminAddress,omitempty"`
	CaddyBindHost         *string `json:"caddyBindHost,omitempty"`
	CaddyHTTPPort         *int    `json:"caddyHttpPort,omitempty"`
	CaddyHTTPSPort        *int    `json:"caddyHttpsPort,omitempty"`
}

type legacyRouteRegistration struct {
	CreatedAt string `json:"createdAt"`
	Host      string `json:"host"`
	OwnerPID  int    `json:"ownerPid"`
	Path      string `json:"path"`
	Port      int    `json:"port"`
}

type managedRouteRecord struct {
	AppBindHost           string
	AppPort               int
	CaddyAdminAddress     string
	CaddyBindHost         string
	CaddyHTTPPort         int
	CaddyHTTPSPort        int
	CreatedAt             string
	DevtoolsControlPort   int
	DocumentInjectionPort int
	Host                  string
	HTTPEnabled           bool
	IsLegacy              bool
	ManifestPath          string
	OwnerPID              int
	Path                  string
	Port                  int
	ServiceName           string
}

type routeRegistrationJSON struct {
	AppBindHost           *string `json:"appBindHost"`
	AppPort               *int    `json:"appPort"`
	CreatedAt             *string `json:"createdAt"`
	DevtoolsControlPort   *int    `json:"devtoolsControlPort"`
	DocumentInjectionPort *int    `json:"documentInjectionPort"`
	Host                  *string `json:"host"`
	CaddyAdminAddress     *string `json:"caddyAdminAddress"`
	CaddyBindHost         *string `json:"caddyBindHost"`
	CaddyHTTPPort         *int    `json:"caddyHttpPort"`
	CaddyHTTPSPort        *int    `json:"caddyHttpsPort"`
	HTTPEnabled           *bool   `json:"httpEnabled"`
	ManifestPath          *string `json:"manifestPath"`
	OwnerPID              *int    `json:"ownerPid"`
	Path                  *string `json:"path"`
	ServiceName           *string `json:"serviceName"`
}

type legacyRouteRegistrationJSON struct {
	CreatedAt *string `json:"createdAt"`
	Host      *string `json:"host"`
	OwnerPID  *int    `json:"ownerPid"`
	Path      *string `json:"path"`
	Port      *int    `json:"port"`
}

type hostClaimJSON struct {
	CreatedAt    *string `json:"createdAt"`
	Host         *string `json:"host"`
	ManifestPath *string `json:"manifestPath"`
	OwnerPID     *int    `json:"ownerPid"`
}

type fixedPortClaimJSON struct {
	BindHost     *string `json:"bindHost"`
	CreatedAt    *string `json:"createdAt"`
	ManifestPath *string `json:"manifestPath"`
	OwnerPID     *int    `json:"ownerPid"`
	Port         *int    `json:"port"`
}

var routeMutationNow = time.Now
var routeMutationProcessID = os.Getpid
var routeMutationIsProcessAlive = isManagedProcessAlive
var routeMutationReadListeningProcessLabel = readListeningProcessLabel
var routeMutationRunManagedCaddyCommand = func(paths Paths, arguments []string, options ManagedCaddyCommandOptions) CommandResult {
	return RunManagedCaddyCommand(paths, arguments, options, ManagedCaddyCommandDependencies{})
}

func ClaimFixedPort(options ClaimFixedPortOptions) error {
	claimPath := getFixedPortClaimPath(options.BindHost, options.Port, options.PortClaimsDirectoryPath)
	claimText := createFixedPortClaimText(options.BindHost, options.ManifestPath, options.Port)

	if error := writeFileExclusive(claimPath, claimText); error == nil {
		return nil
	} else if !errors.Is(error, os.ErrExist) {
		return error
	}

	existingClaimText, error := os.ReadFile(claimPath)
	if error != nil {
		return error
	}
	existingClaim, error := parseFixedPortClaim(existingClaimText)
	if error != nil {
		return error
	}
	if !isFixedPortClaimStale(existingClaim) {
		return errors.New(formatFixedPortClaimConflict(options, existingClaim))
	}

	if error := removeIfExists(claimPath); error != nil {
		return error
	}

	return writeFileExclusive(claimPath, claimText)
}

func ReleaseFixedPortClaim(options ClaimFixedPortOptions) error {
	claimPath := getFixedPortClaimPath(options.BindHost, options.Port, options.PortClaimsDirectoryPath)
	claimText, error := os.ReadFile(claimPath)
	if error != nil {
		if errors.Is(error, os.ErrNotExist) {
			return nil
		}
		return error
	}

	claim, error := parseFixedPortClaim(claimText)
	if error != nil {
		return error
	}
	if claim.OwnerPID != routeMutationProcessID() || claim.ManifestPath != options.ManifestPath {
		return nil
	}

	return removeIfExists(claimPath)
}

func CleanupStaleFixedPortClaims(portClaimsDirectoryPath string) error {
	entries, error := os.ReadDir(portClaimsDirectoryPath)
	if error != nil {
		return error
	}

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		claimPath := filepath.Join(portClaimsDirectoryPath, entry.Name())
		claimText, error := os.ReadFile(claimPath)
		if error != nil {
			return error
		}
		claim, error := parseFixedPortClaim(claimText)
		if error != nil {
			return error
		}
		if !isFixedPortClaimStale(claim) {
			continue
		}

		if error := removeIfExists(claimPath); error != nil {
			return error
		}
	}

	return nil
}

func ClaimHost(options ClaimHostOptions) error {
	if error := assertHostIsAvailable(options); error != nil {
		return error
	}

	hostClaimPath := getHostClaimPath(options.Host, options.RegistrationsDirectoryPath)
	claimText := createHostClaimText(options.Host, options.ManifestPath)

	if error := writeFileExclusive(hostClaimPath, claimText); error == nil {
		return nil
	} else if !errors.Is(error, os.ErrExist) {
		return error
	}

	existingClaimText, error := os.ReadFile(hostClaimPath)
	if error != nil {
		return error
	}
	existingClaim, error := parseHostClaim(existingClaimText)
	if error != nil {
		return error
	}
	if isHostClaimStale(existingClaim) {
		if error := removeIfExists(hostClaimPath); error != nil {
			return error
		}
		return writeFileExclusive(hostClaimPath, claimText)
	}
	if existingClaim.OwnerPID == routeMutationProcessID() && existingClaim.ManifestPath == options.ManifestPath {
		return nil
	}

	return fmt.Errorf("%s is already claimed by PID %d from %s.", options.Host, existingClaim.OwnerPID, existingClaim.ManifestPath)
}

func ReleaseHostClaim(options ClaimHostOptions) error {
	claimPath := getHostClaimPath(options.Host, options.RegistrationsDirectoryPath)
	claimText, error := os.ReadFile(claimPath)
	if error != nil {
		if errors.Is(error, os.ErrNotExist) {
			return nil
		}
		return error
	}

	claim, error := parseHostClaim(claimText)
	if error != nil {
		return error
	}
	if claim.OwnerPID != routeMutationProcessID() || claim.ManifestPath != options.ManifestPath {
		return nil
	}

	return removeIfExists(claimPath)
}

func CleanupStaleRegistrations(registrationsDirectoryPath string) error {
	routesDirectoryPath := filepath.Clean(filepath.Join(registrationsDirectoryPath, ".."))
	paths := CreateManagedCaddyPathsForRoutesDirectory(routesDirectoryPath)
	previousSettings, error := readManagedCaddyGlobalSettings(paths, ManagedCaddyConfigFallback{})
	if error != nil {
		return error
	}

	entries, error := os.ReadDir(registrationsDirectoryPath)
	if error != nil {
		return error
	}

	affectedHostsByName := map[string]struct{}{}
	affectedHosts := []string{}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		registrationPath := filepath.Join(registrationsDirectoryPath, entry.Name())
		registrationText, error := os.ReadFile(registrationPath)
		if error != nil {
			return error
		}
		registration, error := parseManagedRouteRecord(registrationText)
		if error != nil {
			return error
		}
		if routeMutationIsProcessAlive(registration.OwnerPID) {
			continue
		}

		if _, ok := affectedHostsByName[registration.Host]; !ok {
			affectedHostsByName[registration.Host] = struct{}{}
			affectedHosts = append(affectedHosts, registration.Host)
		}
		if error := removeIfExists(registrationPath); error != nil {
			return error
		}
		if registration.IsLegacy {
			legacyRoutePath := filepath.Join(routesDirectoryPath, strings.TrimSuffix(entry.Name(), ".json")+".caddy")
			if error := removeIfExists(legacyRoutePath); error != nil {
				return error
			}
		}
	}

	if error := cleanupStaleHostClaims(paths.HostClaimsDirectoryPath); error != nil {
		return error
	}
	for _, host := range affectedHosts {
		if error := syncHostRoute(host, routesDirectoryPath, nil); error != nil {
			return error
		}
	}

	nextSettings, error := readManagedCaddyGlobalSettings(paths, ManagedCaddyConfigFallback{})
	if error != nil {
		return error
	}
	if didManagedCaddyGlobalSettingsChange(previousSettings, nextSettings) {
		if error := syncManagedCaddyGlobalState(routesDirectoryPath, nextSettings); error != nil {
			return error
		}
	}
	if len(affectedHosts) > 0 {
		if error := syncManagedCaddyNotFoundSite(routesDirectoryPath, nextSettings.HTTPSPort); error != nil {
			return error
		}
	}

	return nil
}

func ActivateRoute(options ActivateRouteOptions, manifestPath string, routesDirectoryPath string) error {
	paths := CreateManagedCaddyPathsForRoutesDirectory(routesDirectoryPath)
	routeRegistrationPath := getRouteRegistrationPath(options.ServiceName, options.Host, options.Path, routesDirectoryPath)
	previousSettings, err := readManagedCaddyGlobalSettings(paths, ManagedCaddyConfigFallback{})
	if err != nil {
		return err
	}

	rollback := func(originalError error) error {
		if removeError := removeIfExists(routeRegistrationPath); removeError != nil {
			return removeError
		}

		nextSettings, settingsError := readManagedCaddyGlobalSettings(paths, ManagedCaddyConfigFallback{})
		if settingsError != nil {
			return settingsError
		}
		if syncError := syncHostRoute(options.Host, routesDirectoryPath, &nextSettings); syncError != nil {
			return syncError
		}
		if syncError := syncManagedCaddyNotFoundSite(routesDirectoryPath, nextSettings.HTTPSPort); syncError != nil {
			return syncError
		}

		return originalError
	}

	if error := os.WriteFile(routeRegistrationPath, []byte(createRouteRegistrationText(options, manifestPath)), 0o644); error != nil {
		return rollback(error)
	}

	nextSettings, err := readManagedCaddyGlobalSettings(paths, ManagedCaddyConfigFallback{})
	if err != nil {
		return rollback(err)
	}
	if didManagedCaddyGlobalSettingsChange(previousSettings, nextSettings) {
		if error := syncManagedCaddyGlobalState(routesDirectoryPath, nextSettings); error != nil {
			return rollback(error)
		}
	} else {
		if error := syncHostRoute(options.Host, routesDirectoryPath, &nextSettings); error != nil {
			return rollback(error)
		}
	}
	if error := syncManagedCaddyNotFoundSite(routesDirectoryPath, nextSettings.HTTPSPort); error != nil {
		return rollback(error)
	}
	if error := reloadManagedCaddy(nextSettings.AdminAddress, routesDirectoryPath, options.CaddyOutputWriters); error != nil {
		return rollback(error)
	}

	return nil
}

func UnregisterRoute(
	serviceName string,
	host string,
	path string,
	manifestPath string,
	registrationsDirectoryPath string,
	outputWriters RouteCommandOutputWriters,
) error {
	routesDirectoryPath := filepath.Clean(filepath.Join(registrationsDirectoryPath, ".."))
	paths := CreateManagedCaddyPathsForRoutesDirectory(routesDirectoryPath)
	registrationPath := getRouteRegistrationPath(serviceName, host, path, routesDirectoryPath)
	previousSettings, error := readManagedCaddyGlobalSettings(paths, ManagedCaddyConfigFallback{})
	if error != nil {
		return error
	}

	registrationText, error := os.ReadFile(registrationPath)
	if error != nil {
		return nil
	}
	registration, error := parseRouteRegistration(registrationText)
	if error != nil {
		return nil
	}
	if registration.OwnerPID != routeMutationProcessID() || registration.ManifestPath != manifestPath {
		return nil
	}

	if error := removeIfExists(registrationPath); error != nil {
		return error
	}
	nextSettings, error := readManagedCaddyGlobalSettings(paths, ManagedCaddyConfigFallback{})
	if error != nil {
		return error
	}
	if didManagedCaddyGlobalSettingsChange(previousSettings, nextSettings) {
		if error := syncManagedCaddyGlobalState(routesDirectoryPath, nextSettings); error != nil {
			return error
		}
	} else {
		if error := syncHostRoute(host, routesDirectoryPath, &nextSettings); error != nil {
			return error
		}
	}
	if error := syncManagedCaddyNotFoundSite(routesDirectoryPath, nextSettings.HTTPSPort); error != nil {
		return error
	}

	return reloadManagedCaddy(nextSettings.AdminAddress, routesDirectoryPath, outputWriters)
}

func SyncManagedHostRoute(host string, adminAddress string, routesDirectoryPath string, outputWriters RouteCommandOutputWriters) error {
	if error := syncHostRoute(host, routesDirectoryPath, nil); error != nil {
		return error
	}

	return reloadManagedCaddy(adminAddress, routesDirectoryPath, outputWriters)
}

func ResolveProxyHost(bindHost string) (string, error) {
	switch bindHost {
	case "127.0.0.1", "0.0.0.0":
		return "127.0.0.1", nil
	case "::1", "::":
		return "::1", nil
	default:
		return "", fmt.Errorf("Unsupported bind host: %s", bindHost)
	}
}

func FormatProxyAddress(host string, port int) string {
	return net.JoinHostPort(host, fmt.Sprintf("%d", port))
}

func CreateManagedCaddyReloadErrorMessage(stdout []byte, stderr []byte) string {
	baseMessage := "Caddy reload failed. Is Caddy already running?"
	renderedMessage := CreateManagedCaddyCommandErrorMessage("reload", CommandResult{Stderr: stderr, Stdout: stdout, Success: false})
	if renderedMessage == "Caddy reload failed." {
		return baseMessage
	}

	detail := strings.TrimPrefix(renderedMessage, "Caddy reload failed.\n")
	return baseMessage + "\n" + detail
}

func createFixedPortClaimText(bindHost string, manifestPath string, port int) string {
	claim := fixedPortClaim{
		BindHost:     bindHost,
		CreatedAt:    formatRouteMutationTimestamp(routeMutationNow()),
		ManifestPath: manifestPath,
		OwnerPID:     routeMutationProcessID(),
		Port:         port,
	}
	text, _ := json.MarshalIndent(claim, "", "  ") // Primitive-only fields cannot fail JSON marshaling.
	return string(text)
}

func createHostClaimText(host string, manifestPath string) string {
	claim := hostClaim{
		CreatedAt:    formatRouteMutationTimestamp(routeMutationNow()),
		Host:         host,
		ManifestPath: manifestPath,
		OwnerPID:     routeMutationProcessID(),
	}
	text, _ := json.MarshalIndent(claim, "", "  ") // Primitive-only fields cannot fail JSON marshaling.
	return string(text)
}

func createRouteRegistrationText(options ActivateRouteOptions, manifestPath string) string {
	registration := routeRegistration{
		AppBindHost:  options.AppBindHost,
		AppPort:      options.AppPort,
		CreatedAt:    formatRouteMutationTimestamp(routeMutationNow()),
		Host:         options.Host,
		ManifestPath: manifestPath,
		OwnerPID:     routeMutationProcessID(),
		Path:         normalizeRoutePath(options.Path),
		ServiceName:  options.ServiceName,
	}
	if options.DevtoolsControlPort != 0 {
		registration.DevtoolsControlPort = &options.DevtoolsControlPort
	}
	if options.DocumentInjectionPort != 0 {
		registration.DocumentInjectionPort = &options.DocumentInjectionPort
	}
	if options.HTTPEnabled {
		enabled := true
		registration.HTTPEnabled = &enabled
	}
	if options.CaddyAdminAddress != "" && ResolveManagedCaddyAdminAddress(options.CaddyAdminAddress) != DefaultManagedCaddyAdminAddress {
		adminAddress := ResolveManagedCaddyAdminAddress(options.CaddyAdminAddress)
		registration.CaddyAdminAddress = &adminAddress
	}
	if options.CaddyBindHost != "" && options.CaddyBindHost != defaultManagedCaddyBindHost {
		bindHost := options.CaddyBindHost
		registration.CaddyBindHost = &bindHost
	}
	if options.CaddyHTTPPort != 0 && options.CaddyHTTPPort != defaultManagedCaddyHTTPPort {
		httpPort := options.CaddyHTTPPort
		registration.CaddyHTTPPort = &httpPort
	}
	if options.CaddyHTTPSPort != 0 && options.CaddyHTTPSPort != defaultManagedCaddyHTTPSPort {
		httpsPort := options.CaddyHTTPSPort
		registration.CaddyHTTPSPort = &httpsPort
	}
	text, _ := json.MarshalIndent(registration, "", "  ") // Primitive-only fields cannot fail JSON marshaling.
	return string(text)
}

func renderHostRouteSnippet(
	registrations []routeRegistration,
	httpEnabled bool,
	httpPort int,
	httpsPort int,
) (string, error) {
	if httpPort == 0 {
		httpPort = defaultManagedCaddyHTTPPort
	}
	if httpsPort == 0 {
		httpsPort = defaultManagedCaddyHTTPSPort
	}

	host := registrations[0].Host
	var rootRegistration *routeRegistration
	nonRootRegistrations := make([]routeRegistration, 0, len(registrations))
	for index := range registrations {
		registration := registrations[index]
		if registration.Path == "/" {
			rootRegistration = &registration
			continue
		}
		nonRootRegistrations = append(nonRootRegistrations, registration)
	}

	lines := []string{}
	if httpEnabled {
		httpLines, error := renderHostRouteSiteBlock(FormatManagedCaddySiteAddress("http", httpPort, host), rootRegistration, nonRootRegistrations, false)
		if error != nil {
			return "", error
		}
		lines = append(lines, httpLines...)
	}
	httpsLines, error := renderHostRouteSiteBlock(FormatManagedCaddySiteAddress("https", httpsPort, host), rootRegistration, nonRootRegistrations, true)
	if error != nil {
		return "", error
	}
	lines = append(lines, httpsLines...)
	return strings.Join(lines, "\n"), nil
}

func renderHostRouteSiteBlock(
	siteAddress string,
	rootRegistration *routeRegistration,
	nonRootRegistrations []routeRegistration,
	useInternalTLS bool,
) ([]string, error) {
	lines := []string{siteAddress + "{"}
	// fix: site address formatting parity requires a space before the opening brace.
	lines[0] = siteAddress + " {"
	if useInternalTLS {
		lines = append(lines, "    tls internal")
	}
	lines = append(lines, "")

	if rootRegistration != nil && rootRegistration.DevtoolsControlPort != nil {
		lines = append(lines, renderNamedProxyHandleLines("@devhost_control path /__devhost__/*", "@devhost_control", *rootRegistration.DevtoolsControlPort)...)
		lines = append(lines, "")
	}
	for _, registration := range nonRootRegistrations {
		serviceHandleLines, error := renderServiceHandle(registration)
		if error != nil {
			return nil, error
		}
		lines = append(lines, serviceHandleLines...)
		lines = append(lines, "")
	}
	if rootRegistration != nil {
		if rootRegistration.DevtoolsControlPort != nil && rootRegistration.DocumentInjectionPort != nil {
			lines = append(lines, renderNamedProxyHandleLines("@devhost_document header Sec-Fetch-Dest document", "@devhost_document", *rootRegistration.DocumentInjectionPort)...)
			lines = append(lines, "")
		}
		rootProxyHandleLines, error := renderRootProxyHandleLines(*rootRegistration)
		if error != nil {
			return nil, error
		}
		lines = append(lines, rootProxyHandleLines...)
	} else {
		lines = append(lines, renderRootErrorHandleLines(404)...)
	}
	lines = append(lines, "}\n")

	return lines, nil
}

func renderNamedProxyHandleLines(matcher string, handleName string, port int) []string {
	return []string{
		matcher,
		"handle " + handleName + " {",
		"    reverse_proxy " + FormatProxyAddress("127.0.0.1", port),
		"}",
	}
}

func renderRootProxyHandleLines(registration routeRegistration) ([]string, error) {
	target, error := readAppTarget(registration)
	if error != nil {
		return nil, error
	}

	return []string{
		"handle {",
		"    reverse_proxy " + target,
		"}",
	}, nil
}

func renderRootErrorHandleLines(statusCode int) []string {
	return []string{
		"handle {",
		fmt.Sprintf("    error %d", statusCode),
		"}",
	}
}

func renderServiceHandle(registration routeRegistration) ([]string, error) {
	target, error := readAppTarget(registration)
	if error != nil {
		return nil, error
	}

	return []string{
		fmt.Sprintf("    handle %s {", registration.Path),
		"        reverse_proxy " + target,
		"    }",
	}, nil
}

func readAppTarget(registration routeRegistration) (string, error) {
	host, error := ResolveProxyHost(registration.AppBindHost)
	if error != nil {
		return "", error
	}

	return FormatProxyAddress(host, registration.AppPort), nil
}

func syncHostRoute(host string, routesDirectoryPath string, settings *managedCaddyGlobalSettings) error {
	registrations, error := readHostRegistrations(host, routesDirectoryPath)
	if error != nil {
		return error
	}
	hostRoutePath := getHostRoutePath(host, routesDirectoryPath)
	if len(registrations) == 0 {
		return removeIfExists(hostRoutePath)
	}

	effectiveSettings := managedCaddyGlobalSettings{}
	if settings != nil {
		effectiveSettings = *settings
	} else {
		paths := CreateManagedCaddyPathsForRoutesDirectory(routesDirectoryPath)
		effectiveSettings, error = readManagedCaddyGlobalSettings(paths, ManagedCaddyConfigFallback{})
		if error != nil {
			return error
		}
	}

	snippet, error := renderHostRouteSnippet(registrations, effectiveSettings.HTTPEnabled, effectiveSettings.HTTPPort, effectiveSettings.HTTPSPort)
	if error != nil {
		return error
	}

	return os.WriteFile(hostRoutePath, []byte(snippet), 0o644)
}

func readHostRegistrations(host string, routesDirectoryPath string) ([]routeRegistration, error) {
	registrationsDirectoryPath := filepath.Join(routesDirectoryPath, ".registrations")
	entries, error := os.ReadDir(registrationsDirectoryPath)
	if error != nil {
		return nil, error
	}

	registrations := []routeRegistration{}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		registrationPath := filepath.Join(registrationsDirectoryPath, entry.Name())
		registrationText, error := os.ReadFile(registrationPath)
		if error != nil {
			return nil, error
		}
		record, error := parseManagedRouteRecord(registrationText)
		if error != nil {
			return nil, error
		}
		if record.IsLegacy || record.Host != host {
			continue
		}

		registrations = append(registrations, routeRegistrationFromRecord(record))
	}

	sort.Slice(registrations, func(left int, right int) bool {
		return compareRouteRegistrations(registrations[left], registrations[right]) < 0
	})
	return registrations, nil
}

func compareRouteRegistrations(left routeRegistration, right routeRegistration) int {
	leftWeight := readRoutePriorityWeight(left.Path)
	rightWeight := readRoutePriorityWeight(right.Path)
	if leftWeight != rightWeight {
		return rightWeight - leftWeight
	}

	return strings.Compare(left.ServiceName, right.ServiceName)
}

func readRoutePriorityWeight(path string) int {
	if path == "/" {
		return -1
	}

	basePath := path
	wildcardPenalty := 1
	if strings.HasSuffix(path, "/*") {
		basePath = strings.TrimSuffix(path, "/*")
		wildcardPenalty = 0
	}

	return len(basePath)*10 + wildcardPenalty
}

func parseHostClaim(claimText []byte) (hostClaim, error) {
	var value hostClaimJSON
	if error := json.Unmarshal(claimText, &value); error != nil {
		return hostClaim{}, error
	}
	if value.CreatedAt == nil || value.Host == nil || value.ManifestPath == nil || value.OwnerPID == nil {
		return hostClaim{}, fmt.Errorf("Host claim is malformed.")
	}

	return hostClaim{CreatedAt: *value.CreatedAt, Host: *value.Host, ManifestPath: *value.ManifestPath, OwnerPID: *value.OwnerPID}, nil
}

func parseFixedPortClaim(claimText []byte) (fixedPortClaim, error) {
	var value fixedPortClaimJSON
	if error := json.Unmarshal(claimText, &value); error != nil {
		return fixedPortClaim{}, error
	}
	if value.BindHost == nil || value.CreatedAt == nil || value.ManifestPath == nil || value.OwnerPID == nil || value.Port == nil {
		return fixedPortClaim{}, fmt.Errorf("Fixed port claim is malformed.")
	}

	return fixedPortClaim{
		BindHost:     *value.BindHost,
		CreatedAt:    *value.CreatedAt,
		ManifestPath: *value.ManifestPath,
		OwnerPID:     *value.OwnerPID,
		Port:         *value.Port,
	}, nil
}

func parseManagedRouteRecord(registrationText []byte) (managedRouteRecord, error) {
	var modernValue routeRegistrationJSON
	if error := json.Unmarshal(registrationText, &modernValue); error == nil && isRouteRegistrationJSON(modernValue) {
		record := managedRouteRecord{
			AppBindHost:  *modernValue.AppBindHost,
			AppPort:      *modernValue.AppPort,
			CreatedAt:    *modernValue.CreatedAt,
			Host:         *modernValue.Host,
			ManifestPath: *modernValue.ManifestPath,
			OwnerPID:     *modernValue.OwnerPID,
			Path:         normalizeRoutePath(*modernValue.Path),
			ServiceName:  *modernValue.ServiceName,
		}
		if modernValue.DevtoolsControlPort != nil {
			record.DevtoolsControlPort = *modernValue.DevtoolsControlPort
		}
		if modernValue.DocumentInjectionPort != nil {
			record.DocumentInjectionPort = *modernValue.DocumentInjectionPort
		}
		if modernValue.HTTPEnabled != nil {
			record.HTTPEnabled = *modernValue.HTTPEnabled
		}
		if modernValue.CaddyAdminAddress != nil {
			record.CaddyAdminAddress = *modernValue.CaddyAdminAddress
		}
		if modernValue.CaddyBindHost != nil {
			record.CaddyBindHost = *modernValue.CaddyBindHost
		}
		if modernValue.CaddyHTTPPort != nil {
			record.CaddyHTTPPort = *modernValue.CaddyHTTPPort
		}
		if modernValue.CaddyHTTPSPort != nil {
			record.CaddyHTTPSPort = *modernValue.CaddyHTTPSPort
		}

		return record, nil
	}

	var legacyValue legacyRouteRegistrationJSON
	if error := json.Unmarshal(registrationText, &legacyValue); error == nil && isLegacyRouteRegistrationJSON(legacyValue) {
		path := "/"
		if legacyValue.Path != nil {
			path = normalizeRoutePath(*legacyValue.Path)
		}

		return managedRouteRecord{
			CreatedAt: *legacyValue.CreatedAt,
			Host:      *legacyValue.Host,
			IsLegacy:  true,
			OwnerPID:  *legacyValue.OwnerPID,
			Path:      path,
			Port:      *legacyValue.Port,
		}, nil
	}

	return managedRouteRecord{}, fmt.Errorf("Registration file is malformed.")
}

func parseRouteRegistration(registrationText []byte) (routeRegistration, error) {
	record, error := parseManagedRouteRecord(registrationText)
	if error != nil {
		return routeRegistration{}, error
	}
	if record.IsLegacy {
		return routeRegistration{}, fmt.Errorf("Registration file is malformed.")
	}

	return routeRegistrationFromRecord(record), nil
}

func routeRegistrationFromRecord(record managedRouteRecord) routeRegistration {
	registration := routeRegistration{
		AppBindHost:  record.AppBindHost,
		AppPort:      record.AppPort,
		CreatedAt:    record.CreatedAt,
		Host:         record.Host,
		ManifestPath: record.ManifestPath,
		OwnerPID:     record.OwnerPID,
		Path:         record.Path,
		ServiceName:  record.ServiceName,
	}
	if record.DevtoolsControlPort != 0 {
		registration.DevtoolsControlPort = &record.DevtoolsControlPort
	}
	if record.DocumentInjectionPort != 0 {
		registration.DocumentInjectionPort = &record.DocumentInjectionPort
	}
	if record.HTTPEnabled {
		enabled := true
		registration.HTTPEnabled = &enabled
	}
	if record.CaddyAdminAddress != "" {
		registration.CaddyAdminAddress = &record.CaddyAdminAddress
	}
	if record.CaddyBindHost != "" {
		registration.CaddyBindHost = &record.CaddyBindHost
	}
	if record.CaddyHTTPPort != 0 {
		registration.CaddyHTTPPort = &record.CaddyHTTPPort
	}
	if record.CaddyHTTPSPort != 0 {
		registration.CaddyHTTPSPort = &record.CaddyHTTPSPort
	}

	return registration
}

func isRouteRegistrationJSON(value routeRegistrationJSON) bool {
	return value.AppBindHost != nil &&
		value.AppPort != nil &&
		value.CreatedAt != nil &&
		value.Host != nil &&
		value.ManifestPath != nil &&
		value.OwnerPID != nil &&
		value.Path != nil &&
		value.ServiceName != nil &&
		(value.HTTPEnabled == nil || *value.HTTPEnabled)
}

func isLegacyRouteRegistrationJSON(value legacyRouteRegistrationJSON) bool {
	return value.CreatedAt != nil && value.Host != nil && value.OwnerPID != nil && value.Port != nil
}

func normalizeRoutePath(path string) string {
	if path == "/" || path == "/*" {
		return "/"
	}

	return path
}

func getRouteRegistrationPath(serviceName string, host string, path string, routesDirectoryPath string) string {
	return filepath.Join(filepath.Join(routesDirectoryPath, ".registrations"), fmt.Sprintf("%s_%s_%s.json", encodePathSegment(host), serviceName, encodeRoutePathSegment(normalizeRoutePath(path))))
}

func getHostRoutePath(host string, routesDirectoryPath string) string {
	return filepath.Join(routesDirectoryPath, encodePathSegment(host)+".caddy")
}

func getHostClaimPath(host string, registrationsDirectoryPath string) string {
	return filepath.Join(filepath.Clean(filepath.Join(registrationsDirectoryPath, "..")), ".host-claims", encodePathSegment(host)+".json")
}

func getFixedPortClaimPath(bindHost string, port int, portClaimsDirectoryPath string) string {
	return filepath.Join(portClaimsDirectoryPath, fmt.Sprintf("%s_%d.json", readFixedPortClaimScope(bindHost), port))
}

func formatFixedPortClaimConflict(options ClaimFixedPortOptions, claim fixedPortClaim) string {
	listenerProcessLabel := routeMutationReadListeningProcessLabel(options.Port)
	if listenerProcessLabel == "" {
		return fmt.Sprintf("%s:%d is already claimed via %s.", options.BindHost, options.Port, claim.ManifestPath)
	}

	return fmt.Sprintf("%s:%d is already in use by %s via %s.", options.BindHost, options.Port, listenerProcessLabel, claim.ManifestPath)
}

func readListeningProcessLabel(port int) string {
	if _, error := exec.LookPath("lsof"); error != nil {
		return ""
	}

	result, error := exec.Command("lsof", "-nP", fmt.Sprintf("-iTCP:%d", port), "-sTCP:LISTEN", "-Fpc").Output()
	if error != nil {
		return ""
	}

	processCommandName := ""
	processID := ""
	for _, line := range strings.Split(string(result), "\n") {
		if len(line) <= 1 {
			continue
		}
		switch line[0] {
		case 'c':
			processCommandName = line[1:]
		case 'p':
			processID = line[1:]
		}
	}

	if processID != "" {
		if processLabel := readProcessLabel(processID); processLabel != "" {
			return quoteProcessLabel(processLabel)
		}
	}

	if processCommandName == "" {
		return ""
	}

	return quoteProcessLabel(processCommandName)
}

func readProcessLabel(processID string) string {
	if processArgs := readProcessCommandLine(processID); len(processArgs) > 0 {
		return formatProcessCommandLine(processArgs)
	}

	if processArgs := readProcessArgs(processID); processArgs != "" {
		return normalizeProcessArgs(processArgs)
	}

	return ""
}

func readProcessCommandLine(processID string) []string {
	result, error := os.ReadFile(filepath.Join("/proc", processID, "cmdline"))
	if error != nil || len(result) == 0 {
		return nil
	}

	parts := bytes.Split(result, []byte{0})
	arguments := make([]string, 0, len(parts))
	for _, part := range parts {
		if len(part) == 0 {
			continue
		}
		arguments = append(arguments, string(part))
	}

	if len(arguments) == 0 {
		return nil
	}

	return arguments
}

func readProcessArgs(processID string) string {
	if _, error := exec.LookPath("ps"); error != nil {
		return ""
	}

	result, error := exec.Command("ps", "-o", "args=", "-p", processID).Output()
	if error != nil {
		return ""
	}

	return strings.TrimSpace(string(result))
}

func formatProcessCommandLine(arguments []string) string {
	if len(arguments) == 0 {
		return ""
	}

	normalizedArguments := append([]string(nil), arguments...)
	normalizedArguments[0] = normalizeProcessExecutable(arguments[0])
	return strings.Join(normalizedArguments, " ")
}

func normalizeProcessArgs(value string) string {
	trimmedValue := strings.TrimSpace(value)
	if trimmedValue == "" {
		return ""
	}

	executablePath, remainder, found := strings.Cut(trimmedValue, " ")
	normalizedExecutable := normalizeProcessExecutable(executablePath)
	if !found {
		return normalizedExecutable
	}

	return normalizedExecutable + " " + remainder
}

func normalizeProcessExecutable(value string) string {
	if value == "" {
		return ""
	}

	if strings.ContainsRune(value, filepath.Separator) {
		return filepath.Base(value)
	}

	return value
}

func quoteProcessLabel(value string) string {
	return "`" + strings.ReplaceAll(value, "`", "'") + "`"
}

func readFixedPortClaimScope(bindHost string) string {
	switch bindHost {
	case "127.0.0.1", "0.0.0.0":
		return "ipv4"
	case "::1", "::":
		return "ipv6"
	default:
		return encodePathSegment(bindHost)
	}
}

func encodePathSegment(value string) string {
	return strings.ReplaceAll(value, ":", "_")
}

func encodeRoutePathSegment(path string) string {
	return hex.EncodeToString([]byte(path))
}

func isHostClaimStale(claim hostClaim) bool {
	if claim.OwnerPID == routeMutationProcessID() {
		return false
	}

	return !routeMutationIsProcessAlive(claim.OwnerPID)
}

func isFixedPortClaimStale(claim fixedPortClaim) bool {
	if claim.OwnerPID == routeMutationProcessID() {
		return false
	}

	return !routeMutationIsProcessAlive(claim.OwnerPID)
}

func assertHostIsAvailable(options ClaimHostOptions) error {
	entries, error := os.ReadDir(options.RegistrationsDirectoryPath)
	if error != nil {
		return error
	}

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		registrationPath := filepath.Join(options.RegistrationsDirectoryPath, entry.Name())
		registrationText, error := os.ReadFile(registrationPath)
		if error != nil {
			return error
		}
		registration, error := parseManagedRouteRecord(registrationText)
		if error != nil {
			return error
		}
		if registration.Host != options.Host || !routeMutationIsProcessAlive(registration.OwnerPID) {
			continue
		}
		if !registration.IsLegacy {
			if registration.OwnerPID == routeMutationProcessID() && registration.ManifestPath == options.ManifestPath {
				continue
			}

			return fmt.Errorf("%s is already claimed by PID %d from %s.", options.Host, registration.OwnerPID, registration.ManifestPath)
		}

		return fmt.Errorf("%s is already claimed by PID %d on port %d.", options.Host, registration.OwnerPID, registration.Port)
	}

	return nil
}

func cleanupStaleHostClaims(hostClaimsDirectoryPath string) error {
	entries, error := os.ReadDir(hostClaimsDirectoryPath)
	if error != nil {
		return error
	}

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		claimPath := filepath.Join(hostClaimsDirectoryPath, entry.Name())
		claimText, error := os.ReadFile(claimPath)
		if error != nil {
			return error
		}
		claim, error := parseHostClaim(claimText)
		if error != nil {
			return error
		}
		if !isHostClaimStale(claim) {
			continue
		}

		if error := removeIfExists(claimPath); error != nil {
			return error
		}
	}

	return nil
}

func didManagedCaddyGlobalSettingsChange(previousSettings managedCaddyGlobalSettings, nextSettings managedCaddyGlobalSettings) bool {
	return previousSettings.AdminAddress != nextSettings.AdminAddress ||
		previousSettings.BindHost != nextSettings.BindHost ||
		previousSettings.HTTPEnabled != nextSettings.HTTPEnabled ||
		previousSettings.HTTPPort != nextSettings.HTTPPort ||
		previousSettings.HTTPSPort != nextSettings.HTTPSPort
}

func syncManagedCaddyGlobalState(routesDirectoryPath string, settings managedCaddyGlobalSettings) error {
	paths := CreateManagedCaddyPathsForRoutesDirectory(routesDirectoryPath)
	entries, error := os.ReadDir(paths.RegistrationsDirectoryPath)
	if error != nil {
		return error
	}

	hostsByName := map[string]struct{}{}
	hosts := []string{}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		registrationPath := filepath.Join(paths.RegistrationsDirectoryPath, entry.Name())
		registrationText, error := os.ReadFile(registrationPath)
		if error != nil {
			return error
		}
		registration, error := parseManagedRouteRecord(registrationText)
		if error != nil {
			return error
		}
		if registration.IsLegacy {
			continue
		}
		if _, ok := hostsByName[registration.Host]; ok {
			continue
		}

		hostsByName[registration.Host] = struct{}{}
		hosts = append(hosts, registration.Host)
	}

	caddyfile, error := renderManagedCaddyfile(renderManagedCaddyfileOptions{
		AdminAddress: settings.AdminAddress,
		BindHost:     settings.BindHost,
		EnableHTTP:   settings.HTTPEnabled,
		HTTPPort:     settings.HTTPPort,
		HTTPSPort:    settings.HTTPSPort,
		Paths:        paths,
		RuntimeOS:    runtime.GOOS,
	})
	if error != nil {
		return error
	}
	if error := os.WriteFile(paths.CaddyfilePath, []byte(caddyfile), 0o644); error != nil {
		return error
	}
	for _, host := range hosts {
		if error := syncHostRoute(host, routesDirectoryPath, &settings); error != nil {
			return error
		}
	}

	return nil
}

func reloadManagedCaddy(adminAddress string, routesDirectoryPath string, outputWriters RouteCommandOutputWriters) error {
	paths := CreateManagedCaddyPathsForRoutesDirectory(routesDirectoryPath)
	result := routeMutationRunManagedCaddyCommand(paths, []string{"reload"}, ManagedCaddyCommandOptions{AdminAddress: adminAddress})
	if result.Success {
		if error := writeSuccessfulCommandOutput(outputWriters.StderrWriter, result.Stderr); error != nil {
			return fmt.Errorf("write caddy reload stderr: %w", error)
		}
		if error := writeSuccessfulCommandOutput(outputWriters.StdoutWriter, result.Stdout); error != nil {
			return fmt.Errorf("write caddy reload stdout: %w", error)
		}

		return nil
	}

	return errors.New(CreateManagedCaddyReloadErrorMessage(result.Stdout, result.Stderr))
}

func writeSuccessfulCommandOutput(writer io.Writer, output []byte) error {
	if writer == nil || len(output) == 0 {
		return nil
	}

	_, error := writer.Write(output)
	return error
}

func formatRouteMutationTimestamp(value time.Time) string {
	return value.UTC().Truncate(time.Millisecond).Format("2006-01-02T15:04:05.000Z")
}

func removeIfExists(path string) error {
	error := os.Remove(path)
	if error != nil && !errors.Is(error, os.ErrNotExist) {
		return error
	}

	return nil
}

func writeFileExclusive(path string, text string) error {
	file, error := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if error != nil {
		return error
	}
	if _, error := file.WriteString(text); error != nil {
		_ = file.Close() // best-effort close after write failure.
		return error
	}

	return file.Close()
}

func isManagedProcessAlive(processID int) bool {
	process, error := os.FindProcess(processID)
	if error != nil {
		return false
	}

	error = process.Signal(syscall.Signal(0))
	return error == nil || errors.Is(error, syscall.EPERM)
}
