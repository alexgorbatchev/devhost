package devtools

import (
	"net/http"
	"testing"
)

func TestSelectAssetEncoding(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name       string
		headers    []string
		hasGzip    bool
		encoding   string
		acceptable bool
	}{
		{"multiple header lines", []string{"br", "GZIP;q=1, identity;q=0"}, true, "gzip", true},
		{"unsupported gzip representation", []string{"gzip, identity;q=0"}, false, "", false},
		{"invalid weight", []string{"gzip;q=invalid"}, true, "", true},
		{"invalid number", []string{"gzip;q=NaN"}, true, "", true},
		{"out of bounds", []string{"gzip;q=2"}, true, "", true},
		{"too many decimal digits", []string{"gzip;q=1.0000"}, true, "", true},
		{"unrelated parameter", []string{"gzip;other=ignored;q=1"}, true, "gzip", true},
		{"explicit identity beats wildcard", []string{"gzip;q=0,*;q=0,identity;q=0.5"}, true, "", true},
		{"explicit gzip beats wildcard", []string{"gzip;q=1,*;q=0"}, true, "gzip", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			encoding, acceptable := selectAssetEncoding(tc.headers, tc.hasGzip)
			if encoding != tc.encoding || acceptable != tc.acceptable {
				t.Fatalf("selectAssetEncoding(%q, %v) = %q, %v; want %q, %v", tc.headers, tc.hasGzip, encoding, acceptable, tc.encoding, tc.acceptable)
			}
		})
	}
}

func TestControlServerAssetValidatorsAndRanges(t *testing.T) {
	t.Parallel()
	s := startAssetTestServer(t)
	client := &http.Client{Transport: &http.Transport{DisableCompression: true}}
	t.Cleanup(client.CloseIdleConnections)
	response, err := client.Get(serverURL(s.Port(), injectedScriptPath))
	if err != nil {
		t.Fatal(err)
	}
	body := readResponseText(t, response)
	response.Body.Close()
	versionURL, tag := response.Request.URL.String(), response.Header.Get("ETag")
	if tag == "" {
		t.Fatal("asset has no validator")
	}
	for _, tc := range []struct {
		name, header, value string
		status              int
		body                string
	}{
		{"cached", "If-None-Match", tag, http.StatusNotModified, ""},
		{"range", "Range", "bytes=0-5", http.StatusPartialContent, body[:6]},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request, err := http.NewRequest(http.MethodGet, versionURL, nil)
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set(tc.header, tc.value)
			result, err := client.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer result.Body.Close()
			if result.StatusCode != tc.status || readResponseText(t, result) != tc.body {
				t.Fatalf("%s did not honor the HTTP validator/range", tc.name)
			}
		})
	}
}
