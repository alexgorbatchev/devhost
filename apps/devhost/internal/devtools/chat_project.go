package devtools

import "fmt"

func (s *ControlServer) chatSessionInProject(id, root string) *chatSession {
	s.chat.mu.Lock()
	session := s.chat.sessions[id]
	s.chat.mu.Unlock()
	if session == nil || session.snapshot().ProjectRootPath != root {
		return nil
	}
	return session
}

func (s *ControlServer) chatResumeMatchesProject(nativeID, harness, root string) bool {
	if nativeID == "" {
		return true
	}
	s.chat.mu.Lock()
	defer s.chat.mu.Unlock()
	for _, session := range s.chat.sessions {
		info := session.snapshot()
		if info.NativeSessionID == nativeID && info.Harness == harness && info.ProjectRootPath != root {
			return false
		}
	}
	return true
}

func (s *ControlServer) chatCommandProjectError(session *chatSession, pageURL string) error {
	tool, err := s.toolContext(pageURL)
	if err != nil {
		return err
	}
	if session.snapshot().ProjectRootPath != tool.ProjectRootPath {
		return fmt.Errorf("Chat session belongs to a different project.")
	}
	return nil
}
