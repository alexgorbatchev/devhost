package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"slices"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/hostusage"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/gorilla/websocket"
)

const websocketCloseReasonResourcesOff = "resource readouts are turned off"

// ControlSettings are the manifest settings the control server applies. A hot
// reload replaces them with UpdateSettings, which keeps the listener, the
// connected pages, and every terminal and agent session.
type ControlSettings struct {
	AnnotationActions         []manifest.ValidatedAnnotationAction
	AnnotationDefaultActionID string
	ComponentEditor           string
	FeatureToggles            FeatureToggles
	NativeBrowser             manifest.DevtoolsBrowserConfig
	Position                  string
	PrimaryService            string
	// ResourceIntervals turns each host readout on with its poll interval; all
	// zero turns the readouts off.
	ResourceIntervals       hostusage.Intervals
	RestartServicesShortcut string
	RoutedServices          []RoutedServiceIdentity
	StackName               string
}

func (o StartControlServerOptions) settings() ControlSettings {
	return ControlSettings{
		AnnotationActions:         o.AnnotationActions,
		AnnotationDefaultActionID: o.AnnotationDefaultActionID,
		ComponentEditor:           o.ComponentEditor,
		FeatureToggles:            o.FeatureToggles,
		NativeBrowser:             o.NativeBrowser,
		Position:                  o.Position,
		PrimaryService:            o.PrimaryService,
		ResourceIntervals:         o.ResourceUsage.Intervals,
		RestartServicesShortcut:   o.RestartServicesShortcut,
		RoutedServices:            o.RoutedServices,
		StackName:                 o.StackName,
	}
}

// normalized copies the slices, so the caller's later changes never reach the
// server, and settles the default action on one the actions hold.
func (c ControlSettings) normalized() ControlSettings {
	c.AnnotationActions = slices.Clone(c.AnnotationActions)
	// Pages read the routes as an array, also when there are none.
	c.RoutedServices = append([]RoutedServiceIdentity{}, c.RoutedServices...)
	c.AnnotationDefaultActionID = normalizeAnnotationDefaultActionID(c.AnnotationDefaultActionID, c.AnnotationActions)
	return c
}

func (c ControlSettings) resourcesEnabled() bool {
	return ResourceUsageOptions{Intervals: c.ResourceIntervals}.isEnabled()
}

func (s *ControlServer) currentSettings() ControlSettings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.settings
}

// renderInjectedConfig encodes the configuration pages read from
// config.json and from the health stream.
func (s *ControlServer) renderInjectedConfig(settings ControlSettings) ([]byte, error) {
	config := injectedConfig{
		NativeBrowserConfigured:   settings.NativeBrowser.Endpoint != "",
		NativeBrowserInstanceID:   s.nativeBrowserInstanceID,
		AnnotationDefaultActionID: settings.AnnotationDefaultActionID,
		AnnotationActions:         createInjectedAnnotationActions(settings.AnnotationActions),
		AnnotationEnabled:         settings.FeatureToggles.AnnotationEnabled,
		AnnotationQueueEnabled:    settings.FeatureToggles.AnnotationQueueEnabled,
		ConfigEditorEnabled:       settings.FeatureToggles.ConfigEditorEnabled,
		ComponentEditor:           settings.ComponentEditor,
		HomeDirectoryPath:         s.homeDirectoryPath,
		EditorEnabled:             settings.FeatureToggles.EditorEnabled,
		ExternalToolbarsEnabled:   settings.FeatureToggles.ExternalToolbarsEnabled,
		MinimapEnabled:            settings.FeatureToggles.MinimapEnabled,
		Position:                  settings.Position,
		ProjectRootPath:           s.projectRootPath,
		RoutedServices:            settings.RoutedServices,
		StackName:                 settings.StackName,
		StatusEnabled:             settings.FeatureToggles.StatusEnabled,
		ResourcesEnabled:          settings.resourcesEnabled(),
		TerminalEnabled:           settings.FeatureToggles.TerminalEnabled,
		RestartServicesShortcut:   settings.RestartServicesShortcut,
		PrimaryService:            settings.PrimaryService,
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		return nil, fmt.Errorf("encode devtools config: %w", err)
	}
	return encoded, nil
}

