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
	KillZombies             bool
	LogWriter               io.Writer
}

type ClaimHostOptions struct {
	Host                       string
	ManifestPath               string
	RegistrationsDirectoryPath string
	KillZombies                bool
	LogWriter                  io.Writer
}

type ActivateRouteOptions struct {
	ProxyLocalOrigin      bool
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
	StackName             string
}

type RouteCommandOutputWriters struct {
	StderrWriter io.Writer
	StdoutWriter io.Writer
}

type hostClaim struct {
	CreatedAt          string `json:"createdAt"`
	Host               string `json:"host"`
	ManifestPath       string `json:"manifestPath"`
	OwnerPID           int    `json:"ownerPid"`
	OwnerStartIdentity string `json:"ownerStartIdentity,omitempty"`
}

type fixedPortClaim struct {
	BindHost           string `json:"bindHost"`
	CreatedAt          string `json:"createdAt"`
	ManifestPath       string `json:"manifestPath"`
	OwnerPID           int    `json:"ownerPid"`
	OwnerStartIdentity string `json:"ownerStartIdentity,omitempty"`
	Port               int    `json:"port"`
}

type routeRegistration struct {
	ProxyLocalOrigin      bool    `json:"proxyLocalOrigin,omitempty"`
	AppBindHost           string  `json:"appBindHost"`
	AppPort               int     `json:"appPort"`
	CreatedAt             string  `json:"createdAt"`
	Host                  string  `json:"host"`
	ManifestPath          string  `json:"manifestPath"`
	OwnerPID              int     `json:"ownerPid"`
	OwnerStartIdentity    string  `json:"ownerStartIdentity,omitempty"`
	Path                  string  `json:"path"`
	ServiceName           string  `json:"serviceName"`
	DevtoolsControlPort   *int    `json:"devtoolsControlPort,omitempty"`
	DocumentInjectionPort *int    `json:"documentInjectionPort,omitempty"`
	HTTPEnabled           *bool   `json:"httpEnabled,omitempty"`
	CaddyAdminAddress     *string `json:"caddyAdminAddress,omitempty"`
	CaddyBindHost         *string `json:"caddyBindHost,omitempty"`
	CaddyHTTPPort         *int    `json:"caddyHttpPort,omitempty"`
	CaddyHTTPSPort        *int    `json:"caddyHttpsPort,omitempty"`
	StackName             string  `json:"stackName,omitempty"`
}

type legacyRouteRegistration struct {
	CreatedAt string `json:"createdAt"`
	Host      string `json:"host"`
	OwnerPID  int    `json:"ownerPid"`
	Path      string `json:"path"`
	Port      int    `json:"port"`
}

type managedRouteRecord struct {
	ProxyLocalOrigin      bool
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
	OwnerStartIdentity    string
	Path                  string
	Port                  int
	ServiceName           string
	StackName             string
}

type routeRegistrationJSON struct {
	ProxyLocalOrigin      *bool   `json:"proxyLocalOrigin"`
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
	OwnerStartIdentity    *string `json:"ownerStartIdentity"`
	Path                  *string `json:"path"`
	ServiceName           *string `json:"serviceName"`
	StackName             *string `json:"stackName"`
}

type legacyRouteRegistrationJSON struct {
	CreatedAt *string `json:"createdAt"`
	Host      *string `json:"host"`
	OwnerPID  *int    `json:"ownerPid"`
	Path      *string `json:"path"`
	Port      *int    `json:"port"`
}

type hostClaimJSON struct {
	CreatedAt          *string `json:"createdAt"`
	Host               *string `json:"host"`
	ManifestPath       *string `json:"manifestPath"`
	OwnerPID           *int    `json:"ownerPid"`
	OwnerStartIdentity *string `json:"ownerStartIdentity"`
}

type fixedPortClaimJSON struct {
	BindHost           *string `json:"bindHost"`
	CreatedAt          *string `json:"createdAt"`
	ManifestPath       *string `json:"manifestPath"`
	OwnerPID           *int    `json:"ownerPid"`
	OwnerStartIdentity *string `json:"ownerStartIdentity"`
	Port               *int    `json:"port"`
}

