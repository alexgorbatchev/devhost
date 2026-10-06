package devtools

import (
	"encoding/json"
	"fmt"
	"slices"
)

type RoutingConfig struct {
	RoutedServices []RoutedServiceIdentity `json:"routedServices"`
	PrimaryService string                  `json:"primaryService"`
}

// UpdateRouting preserves the control listener, connected clients, and sessions.
func (s *ControlServer) UpdateRouting(routes []RoutedServiceIdentity, primary string) error {
	s.mu.Lock()
	var config injectedConfig
	if err := json.Unmarshal(s.configJSON, &config); err != nil {
		s.mu.Unlock()
		return fmt.Errorf("read injected routing configuration: %w", err)
	}
	config.RoutedServices, config.PrimaryService = slices.Clone(routes), primary
	encoded, err := json.Marshal(config)
	if err != nil {
		s.mu.Unlock()
		return fmt.Errorf("encode injected routing configuration: %w", err)
	}
	s.configJSON = encoded
	s.routedServices, s.primaryService = slices.Clone(routes), primary
	s.mu.Unlock()
	// Queues acquire their lock before looking up a terminal on the control
	// server. Release the control lock first to preserve that lock order.
	if s.annotationQueueStore != nil {
		s.annotationQueueStore.mu.Lock()
		s.annotationQueueStore.routedServices = slices.Clone(routes)
		s.annotationQueueStore.mu.Unlock()
	}
	return nil
}
