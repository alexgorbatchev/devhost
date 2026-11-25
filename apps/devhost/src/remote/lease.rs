use std::{
    env, io,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

use super::{
    Options, Settings,
    state::{self, LeaseRecord, Owner, POLL_INTERVAL, STARTUP_TIMEOUT, WorkerRecord},
};
use crate::paths::manifest_identity;
use http_body_util::Empty;
use hyper::{Request, body::Bytes};
use hyper_util::{client::legacy::Client, rt::TokioExecutor};

/// A stack's published routes. Explicit close waits for the last connector to exit.
pub struct Lease {
    dir: PathBuf,
    record: LeaseRecord,
    closed: bool,
}

impl Lease {
    pub fn acquire(options: &Options, cancel: &AtomicBool) -> io::Result<Self> {
        options.validate()?;
        let mut lease = Self {
            dir: options.state_directory.join("remote"),
            record: LeaseRecord {
                owner: Owner::current()?,
                manifest_path: manifest_identity(&options.manifest_path),
                hosts: Vec::new(),
                backend: options.backend.clone(),
            },
            closed: false,
        };
        if let Err(error) = lease.update(options, cancel) {
            return match lease.close() {
                Ok(()) => Err(error),
                Err(cleanup) => Err(io::Error::other(format!("{error}\ncleanup: {cleanup}"))),
            };
        }
        Ok(lease)
    }

    pub fn update(&mut self, options: &Options, cancel: &AtomicBool) -> io::Result<()> {
        if self.closed {
            return Err(io::Error::other("remote preview lease is closed"));
        }
        options.validate()?;
        if options.state_directory.join("remote") != self.dir
            || manifest_identity(&options.manifest_path) != self.record.manifest_path
        {
            return Err(io::Error::other(
                "remote preview lease ownership cannot change",
            ));
        }
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        let next = LeaseRecord {
            hosts: options.hosts.clone(),
            backend: options.backend.clone(),
            ..self.record.clone()
        };
        let result = state::with_lock(&self.dir, deadline, || {
            check_cancel(cancel)?;
            let leases = state::read_leases(&self.dir)?;
            let worker = state::read_worker(&self.dir)?;
            let settings_path = self.dir.join("settings.json");
            if !leases.is_empty() || worker.owner.alive() {
                if state::read_json::<Settings>(&settings_path)? != options.settings {
                    return Err(io::Error::other("remote connector settings changed; stop all remote stacks before changing the machine's remote settings"));
                }
            } else { state::write_json(&settings_path, &options.settings)?; }
            for lease in leases {
                if lease.manifest_path == next.manifest_path && lease.owner == next.owner { continue; }
                if let Some(host) = next.hosts.iter().find(|host| lease.hosts.contains(host)) {
                    return Err(io::Error::other(format!("remote preview hostname {host} already belongs to another stack")));
                }
            }
            state::write_json(&state::lease_path(&self.dir, &next), &next)
        }).and_then(|()| ensure_worker(&options.state_directory, self.record.hosts.is_empty(), deadline, cancel));
        if let Err(error) = result {
            let restore =
                state::with_lock(&self.dir, Instant::now() + Duration::from_secs(5), || {
                    if self.record.hosts.is_empty() {
                        state::remove_file(&state::lease_path(&self.dir, &next))
                    } else {
                        state::write_json(&state::lease_path(&self.dir, &self.record), &self.record)
                    }
                });
            return match restore {
                Ok(()) => Err(error),
                Err(restore) => Err(io::Error::other(format!(
                    "{error}\nrestore remote lease: {restore}"
                ))),
            };
        }
        self.record = next;
        Ok(())
    }

    pub fn close(&mut self) -> io::Result<()> {
        if self.closed {
            return Ok(());
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        state::with_lock(&self.dir, deadline, || {
            state::remove_file(&state::lease_path(&self.dir, &self.record))
        })?;
        self.closed = true;
        loop {
            let done = state::with_lock(&self.dir, deadline, || {
                Ok(!state::read_leases(&self.dir)?.is_empty()
                    || !state::read_worker(&self.dir)?.owner.alive())
            })?;
            if done {
                return Ok(());
            }
            state::pause(deadline)
                .map_err(|e| io::Error::other(format!("wait for remote connector cleanup: {e}")))?;
        }
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        if !self.closed {
            // Unexpected unwinding still withdraws the stack. The worker reaps
            // absent owners if storage failure prevents this best-effort cleanup.
            let _ = self.close();
        }
    }
}

fn check_cancel(cancel: &AtomicBool) -> io::Result<()> {
    if cancel.load(Ordering::Relaxed) {
        Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "remote connector canceled",
        ))
    } else {
        Ok(())
    }
}

