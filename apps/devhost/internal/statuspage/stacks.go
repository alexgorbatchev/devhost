package statuspage

type StackService struct {
	Name      string   `json:"name"`
	Directory string   `json:"directory"`
	URLs      []string `json:"urls"`
	Status    string   `json:"status"`
}

type StackConfig struct {
	Path    string `json:"path"`
	Kind    string `json:"kind"`
	Content string `json:"content"`
	Error   string `json:"error"`
}

type Stack struct {
	Name         string         `json:"name"`
	PID          int            `json:"pid"`
	ManifestPath string         `json:"manifestPath"`
	Directory    string         `json:"directory"`
	StartedAt    string         `json:"startedAt"`
	Services     []StackService `json:"services"`
	Configs      []StackConfig  `json:"configs"`
	Error        string         `json:"error"`
}

func StackDirectory(stacks []Stack, query string) (string, error) {
	message := "Open a service URL or expand its configuration below. Refresh to update."
	if len(stacks) == 0 {
		message = "No stacks running. Start a project with devhost start, then refresh this page."
		if query != "" {
			message = "No matching stacks. Try another name, URL, or path."
		}
	}
	return Render(Page{Kind: "stacks", Status: 200, Title: "Running stacks", Message: message, Stacks: stacks, Query: query}, "")
}