var routeMutationNow = time.Now
var routeMutationProcessID = os.Getpid
var routeMutationIsOwnerAlive = isRecordOwnerAlive
var routeMutationOwnerStartIdentity = readOwnStartIdentity
var routeMutationReadListeningProcessLabel = readListeningProcessLabel
var routeMutationRunManagedCaddyCommand = func(paths Paths, arguments []string, options ManagedCaddyCommandOptions) CommandResult {
	return RunManagedCaddyCommand(paths, arguments, options, ManagedCaddyCommandDependencies{})
}

func ClaimFixedPort(options ClaimFixedPortOptions) error {
	claimPath := getFixedPortClaimPath(options.BindHost, options.Port, options.PortClaimsDirectoryPath)
	claimText := createFixedPortClaimText(options.BindHost, options.ManifestPath, options.Port)

	if err := writeFileExclusive(claimPath, claimText); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrExist) {
		return err
	}

	existingClaimText, err := os.ReadFile(claimPath)
	if err != nil {
		return err
	}
	existingClaim, err := parseFixedPortClaim(existingClaimText)
	if err != nil {
		return err
	}
	if !isFixedPortClaimStale(existingClaim) {
		if options.KillZombies && existingClaim.ManifestPath == options.ManifestPath && existingClaim.OwnerPID != routeMutationProcessID() {
			if options.LogWriter != nil {
				_, _ = fmt.Fprintf(options.LogWriter, "[devhost] Killing zombie PID %d claiming port %d...\n", existingClaim.OwnerPID, options.Port)
			}
			if process, err := os.FindProcess(existingClaim.OwnerPID); err == nil {
				_ = process.Kill()
			}
			if err := removeIfExists(claimPath); err != nil {
				return err
			}
			return writeFileExclusive(claimPath, claimText)
		}

		return errors.New(formatFixedPortClaimConflict(options, existingClaim))
	}

	if err := removeIfExists(claimPath); err != nil {
		return err
	}

	return writeFileExclusive(claimPath, claimText)
}

func ReleaseFixedPortClaim(options ClaimFixedPortOptions) error {
	claimPath := getFixedPortClaimPath(options.BindHost, options.Port, options.PortClaimsDirectoryPath)
	claimText, err := os.ReadFile(claimPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}

	claim, err := parseFixedPortClaim(claimText)
	if err != nil {
		return err
	}
	if claim.OwnerPID != routeMutationProcessID() || claim.ManifestPath != options.ManifestPath {
		return nil
	}

	return removeIfExists(claimPath)
}

func CleanupStaleFixedPortClaims(portClaimsDirectoryPath string) error {
	entries, err := os.ReadDir(portClaimsDirectoryPath)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		claimPath := filepath.Join(portClaimsDirectoryPath, entry.Name())
		claimText, err := os.ReadFile(claimPath)
		if err != nil {
			return err
		}
		claim, err := parseFixedPortClaim(claimText)
		if err != nil {
			return err
		}
		if !isFixedPortClaimStale(claim) {
			continue
		}

		if err := removeIfExists(claimPath); err != nil {
			return err
		}
	}

	return nil
}

func ClaimHost(options ClaimHostOptions) error {
	if err := assertHostIsAvailable(options); err != nil {
		return err
	}

	hostClaimPath := getHostClaimPath(options.Host, options.RegistrationsDirectoryPath)
	claimText := createHostClaimText(options.Host, options.ManifestPath)

	if err := writeFileExclusive(hostClaimPath, claimText); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrExist) {
		return err
	}

	existingClaimText, err := os.ReadFile(hostClaimPath)
	if err != nil {
		return err
	}
	existingClaim, err := parseHostClaim(existingClaimText)
	if err != nil {
		return err
	}
	if isHostClaimStale(existingClaim) {
		if err := removeIfExists(hostClaimPath); err != nil {
			return err
		}
		return writeFileExclusive(hostClaimPath, claimText)
	}
	if existingClaim.OwnerPID == routeMutationProcessID() && existingClaim.ManifestPath == options.ManifestPath {
		return nil
	}

	if options.KillZombies && existingClaim.ManifestPath == options.ManifestPath {
		if options.LogWriter != nil {
			_, _ = fmt.Fprintf(options.LogWriter, "[devhost] Killing zombie PID %d claiming %s...\n", existingClaim.OwnerPID, options.Host)
		}
		if process, err := os.FindProcess(existingClaim.OwnerPID); err == nil {
			_ = process.Kill()
		}
		if err := removeIfExists(hostClaimPath); err != nil {
			return err
		}
		return writeFileExclusive(hostClaimPath, claimText)
	}

	return fmt.Errorf("%s is already claimed by PID %d from %s.", options.Host, existingClaim.OwnerPID, existingClaim.ManifestPath)
}

