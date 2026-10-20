package caddy

import (
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strings"
)

// caddyOutputLabel is the log label of the lines Caddy writes.
const caddyOutputLabel = "caddy"

// screenedCaddyMessages are lines Caddy writes in normal operation under the
// managed configuration. devhost reports what they mean itself, or nobody
// reading devhost output can act on them.
var screenedCaddyMessages = []string{
	// caddy start; devhost reports the Caddyfile it started.
	"Successfully started Caddy",
	// truststore skips the Firefox (NSS) and Java trust stores when they are absent.
	"not NSS security databases found",
	"define JAVA_HOME environment variable to use the Java trust",
	// devhost explains the password prompt and reports the trust result.
	"installing root certificate (you might be prompted for password)",
	"root certificate is already trusted by system",
	"certificate installed properly in",
	// skip_install_trust: devhost installs the local CA itself.
	"root certificate trust store installation disabled",
	// devhost writes the Caddyfile and its catch-all HTTPS site, and imports route
	// files that exist only while a stack routes a hostname.
	"Caddyfile input is not formatted",
	"on-demand TLS is enabled, but no protections are in place",
	"No files matching import glob pattern",
}

// Caddy's console encoder, which Caddy uses for stderr before it loads a
// configuration and for the standard library logger its dependencies write to.
var caddyConsoleLinePattern = regexp.MustCompile(`^\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?\s+(DEBUG|INFO|WARN|ERROR|DPANIC|PANIC|FATAL)\s+(.*)$`)

type caddyLogEntry struct {
	// level is empty for a line that is not a Caddy log entry.
	level string
	text  string
}

// writeCaddyOutput writes Caddy command output as caddy-labelled records,
// without the screened lines. After a command that succeeded, it also leaves
// out Caddy's routine debug and info entries.
func writeCaddyOutput(writer io.Writer, output []byte, failed bool) error {
	if writer == nil {
		return nil
	}
	for line := range strings.SplitSeq(string(output), "\n") {
		entry := parseCaddyLogLine(strings.TrimSuffix(line, "\r"))
		if strings.TrimSpace(entry.text) == "" || isScreenedCaddyMessage(entry.text) {
			continue
		}
		if !failed && (entry.level == "DEBUG" || entry.level == "INFO") {
			continue
		}
		text := entry.text
		if entry.level != "" && entry.level != "DEBUG" && entry.level != "INFO" {
			text = entry.level + " " + text
		}
		if _, err := fmt.Fprintf(writer, "[%s] %s\n", caddyOutputLabel, text); err != nil {
			return err
		}
	}
	return nil
}

func isScreenedCaddyMessage(text string) bool {
	return slices.ContainsFunc(screenedCaddyMessages, func(message string) bool {
		return strings.Contains(text, message)
	})
}

func parseCaddyLogLine(line string) caddyLogEntry {
	if strings.HasPrefix(line, "{") {
		var fields map[string]any
		if err := json.Unmarshal([]byte(line), &fields); err == nil {
			if entry, ok := parseCaddyJSONEntry(fields); ok {
				return entry
			}
		}
	}
	if match := caddyConsoleLinePattern.FindStringSubmatch(line); match != nil {
		return caddyLogEntry{level: match[1], text: strings.ReplaceAll(match[2], "\t", " ")}
	}
	return caddyLogEntry{text: strings.TrimRight(line, " \t")}
}

// parseCaddyJSONEntry reads an entry of Caddy's JSON log encoder, which the
// managed configuration uses for caddy.runtime.log.
func parseCaddyJSONEntry(fields map[string]any) (caddyLogEntry, bool) {
	level, ok := fields["level"].(string)
	if !ok {
		return caddyLogEntry{}, false
	}
	message, ok := fields["msg"].(string)
	if !ok {
		return caddyLogEntry{}, false
	}
	text := message
	if logger, ok := fields["logger"].(string); ok && logger != "" {
		text = logger + ": " + message
	}
	keys := make([]string, 0, len(fields))
	for key := range fields {
		switch key {
		case "level", "ts", "logger", "msg":
		default:
			keys = append(keys, key)
		}
	}
	slices.Sort(keys)
	for _, key := range keys {
		text += " " + key + "=" + formatCaddyLogValue(fields[key])
	}
	return caddyLogEntry{level: strings.ToUpper(level), text: text}, true
}

func formatCaddyLogValue(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprint(value)
	}
	return string(encoded)
}
