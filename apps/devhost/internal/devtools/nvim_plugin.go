package devtools

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

//go:embed nvim/devhost-react-highlight.nvim/plugin/*.lua nvim/devhost-react-highlight.nvim/lua/devhost-react-highlight/*.lua
var bundledNeovimPlugin embed.FS

func writeBundledNeovimPlugin(destinationPath string) error {
	const sourceRootPath = "nvim/devhost-react-highlight.nvim"

	return fs.WalkDir(bundledNeovimPlugin, sourceRootPath, func(sourcePath string, directoryEntry fs.DirEntry, walkError error) error {
		if walkError != nil {
			return walkError
		}

		relativePath := strings.TrimPrefix(sourcePath, sourceRootPath)
		relativePath = strings.TrimPrefix(relativePath, "/")
		if relativePath == "" {
			return nil
		}

		destinationFilePath := filepath.Join(destinationPath, filepath.FromSlash(relativePath))
		if directoryEntry.IsDir() {
			return os.MkdirAll(destinationFilePath, 0o755)
		}

		content, err := bundledNeovimPlugin.ReadFile(sourcePath)
		if err != nil {
			return fmt.Errorf("read bundled Neovim plugin file: %w", err)
		}
		if err := os.MkdirAll(filepath.Dir(destinationFilePath), 0o755); err != nil {
			return fmt.Errorf("prepare bundled Neovim plugin file: %w", err)
		}
		if err := os.WriteFile(destinationFilePath, content, 0o644); err != nil {
			return fmt.Errorf("write bundled Neovim plugin file: %w", err)
		}

		return nil
	})
}
