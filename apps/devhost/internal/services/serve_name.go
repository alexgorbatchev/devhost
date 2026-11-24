package services

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
)

var commandWords = regexp.MustCompile(`'[^']*'|"[^"]*"|[^\s]+`)

func inferServeName(directory string, command []string) string {
	words := command
	if len(command) == 3 && command[0] == "/bin/sh" && command[1] == "-c" {
		words = commandWords.FindAllString(command[2], -1)
	}
	repositories := map[string]bool{}
	for i, word := range words {
		word = strings.Trim(word, "\"'")
		if strings.HasPrefix(word, "-") || (i > 0 && strings.HasPrefix(words[i-1], "-")) {
			continue
		}
		ext := strings.ToLower(filepath.Ext(word))
		entrypoint := slices.Contains([]string{".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".php", ".sh"}, ext)
		if !entrypoint && !(i == 0 && strings.ContainsRune(word, filepath.Separator)) {
			continue
		}
		path := word
		if !filepath.IsAbs(path) {
			path = filepath.Join(directory, path)
		}
		if info, err := os.Stat(path); err != nil || info.IsDir() {
			continue
		}
		if repo := serveGitRoot(filepath.Dir(path)); repo != "" {
			repositories[repo] = true
		}
	}
	if len(repositories) == 1 {
		for repo := range repositories {
			return serveRepositoryName(repo)
		}
	}
	if repo := serveGitRoot(directory); repo != "" {
		return serveRepositoryName(repo)
	}
	return filepath.Base(directory)
}

func serveGitRoot(directory string) string {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	data, err := exec.CommandContext(ctx, "git", "-C", directory, "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func serveRepositoryName(directory string) string {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	data, err := exec.CommandContext(ctx, "git", "-C", directory, "remote", "get-url", "origin").Output()
	if err == nil {
		remote := strings.TrimSuffix(strings.TrimSpace(string(data)), "/")
		if index := strings.LastIndexAny(remote, "/:"); index >= 0 {
			remote = remote[index+1:]
		}
		if name := strings.TrimSuffix(remote, ".git"); name != "" {
			return name
		}
	}
	return filepath.Base(directory)
}

func serveNameLabel(name string) string {
	var result strings.Builder
	separator := false
	for _, ch := range strings.ToLower(name) {
		if ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' {
			if separator && result.Len() > 0 {
				result.WriteByte('-')
			}
			separator = false
			result.WriteRune(ch)
		} else {
			separator = true
		}
	}
	label := result.String()
	// Reserve eight random hex digits, their separator, and a port suffix.
	if len(label) > 48 {
		label = strings.TrimRight(label[:48], "-")
	}
	if label == "" {
		label = "app"
	}
	return label
}