func ReleaseHostClaim(options ClaimHostOptions) error {
	claimPath := getHostClaimPath(options.Host, options.RegistrationsDirectoryPath)
	claimText, err := os.ReadFile(claimPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}

	claim, err := parseHostClaim(claimText)
	if err != nil {
		return err
	}
	if claim.OwnerPID != routeMutationProcessID() || claim.ManifestPath != options.ManifestPath {
		return nil
	}

	return removeIfExists(claimPath)
}

func CleanupStaleRegistrations(registrationsDirectoryPath string, fallback ManagedCaddyConfigFallback) error {
	routesDirectoryPath := filepath.Clean(filepath.Join(registrationsDirectoryPath, ".."))
	paths := CreateManagedCaddyPathsForRoutesDirectory(routesDirectoryPath)
	previousSettings, err := ReadManagedCaddyGlobalSettings(paths, fallback)
	if err != nil {
		return err
	}

	entries, err := os.ReadDir(registrationsDirectoryPath)
	if err != nil {
		return err
	}

	affectedHostsByName := map[string]struct{}{}
	affectedHosts := []string{}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		registrationPath := filepath.Join(registrationsDirectoryPath, entry.Name())
		registrationText, err := os.ReadFile(registrationPath)
		if err != nil {
			return err
		}
		registration, err := parseManagedRouteRecord(registrationText)
		if err != nil {
			return err
		}
		if routeMutationIsOwnerAlive(registration.OwnerPID, registration.OwnerStartIdentity) {
			continue
		}

		if _, ok := affectedHostsByName[registration.Host]; !ok {
			affectedHostsByName[registration.Host] = struct{}{}
			affectedHosts = append(affectedHosts, registration.Host)
		}
		if err := removeIfExists(registrationPath); err != nil {
			return err
		}
		if registration.IsLegacy {
			legacyRoutePath := filepath.Join(routesDirectoryPath, strings.TrimSuffix(entry.Name(), ".json")+".caddy")
			if err := removeIfExists(legacyRoutePath); err != nil {
				return err
			}
		}
	}

	if err := cleanupStaleHostClaims(paths.HostClaimsDirectoryPath); err != nil {
		return err
	}
	for _, host := range affectedHosts {
		if err := syncHostRoute(host, routesDirectoryPath, nil); err != nil {
			return err
		}
	}

	nextSettings, err := ReadManagedCaddyGlobalSettings(paths, fallback)
	if err != nil {
		return err
	}
	if didManagedCaddyGlobalSettingsChange(previousSettings, nextSettings) {
		if err := syncManagedCaddyGlobalState(routesDirectoryPath, nextSettings); err != nil {
			return err
		}
	}
	if len(affectedHosts) > 0 {
		if err := syncManagedCaddyNotFoundSite(routesDirectoryPath, nextSettings.HTTPSPort); err != nil {
			return err
		}
	}

	return nil
}

