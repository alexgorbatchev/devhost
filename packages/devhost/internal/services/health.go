package services

import (
	"fmt"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/alexgorbatchev/devhost/packages/devhost/internal/caddy"
)

const pollIntervalDuration = 200 * time.Millisecond

type WaitForServiceHealthOptions struct {
	Health       ResolvedHealthConfig
	ReadExitCode func() *int
	ServiceName  string
}

type healthDependencies struct {
	canConnectToPort    func(string, int) bool
	isReadyHTTPEndpoint func(string) bool
	now                 func() time.Time
	sleep               func(time.Duration)
}

func WaitForServiceHealth(options WaitForServiceHealthOptions) error {
	return waitForServiceHealth(options, healthDependencies{
		canConnectToPort:    canConnectToPort,
		isReadyHTTPEndpoint: isReadyHTTPEndpoint,
		now:                 time.Now,
		sleep:               time.Sleep,
	})
}

func CheckServiceHealth(health ResolvedHealthConfig) bool {
	return checkServiceHealth(health, healthDependencies{
		canConnectToPort:    canConnectToPort,
		isReadyHTTPEndpoint: isReadyHTTPEndpoint,
	})
}

func waitForServiceHealth(options WaitForServiceHealthOptions, dependencies healthDependencies) error {
	if options.Health.Kind == "process" {
		return throwIfExited(options.ReadExitCode, options.ServiceName)
	}

	timeout := time.Duration(options.Health.Timeout) * time.Millisecond
	interval := time.Duration(options.Health.Interval) * time.Millisecond
	deadline := dependencies.now().Add(timeout)
	consecutiveFailures := 0

	for dependencies.now().Before(deadline) {
		if checkServiceHealth(options.Health, dependencies) {
			consecutiveFailures = 0
			return nil
		}

		consecutiveFailures++
		if options.Health.Retries > 0 && consecutiveFailures > options.Health.Retries {
			return fmt.Errorf("Service %s failed its health check %d consecutive times.", options.ServiceName, consecutiveFailures)
		}

		if error := throwIfExited(options.ReadExitCode, options.ServiceName); error != nil {
			return error
		}

		dependencies.sleep(interval)
	}

	return fmt.Errorf("Service %s did not pass its health check within %dms.", options.ServiceName, options.Health.Timeout)
}

func throwIfExited(readExitCode func() *int, serviceName string) error {
	if readExitCode == nil {
		return nil
	}

	exitCode := readExitCode()
	if exitCode == nil {
		return nil
	}

	return fmt.Errorf("Service %s exited before passing its health check with code %d.", serviceName, *exitCode)
}

func checkServiceHealth(health ResolvedHealthConfig, dependencies healthDependencies) bool {
	if health.Kind == "process" {
		return true
	}

	if health.Kind == "tcp" {
		if health.Host == nil || health.Port == nil {
			return false
		}

		resolvedHost, error := caddy.ResolveProxyHost(*health.Host)
		if error != nil {
			return false
		}

		return dependencies.canConnectToPort(resolvedHost, *health.Port)
	}

	if health.URL == nil {
		return false
	}

	return dependencies.isReadyHTTPEndpoint(*health.URL)
}

func canConnectToPort(host string, port int) bool {
	connection, error := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), pollIntervalDuration)
	if error != nil {
		return false
	}
	defer connection.Close()

	return true
}

func isReadyHTTPEndpoint(url string) bool {
	client := http.Client{
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Timeout: pollIntervalDuration,
	}

	response, error := client.Get(url)
	if error != nil {
		return false
	}
	defer response.Body.Close()

	return response.StatusCode >= 200 && response.StatusCode < 300
}
