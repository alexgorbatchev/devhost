package caddy

import "strings"

// The public authority is checked before either header is translated. Checking
// the joined Origin values also rejects duplicate and opaque origins.
const foreignOriginMatcher = "@devhost_foreign_origin expression `{http.request.header.Origin} != '' && {http.request.header.Origin} != 'http://' + {http.request.hostport} && {http.request.header.Origin} != 'https://' + {http.request.hostport}`"

func renderServiceProxyLines(registration routeRegistration, target string, rewriteHost bool) ([]string, error) {
	if !registration.ProxyLocalOrigin {
		return []string{"reverse_proxy " + target}, nil
	}
	localTarget, err := readAppTarget(registration)
	if err != nil {
		return nil, err
	}
	lines := []string{
		"route {",
		"    " + foreignOriginMatcher,
		`    respond @devhost_foreign_origin "Origin does not match the routed host" 403`,
		"    reverse_proxy " + target + " {",
	}
	if rewriteHost {
		lines = append(lines, "        header_up Host "+localTarget)
	}
	lines = append(lines,
		`        header_up Origin "^.+$" "http://`+localTarget+`"`,
		"    }",
		"}",
	)
	return lines, nil
}

func indentProxyLines(lines []string, spaces int) []string {
	indented := make([]string, len(lines))
	for i, line := range lines {
		indented[i] = strings.Repeat(" ", spaces) + line
	}
	return indented
}

func renderDocumentProxyHandleLines(registration routeRegistration) ([]string, error) {
	target := FormatProxyAddress("127.0.0.1", *registration.DocumentInjectionPort)
	// The document proxy translates Host itself and uses the public Host for
	// X-Forwarded-Host, so only Origin is translated at this hop.
	proxyLines, err := renderServiceProxyLines(registration, target, false)
	if err != nil {
		return nil, err
	}
	matcher := "@devhost_document_" + registration.ServiceName
	lines := []string{matcher + " header Sec-Fetch-Dest document", "handle " + matcher + " {"}
	lines = append(lines, indentProxyLines(proxyLines, 4)...)
	return append(lines, "}"), nil
}
