package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/charmbracelet/x/ansi"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cli"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/services"
)

func runStackInfo(arguments cli.CommandLineArguments, cwd string, stdout, stderr io.Writer) int {
	if arguments.Session != "" {
		info, err := services.ReadServeInfo(context.Background(), arguments.Session, readEnvironment())
		if err != nil {
			return fail(stderr, err)
		}
		if err := cliout.WriteData(stdout, []byte(formatStackInfo(info, cliout.IsAgentMode(), time.Now().UTC()))); err != nil {
			return fail(stderr, err)
		}
		if !info.Ready {
			return 1
		}
		return 0
	}
	var manifestPath string
	var err error
	if arguments.ManifestPath != nil {
		manifestPath, err = resolveManifestPath(arguments.ManifestPath, cwd)
	} else {
		manifestPath, err = manifest.ResolveManifestPath(cwd)
		if err != nil {
			err = &cliout.Failure{
				Err:     fmt.Errorf("%w Pass --manifest <path> or set DEVHOST_MANIFEST.", err),
				Summary: err.Error(),
				Hint:    "Run devhost from your project folder, or pass --manifest <path>.",
			}
		}
	}
	if err != nil {
		return fail(stderr, err)
	}

	info, err := services.ReadStackInfo(context.Background(), manifestPath, readEnvironment())
	if err != nil {
		var notRunning *services.StackNotRunningError
		if errors.As(err, &notRunning) {
			hint := `Run "devhost start" to start this stack.`
			if notRunning.OtherStacksCount > 0 {
				hint = `Other stacks are running. Run "devhost stack list" to print their PIDs and manifests.`
			}
			return fail(stderr, &cliout.Failure{Err: notRunning, Hint: hint})
		}
		return fail(stderr, err)
	}

	output := formatStackInfo(info, cliout.IsAgentMode(), time.Now().UTC())
	if err := cliout.WriteData(stdout, []byte(output)); err != nil {
		return fail(stderr, fmt.Errorf("writing stack info: %w", err))
	}

	if !info.Ready {
		return 1
	}
	return 0
}

func formatStackInfo(info services.StackInfo, agentMode bool, now time.Time) string {
	if agentMode {
		return formatStackInfoAgent(info)
	}
	return formatStackInfoHuman(info, now)
}

func formatStackInfoHuman(info services.StackInfo, now time.Time) string {
	var out strings.Builder

	headerParts := []string{
		info.Name,
		info.RunState,
		fmt.Sprintf("PID %d", info.PID),
		info.Mode,
	}
	if info.CreatedAt != "" {
		if createdAt, err := time.Parse(time.RFC3339Nano, info.CreatedAt); err == nil {
			headerParts = append(headerParts, "up "+formatUptime(now.Sub(createdAt)))
		}
	}
	out.WriteString(strings.Join(headerParts, " · "))
	out.WriteByte('\n')

	type serviceRow struct {
		name       string
		state      string
		urls       string
		lastOutput string
	}

	rows := make([]serviceRow, 0, len(info.Services))
	maxNameWidth := 0
	maxStateWidth := 0
	for _, service := range info.Services {
		name := service.Name
		if service.Primary {
			name += " (primary)"
		}
		state := formatServiceStateHuman(service)
		urls := "(no route)"
		if len(service.URLs) > 0 {
			urls = strings.Join(service.URLs, ", ")
		}
		maxNameWidth = max(maxNameWidth, ansi.StringWidth(name))
		maxStateWidth = max(maxStateWidth, ansi.StringWidth(state))
		rows = append(rows, serviceRow{
			name:       name,
			state:      state,
			urls:       urls,
			lastOutput: service.LastOutput,
		})
	}

	for _, row := range rows {
		namePadding := strings.Repeat(" ", maxNameWidth-ansi.StringWidth(row.name)+2)
		statePadding := strings.Repeat(" ", maxStateWidth-ansi.StringWidth(row.state)+2)
		out.WriteString(row.name)
		out.WriteString(namePadding)
		out.WriteString(row.state)
		out.WriteString(statePadding)
		out.WriteString(row.urls)
		out.WriteByte('\n')
		if row.lastOutput != "" {
			out.WriteString("  └ ")
			out.WriteString(row.lastOutput)
			out.WriteByte('\n')
		}
	}

	if info.LogPath != "" {
		out.WriteString("Log: ")
		out.WriteString(cliout.DisplayPath(info.LogPath))
		out.WriteByte('\n')
	}

	return out.String()
}

