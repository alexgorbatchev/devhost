package devtools

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const cacheControlImmutable = "public, max-age=31536000, immutable"

var encodingQualityPattern = regexp.MustCompile(`^(0(\.[0-9]{0,3})?|1(\.0{0,3})?)$`)

type assetResponse struct {
	name         string
	contentType  string
	cacheControl string
	content      []byte
	compressed   []byte
}

func assetVersion(content []byte) string {
	return fmt.Sprintf("%x", sha256.Sum256(content))
}

func allowAssetMethod(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		return true
	}
	w.Header().Set("Allow", "GET, HEAD")
	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	return false
}

func serveAsset(w http.ResponseWriter, r *http.Request, asset assetResponse) {
	if !allowAssetMethod(w, r) {
		return
	}
	w.Header().Set("Vary", "Accept-Encoding")
	w.Header().Set("Cache-Control", asset.cacheControl)
	w.Header().Set("Content-Type", asset.contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	encoding, acceptable := selectAssetEncoding(r.Header.Values("Accept-Encoding"), len(asset.compressed) > 0)
	if !acceptable {
		w.Header().Set("Cache-Control", cacheControlNoStore)
		http.Error(w, "No acceptable content encoding", http.StatusNotAcceptable)
		return
	}
	content := asset.content
	if encoding == "gzip" {
		w.Header().Set("Content-Encoding", encoding)
		content = asset.compressed
	}
	w.Header().Set("ETag", `"`+assetVersion(content)+`"`)
	http.ServeContent(w, r, asset.name, time.Time{}, bytes.NewReader(content))
}

// Identity is acceptable by default; an explicit coding takes precedence over a wildcard.
func selectAssetEncoding(headers []string, hasGzip bool) (string, bool) {
	qualities := map[string]float64{}
	for _, header := range headers {
		for _, item := range strings.Split(header, ",") {
			coding, parameters, _ := strings.Cut(item, ";")
			quality := 1.0
			for _, parameter := range strings.Split(parameters, ";") {
				key, value, ok := strings.Cut(strings.TrimSpace(parameter), "=")
				if !ok || !strings.EqualFold(key, "q") {
					continue
				}
				value = strings.TrimSpace(value)
				parsed, err := strconv.ParseFloat(value, 64)
				if err != nil || !encodingQualityPattern.MatchString(value) {
					quality = 0
				} else {
					quality = parsed
				}
			}
			qualities[strings.ToLower(strings.TrimSpace(coding))] = quality
		}
	}
	gzipQuality, explicitGzip := qualities["gzip"]
	if !explicitGzip {
		gzipQuality = qualities["*"]
	}
	identityQuality, explicitIdentity := qualities["identity"]
	if !explicitIdentity {
		identityQuality = 1
		if wildcard, ok := qualities["*"]; ok && wildcard == 0 {
			identityQuality = 0
		}
	}
	if hasGzip && gzipQuality > 0 && gzipQuality >= identityQuality {
		return "gzip", true
	}
	return "", identityQuality > 0
}

func serveVersionedAsset(w http.ResponseWriter, r *http.Request, asset assetResponse) {
	if !allowAssetMethod(w, r) {
		return
	}
	version := assetVersion(asset.content)
	requestedVersion := r.URL.Query().Get("v")
	if requestedVersion == "" {
		w.Header().Set("Cache-Control", cacheControlNoStore)
		url := *r.URL
		query := url.Query()
		query.Set("v", version)
		url.RawQuery = query.Encode()
		http.Redirect(w, r, url.String(), http.StatusTemporaryRedirect)
		return
	}
	if requestedVersion != version {
		w.Header().Set("Cache-Control", cacheControlNoStore)
		http.NotFound(w, r)
		return
	}
	asset.cacheControl = cacheControlImmutable
	serveAsset(w, r, asset)
}
