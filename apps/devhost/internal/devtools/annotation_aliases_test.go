package devtools

import "testing"

func TestAnnotationAliasesShareServiceQueue(t *testing.T) {
	harness := newAnnotationQueueHarness(t, []RoutedServiceIdentity{
		{Host: "app.localhost", Path: "/", ServiceName: "web"},
		{Host: "alias.localhost", Path: "/", ServiceName: "web"},
		{Host: "alias.localhost", Path: "/api/*", ServiceName: "api"},
	})
	first, err := harness.store.enqueue(defaultAnnotationActionID, testAnnotationDetail("First", 1, "https://app.localhost/"), "", nil)
	if err != nil {
		t.Fatal(err)
	}
	harness.setSessionStatus(first.SessionID, agentSessionStatusWorking)
	if err := harness.store.handleAgentStatus(first.SessionID, agentSessionStatusWorking); err != nil {
		t.Fatal(err)
	}
	second, err := harness.store.enqueue(defaultAnnotationActionID, testAnnotationDetail("Alias", 2, "https://alias.localhost/"), "", &first.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if second.SessionID != first.SessionID || len(harness.startedAnnotations) != 1 {
		t.Fatalf("alias started another session: %#v", second)
	}
	api, err := harness.store.enqueue(defaultAnnotationActionID, testAnnotationDetail("API", 3, "https://alias.localhost/api/users"), "", &first.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if api.SessionID == first.SessionID || len(harness.startedAnnotations) != 2 {
		t.Fatal("different service shared alias queue")
	}
}
