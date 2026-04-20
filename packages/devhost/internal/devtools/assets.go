package devtools

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

func readBundledDevtoolsScript() (string, error) {
	return readDevtoolsAsset("src/devtools-server/devtoolsScript.generated.txt")
}

func readXtermStylesheet() (string, error) {
	return readDevtoolsAsset("node_modules/@xterm/xterm/css/xterm.css")
}

func readDevtoolsAsset(relativePath string) (string, error) {
	_, currentFilePath, _, ok := runtime.Caller(0)
	if !ok {
		return "", fmt.Errorf("resolve devtools asset path: runtime caller unavailable")
	}

	moduleRootPath := filepath.Clean(filepath.Join(filepath.Dir(currentFilePath), "..", ".."))
	assetPath := filepath.Join(moduleRootPath, relativePath)
	assetText, error := os.ReadFile(assetPath)
	if error != nil {
		return "", fmt.Errorf("read devtools asset %s: %w", relativePath, error)
	}

	return string(assetText), nil
}
