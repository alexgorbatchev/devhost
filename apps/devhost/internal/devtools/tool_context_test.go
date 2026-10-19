package devtools

import (
	"testing"
)

func TestToolContextResolvesEditorAndAnnotationServiceFromPageURL(t *testing.T) {
	s := &ControlServer{settings: ControlSettings{PrimaryService: "web", RoutedServices: []RoutedServiceIdentity{{Host: "shop.localhost", Path: "/", ServiceName: "web"}, {Host: "shop.localhost", Path: "/api/*", ServiceName: "api"}}}, getToolContext: func(name string) (ToolContext, error) { return ToolContext{ProjectRootPath: name}, nil }}
	for _, tc := range []struct {
		request string
		want    string
	}{
		{"https://shop.localhost/api/items", "api"},
		{"https://shop.localhost/", "web"},
		{"", "web"},
	} {
		ctx, err := s.toolContext(tc.request)
		if err != nil || ctx.ProjectRootPath != tc.want {
			t.Fatalf("context = %#v, %v, want %q", ctx, err, tc.want)
		}
	}
}
