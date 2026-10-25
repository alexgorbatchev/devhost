package nativebrowser

import "testing"

func TestIsSupportedBrowserProduct(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		product string
		want    bool
	}{
		{"Chrome/154.0.8037.92", true},
		{"Chrome/155.0.8059.84", true},
		{"Chrome/158.0.8113.0", true},
		{"Chrome/153.0.7999.1", false},
		{"Chrome/154", false},
		{"HeadlessChrome/155.0.8059.84", false},
		{"Firefox/150.0", false},
		{"Chrome/abc.0.0.0", false},
		{"", false},
	} {
		if got := isSupportedBrowserProduct(tc.product); got != tc.want {
			t.Errorf("isSupportedBrowserProduct(%q) = %v, want %v", tc.product, got, tc.want)
		}
	}
}

func TestIsSupportedReactExtensionVersion(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		version string
		want    bool
	}{
		{"8.0.0", true},
		{"8.0.1", true},
		{"8.1.0", true},
		{"9.0.0", true},
		{"8.0", true},
		{"8.0.0.1", true},
		{"7.0.1", false},
		{"7", false},
		{"8.0.0-beta", false},
		{"8.0.0.0.0", false},
		{"", false},
	} {
		if got := isSupportedReactExtensionVersion(tc.version); got != tc.want {
			t.Errorf("isSupportedReactExtensionVersion(%q) = %v, want %v", tc.version, got, tc.want)
		}
	}
}

func TestIsSupportedReactVersion(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		version string
		want    bool
	}{
		{"19.2.5", true},
		{"19.2.6", true},
		{"19.3.1", true},
		{"19.10.0", true},
		{"19.2.4", false},
		{"18.3.1", false},
		{"20.0.0", false},
		{"19.3.0-canary-a6b912fb-20261023", false},
		{"19.3", false},
		{"19.3.1.0", false},
		{"", false},
	} {
		if got := isSupportedReactVersion(tc.version); got != tc.want {
			t.Errorf("isSupportedReactVersion(%q) = %v, want %v", tc.version, got, tc.want)
		}
	}
}

func TestHostScanObservation(t *testing.T) {
	t.Parallel()
	scan := hostScan{
		Matches: true,
		Roots: []rendererRoot{
			{Version: "19.3.1", Connected: true},
			{Version: "19.2.5", Connected: false},
			{Version: "18.3.1", Connected: true},
			{Version: "", Connected: true},
		},
		UnsupportedContainers: 1,
	}
	got := scan.observation()
	want := hostObservation{Matches: true, HostRoots: 1, UnsupportedRoots: 3}
	if got != want {
		t.Fatalf("observation() = %+v, want %+v", got, want)
	}
	if message := nativeDocumentMessage(got); message == "" {
		t.Fatal("nativeDocumentMessage returned no message for unsupported roots")
	}
}
