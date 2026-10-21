package devtools

type ToolContext struct {
	ProjectRootPath string
	ResolvePath     func(string) string
}

func (s *ControlServer) toolContext(pageURL string) (ToolContext, error) {
	if s.getToolContext == nil {
		return ToolContext{ProjectRootPath: s.projectRootPath}, nil
	}
	settings := s.currentSettings()
	name := settings.PrimaryService
	if route := resolveRoutedServiceForURL(settings.RoutedServices, pageURL); route != nil {
		name = route.ServiceName
	}
	return s.getToolContext(name)
}
