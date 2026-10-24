package statuspage

import (
	"bytes"
	_ "embed"
	"fmt"
	"html/template"
	"strings"
)

// Page is the data shared by a standalone document and its React view.
// Recovery holds the devtools lifecycle snapshot at the JSON/template boundary.
type Page struct {
	Kind     string      `json:"kind"`
	Status   int         `json:"status"`
	Title    string      `json:"title"`
	Message  string      `json:"message"`
	Routes   []RouteLink `json:"routes,omitempty"`
	Recovery any         `json:"recovery,omitempty"`
}

// PageCSS contains the standalone shadcn theme and component utilities.
//
//go:embed dist/statusPages.css
var PageCSS string

//go:embed dist/statusPages.js
var pageScript string

//go:embed document.html
var document string

var pageTemplate = template.Must(template.New("status-page").Parse(document))

// Render embeds the complete UI, so failure pages never depend on an app or CDN.
// The optional stylesheet URL is served by the managed Caddy, independently of stacks.
func Render(page Page, stylesheetURL string) (string, error) {
	data := struct {
		Page          Page
		StylesheetURL string
		Styles        template.CSS
		ThemeScript   template.JS
		Script        template.JS
	}{page, stylesheetURL, template.CSS(PageCSS), template.JS(ThemeScript), template.JS(strings.ReplaceAll(pageScript, "</", "<\\/"))}
	var output bytes.Buffer
	if err := pageTemplate.Execute(&output, data); err != nil {
		return "", fmt.Errorf("render status page: %w", err)
	}
	return output.String(), nil
}
