package devtools

type ToolContext struct {
	ProjectRootPath string
	ResolvePath     func(string) string
}

func (s *ControlServer) toolContext(pageURL string) (ToolContext, error) {
	if s.getToolContext == nil {
		return ToolContext{ProjectRootPath: s.projectRootPath}, nil
	}
	s.mu.Lock()
	name := s.primaryService
	if route := resolveRoutedServiceForURL(s.routedServices, pageURL); route != nil {
		name = route.ServiceName
	}
	s.mu.Unlock()
	return s.getToolContext(name)
}