func UnregisterRoute(
	serviceName string,
	host string,
	path string,
	manifestPath string,
	registrationsDirectoryPath string,
	fallback ManagedCaddyConfigFallback,
	outputWriters RouteCommandOutputWriters,
) error {
	routesDirectoryPath := filepath.Clean(filepath.Join(registrationsDirectoryPath, ".."))
	paths := CreateManagedCaddyPathsForRoutesDirectory(routesDirectoryPath)
	registrationPath := getRouteRegistrationPath(serviceName, host, path, routesDirectoryPath)
	previousSettings, err := ReadManagedCaddyGlobalSettings(paths, fallback)
	if err != nil {
		return err
	}

	registrationText, err := os.ReadFile(registrationPath)
	if err != nil {
		return nil
	}
	registration, err := parseRouteRegistration(registrationText)
	if err != nil {
		return nil
	}
	if registration.OwnerPID != routeMutationProcessID() || registration.ManifestPath != manifestPath {
		return nil
	}

	if err := removeIfExists(registrationPath); err != nil {
		return err
	}
	nextSettings, err := ReadManagedCaddyGlobalSettings(paths, fallback)
	if err != nil {
		return err
	}
	if didManagedCaddyGlobalSettingsChange(previousSettings, nextSettings) {
		if err := syncManagedCaddyGlobalState(routesDirectoryPath, nextSettings); err != nil {
			return err
		}
	}
	if err := syncHostRoute(host, routesDirectoryPath, &nextSettings); err != nil {
		return err
	}
	if err := syncManagedCaddyNotFoundSite(routesDirectoryPath, nextSettings.HTTPSPort); err != nil {
		return err
	}

	return reloadManagedCaddy(previousSettings.AdminAddress, routesDirectoryPath, outputWriters)
}

func SyncManagedHostRoute(host string, adminAddress string, routesDirectoryPath string, outputWriters RouteCommandOutputWriters) error {
	if err := syncHostRoute(host, routesDirectoryPath, nil); err != nil {
		return err
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
		BindHost:           bindHost,
		CreatedAt:          formatRouteMutationTimestamp(routeMutationNow()),
		ManifestPath:       manifestPath,
		OwnerPID:           routeMutationProcessID(),
		OwnerStartIdentity: routeMutationOwnerStartIdentity(),
		Port:               port,
	}
	text, _ := json.MarshalIndent(claim, "", "  ") // Primitive-only fields cannot fail JSON marshaling.
	return string(text)
}

func createHostClaimText(host string, manifestPath string) string {
	claim := hostClaim{
		CreatedAt:          formatRouteMutationTimestamp(routeMutationNow()),
		Host:               host,
		ManifestPath:       manifestPath,
		OwnerPID:           routeMutationProcessID(),
		OwnerStartIdentity: routeMutationOwnerStartIdentity(),
	}
	text, _ := json.MarshalIndent(claim, "", "  ") // Primitive-only fields cannot fail JSON marshaling.
	return string(text)
}

func createRouteRegistrationText(options ActivateRouteOptions, manifestPath string) string {
	registration := routeRegistration{
		ProxyLocalOrigin:   options.ProxyLocalOrigin,
		AppBindHost:        options.AppBindHost,
		AppPort:            options.AppPort,
		CreatedAt:          formatRouteMutationTimestamp(routeMutationNow()),
		Host:               options.Host,
		ManifestPath:       manifestPath,
		OwnerPID:           routeMutationProcessID(),
		OwnerStartIdentity: routeMutationOwnerStartIdentity(),
		Path:               normalizeRoutePath(options.Path),
		ServiceName:        options.ServiceName,
		StackName:          options.StackName,
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
	routesDirectoryPath string,
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
		httpLines, err := renderHostRouteSiteBlock(FormatManagedCaddySiteAddress("http", httpPort, host), rootRegistration, nonRootRegistrations, false, routesDirectoryPath)
		if err != nil {
			return "", err
		}
		lines = append(lines, httpLines...)
	}
	httpsLines, err := renderHostRouteSiteBlock(FormatManagedCaddySiteAddress("https", httpsPort, host), rootRegistration, nonRootRegistrations, true, routesDirectoryPath)
	if err != nil {
		return "", err
	}
	lines = append(lines, httpsLines...)
	return strings.Join(lines, "\n"), nil
}

