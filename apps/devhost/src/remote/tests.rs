use super::{
    state::{self, LeaseRecord, Owner},
    *,
};
use std::{
    fs, io,
    os::unix::fs::PermissionsExt,
    time::{Duration, Instant},
};

fn options(root: &std::path::Path) -> Options {
    let credentials = root.join("credentials");
    fs::write(&credentials, "machine:private").unwrap();
    fs::set_permissions(&credentials, fs::Permissions::from_mode(0o600)).unwrap();
    Options {
        state_directory: root.join("state"),
        manifest_path: root.join("devhost.toml"),
        settings: Settings {
            server_url: "http://127.0.0.1:1".to_owned(),
            credential_file: credentials,
            fingerprint: "pin".to_owned(),
            remote_port: 18081,
            domain_suffix: ".preview.example.test".to_owned(),
        },
        hosts: vec!["app.preview.example.test".to_owned()],
        backend: Backend {
            scheme: "http".to_owned(),
            address: "127.0.0.1:3000".to_owned(),
            root_certificate_path: Default::default(),
        },
    }
}

#[test]
fn credentials_enforce_private_regular_bounded_single_line_files() {
    let fixture = tempfile::tempdir().unwrap();
    let options = options(fixture.path());
    let path = options.settings.credential_file;
    for bytes in [
        b"".as_slice(),
        b"user",
        b":pass",
        b"user:",
        b"user:pass\nsecond:line",
        b"user:pa\0ss",
        b"user:\xff",
    ] {
        fs::write(&path, bytes).unwrap();
        assert!(settings::read_credentials(&path).is_err(), "{bytes:?}");
    }
    fs::write(&path, vec![b'a'; 4097]).unwrap();
    assert!(
        settings::read_credentials(&path)
            .unwrap_err()
            .to_string()
            .contains("4096")
    );
    fs::write(&path, "  user:pass:word\n").unwrap();
    assert_eq!(settings::read_credentials(&path).unwrap(), "user:pass:word");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(
        settings::read_credentials(&path)
            .unwrap_err()
            .to_string()
            .contains("0600")
    );
    assert!(settings::read_credentials(fixture.path()).is_err());
    fs::remove_file(&path).unwrap();
    assert!(
        settings::read_credentials(&path)
            .unwrap_err()
            .to_string()
            .contains("open remote credential file")
    );
}

#[test]
fn invalid_remote_options_fail_before_publication() {
    let fixture = tempfile::tempdir().unwrap();
    let cases: [fn(&mut Options); 12] = [
        |o| o.state_directory.clear(),
        |o| o.manifest_path.clear(),
        |o| o.settings.server_url.clear(),
        |o| o.settings.fingerprint.clear(),
        |o| o.settings.remote_port = 0,
        |o| o.hosts.clear(),
        |o| o.hosts[0] = "Upper.example.test".to_owned(),
        |o| o.hosts[0] = "app:443".to_owned(),
        |o| o.backend.scheme = "ftp".to_owned(),
        |o| o.backend.address = "192.0.2.1:3000".to_owned(),
        |o| o.backend.address = "localhost:3000".to_owned(),
        |o| o.backend.scheme = "https".to_owned(),
    ];
    for change in cases {
        let mut options = options(fixture.path());
        change(&mut options);
        assert!(options.validate().is_err());
        assert!(!options.state_directory.join("remote").exists());
    }
    assert!(options(fixture.path()).validate().is_ok());
}

#[test]
fn state_lock_serializes_and_expires_without_running_action() {
    let fixture = tempfile::tempdir().unwrap();
    let dir = fixture.path();
    state::with_lock(dir, Instant::now() + Duration::from_secs(1), || {
        let result: io::Result<()> =
            state::with_lock(dir, Instant::now() + Duration::from_millis(20), || {
                panic!("locked action ran")
            });
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::TimedOut);
        Ok(())
    })
    .unwrap();
    state::with_lock(dir, Instant::now() + Duration::from_secs(1), || Ok(())).unwrap();
    assert_eq!(
        fs::metadata(dir.join("state.lock"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert_eq!(
        fs::metadata(dir.join("leases"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
}

#[test]
fn state_preserves_live_owners_reaps_stale_owners_and_rejects_corruption() {
    let fixture = tempfile::tempdir().unwrap();
    let dir = fixture.path();
    state::with_lock(dir, Instant::now() + Duration::from_secs(1), || Ok(())).unwrap();
    let options = options(dir);
    let current = Owner::current().unwrap();
    assert!(current.alive());
    assert!(!Owner::default().alive());
    let live = LeaseRecord {
        owner: current.clone(),
        manifest_path: options.manifest_path,
        hosts: options.hosts,
        backend: options.backend,
    };
    let live_path = state::lease_path(dir, &live);
    state::write_json(&live_path, &live).unwrap();
    let mut stale = live.clone();
    stale.owner.start_identity.push_str("-stale");
    assert!(!stale.owner.alive());
    let stale_path = state::lease_path(dir, &stale);
    state::write_json(&stale_path, &stale).unwrap();
    fs::write(dir.join("leases/ignored.txt"), "ignored").unwrap();
    fs::create_dir(dir.join("leases/subdirectory")).unwrap();
    assert_eq!(state::read_leases(dir).unwrap().len(), 1);
    assert!(!stale_path.exists());
    assert_eq!(
        fs::metadata(&live_path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    fs::write(&live_path, "corrupt").unwrap();
    assert!(
        state::read_leases(dir)
            .unwrap_err()
            .to_string()
            .contains("read remote preview lease")
    );
    assert!(live_path.exists());
    state::remove_file(&live_path).unwrap();
    state::remove_file(&live_path).unwrap();
    assert_eq!(state::read_worker(dir).unwrap().owner, Owner::default());
    // Rename failure removes only its own staging file.
    let target = dir.join("occupied");
    fs::create_dir(&target).unwrap();
    assert!(state::write_json(&target, &current).is_err());
    assert!(!fs::read_dir(dir).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".remote-")
    }));
}

#[test]
fn relative_credentials_resolve_against_machine_configuration() {
    let fixture = tempfile::tempdir().unwrap();
    let config = fixture.path().join("config.toml");
    fs::write(&config, "[remote]\nserverURL='https://relay.example.test'\ncredentialFile='private/auth'\nfingerprint='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='\nremotePort=18081\ndomainSuffix='.preview.example.test'\n").unwrap();
    assert_eq!(
        crate::config::read_from(&config)
            .unwrap()
            .remote
            .unwrap()
            .credential_file,
        fixture.path().join("private/auth")
    );
}
