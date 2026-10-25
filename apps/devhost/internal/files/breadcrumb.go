package files

import (
	"net/url"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/statuspage"
)

func breadcrumbs(requestPath string) []statuspage.FileLink {
	crumbs := []statuspage.FileLink{{Name: "devhost", Href: "/"}}
	prefix := "/"
	for part := range strings.SplitSeq(strings.Trim(requestPath, "/"), "/") {
		if part == "" {
			continue
		}
		prefix += url.PathEscape(part) + "/"
		crumbs = append(crumbs, statuspage.FileLink{Name: part, Href: prefix})
	}
	crumbs[len(crumbs)-1].Href = ""
	return crumbs
}
