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
