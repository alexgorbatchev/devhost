package services

import (
	"context"
	"fmt"
	"io"
	"net"
	"strconv"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

const (
	startupProgressDelay    = 2 * time.Second
	startupProgressInterval = 5 * time.Second
)

type startupHealthOptions struct {
	stackName    string
	logWriter    io.Writer
	readExitCode func() *int
}

func waitForStartupHealth(ctx context.Context, service ResolvedService, options startupHealthOptions) error {
	var lastProgressLog time.Time
	var mismatch string
	err := WaitForServiceHealth(ctx, WaitForServiceHealthOptions{
		Health: service.Health, ServiceName: service.Name, ReadExitCode: options.readExitCode,
		OnProgress: func(_ int, elapsed time.Duration) {
			now := time.Now()
			if elapsed < startupProgressDelay || (!lastProgressLog.IsZero() && now.Sub(lastProgressLog) < startupProgressInterval) {
				return
			}
			lastProgressLog = now
			writeLogLine(options.logWriter, options.stackName, fmt.Sprintf(
				"Waiting for service %s to pass its %s (elapsed: %s; timeout: %s)...",
				service.Name, describeStartupHealth(service.Health), elapsed.Round(time.Second), time.Duration(service.Health.Timeout)*time.Millisecond,
			))
			if mismatch == "" {
				mismatch = startupBindMismatch(ctx, service)
				if mismatch != "" {
					writeLogLine(options.logWriter, options.stackName, fmt.Sprintf("WARNING: Service %s: %s", service.Name, mismatch))
				}
			}
		},
	})
	if err == nil || ctx.Err() != nil {
		return err
	}
	if options.readExitCode != nil && options.readExitCode() != nil {
		return err
	}

	switch service.Health.Kind {
	case HealthKindTCP:
		address := startupTCPAddress(service.Health)
		if address == "" {
			return err
		}
		if mismatch == "" {
			mismatch = startupBindMismatch(ctx, service)
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if mismatch == "" {
			mismatch = fmt.Sprintf("Configure the app to listen on %s and check its startup logs.", address)
		}
		return fmt.Errorf("%w TCP health check could not connect to %s. %s", err, address, mismatch)
	case HealthKindHTTP:
		if service.Health.URL != nil {
			return fmt.Errorf("%w HTTP health check requires a 2xx response from %s. Check the app's startup logs and services.%s.health.http.", err, *service.Health.URL, service.Name)
		}
	}
	return err
}

func describeStartupHealth(health ResolvedHealthConfig) string {
	switch health.Kind {
	case HealthKindTCP:
		return "TCP health check on " + startupTCPAddress(health)
	case HealthKindHTTP:
		if health.URL != nil {
			return "HTTP health check on " + *health.URL
		}
	}
	return "health check"
}

func startupTCPAddress(health ResolvedHealthConfig) string {
	if health.Host == nil || health.Port == nil {
		return ""
	}
	host, err := caddy.ResolveProxyHost(*health.Host)
	if err != nil {
		return ""
	}
	return net.JoinHostPort(host, strconv.Itoa(*health.Port))
}

func startupBindMismatch(ctx context.Context, service ResolvedService) string {
	health := service.Health
	if health.Kind != HealthKindTCP || health.Host == nil || health.Port == nil {
		return ""
	}
	altHost := readAlternativeBindHost(*health.Host)
	if altHost == "" || !canConnectToPort(ctx, altHost, *health.Port, probeTimeoutFor(health)) {
		return ""
	}
	return fmt.Sprintf(
		"A TCP connection to %s succeeded instead. Set services.%s.bindHost = %q in your manifest, or configure the app to listen on %s.",
		net.JoinHostPort(altHost, strconv.Itoa(*health.Port)), service.Name, altHost, startupTCPAddress(health),
	)
}
