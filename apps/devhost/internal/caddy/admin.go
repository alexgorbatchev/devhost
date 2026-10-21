package caddy

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
)

const caddyAdminTimeout = time.Second

type AdminAvailabilityDependencies struct {
	HTTPClient *http.Client
}

func EnsureManagedCaddyAdminAvailable(adminAPIURL string, dependencies AdminAvailabilityDependencies) error {
	httpClient := dependencies.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{}
	}

	requestContext, cancel := context.WithTimeout(context.Background(), caddyAdminTimeout)
	defer cancel()

	request, err := http.NewRequestWithContext(requestContext, http.MethodGet, adminAPIURL, nil)
	if err != nil {
		return managedCaddyAdminFailure(err.Error())
	}

	response, err := httpClient.Do(request)
	if err != nil {
		return managedCaddyAdminFailure(err.Error())
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		detail := strings.TrimSpace(fmt.Sprintf("HTTP %s", response.Status))
		return managedCaddyAdminFailure(detail)
	}

	return nil
}

func managedCaddyAdminFailure(detail string) error {
	return &cliout.Failure{Err: fmt.Errorf("%s", CreateManagedCaddyAdminUnavailableErrorMessage(detail)), Summary: "Caddy is not available.", Hint: "Run 'devhost caddy start' first."}
}

func CreateManagedCaddyAdminUnavailableErrorMessage(detail string) string {
	baseMessage := "Caddy admin API is not available. Run 'devhost caddy start' first."
	normalizedDetail := normalizeManagedCaddyAdminErrorDetail(detail)
	if normalizedDetail == "" {
		return baseMessage
	}

	return baseMessage + "\ndetail: " + normalizedDetail
}

func normalizeManagedCaddyAdminErrorDetail(detail string) string {
	trimmedDetail := strings.TrimSpace(strings.ReplaceAll(detail, " Is the computer able to access the url?", ""))
	return trimmedDetail
}
