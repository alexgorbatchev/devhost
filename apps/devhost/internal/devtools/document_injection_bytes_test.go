package devtools

import "testing"

func TestInjectDevtoolsScriptPreservesSourceBytes(t *testing.T) {
	t.Parallel()
	const script = `<script type="module" src="/__devhost__/inject.js"></script>`
	for _, test := range []struct {
		name, prefix, suffix string
	}{
		{"legacy encoding", "<html><body>caf\xe9", "</body></html>"},
		{"unicode case length", "<body>İKȺ", "</body>"},
		{"mixed case", "<BODY>hello", "</BoDy></HTML>"},
		{"last closing tag", "</body><body>second", "</body>"},
		{"other trailing tags", "<body>hello", "</body><footer></footer>"},
		{"absent closing tag", "<body>caf\xff<div>hello</div>", ""},
		{"short trailing tag", "<body>hello<", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got, want := injectDevtoolsScript(test.prefix+test.suffix), test.prefix+script+test.suffix; got != want {
				t.Fatalf("injected document = %q, want %q", got, want)
			}
		})
	}
}
