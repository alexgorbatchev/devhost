package devtools

import (
	"encoding/json"
	"net/http"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/hostusage"
)

// ResourceUsageOptions selects the host readouts shown in the toolbar. Leaving every interval at zero turns the
// feature off: nothing is sampled and the stream is not served.
type ResourceUsageOptions struct {
	Intervals hostusage.Intervals
	Readers   hostusage.Readers
	// OnFailure is called when a readout's reads start failing, once per outage.
	OnFailure func(readout string, err error)
}

func (o ResourceUsageOptions) isEnabled() bool {
	return o.Intervals.CPU > 0 || o.Intervals.Memory > 0 || o.Intervals.Disk > 0
}

func (s *ControlServer) startResourceSampler(options ResourceUsageOptions) {
	sampler := hostusage.Start(s.ctx, hostusage.Options{
		Intervals: options.Intervals,
		Readers:   options.Readers,
		OnChange:  func() { s.publishResourceUsage(nil) },
		OnFailure: options.OnFailure,
	})

	s.mu.Lock()
	s.resourceSampler = sampler
	s.mu.Unlock()
}

func (s *ControlServer) handleResourcesWebsocket(writer http.ResponseWriter, request *http.Request) {
	client, err := s.upgrade(writer, request)
	if err != nil {
		return
	}

	s.publishResourceUsage(client)

	go s.readUntilClosed(client, s.removeResourceClient)
}

// publishResourceUsage sends the latest readings to every client they are news to: all of them when they differ
// from the readings sent last, and otherwise only newClient, which has received none yet. newClient is the client
// an attach is adding, or nil.
func (s *ControlServer) publishResourceUsage(newClient *websocketClient) {
	// Reading and sending are one step for the same reason as in publishHealth, and so that a later reading is
	// never sent before an earlier one.
	s.resourcesMu.Lock()
	defer s.resourcesMu.Unlock()

	s.mu.Lock()
	sampler := s.resourceSampler
	isStopped := s.isStopped
	s.mu.Unlock()
	// The first readings can arrive before startResourceSampler has recorded the sampler; no client is attached
	// that early, and an attach reads the usage itself.
	if sampler == nil || isStopped {
		if newClient != nil {
			newClient.close()
		}
		return
	}

	encoded, err := json.Marshal(sampler.Usage())
	if err != nil {
		// Usage holds only numbers, so this cannot fail; without a message there is nothing to send.
		return
	}
	message := string(encoded)

	s.mu.Lock()
	if newClient != nil {
		s.resourceClients[newClient] = struct{}{}
	}
	var recipients []*websocketClient
	switch {
	case message != s.lastPublishedResources:
		s.lastPublishedResources = message
		recipients = snapshotClients(s.resourceClients)
	case newClient != nil:
		recipients = []*websocketClient{newClient}
	}
	s.mu.Unlock()

	s.broadcast(recipients, message, s.removeResourceClient)
}

func (s *ControlServer) removeResourceClient(client *websocketClient) {
	s.mu.Lock()
	delete(s.resourceClients, client)
	s.mu.Unlock()
	client.close()
}
