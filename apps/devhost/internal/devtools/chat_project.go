package devtools

import (
	"errors"
	"fmt"
)

// chatRoot maps a chat target to the directory its native agents run in. The
// browser names a target, never a path: the project root follows the page's
// routed service, and the devhost root is the source checkout devhost serves
// its devtools from.
func (s *ControlServer) chatRoot(pageURL, target string) (string, error) {
	switch target {
	case chatTargetProject:
		tool, err := s.toolContext(pageURL)
		if err != nil {
			return "", err
		}
		return tool.ProjectRootPath, nil
	case chatTargetDevhost:
		if s.devSource == nil {
			return "", errors.New("This devhost has no devhost source checkout to chat in.")
		}
		return s.devSource.RootPath(), nil
	default:
		return "", fmt.Errorf("unknown chat target %q", target)
	}
}

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

func (s *ControlServer) chatCommandProjectError(session *chatSession, pageURL, target string) error {
	root, err := s.chatRoot(pageURL, target)
	if err != nil {
		return err
	}
	if session.snapshot().ProjectRootPath != root {
		return fmt.Errorf("Chat session belongs to a different project.")
	}
	return nil
}
