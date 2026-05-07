package manifest

type RawManifest struct {
	serviceOrder []string
	value        map[string]any
}

type Manifest struct {
	Annotation            ValidatedAnnotation
	Caddy                 CaddyConfig
	Devtools              DevtoolsConfig
	ManifestDirectoryPath string
	ManifestPath          string
	Name                  string
	PrimaryService        string
	ServiceOrder          []string
	Services              map[string]ValidatedService
}

type ValidatedAnnotation struct {
	Actions         []ValidatedAnnotationAction
	DefaultActionID string
}

type ValidatedAnnotationAction struct {
	Agent       ValidatedAgent
	Command     []string
	Cwd         string
	DisplayName string
	Env         map[string]string
	ID          string
	Kind        string
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

type DevtoolsConfig struct {
	Editor           DevtoolsEditorConfig
	ExternalToolbars DevtoolsToggleConfig
	Minimap          DevtoolsMinimapConfig
	Status           DevtoolsStatusConfig
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

type DevtoolsStatusConfig struct {
	Enabled  bool
	Position string
}

type ValidatedAgent struct {
	Command     []string
	Cwd         string
	DisplayName string
	Env         map[string]string
	Kind        string
}

type ValidatedService struct {
	BindHost   string
	Command    []string
	Cwd        string
	DependsOn  []string
	Env        map[string]string
	Health     *HealthConfig
	Host       *string
	InjectPort bool
	Lifecycle  ServiceLifecycleConfig
	Managed    bool
	Name       string
	Path       *string
	Port       *PortConfig
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