func renderHostRouteSiteBlock(
	siteAddress string,
	rootRegistration *routeRegistration,
	nonRootRegistrations []routeRegistration,
	useInternalTLS bool,
	routesDirectoryPath string,
) ([]string, error) {
	lines := []string{siteAddress + "{"}
	// fix: site address formatting parity requires a space before the opening brace.
	lines[0] = siteAddress + " {"
	if useInternalTLS {
		lines = append(lines, "    tls internal")
	}
	lines = append(lines, "")

	var stackName string
	if rootRegistration != nil && rootRegistration.StackName != "" {
		stackName = rootRegistration.StackName
	} else {
		for _, reg := range nonRootRegistrations {
			if reg.StackName != "" {
				stackName = reg.StackName
				break
			}
		}
	}

	if stackName != "" {
		paths := CreateManagedCaddyPathsForRoutesDirectory(routesDirectoryPath)
		logFilePath := filepath.Join(paths.CaddyDirectoryPath, "logs", fmt.Sprintf("%s_access.log", stackName))
		logFileSlash := filepath.ToSlash(logFilePath)
		lines = append(lines, "    log {")
		lines = append(lines, "        output file \""+logFileSlash+"\"")
		lines = append(lines, "    }")
		lines = append(lines, "")
	}

	if rootRegistration != nil && rootRegistration.DevtoolsControlPort != nil {
		lines = append(lines, renderNamedProxyHandleLines("@devhost_control path /__devhost__/*", "@devhost_control", *rootRegistration.DevtoolsControlPort)...)
		lines = append(lines, "")
	}
	for _, registration := range nonRootRegistrations {
		serviceHandleLines, err := renderServiceHandle(registration)
		if err != nil {
			return nil, err
		}
		lines = append(lines, serviceHandleLines...)
		lines = append(lines, "")
	}
	if rootRegistration != nil {
		if rootRegistration.DocumentInjectionPort != nil {
			lines = append(lines, renderRecoveryProxyHandleLines(*rootRegistration)...)
			documentLines, err := renderDocumentProxyHandleLines(*rootRegistration)
			if err != nil {
				return nil, err
			}
			lines = append(lines, documentLines...)
			lines = append(lines, "")
		}
		rootProxyHandleLines, err := renderRootProxyHandleLines(*rootRegistration)
		if err != nil {
			return nil, err
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
	target, err := readAppTarget(registration)
	if err != nil {
		return nil, err
	}

	proxyLines, err := renderServiceProxyLines(registration, target, true)
	if err != nil {
		return nil, err
	}
	lines := append([]string{"handle {"}, indentProxyLines(proxyLines, 4)...)
	return append(lines, "}"), nil
}

func renderRootErrorHandleLines(statusCode int) []string {
	return []string{
		"handle {",
		fmt.Sprintf("    error %d", statusCode),
		"}",
	}
}

func renderServiceHandle(registration routeRegistration) ([]string, error) {
	target, err := readAppTarget(registration)
	if err != nil {
		return nil, err
	}

	proxyLines, err := renderServiceProxyLines(registration, target, true)
	if err != nil {
		return nil, err
	}
	lines := []string{fmt.Sprintf("    handle %s {", registration.Path)}
	if registration.DocumentInjectionPort != nil {
		lines = append(lines, indentProxyLines(renderRecoveryProxyHandleLines(registration), 8)...)
		documentLines, err := renderDocumentProxyHandleLines(registration)
		if err != nil {
			return nil, err
		}
		lines = append(lines, indentProxyLines(documentLines, 8)...)
		lines = append(lines, "        handle {")
		lines = append(lines, indentProxyLines(proxyLines, 12)...)
		lines = append(lines, "        }")
	} else {
		lines = append(lines, indentProxyLines(proxyLines, 8)...)
	}
	return append(lines, "    }"), nil
}

func renderRecoveryProxyHandleLines(registration routeRegistration) []string {
	// Recovery requests retain the browser's public Origin for mutation checks;
	// proxyLocalOrigin translation applies only to traffic forwarded to the app.
	matcher := "@devhost_recovery_" + registration.ServiceName
	return renderNamedProxyHandleLines(matcher+" header X-Devhost-Recovery *", matcher, *registration.DocumentInjectionPort)
}

func readAppTarget(registration routeRegistration) (string, error) {
	host, err := ResolveProxyHost(registration.AppBindHost)
	if err != nil {
		return "", err
	}

	return FormatProxyAddress(host, registration.AppPort), nil
}

func syncHostRoute(host string, routesDirectoryPath string, settings *ManagedCaddyGlobalSettings) error {
	registrations, err := readHostRegistrations(host, routesDirectoryPath)
	if err != nil {
		return err
	}
	hostRoutePath := getHostRoutePath(host, routesDirectoryPath)
	if len(registrations) == 0 {
		return removeIfExists(hostRoutePath)
	}

	effectiveSettings := ManagedCaddyGlobalSettings{}
	if settings != nil {
		effectiveSettings = *settings
	} else {
		paths := CreateManagedCaddyPathsForRoutesDirectory(routesDirectoryPath)
		effectiveSettings, err = ReadManagedCaddyGlobalSettings(paths, ManagedCaddyConfigFallback{})
		if err != nil {
			return err
		}
	}

	snippet, err := renderHostRouteSnippet(registrations, effectiveSettings.HTTPEnabled, effectiveSettings.HTTPPort, effectiveSettings.HTTPSPort, routesDirectoryPath)
	if err != nil {
		return err
	}

	return os.WriteFile(hostRoutePath, []byte(snippet), 0o644)
}

func readHostRegistrations(host string, routesDirectoryPath string) ([]routeRegistration, error) {
	registrationsDirectoryPath := filepath.Join(routesDirectoryPath, ".registrations")
	entries, err := os.ReadDir(registrationsDirectoryPath)
	if err != nil {
		return nil, err
	}

	registrations := []routeRegistration{}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		registrationPath := filepath.Join(registrationsDirectoryPath, entry.Name())
		registrationText, err := os.ReadFile(registrationPath)
		if err != nil {
			return nil, err
		}
		record, err := parseManagedRouteRecord(registrationText)
		if err != nil {
			return nil, err
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
	if err := json.Unmarshal(claimText, &value); err != nil {
		return hostClaim{}, err
	}
	if value.CreatedAt == nil || value.Host == nil || value.ManifestPath == nil || value.OwnerPID == nil {
		return hostClaim{}, fmt.Errorf("Host claim is malformed.")
	}

	claim := hostClaim{CreatedAt: *value.CreatedAt, Host: *value.Host, ManifestPath: *value.ManifestPath, OwnerPID: *value.OwnerPID}
	if value.OwnerStartIdentity != nil {
		claim.OwnerStartIdentity = *value.OwnerStartIdentity
	}

	return claim, nil
}

func parseFixedPortClaim(claimText []byte) (fixedPortClaim, error) {
	var value fixedPortClaimJSON
	if err := json.Unmarshal(claimText, &value); err != nil {
		return fixedPortClaim{}, err
	}
	if value.BindHost == nil || value.CreatedAt == nil || value.ManifestPath == nil || value.OwnerPID == nil || value.Port == nil {
		return fixedPortClaim{}, fmt.Errorf("Fixed port claim is malformed.")
	}

	claim := fixedPortClaim{
		BindHost:     *value.BindHost,
		CreatedAt:    *value.CreatedAt,
		ManifestPath: *value.ManifestPath,
		OwnerPID:     *value.OwnerPID,
		Port:         *value.Port,
	}
	if value.OwnerStartIdentity != nil {
		claim.OwnerStartIdentity = *value.OwnerStartIdentity
	}

	return claim, nil
}

func parseManagedRouteRecord(registrationText []byte) (managedRouteRecord, error) {
	var modernValue routeRegistrationJSON
	if err := json.Unmarshal(registrationText, &modernValue); err == nil && isRouteRegistrationJSON(modernValue) {
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
		if modernValue.OwnerStartIdentity != nil {
			record.OwnerStartIdentity = *modernValue.OwnerStartIdentity
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
		if modernValue.StackName != nil {
			record.StackName = *modernValue.StackName
		}
		if modernValue.ProxyLocalOrigin != nil {
			record.ProxyLocalOrigin = *modernValue.ProxyLocalOrigin
		}

		return record, nil
	}

	var legacyValue legacyRouteRegistrationJSON
	if err := json.Unmarshal(registrationText, &legacyValue); err == nil && isLegacyRouteRegistrationJSON(legacyValue) {
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
	record, err := parseManagedRouteRecord(registrationText)
	if err != nil {
		return routeRegistration{}, err
	}
	if record.IsLegacy {
		return routeRegistration{}, fmt.Errorf("Registration file is malformed.")
	}

	return routeRegistrationFromRecord(record), nil
}

func routeRegistrationFromRecord(record managedRouteRecord) routeRegistration {
	registration := routeRegistration{
		ProxyLocalOrigin:   record.ProxyLocalOrigin,
		AppBindHost:        record.AppBindHost,
		AppPort:            record.AppPort,
		CreatedAt:          record.CreatedAt,
		Host:               record.Host,
		ManifestPath:       record.ManifestPath,
		OwnerPID:           record.OwnerPID,
		OwnerStartIdentity: record.OwnerStartIdentity,
		Path:               record.Path,
		ServiceName:        record.ServiceName,
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
	if record.StackName != "" {
		registration.StackName = record.StackName
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
	if _, err := exec.LookPath("lsof"); err != nil {
		return ""
	}

	result, err := exec.Command("lsof", "-nP", fmt.Sprintf("-iTCP:%d", port), "-sTCP:LISTEN", "-Fpc").Output()
	if err != nil {
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
	result, err := os.ReadFile(filepath.Join("/proc", processID, "cmdline"))
	if err != nil || len(result) == 0 {
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
	if _, err := exec.LookPath("ps"); err != nil {
		return ""
	}

	result, err := exec.Command("ps", "-o", "args=", "-p", processID).Output()
	if err != nil {
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

	return !routeMutationIsOwnerAlive(claim.OwnerPID, claim.OwnerStartIdentity)
}

func isFixedPortClaimStale(claim fixedPortClaim) bool {
	if claim.OwnerPID == routeMutationProcessID() {
		return false
	}

	return !routeMutationIsOwnerAlive(claim.OwnerPID, claim.OwnerStartIdentity)
}

func assertHostIsAvailable(options ClaimHostOptions) error {
	entries, err := os.ReadDir(options.RegistrationsDirectoryPath)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		registrationPath := filepath.Join(options.RegistrationsDirectoryPath, entry.Name())
		registrationText, err := os.ReadFile(registrationPath)
		if err != nil {
			return err
		}
		registration, err := parseManagedRouteRecord(registrationText)
		if err != nil {
			return err
		}
		if registration.Host != options.Host || !routeMutationIsOwnerAlive(registration.OwnerPID, registration.OwnerStartIdentity) {
			continue
		}
		if !registration.IsLegacy {
			if registration.OwnerPID == routeMutationProcessID() && registration.ManifestPath == options.ManifestPath {
				continue
			}

			if options.KillZombies && registration.ManifestPath == options.ManifestPath {
				if options.LogWriter != nil {
					_, _ = fmt.Fprintf(options.LogWriter, "[devhost] Killing zombie PID %d claiming %s...\n", registration.OwnerPID, options.Host)
				}
				if process, err := os.FindProcess(registration.OwnerPID); err == nil {
					_ = process.Kill()
				}
				continue
			}

			return fmt.Errorf("%s is already claimed by PID %d from %s.", options.Host, registration.OwnerPID, registration.ManifestPath)
		}

		return fmt.Errorf("%s is already claimed by PID %d on port %d.", options.Host, registration.OwnerPID, registration.Port)
	}

	return nil
}

func cleanupStaleHostClaims(hostClaimsDirectoryPath string) error {
	entries, err := os.ReadDir(hostClaimsDirectoryPath)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		claimPath := filepath.Join(hostClaimsDirectoryPath, entry.Name())
		claimText, err := os.ReadFile(claimPath)
		if err != nil {
			return err
		}
		claim, err := parseHostClaim(claimText)
		if err != nil {
			return err
		}
		if !isHostClaimStale(claim) {
			continue
		}

		if err := removeIfExists(claimPath); err != nil {
			return err
		}
	}

	return nil
}

func didManagedCaddyGlobalSettingsChange(previousSettings ManagedCaddyGlobalSettings, nextSettings ManagedCaddyGlobalSettings) bool {
	return previousSettings.AdminAddress != nextSettings.AdminAddress ||
		previousSettings.BindHost != nextSettings.BindHost ||
		previousSettings.HTTPEnabled != nextSettings.HTTPEnabled ||
		previousSettings.HTTPPort != nextSettings.HTTPPort ||
		previousSettings.HTTPSPort != nextSettings.HTTPSPort
}

func syncManagedCaddyGlobalState(routesDirectoryPath string, settings ManagedCaddyGlobalSettings) error {
	paths := CreateManagedCaddyPathsForRoutesDirectory(routesDirectoryPath)
	entries, err := os.ReadDir(paths.RegistrationsDirectoryPath)
	if err != nil {
		return err
	}

	hostsByName := map[string]struct{}{}
	hosts := []string{}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		registrationPath := filepath.Join(paths.RegistrationsDirectoryPath, entry.Name())
		registrationText, err := os.ReadFile(registrationPath)
		if err != nil {
			return err
		}
		registration, err := parseManagedRouteRecord(registrationText)
		if err != nil {
			return err
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

	caddyfile, err := renderManagedCaddyfile(renderManagedCaddyfileOptions{
		AdminAddress: settings.AdminAddress,
		BindHost:     settings.BindHost,
		EnableHTTP:   settings.HTTPEnabled,
		HTTPPort:     settings.HTTPPort,
		HTTPSPort:    settings.HTTPSPort,
		Paths:        paths,
		RuntimeOS:    runtime.GOOS,
	})
	if err != nil {
		return err
	}
	if err := os.WriteFile(paths.CaddyfilePath, []byte(caddyfile), 0o644); err != nil {
		return err
	}
	for _, host := range hosts {
		if err := syncHostRoute(host, routesDirectoryPath, &settings); err != nil {
			return err
		}
	}

	return nil
}

func reloadManagedCaddy(adminAddress string, routesDirectoryPath string, outputWriters RouteCommandOutputWriters) error {
	paths := CreateManagedCaddyPathsForRoutesDirectory(routesDirectoryPath)
	result := routeMutationRunManagedCaddyCommand(paths, []string{"reload"}, ManagedCaddyCommandOptions{AdminAddress: adminAddress})
	if result.Success {
		if err := writeSuccessfulCommandOutput(outputWriters.StderrWriter, result.Stderr); err != nil {
			return fmt.Errorf("write caddy reload stderr: %w", err)
		}
		if err := writeSuccessfulCommandOutput(outputWriters.StdoutWriter, result.Stdout); err != nil {
			return fmt.Errorf("write caddy reload stdout: %w", err)
		}

		return nil
	}

	return errors.New(CreateManagedCaddyReloadErrorMessage(result.Stdout, result.Stderr))
}

func writeSuccessfulCommandOutput(writer io.Writer, output []byte) error {
	if writer == nil || len(output) == 0 {
		return nil
	}

	_, err := writer.Write(output)
	return err
}

func formatRouteMutationTimestamp(value time.Time) string {
	return value.UTC().Truncate(time.Millisecond).Format("2006-01-02T15:04:05.000Z")
}

func removeIfExists(path string) error {
	err := os.Remove(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}

	return nil
}

func writeFileExclusive(path string, text string) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err := file.WriteString(text); err != nil {
		_ = file.Close() // best-effort close after write failure.
		return err
	}

	return file.Close()
}

func isManagedProcessAlive(processID int) bool {
	process, err := os.FindProcess(processID)
	if err != nil {
		return false
	}

	err = process.Signal(syscall.Signal(0))
	return err == nil || errors.Is(err, syscall.EPERM)
}
