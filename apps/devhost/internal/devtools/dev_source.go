package devtools

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

const devtoolsBundleRecipe = "build-devtools-bundle"

// DevSourceCheckout locates everything the on-demand asset loop needs inside a
// devhost source checkout. All paths derive from the checkout root so the
// sources that are watched, the bundle that is served, and the recipe that
// rebuilds it can never point at different trees.
type DevSourceCheckout struct {
	rootPath            string
	sourceDirectoryPath string
	assetsDirectoryPath string
	justfilePath        string
}

// NewDevSourceCheckout rejects a root that lacks the devtools sources or the
// app justfile, so a mistyped path fails at startup instead of silently
// serving the embedded assets on every request.
func NewDevSourceCheckout(rootPath string) (*DevSourceCheckout, error) {
	appDirectoryPath := filepath.Join(rootPath, "apps", "devhost")
	checkout := &DevSourceCheckout{
		rootPath:            rootPath,
		sourceDirectoryPath: filepath.Join(rootPath, "packages", "devhost-ui", "src", "devtools"),
		assetsDirectoryPath: filepath.Join(appDirectoryPath, "internal", "devtools", "dist"),
		justfilePath:        filepath.Join(appDirectoryPath, "justfile"),
	}

	if err := requireDevSourcePath(rootPath, checkout.sourceDirectoryPath, true); err != nil {
		return nil, err
	}

	if err := requireDevSourcePath(rootPath, checkout.justfilePath, false); err != nil {
		return nil, err
	}

	return checkout, nil
}

func requireDevSourcePath(rootPath string, path string, wantDirectory bool) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("%s is not a devhost checkout: %w", rootPath, err)
	}

	if info.IsDir() != wantDirectory {
		return fmt.Errorf("%s is not a devhost checkout: unexpected file type at %s", rootPath, path)
	}

	return nil
}

// RootPath is the checkout root the loop was configured with.
func (c *DevSourceCheckout) RootPath() string {
	return c.rootPath
}

func (c *DevSourceCheckout) assetPath(name string) string {
	return filepath.Join(c.assetsDirectoryPath, name)
}

// buildCommand runs the app justfile's bundle recipe. just runs a recipe from
// the directory of the justfile passed with --justfile, which is where the
// recipe expects to be.
func (c *DevSourceCheckout) buildCommand(ctx context.Context) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "just", "--justfile", c.justfilePath, devtoolsBundleRecipe)
	cmd.Env = append(os.Environ(), "DEVHOST_DEVTOOLS_DEVELOPMENT=1")
	return cmd
}
