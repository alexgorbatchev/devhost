package devtools

// ConfigurationSource names the configuration a reload reads.
type ConfigurationSource string

const (
	// ConfigurationSourceManifest is the stack's manifest and the files it includes.
	ConfigurationSourceManifest ConfigurationSource = "manifest"
	// ConfigurationSourceConfig is the devhost config file every stack on the machine shares.
	ConfigurationSourceConfig ConfigurationSource = "config"
)

// ConfigurationStatus reports the reloads of one configuration source.
type ConfigurationStatus struct {
	Source ConfigurationSource `json:"source"`
	// Reloads counts the reloads of the source that have finished, accepted or rejected, so a page that saved a file
	// can tell when the reload that follows is done.
	Reloads int `json:"reloads"`
	// Error is why the last reload was rejected; it is empty after an accepted one. The stack keeps running the
	// configuration it accepted before.
	Error string `json:"error,omitempty"`
}
