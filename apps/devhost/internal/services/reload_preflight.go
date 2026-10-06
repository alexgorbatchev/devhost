package services

import (
	"fmt"
	"os"
)

func validateServiceWorkingDirectory(service ResolvedService) error {
	if service.Cwd == "" {
		return nil
	}
	info, err := os.Stat(service.Cwd)
	if err != nil {
		return fmt.Errorf("start service %s: cannot access working directory %q (services.%s.cwd); check the configured cwd path: %w", service.Name, service.Cwd, service.Name, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("start service %s: working directory %q (services.%s.cwd) is not a directory; set cwd to a directory", service.Name, service.Cwd, service.Name)
	}
	return nil
}
