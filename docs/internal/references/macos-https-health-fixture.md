---
created_on: 2026-11-24 19:55
last_modified: 2026-11-24 19:55
status: current
---

# Native HTTPS health fixture on macOS

The `stack_lifecycle` HTTPS health test uses an HTTP/2-only loopback server and verifies certificate trust, successful health responses, and rejected status codes. Linux uses a private CA file through `SSL_CERT_FILE`. On macOS, native TLS verification uses the system trust store, so the test requires a root certificate already trusted by the test user.

## Hosted macOS CI

On disposable GitHub-hosted macOS runners, CI runs `bash test-support/macosHealthTrust.sh prepare`. It generates a unique one-day CA and a separate server certificate for `127.0.0.1`, adds only that CA to the admin trust store, and exports `DEVHOST_HEALTH_TRUST_DIR` through `GITHUB_ENV`. Disposable hosted macOS VMs are destroyed at job completion, so hosted CI relies on VM teardown for final removal of the temporary trust record rather than invoking interactive-authorization-gated `security delete-certificate` on macOS. The script refuses non-hosted runners and contributor machines and preserves all pre-existing certificates and trust settings.

## Local macOS validation

For local macOS validation, provision a certificate explicitly on an isolated test user or disposable machine:

1. Create a private directory containing `root.pem`, `server.pem`, and `server.key`.
2. Ensure `server.pem` is valid for IP `127.0.0.1`, allows TLS server authentication, and chains to `root.pem` trusted by that user.
3. Export `DEVHOST_HEALTH_TRUST_DIR` pointing to that directory and run `just devhost test`.
4. Remove only the fixture's own certificate and trust record after finishing.

The test fails with a prerequisite diagnostic when `DEVHOST_HEALTH_TRUST_DIR` is missing on macOS; it never skips HTTPS verification or edits the local trust store itself.
