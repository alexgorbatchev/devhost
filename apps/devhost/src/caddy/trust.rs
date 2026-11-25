use std::{fs, io, path::Path};

use rustls_pki_types::{CertificateDer, pem::PemObject};

pub(crate) const UNTRUSTED_ROOT_CERTIFICATE_WARNING: &str = "managed caddy local CA is not trusted, so browsers will reject devhost HTTPS certificates. Run 'devhost caddy trust' to trust it.";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RootCertificateTrust {
    Missing,
    Untrusted,
    Trusted,
}

pub(crate) fn read_root_certificate_trust(path: &Path) -> Result<RootCertificateTrust, String> {
    let contents = match fs::read(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(RootCertificateTrust::Missing);
        }
        Err(error) => return Err(format!("read managed caddy root certificate: {error}")),
    };
    let cert = match CertificateDer::from_pem_slice(&contents) {
        Ok(cert) => cert,
        Err(_) => {
            return Err(format!(
                "read managed caddy root certificate {}: no PEM certificate",
                path.display()
            ));
        }
    };
    if webpki::anchor_from_trusted_cert(&cert).is_err() {
        return Err(format!(
            "parse managed caddy root certificate {}: invalid X.509 certificate",
            path.display()
        ));
    }
    let native = rustls_native_certs::load_native_certs();
    let trusted = native
        .certs
        .iter()
        .any(|system_cert| system_cert.as_ref() == cert.as_ref());
    if trusted {
        Ok(RootCertificateTrust::Trusted)
    } else {
        Ok(RootCertificateTrust::Untrusted)
    }
}

pub(crate) fn trust_check_warning(error: &str) -> String {
    format!("managed caddy could not check whether its local CA is trusted: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_missing_invalid_and_untrusted_certificates() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path();
        assert_eq!(
            read_root_certificate_trust(&root.join("missing.crt")).unwrap(),
            RootCertificateTrust::Missing
        );

        let invalid = root.join("invalid.crt");
        fs::write(&invalid, "not a certificate").unwrap();
        assert!(
            read_root_certificate_trust(&invalid)
                .unwrap_err()
                .contains("no PEM certificate")
        );

        let bad_der = root.join("bad-der.crt");
        fs::write(
            &bad_der,
            "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
        )
        .unwrap();
        assert!(
            read_root_certificate_trust(&bad_der)
                .unwrap_err()
                .contains("parse managed caddy root certificate")
        );

        assert!(trust_check_warning("boom").contains("boom"));
    }
}
