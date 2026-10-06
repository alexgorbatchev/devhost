package services

import (
	"fmt"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func TestReloadPreservesAutoPortsAndRebindsServiceTemplates(t *testing.T) {
	m := manifest.Manifest{Services: map[string]manifest.ValidatedService{
		"api": {Name: "api", BindHost: "127.0.0.1", Port: &manifest.PortConfig{Auto: true}},
		"web": {Name: "web", BindHost: "127.0.0.1", Port: &manifest.PortConfig{Auto: true}, Command: []string{"serve", "{{ services.api.port }}"}, Env: map[string]string{"API": "{{ services.api.port }}"}},
	}}
	previous, err := ResolveServicePorts(m)
	if err != nil {
		t.Fatal(err)
	}
	next, err := resolveReloadPorts(m, previous)
	if err != nil {
		t.Fatal(err)
	}
	for name, old := range previous.Services {
		if *next.Services[name].Port != *old.Port {
			t.Fatalf("reload reassigned %s port", name)
		}
	}
	api := m.Services["api"]
	api.Port = &manifest.PortConfig{Number: mustReservePort(t)}
	m.Services["api"] = api
	next, err = resolveReloadPorts(m, previous)
	if err != nil {
		t.Fatal(err)
	}
	want := fmt.Sprint(api.Port.Number)
	if next.Services["web"].Command[1] != want || next.Services["web"].Env["API"] != want || *next.Services["web"].Port != *previous.Services["web"].Port {
		t.Fatalf("dependent templates did not follow changed port: %#v", next.Services["web"])
	}
}
