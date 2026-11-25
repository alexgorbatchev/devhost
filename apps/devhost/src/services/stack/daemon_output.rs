use super::*;
use std::{
    io::{self, Read},
    os::fd::AsRawFd,
};

#[derive(Default)]
pub(super) struct DaemonOutput {
    services: Mutex<BTreeMap<String, Vec<Readers>>>,
}

impl DaemonOutput {
    pub fn retain(&self, service: &str, readers: Readers) {
        self.services
            .lock()
            .expect("daemon output")
            .entry(service.to_owned())
            .or_default()
            .push(readers);
    }

    pub fn stop(&self, service: &str) {
        let readers = self.services.lock().expect("daemon output").remove(service);
        drop(readers);
    }
}

#[derive(Default)]
pub(super) struct Readers {
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}

impl Readers {
    pub fn spawn<R: Read + AsRawFd + Send + 'static>(
        &mut self,
        pipe: R,
        name: String,
        output: ServiceOutput,
        stderr: bool,
        attempt: Arc<AttemptOutputLines>,
    ) {
        let stop = self.stop.clone();
        self.threads.push(thread::spawn(move || {
            pipe_reader_lines(
                CancellablePipe { pipe, stop },
                &name,
                &output,
                stderr,
                &attempt,
            );
        }));
    }
}

impl Drop for Readers {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

struct CancellablePipe<R> {
    pipe: R,
    stop: Arc<AtomicBool>,
}

impl<R: Read + AsRawFd> Read for CancellablePipe<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        loop {
            if self.stop.load(Ordering::Acquire) {
                return Ok(0);
            }
            let mut fd = libc::pollfd {
                fd: self.pipe.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            };
            // SAFETY: fd points to one initialized pollfd, valid for this call.
            let ready = unsafe { libc::poll(&mut fd, 1, 25) };
            if ready > 0 {
                return self.pipe.read(buffer);
            }
            if ready < 0 {
                let error = io::Error::last_os_error();
                if error.kind() != io::ErrorKind::Interrupted {
                    return Err(error);
                }
            }
        }
    }
}

#[derive(Default)]
pub(super) struct CommandOptions<'a> {
    pub cancel: Option<&'a AtomicBool>,
    pub keep_output: Option<&'a DaemonOutput>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::resolve::{PortResolutionOptions, resolve_service_ports};

    fn manifest(root: &Path) -> ResolvedManifest {
        fs::write(root.join("devhost.toml"), "name = 'daemon-test'\n[services.worker]\ncommand = ['sleep', '30']\nhealth.process = true\n").unwrap();
        resolve_service_ports(
            &crate::manifest::read_manifest(root, None).unwrap(),
            &PortResolutionOptions::default(),
        )
        .unwrap()
    }

    #[test]
    fn lifecycle_helper_receives_cancellation() {
        let fixture = tempfile::tempdir().unwrap();
        let manifest = manifest(fixture.path());
        let service = &manifest.services["worker"];
        let output = ServiceOutput::new(
            cli_command_kit::Mode::Agent,
            Box::new(io::sink()),
            Box::new(io::sink()),
            &["worker"],
        );
        let cancel = AtomicBool::new(false);
        let started = Instant::now();
        thread::scope(|scope| {
            scope.spawn(|| {
                let deadline = Instant::now() + Duration::from_secs(3);
                while !fixture.path().join("ready").exists() && Instant::now() < deadline {
                    thread::sleep(Duration::from_millis(5));
                }
                cancel.store(true, Ordering::Release);
            });
            let result = run_service_command(&manifest, service, &["sh".into(), "-c".into(), "trap 'printf term > terminated; exit 0' TERM; printf ready > ready; while :; do sleep .1; done".into()], "daemon start", &BTreeMap::new(), &[], &output, CommandOptions { cancel: Some(&cancel), keep_output: None });
            assert_eq!(result.unwrap_err(), "canceled");
        });
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(
            fs::read_to_string(fixture.path().join("terminated")).unwrap(),
            "term"
        );
    }

    #[test]
    fn inherited_output_survives_launcher_and_readers_have_bounded_shutdown() {
        let fixture = tempfile::tempdir().unwrap();
        let manifest = manifest(fixture.path());
        let service = &manifest.services["worker"];
        let lines = Arc::new(Mutex::new(Vec::new()));
        let observed = lines.clone();
        let output = ServiceOutput::new(
            cli_command_kit::Mode::Agent,
            Box::new(io::sink()),
            Box::new(io::sink()),
            &["worker"],
        )
        .with_observer(Arc::new(move |_, _, line| {
            observed.lock().unwrap().push(line.to_owned())
        }));
        let owner = DaemonOutput::default();
        let started = Instant::now();
        run_service_command(&manifest, service, &["sh".into(), "-c".into(), "printf '%s' $$ > group; (sleep .1; printf 'heartbeat\\n'; exec sleep 30) & printf '%s' $! > daemon".into()], "daemon start", &BTreeMap::new(), &[], &output, CommandOptions { cancel: None, keep_output: Some(&owner) }).unwrap();
        struct Group(i32, i32);
        impl Drop for Group {
            fn drop(&mut self) {
                send_signal_to_group(self.0, libc::SIGKILL);
                // SAFETY: this fixture owns the background daemon; Linux may adopt it as subreaper.
                unsafe {
                    libc::waitpid(self.1, std::ptr::null_mut(), 0);
                }
            }
        }
        let _group = Group(
            fs::read_to_string(fixture.path().join("group"))
                .unwrap()
                .parse()
                .unwrap(),
            fs::read_to_string(fixture.path().join("daemon"))
                .unwrap()
                .parse()
                .unwrap(),
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        let deadline = Instant::now() + Duration::from_secs(2);
        while !lines.lock().unwrap().iter().any(|line| line == "heartbeat")
            && Instant::now() < deadline
        {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(lines.lock().unwrap().iter().any(|line| line == "heartbeat"));
        let started = Instant::now();
        owner.stop("worker");
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn invalid_log_bytes_do_not_discard_following_lines() {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let observed = lines.clone();
        let output = ServiceOutput::new(
            cli_command_kit::Mode::Agent,
            Box::new(io::sink()),
            Box::new(io::sink()),
            &["worker"],
        )
        .with_observer(Arc::new(move |_, _, line| {
            observed.lock().unwrap().push(line.to_owned())
        }));
        pipe_reader_lines(
            &b"bad \xff\nnext\nlast"[..],
            "worker",
            &output,
            false,
            &AttemptOutputLines::default(),
        );
        assert_eq!(*lines.lock().unwrap(), ["bad \u{fffd}", "next", "last"]);
    }
}
