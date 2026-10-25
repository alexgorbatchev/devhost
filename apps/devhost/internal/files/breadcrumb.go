package files

import (
	"net/url"
	"strings"
)

func breadcrumbs(requestPath string) []listingEntry {
	crumbs := []listingEntry{{Name: "devhost", Href: "/"}}
	prefix := "/"
	for part := range strings.SplitSeq(strings.Trim(requestPath, "/"), "/") {
		if part == "" {
			continue
		}
		prefix += url.PathEscape(part) + "/"
		crumbs = append(crumbs, listingEntry{Name: part, Href: prefix})
	}
	crumbs[len(crumbs)-1].Href = ""
	return crumbs
}
