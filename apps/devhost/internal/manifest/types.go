package manifest

import "time"

type RawManifest struct {
	Inputs       Inputs
	serviceOrder []string
	value        map[string]any
}

// Inputs records files and include globs even when loading fails, so callers
// can observe repairs and changes to the membership of an include glob.
type Inputs struct {
	Files    []string
	Patterns []string
}

type Manifest struct {
	Annotation            ValidatedAnnotation
	Caddy                 CaddyConfig
	Devtools              DevtoolsConfig
	Worktrees             WorktreesConfig
	ManifestDirectoryPath string
	ManifestPath          string
	Name                  string
	PrimaryService        string
	ServiceOrder          []string
	Services              map[string]ValidatedService
	KillZombies           bool
}

type WorktreesConfig struct {
	Enabled bool
}

type ValidatedAnnotation struct {
	TempDir         *string
	Actions         []ValidatedAnnotationAction
	DefaultActionID string
}

type ValidatedAnnotationAction struct {
	// TempDir is inherited from the stack's annotation configuration.
	TempDir *string
	Agent   ValidatedAgent
	Command []string
	Cwd     string
	Env     map[string]string
	ID      string
	Kind    string
	Label   string
}

type CaddyConfig struct {
	Global CaddyGlobalConfig
}

type CaddyGlobalConfig struct {
	AdminAddress string
	BindHost     string
	HTTP         bool
	HTTPPort     int
	HTTPSPort    int
}

type DevtoolsBrowserConfig struct {
	Endpoint         string
	ReactExtensionID string
}

type DevtoolsConfig struct {
	Browser          DevtoolsBrowserConfig
	Editor           DevtoolsEditorConfig
	ExternalToolbars DevtoolsToggleConfig
	Minimap          DevtoolsMinimapConfig
	Resources        DevtoolsResourcesConfig
	Status           DevtoolsStatusConfig
	Shortcuts        DevtoolsShortcutsConfig // New table
	IdleTimeout      string
}

type DevtoolsShortcutsConfig struct {
	RestartServices string `descr:"Global keyboard shortcut for restarting services." name:"restartServices"`
}

type DevtoolsEditorConfig struct {
	Enabled bool
	IDE     string
}

type DevtoolsToggleConfig struct {
	Enabled bool
}

type DevtoolsMinimapConfig struct {
	Enabled bool
}

// DevtoolsResourcesConfig configures the host CPU, memory, and disk readouts in the toolbar.
type DevtoolsResourcesConfig struct {
	Enabled bool
	CPU     DevtoolsResourceConfig
	Memory  DevtoolsResourceConfig
	Disk    DevtoolsResourceConfig
}

// DevtoolsResourceConfig holds the resolved settings of one readout: its own poll interval, the shared one, or its
// default, in that order.
type DevtoolsResourceConfig struct {
	Enabled      bool
	PollInterval time.Duration
}

type DevtoolsStatusConfig struct {
	Enabled  bool
	Position string
}

type ValidatedAgent struct {
	Args    []string
	Command []string
	Cwd     string
	Env     map[string]string
	Kind    string
}

type ValidatedService struct {
	ProxyLocalOrigin bool
	BindHost         string
	Command          []string
	Cwd              string
	DependsOn        []string
	Env              map[string]string
	Health           *HealthConfig
	Hosts            []string
	InjectPort       bool
	Lifecycle        ServiceLifecycleConfig
	Managed          bool
	Name             string
	Path             *string
	Port             *PortConfig
	Watch            []string
}

type ServiceLifecycleConfig struct {
	Mode   string
	Start  []string
	Status []string
	Stop   []string
}

type PortConfig struct {
	Auto   bool
	Number int
}

type HealthConfig struct {
	HTTP     *string
	Interval *int
	Process  bool
	Retries  *int
	TCP      *int
	Timeout  *int
}

func (p *PortConfig) Equal(other *PortConfig) bool {
	if p == nil || other == nil {
		return p == other
	}

	return p.Auto == other.Auto && p.Number == other.Number
}
