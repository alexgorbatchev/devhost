package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/hostusage"
	"github.com/gorilla/websocket"
)

const websocketCloseReasonResourcesOff = "resource readouts are turned off"

// ControlSettings are the manifest settings the control server applies. A hot
// reload replaces them with UpdateSettings, which keeps the listener, the
// connected pages, and every chat session.
type ControlSettings struct {
	ChatPrompt      string
	ComponentEditor string
	FeatureToggles  FeatureToggles
	Position        string
	PrimaryService  string
	// ResourceIntervals turns each host readout on with its poll interval; all
	// zero turns the readouts off.
	ResourceIntervals       hostusage.Intervals
	RestartServicesShortcut string
	RoutedServices          []RoutedServiceIdentity
	StackName               string
}

func (o StartControlServerOptions) settings() ControlSettings {
	return ControlSettings{
		ChatPrompt:              o.ChatPrompt,
		ComponentEditor:         o.ComponentEditor,
		FeatureToggles:          o.FeatureToggles,
		Position:                o.Position,
		PrimaryService:          o.PrimaryService,
		ResourceIntervals:       o.ResourceUsage.Intervals,
		RestartServicesShortcut: o.RestartServicesShortcut,
		RoutedServices:          o.RoutedServices,
		StackName:               o.StackName,
	}
}

// normalized copies the routes, so the caller's later changes never reach the
// server.
func (c ControlSettings) normalized() ControlSettings {
	// Pages read the routes as an array, also when there are none.
	c.RoutedServices = append([]RoutedServiceIdentity{}, c.RoutedServices...)
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
		ChatEnabled:             settings.FeatureToggles.ChatEnabled,
		AnnotationEnabled:       settings.FeatureToggles.AnnotationEnabled,
		ConfigEditorEnabled:     settings.FeatureToggles.ConfigEditorEnabled,
		ComponentEditor:         settings.ComponentEditor,
		HomeDirectoryPath:       s.homeDirectoryPath,
		EditorEnabled:           settings.FeatureToggles.EditorEnabled,
		ExternalToolbarsEnabled: settings.FeatureToggles.ExternalToolbarsEnabled,
		MinimapEnabled:          settings.FeatureToggles.MinimapEnabled,
		Position:                settings.Position,
		ProjectRootPath:         s.projectRootPath,
		ControlOrigin:           s.controlOrigin(),
		RoutedServices:          settings.RoutedServices,
		StackName:               settings.StackName,
		StatusEnabled:           settings.FeatureToggles.StatusEnabled,
		ResourcesEnabled:        settings.resourcesEnabled(),
		RestartServicesShortcut: settings.RestartServicesShortcut,
		PrimaryService:          settings.PrimaryService,
	}
	if s.devSource != nil {
		config.DevhostSourceRootPath = s.devSource.RootPath()
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		return nil, fmt.Errorf("encode devtools config: %w", err)
	}
	return encoded, nil
}

// UpdateSettings applies settings from a hot reload. The listener, connected
// pages, and chat sessions stay. Open pages receive the new configuration with
// the next health message, which this sends.
func (s *ControlServer) UpdateSettings(settings ControlSettings) error {
	if s.isClosed() {
		return nil
	}
	settings = settings.normalized()
	configJSON, err := s.renderInjectedConfig(settings)
	if err != nil {
		return err
	}
	s.mu.Lock()
	previous := s.settings
	s.settings, s.configJSON = settings, configJSON
	s.mu.Unlock()
	if !reflect.DeepEqual(previous.ResourceIntervals, settings.ResourceIntervals) {
		s.restartResourceSampler(settings.ResourceIntervals)
	}

	return s.PublishHealthResponse()
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
