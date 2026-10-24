package statuspage

import (
	"encoding/json"
	"html"
	"regexp"
	"strings"
	"testing"
)

func TestDocumentEscapesFallbackAndRoundTripsPageData(t *testing.T) {
	t.Parallel()
	hostile := "failure </script><img src=x onerror=alert(1)> & more"
	page := Page{Kind: "not-found", Status: 404, Title: hostile, Message: hostile, Routes: []RouteLink{{Host: hostile, URL: "https://web.localhost/path?q=a&b=c"}}}
	document, err := Render(page, "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(document, "<img src=x") {
		t.Fatal("untrusted page content became executable markup")
	}
	if !strings.Contains(document, "<h1>"+html.EscapeString(hostile)+"</h1>") {
		t.Fatal("HTML fallback lost the error title")
	}
	payload := regexp.MustCompile(`(?s)<script id="devhost-status-data" type="application/json">(.*?)</script>`).FindStringSubmatch(document)
	if len(payload) != 2 {
		t.Fatal("missing embedded page data")
	}
	var decoded Page
	if err := json.Unmarshal([]byte(payload[1]), &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Title != hostile || decoded.Message != hostile || len(decoded.Routes) != 1 || decoded.Routes[0] != page.Routes[0] {
		t.Fatalf("page data failed to round trip: %+v", decoded)
	}
	if !strings.Contains(document, `href="https://web.localhost/path?q=a&amp;b=c"`) {
		t.Fatal("fallback route link is missing or not escaped")
	}
}
