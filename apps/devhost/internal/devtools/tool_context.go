package devtools

import "github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"

type ToolContext struct {
	ProjectRootPath   string
	AnnotationActions []manifest.ValidatedAnnotationAction
	ResolvePath       func(string) string
}

func (s *ControlServer) toolContext(request terminalSessionRequest) (ToolContext, error) {
	if s.getToolContext == nil {
		return ToolContext{ProjectRootPath: s.projectRootPath, AnnotationActions: s.annotationActions}, nil
	}
	pageURL := request.PageURL
	if request.Annotation != nil {
		pageURL = request.Annotation.URL
	}
	s.mu.Lock()
	name := s.primaryService
	if route := resolveRoutedServiceForURL(s.routedServices, pageURL); route != nil {
		name = route.ServiceName
	}
	s.mu.Unlock()
	return s.getToolContext(name)
}
