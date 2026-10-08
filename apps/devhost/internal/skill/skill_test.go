package skill

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// negativeInstruction matches the wordings that tell a reader what to leave
// undone. The skill ships with devhost and is read by agents working in other
// people's projects, so it states what to do and what devhost does; rules for
// contributors live in the AGENTS.md files.
var negativeInstruction = regexp.MustCompile(`(?i)\b(do not|don't|never|must not|should not|shouldn't|avoid|refrain)\b`)

func TestSkillGivesNoNegativeInstructions(t *testing.T) {
	t.Parallel()

	referencePaths, err := filepath.Glob(filepath.Join("devhost", "references", "*.md"))
	if err != nil {
		t.Fatalf("list the reference files: %v", err)
	}
	if len(referencePaths) == 0 {
		t.Fatal("found no reference files beside devhost/SKILL.md")
	}

	documents := map[string]string{filepath.Join("devhost", "SKILL.md"): Document()}
	for _, referencePath := range referencePaths {
		content, err := os.ReadFile(referencePath)
		if err != nil {
			t.Fatalf("read %s: %v", referencePath, err)
		}
		documents[referencePath] = string(content)
	}

	for documentPath, content := range documents {
		for index, line := range strings.Split(content, "\n") {
			// Emphasis marks can sit inside a phrase, as in "must **not**".
			plain := strings.ReplaceAll(line, "*", "")
			if phrase := negativeInstruction.FindString(plain); phrase != "" {
				t.Errorf("%s:%d says %q: %s", documentPath, index+1, phrase, strings.TrimSpace(line))
			}
		}
	}
}