func formatServiceStateHuman(service devtools.StackServiceInfo) string {
	switch service.State {
	case services.ServiceStateExited:
		if service.ExitCode != nil {
			return fmt.Sprintf("exited %d", *service.ExitCode)
		}
		return "exited"
	case services.ServiceStateNotStarted:
		return "not started"
	default:
		return service.State
	}
}

func formatStackInfoAgent(info services.StackInfo) string {
	var out strings.Builder

	stackFields := []string{
		"name=" + formatAgentValue(info.Name),
		"pid=" + strconv.Itoa(info.PID),
		"mode=" + info.Mode,
		"ready=" + strconv.FormatBool(info.Ready),
	}
	if info.Remote {
		stackFields = append(stackFields, "remote=true")
	}
	if info.ManifestPath != "" {
		stackFields = append(stackFields, "manifest="+formatAgentValue(info.ManifestPath))
	}
	if len(info.ManifestFiles) > 0 {
		stackFields = append(stackFields, "manifestFiles="+formatAgentValue(strings.Join(info.ManifestFiles, ",")))
	}
	if info.ControlPort > 0 {
		stackFields = append(stackFields, "controlPort="+strconv.Itoa(info.ControlPort))
	}
	if info.LogPath != "" {
		stackFields = append(stackFields, "log="+formatAgentValue(info.LogPath))
	}
	if info.CreatedAt != "" {
		stackFields = append(stackFields, "createdAt="+info.CreatedAt)
	}
	out.WriteString("devhost: stack ")
	out.WriteString(strings.Join(stackFields, " "))
	out.WriteByte('\n')

	for _, service := range info.Services {
		fields := []string{
			"name=" + formatAgentValue(service.Name),
			"state=" + service.State,
		}
		if service.Primary {
			fields = append(fields, "primary=true")
		}
		if service.ExitCode != nil {
			fields = append(fields, "exitCode="+strconv.Itoa(*service.ExitCode))
		}
		if service.Since != "" {
			fields = append(fields, "since="+service.Since)
		}
		if service.Port != nil {
			fields = append(fields, "port="+strconv.Itoa(*service.Port))
		}
		if len(service.URLs) > 0 {
			fields = append(fields, "url="+formatAgentValue(strings.Join(service.URLs, ",")))
		}
		if service.LastOutput != "" {
			fields = append(fields, "last="+strconv.Quote(service.LastOutput))
		}
		out.WriteString("devhost: service ")
		out.WriteString(strings.Join(fields, " "))
		out.WriteByte('\n')
	}

	return out.String()
}

func formatAgentValue(value string) string {
	if value == "" {
		return `""`
	}
	for _, r := range value {
		if unicode.IsSpace(r) || r == '"' || r == '\\' || r == '=' || r < 0x20 || r == 0x7f {
			return strconv.Quote(value)
		}
	}
	return value
}

func formatUptime(d time.Duration) string {
	if d < 0 {
		d = 0
	}
	seconds := int(d.Seconds())
	if seconds < 60 {
		return fmt.Sprintf("%ds", seconds)
	}
	minutes := seconds / 60
	if minutes < 60 {
		return fmt.Sprintf("%dm", minutes)
	}
	hours := minutes / 60
	remainingMinutes := minutes % 60
	if hours < 24 {
		if remainingMinutes == 0 {
			return fmt.Sprintf("%dh", hours)
		}
		return fmt.Sprintf("%dh %dm", hours, remainingMinutes)
	}
	days := hours / 24
	remainingHours := hours % 24
	if remainingHours == 0 {
		return fmt.Sprintf("%dd", days)
	}
	return fmt.Sprintf("%dd %dh", days, remainingHours)
}