fn ensure_worker(
    state_directory: &Path,
    require_connection: bool,
    deadline: Instant,
    cancel: &AtomicBool,
) -> io::Result<()> {
    let dir = state_directory.join("remote");
    loop {
        check_cancel(cancel)?;
        let worker = state::with_lock(&dir, deadline, || {
            let worker = state::read_worker(&dir)?;
            if worker.owner.alive() {
                return Ok(worker);
            }
            spawn_worker(state_directory)
        })?;
        if !worker.admin_address.is_empty() && !worker.stopping {
            return if require_connection {
                await_ready(&worker.admin_address, deadline, cancel)
            } else {
                Ok(())
            };
        }
        state::pause(deadline).map_err(|e| {
            io::Error::other(format!(
                "wait for remote connector startup (log: {}): {e}",
                dir.join("connector.log").display()
            ))
        })?;
    }
}

fn spawn_worker(state_directory: &Path) -> io::Result<WorkerRecord> {
    let dir = state_directory.join("remote");
    // Append is essential when a new owner restarts a failed connector.
    let mut append = std::fs::OpenOptions::new();
    append.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        append.mode(0o600);
    }
    let log = append.open(dir.join("connector.log"))?;
    let mut command = Command::new(env::current_exe()?);
    command
        .arg("_remote-worker")
        .arg("--state-dir")
        .arg(state_directory)
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: setsid is async-signal-safe and the closure touches no shared state.
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() == -1 {
                    Err(io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
    }
    let mut child = command.spawn()?;
    let identity = Owner::for_pid(child.id() as i32);
    let worker = identity.map(|owner| WorkerRecord {
        owner,
        ..Default::default()
    });
    let result = worker.and_then(|worker| {
        state::write_json(&dir.join("worker.json"), &worker)?;
        Ok(worker)
    });
    if result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    } else {
        thread::spawn(move || {
            let _ = child.wait();
        });
    }
    result
}

fn await_ready(address: &str, deadline: Instant, cancel: &AtomicBool) -> io::Result<()> {
    let request = Request::get(format!("http://{address}/ready"))
        .body(Empty::<Bytes>::new())
        .map_err(io::Error::other)?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    runtime.block_on(async {
        let client = Client::builder(TokioExecutor::new()).build_http();
        let request = async {
            let response = client.request(request).await.map_err(io::Error::other)?;
            if response.status() == http::StatusCode::OK { return Ok(()); }
            let bytes = axum::body::to_bytes(axum::body::Body::new(response.into_body()), 1024).await.map_err(io::Error::other)?;
            Err(io::Error::other(format!("remote connector is unavailable: {}", String::from_utf8_lossy(&bytes))))
        };
        tokio::pin!(request);
        loop {
            tokio::select! {
                result = &mut request => return result,
                _ = tokio::time::sleep(POLL_INTERVAL) => {
                    check_cancel(cancel)?;
                    if Instant::now() >= deadline {return Err(io::Error::new(io::ErrorKind::TimedOut, "wait for authenticated remote connector: timed out"));}
                }
            }
        }
    })
}
