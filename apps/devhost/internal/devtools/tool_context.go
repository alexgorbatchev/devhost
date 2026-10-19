package devtools

import "github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"

type ToolContext struct {
	ProjectRootPath   string
	AnnotationActions []manifest.ValidatedAnnotationAction
	ResolvePath       func(string) string
}

func (s *ControlServer) toolContext(request terminalSessionRequest) (ToolContext, error) {
	settings := s.currentSettings()
	if s.getToolContext == nil {
		return ToolContext{ProjectRootPath: s.projectRootPath, AnnotationActions: settings.AnnotationActions}, nil
	}
	pageURL := request.PageURL
	if request.Annotation != nil {
		pageURL = request.Annotation.URL
	}
	name := settings.PrimaryService
	if route := resolveRoutedServiceForURL(settings.RoutedServices, pageURL); route != nil {
		name = route.ServiceName
	}
	return s.getToolContext(name)
}
