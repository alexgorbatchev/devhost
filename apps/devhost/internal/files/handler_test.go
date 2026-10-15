package files

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServeFiles(t *testing.T) {
	dir := t.TempDir()
	for name, body := range map[string]string{
		"index.md":                 "# Welcome\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] Done\n\n~~old~~\n\n<script>window.pwned=true</script>\n\n[bad](javascript:alert(1))",
		"nested/index.html":        "<h1>HTML index</h1>",
		"nested/index.md":          "# Lower priority",
		"nested/deeper/target.txt": "nested target",
		"nested/target.txt":        "parent target",
		"target.txt":               "root target",
		"listing/a & b.txt":        "hello world",
		"UPPER.MD":                 "# Uppercase",
		"listing/.secret":          "hidden",
		".env":                     "password",
		".private/token":           "hidden token",
	} {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	outside := filepath.Join(t.TempDir(), "secret.txt")
	if err := os.WriteFile(outside, []byte("outside secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	for name, target := range map[string]string{
		"escape": outside, "alias": ".private", "safe.txt": "listing/a & b.txt",
		"absolute.txt": filepath.Join(dir, "listing/a & b.txt"), "alias.md": "listing/a & b.txt",
		"deep": "nested/deeper", "parent.txt": "deep/../target.txt", "broken.txt": "missing/../target.txt",
		"absolute-parent.txt": dir + "/deep/../target.txt",
	} {
		if err := os.Symlink(target, filepath.Join(dir, name)); err != nil {
			t.Fatal(err)
		}
	}
	h, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := h.Close(); err != nil {
			t.Error(err)
		}
	})
	for _, tt := range []struct {
		name, method, target string
		status               int
		contains, excludes   []string
	}{
		{"markdown", "GET", "/", 200, []string{"<h1>Welcome</h1>", "<table>", "type=\"checkbox\"", "<del>old</del>", "&lt;script&gt;", "Show source"}, []string{"<script>window.pwned", "href=\"javascript:"}},
		{"index priority", "GET", "/nested/", 200, []string{"HTML index"}, []string{"Lower priority"}},
		{"listing", "GET", "/listing/", 200, []string{"a%20&amp;%20b.txt", "a &amp; b.txt"}, []string{".secret"}},
		{"root listing protection", "GET", "/listing/.secret", 404, nil, []string{"hidden"}},
		{"hidden file", "GET", "/.env", 404, nil, []string{"password"}},
		{"hidden directory", "GET", "/.private/token", 404, nil, nil},
		{"hidden alias", "GET", "/alias/token", 404, nil, []string{"hidden token"}},
		{"outside symlink", "GET", "/escape", 404, nil, []string{"outside secret"}},
		{"inside symlink", "GET", "/safe.txt", 200, []string{"hello world"}, nil},
		{"absolute inside symlink", "GET", "/absolute.txt", 200, []string{"hello world"}, nil},
		{"markdown alias", "GET", "/alias.md", 200, []string{"<p>hello world</p>", "Show source"}, nil},
		{"uppercase markdown", "GET", "/UPPER.MD", 200, []string{"<h1>Uppercase</h1>"}, nil},
		{"parent after symlink", "GET", "/parent.txt", 200, []string{"parent target"}, []string{"root target"}},
		{"absolute parent after symlink", "GET", "/absolute-parent.txt", 200, []string{"parent target"}, []string{"root target"}},
		{"missing link component", "GET", "/broken.txt", 404, nil, []string{"root target"}},
		{"traversal", "GET", "/../secret.txt", 404, nil, nil},
		{"missing", "GET", "/missing", 404, nil, nil},
		{"head", "HEAD", "/index.md", 200, nil, []string{"Welcome"}},
		{"read only", "POST", "/index.md", 405, nil, nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(tt.method, tt.target, nil)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tt.status {
				t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
			}
			for _, s := range tt.contains {
				if !strings.Contains(w.Body.String(), s) {
					t.Errorf("missing %q in %s", s, w.Body.String())
				}
			}
			for _, s := range tt.excludes {
				if strings.Contains(w.Body.String(), s) {
					t.Errorf("unexpected %q", s)
				}
			}
		})
	}
	server := httptest.NewServer(h)
	t.Cleanup(server.Close)
	req, err := http.NewRequest(http.MethodGet, server.URL+"/safe.txt", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Range", "bytes=0-4")
	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusPartialContent || string(body) != "hello" {
		t.Fatalf("range: %d %q", resp.StatusCode, body)
	}
	if err := os.WriteFile(filepath.Join(dir, "safe-new.md"), []byte("# New file"), 0o644); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/safe-new.md", nil))
	if !strings.Contains(w.Body.String(), "<h1>New file</h1>") {
		t.Fatal("new file was not served")
	}
}
