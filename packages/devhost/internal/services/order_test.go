package services

import (
	"testing"

	"github.com/alexgorbatchev/devhost/packages/devhost/internal/manifest"
)

func TestResolveServiceOrder(t *testing.T) {
	t.Parallel()

	t.Run("returns dependency first order", func(t *testing.T) {
		t.Parallel()

		value := manifest.Manifest{ServiceOrder: []string{"db", "api", "web"}, Services: map[string]manifest.ValidatedService{
			"web": {Name: "web", DependsOn: []string{"api"}},
			"api": {Name: "api", DependsOn: []string{"db"}},
			"db":  {Name: "db", DependsOn: []string{}},
		}}

		orderedServices, error := ResolveServiceOrder(value)
		if error != nil {
			t.Fatalf("ResolveServiceOrder(...) unexpected error = %v", error)
		}

		want := []string{"db", "api", "web"}
		if len(orderedServices) != len(want) || orderedServices[0] != want[0] || orderedServices[1] != want[1] || orderedServices[2] != want[2] {
			t.Fatalf("ResolveServiceOrder(...) = %#v, want %#v", orderedServices, want)
		}
	})

	t.Run("rejects dependency cycles", func(t *testing.T) {
		t.Parallel()

		value := manifest.Manifest{ServiceOrder: []string{"web", "api"}, Services: map[string]manifest.ValidatedService{
			"web": {Name: "web", DependsOn: []string{"api"}},
			"api": {Name: "api", DependsOn: []string{"web"}},
		}}

		_, error := ResolveServiceOrder(value)
		want := "Dependency cycle detected: web -> api -> web"
		if error == nil || error.Error() != want {
			t.Fatalf("ResolveServiceOrder(...) error = %v, want %q", error, want)
		}
	})
}
