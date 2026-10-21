// Package caddytest stands in for a managed Caddy's admin endpoint in tests.
package caddytest

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
)

// StartAdminServer starts an admin endpoint that accepts every request, as a running Caddy accepts the requests
// devhost sends it, and returns its address. The endpoint stops when the test ends.
func StartAdminServer(t testing.TB) string {
	t.Helper()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte("{}"))
	}))
	t.Cleanup(server.Close)
	return server.Listener.Addr().String()
}

// WriteUntrustedRootCertificate writes a freshly generated root CA certificate to path, where Caddy keeps its local CA.
// No system trust store holds the new certificate, as none holds a Caddy local CA that was never installed.
func WriteUntrustedRootCertificate(t testing.TB, path string) {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "devhost test local CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	certificate, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificate}), 0o644); err != nil {
		t.Fatal(err)
	}
}

// UnusedAdminAddress returns an admin address that refuses connections for the whole test, as a Caddy that is not
// running does.
func UnusedAdminAddress(t testing.TB) string {
	t.Helper()
	return net.JoinHostPort("127.0.0.1", strconv.Itoa(nettest.ReservePort(t)))
}
