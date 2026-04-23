package devtools

import _ "embed"

var (
	//go:embed dist/devtools.js
	bundledDevtoolsScript string

	//go:embed dist/xterm.css
	bundledXtermStylesheet string
)

func readBundledDevtoolsScript() (string, error) {
	return bundledDevtoolsScript, nil
}

func readXtermStylesheet() (string, error) {
	return bundledXtermStylesheet, nil
}
