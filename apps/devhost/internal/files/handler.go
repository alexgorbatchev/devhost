// Package files serves a live directory and renders Markdown documents.
package files

import (
	"cmp"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/statuspage"
)

const maxSymlinkDepth = 40

type Handler struct {
	root *os.Root
}

// Open pins the served root; filesystem reads remain confined to it even if a
// symlink changes during a request.
func Open(directory string) (*Handler, error) {
	directory, err := filepath.EvalSymlinks(directory)
	if err != nil {
		return nil, fmt.Errorf("resolve served directory: %w", err)
	}
	directory, err = filepath.Abs(directory)
	if err != nil {
		return nil, fmt.Errorf("resolve served directory: %w", err)
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, fmt.Errorf("open served directory: %w", err)
	}
	return &Handler{root: root}, nil
}

func (h *Handler) Close() error { return h.root.Close() }

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	name := strings.TrimPrefix(r.URL.Path, "/")
	name = strings.TrimSuffix(name, "/")
	if name == "" {
		name = "."
	}
	f, err := h.open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close() // Read-only descriptor; response errors are handled by net/http.
	info, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if info.IsDir() {
		if !strings.HasSuffix(r.URL.Path, "/") {
			target := *r.URL
			target.Path += "/"
			http.Redirect(w, r, target.String(), http.StatusMovedPermanently)
			return
		}
		h.directory(w, r, f, name)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/") {
		http.NotFound(w, r)
		return
	}
	h.file(w, r, f, info, name)
}

func visible(name string) bool {
	if name == "." {
		return true
	}
	if !fs.ValidPath(name) {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if strings.HasPrefix(part, ".") {
			return false
		}
	}
	return true
}

// Resolve each link so an otherwise public alias cannot expose a hidden file.
// os.Root supplies the independent OS-level confinement for the actual open.
func (h *Handler) resolve(name string) (string, error) {
	if !visible(name) {
		return "", fs.ErrNotExist
	}
	pending := strings.Split(name, "/")
	var resolved []string
	links := 0
	for len(pending) > 0 {
		part := pending[0]
		pending = pending[1:]
		switch part {
		case "", ".":
			continue
		case "..":
			if len(resolved) == 0 {
				return "", fs.ErrPermission
			}
			resolved = resolved[:len(resolved)-1]
			continue
		}
		if strings.HasPrefix(part, ".") {
			return "", fs.ErrNotExist
		}
		prefix := path.Join(append(resolved, part)...)
		info, err := h.root.Lstat(prefix)
		if err != nil {
			return "", err
		}
		if info.Mode()&fs.ModeSymlink != 0 {
			links++
			if links > maxSymlinkDepth {
				return "", fs.ErrPermission
			}
			target, err := h.root.Readlink(prefix)
			if err != nil {
				return "", err
			}
			if filepath.IsAbs(target) {
				// Strip the root without cleaning: a symlink followed by .. must
				// resolve before walking its parent, just like native file access.
				rootPrefix := h.root.Name()
				if !strings.HasSuffix(rootPrefix, string(os.PathSeparator)) {
					rootPrefix += string(os.PathSeparator)
				}
				if target == h.root.Name() {
					target = "."
				} else if strings.HasPrefix(target, rootPrefix) {
					target = strings.TrimPrefix(target, rootPrefix)
				} else {
					return "", fs.ErrPermission
				}
				resolved = nil
			}
			pending = append(strings.Split(filepath.ToSlash(target), "/"), pending...)
			continue
		}
		if len(pending) > 0 && !info.IsDir() {
			return "", fs.ErrNotExist
		}
		resolved = append(resolved, part)
	}
	if len(resolved) == 0 {
		return ".", nil
	}
	return strings.Join(resolved, "/"), nil
}

func (h *Handler) open(name string) (*os.File, error) {
	resolved, err := h.resolve(name)
	if err != nil {
		return nil, err
	}
	// A FIFO swapped in after resolution must not block a request or shutdown.
	f, err := h.root.OpenFile(resolved, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err == nil && (info.IsDir() || info.Mode().IsRegular()) {
		return f, nil
	}
	_ = f.Close() // Return the stat/type failure instead of a descriptor-close error.
	if err != nil {
		return nil, err
	}
	return nil, fs.ErrPermission
}

func (h *Handler) file(w http.ResponseWriter, r *http.Request, f *os.File, info fs.FileInfo, name string) {
	if !strings.EqualFold(path.Ext(name), ".md") {
		http.ServeContent(w, r, name, info.ModTime(), f)
		return
	}
	source, err := io.ReadAll(f)
	if err != nil {
		http.Error(w, "Could not read document", http.StatusInternalServerError)
		return
	}
	h.document(w, r, statuspage.FilePage{Markdown: true, Source: string(source)})
}

func (h *Handler) directory(w http.ResponseWriter, r *http.Request, dir *os.File, name string) {
	for _, index := range []string{"index.html", "index.md"} {
		f, err := h.open(path.Join(name, index))
		if err != nil {
			continue
		}
		info, err := f.Stat()
		if err == nil && info.Mode().IsRegular() {
			h.file(w, r, f, info, index)
			_ = f.Close() // Read-only descriptor; the response is already written.
			return
		}
		_ = f.Close() // An index directory is not a document.
	}
	entries, err := dir.ReadDir(-1)
	if err != nil {
		http.Error(w, "Could not read directory", http.StatusInternalServerError)
		return
	}
	slices.SortFunc(entries, func(a, b fs.DirEntry) int { return cmp.Compare(a.Name(), b.Name()) })
	data := statuspage.FilePage{}
	for _, entry := range entries {
		f, err := h.open(path.Join(name, entry.Name()))
		if err != nil {
			continue
		}
		info, err := f.Stat()
		_ = f.Close() // Metadata read; no data was written.
		if err != nil {
			continue
		}
		label := entry.Name()
		href := url.PathEscape(label)
		if info.IsDir() {
			label += "/"
			href += "/"
		}
		data.Entries = append(data.Entries, statuspage.FileLink{Name: label, Href: href})
	}
	h.document(w, r, data)
}

func (h *Handler) document(w http.ResponseWriter, r *http.Request, data statuspage.FilePage) {
	data.Breadcrumbs = breadcrumbs(r.URL.Path)
	title := "Directory listing"
	if data.Markdown {
		title = r.URL.Path
	}
	body, err := statuspage.Render(statuspage.Page{Kind: "files", Status: http.StatusOK, Title: title, Files: &data}, "")
	if err != nil {
		http.Error(w, "Could not render page", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// Rendering on every request keeps edits visible, including edits made within
	// one filesystem timestamp tick; source and rendered views share one response.
	http.ServeContent(w, r, "", time.Time{}, strings.NewReader(body))
}
