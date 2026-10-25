package nativebrowser

import (
	"slices"
	"strconv"
	"strings"
)

// The oldest releases the native window contract was verified with. Newer releases are accepted: the browser's
// DevTools target API and the extension's manifest shape are checked directly where they are used.
var (
	minimumBrowserVersion        = []int{154, 0, 8037, 92}
	minimumReactExtensionVersion = []int{8, 0, 0, 0}
	// The hook and Fiber root fields observeHostFunction reads are internal to React, so a new major release is
	// unsupported until it is verified.
	minimumReactVersion = []int{19, 2, 5}
)

const browserProductPrefix = "Chrome/"

// parseVersion reads a Chrome version: one to maxParts dot-separated integers from 0 to 65535, as Chrome's
// extension manifest `version` and its own product version are written. Missing parts count as zero.
func parseVersion(text string, maxParts int) ([]int, bool) {
	fields := strings.Split(text, ".")
	if text == "" || len(fields) > maxParts {
		return nil, false
	}
	parts := make([]int, maxParts)
	for i, field := range fields {
		value, err := strconv.Atoi(field)
		if err != nil || value < 0 || value > 65535 || strconv.Itoa(value) != field {
			return nil, false
		}
		parts[i] = value
	}
	return parts, true
}

// isSupportedBrowserProduct reports whether a Browser.getVersion product names Chrome at the oldest verified
// release or newer. Chrome for Testing and Chromium report the same product name.
func isSupportedBrowserProduct(product string) bool {
	version, ok := strings.CutPrefix(product, browserProductPrefix)
	if !ok || strings.Count(version, ".") != 3 {
		return false
	}
	parts, ok := parseVersion(version, 4)
	return ok && slices.Compare(parts, minimumBrowserVersion) >= 0
}

// isSupportedReactExtensionVersion reports whether a React Developer Tools manifest version is the oldest verified
// release or newer.
func isSupportedReactExtensionVersion(version string) bool {
	parts, ok := parseVersion(version, 4)
	return ok && slices.Compare(parts, minimumReactExtensionVersion) >= 0
}

// isSupportedReactVersion reports whether a renderer's React DOM version, as `major.minor.patch`, is the oldest
// verified React 19 release or a newer React 19 release. Prereleases such as canaries are unsupported.
func isSupportedReactVersion(version string) bool {
	if strings.Count(version, ".") != 2 {
		return false
	}
	parts, ok := parseVersion(version, 3)
	return ok && parts[0] == minimumReactVersion[0] && slices.Compare(parts, minimumReactVersion) >= 0
}