// UpdateSettings applies settings from a hot reload. The listener, connected
// pages, and terminal and agent sessions stay; running sessions keep the
// environment they started with, and new ones get the new settings. Open pages
// receive the new configuration with the next health message, which this
// sends.
func (s *ControlServer) UpdateSettings(settings ControlSettings) error {
	if s.isClosed() {
		return nil
	}
	settings = settings.normalized()
	configJSON, err := s.renderInjectedConfig(settings)
	if err != nil {
		return err
	}
	previous := s.currentSettings()
	if err := s.updateNeovimShellIntegration(previous, settings); err != nil {
		return err
	}

	s.mu.Lock()
	s.settings, s.configJSON = settings, configJSON
	s.mu.Unlock()
	// Queues acquire their lock before looking up a terminal on the control
	// server. Release the control lock first to preserve that lock order.
	s.annotationQueueStore.setRoutedServices(settings.RoutedServices)
	if !reflect.DeepEqual(previous.ResourceIntervals, settings.ResourceIntervals) {
		s.restartResourceSampler(settings.ResourceIntervals)
	}
	if settings.FeatureToggles.AnnotationQueueEnabled && !previous.FeatureToggles.AnnotationQueueEnabled {
		if err := s.annotationQueueStore.resumePersistedQueues(); err != nil {
			return err
		}
	}

	return s.PublishHealthResponse()
}

// updateNeovimShellIntegration keeps the Neovim launcher files matching the
// editor setting and the stack name their directory and launcher carry.
func (s *ControlServer) updateNeovimShellIntegration(previous ControlSettings, next ControlSettings) error {
	isEnabled := next.FeatureToggles.EditorEnabled
	if isEnabled == previous.FeatureToggles.EditorEnabled && (!isEnabled || next.StackName == previous.StackName) {
		return nil
	}
	var replacement *neovimPluginShellIntegrationFiles
	if isEnabled {
		files, err := createNeovimPluginShellIntegrationFiles(s.projectRootPath, next.StackName, s.reactHighlightEndpoint(), s.runtimeDirectoryPath)
		if err != nil {
			return err
		}
		replacement = files
	}
	s.mu.Lock()
	retired := s.neovimShellIntegration
	s.neovimShellIntegration = replacement
	s.mu.Unlock()
	if retired != nil {
		retired.cleanup()
	}
	return nil
}

func (s *ControlServer) reactHighlightEndpoint() string {
	return fmt.Sprintf("http://127.0.0.1:%d%s", s.Port(), reactHighlightCursorPath)
}

// restartResourceSampler stops the sampler for the previous intervals and
// starts one for intervals. Turning every readout off ends the pages' streams
// as finished, so they do not reconnect.
func (s *ControlServer) restartResourceSampler(intervals hostusage.Intervals) {
	s.mu.Lock()
	sampler, cancel := s.resourceSampler, s.cancelResourceSampler
	s.resourceSampler, s.cancelResourceSampler = nil, nil
	s.lastPublishedResources = ""
	var finished []*websocketClient
	isEnabled := ResourceUsageOptions{Intervals: intervals}.isEnabled()
	if !isEnabled {
		finished = snapshotClients(s.resourceClients)
		s.resourceClients = map[*websocketClient]struct{}{}
	}
	s.mu.Unlock()
	if cancel != nil {
		cancel()
		sampler.Wait()
	}
	for _, client := range finished {
		client.closeWith(websocket.CloseNormalClosure, websocketCloseReasonResourcesOff)
	}
	if isEnabled {
		s.startResourceSampler(intervals)
	}
}

func (s *ControlServer) startResourceSampler(intervals hostusage.Intervals) {
	ctx, cancel := context.WithCancel(s.ctx)
	sampler := hostusage.Start(ctx, hostusage.Options{
		Intervals: intervals,
		Readers:   s.resourceReaders,
		OnChange:  func() { s.publishResourceUsage(nil) },
		OnFailure: s.onResourceFailure,
	})

	s.mu.Lock()
	s.resourceSampler, s.cancelResourceSampler = sampler, cancel
	s.mu.Unlock()
}
