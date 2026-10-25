package statuspage

import (
	"bytes"
	_ "embed"
	"html/template"
)

type StackService struct {
	Name      string
	Directory string
	URLs      []string
	Status    string
}

type StackConfig struct {
	Path    string
	Kind    string
	Content string
	Error   string
}

type Stack struct {
	Name         string
	PID          int
	ManifestPath string
	Directory    string
	StartedAt    string
	Services     []StackService
	Configs      []StackConfig
	Error        string
}

//go:embed stacks.html
var stacksDocument string

var stacksTemplate = template.Must(template.New("stacks").Parse(stacksDocument))

func StackDirectory(stacks []Stack, query string) (string, error) {
	data := struct {
		Stacks      []Stack
		Query       string
		Styles      template.CSS
		ThemeScript template.JS
	}{stacks, query, template.CSS(CSS), template.JS(ThemeScript)}
	var output bytes.Buffer
	if err := stacksTemplate.Execute(&output, data); err != nil {
		return "", err
	}
	return output.String(), nil
}
