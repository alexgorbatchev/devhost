use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver},
    },
    time::{Duration, Instant},
};

use super::resolve::ResolvedService;
use crate::{
    cliout::{self, ServiceOutput},
    manifest::{Inputs, resolve_watch_path},
};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

const DEBOUNCE: Duration = Duration::from_millis(200);
static LIMIT_WARNING: AtomicBool = AtomicBool::new(false);
const EXCLUDED: &[&str] = &[
    ".git",
    "node_modules",
    "vendor",
    ".next",
    ".tmp",
    "dist",
    "target",
    ".workspaces",
    ".shadow",
    ".agents",
    "build",
];

struct ServiceWatch {
    watcher: RecommendedWatcher,
    events: Receiver<notify::Result<Event>>,
    pending: Option<Instant>,
}

pub(crate) struct ServiceWatches {
    watches: BTreeMap<String, ServiceWatch>,
    dirty: Arc<Mutex<BTreeSet<String>>>,
    output: ServiceOutput,
}

impl ServiceWatches {
    pub fn new(dirty: Arc<Mutex<BTreeSet<String>>>, output: ServiceOutput) -> Self {
        Self {
            watches: BTreeMap::new(),
            dirty,
            output,
        }
    }

    pub fn start(&mut self, service: &ResolvedService, label: &str) -> Result<(), String> {
        self.stop(&service.name);
        if service.watch.is_empty() {
            return Ok(());
        }
        let (tx, events) = mpsc::channel();
        let mut watcher =
            notify::recommended_watcher(tx).map_err(|e| format!("create fsnotify watcher: {e}"))?;
        for raw in &service.watch {
            let path = resolve_watch_path(&service.cwd, raw);
            match fs::metadata(&path) {
                Ok(info) if info.is_dir() => add_tree(&mut watcher, &path, &self.output, label)?,
                Ok(_) => add_path(&mut watcher, &path, &self.output, label)?,
                Err(_) => self.output.log_stdout(
                    label,
                    &cliout::warning(
                        self.output.mode(),
                        &format!(
                            "watch path {:?} for service {} does not exist",
                            path, service.name
                        ),
                    ),
                ),
            }
        }
        self.watches.insert(
            service.name.clone(),
            ServiceWatch {
                watcher,
                events,
                pending: None,
            },
        );
        Ok(())
    }

    pub fn stop(&mut self, name: &str) {
        self.watches.remove(name);
        self.clear_dirty(name);
    }

    pub fn clear_dirty(&mut self, name: &str) {
        if let Some(watch) = self.watches.get_mut(name) {
            watch.pending = None;
        }
        self.dirty.lock().expect("dirty services").remove(name);
    }

    pub fn poll(&mut self, label: &str) {
        for (name, watch) in &mut self.watches {
            while let Ok(event) = watch.events.try_recv() {
                match event {
                    Ok(event) if !matches!(event.kind, EventKind::Access(_)) => {
                        if matches!(event.kind, EventKind::Create(_)) {
                            for path in &event.paths {
                                if path.is_dir() {
                                    let _ = add_tree(&mut watch.watcher, path, &self.output, label);
                                }
                            }
                        }
                        watch.pending = Some(Instant::now() + DEBOUNCE);
                    }
                    Ok(_) => {}
                    Err(error) => watch_error(
                        &self.output,
                        label,
                        &format!("watcher error for service {name}: {error}"),
                    ),
                }
            }
            if watch
                .pending
                .is_some_and(|deadline| Instant::now() >= deadline)
            {
                watch.pending = None;
                self.dirty
                    .lock()
                    .expect("dirty services")
                    .insert(name.clone());
            }
        }
    }
}

fn add_tree(
    watcher: &mut RecommendedWatcher,
    root: &Path,
    output: &ServiceOutput,
    label: &str,
) -> Result<(), String> {
    if root
        .file_name()
        .is_some_and(|name| EXCLUDED.iter().any(|excluded| name == *excluded))
    {
        return Ok(());
    }
    add_path(watcher, root, output, label)?;
    for entry in fs::read_dir(root).map_err(|e| format!("add watch path {root:?}: {e}"))? {
        let entry = entry.map_err(|e| format!("add watch path {root:?}: {e}"))?;
        if entry
            .file_type()
            .map_err(|e| format!("stat watched entry: {e}"))?
            .is_dir()
        {
            add_tree(watcher, &entry.path(), output, label)?;
        }
    }
    Ok(())
}

fn add_path(
    watcher: &mut RecommendedWatcher,
    path: &Path,
    output: &ServiceOutput,
    label: &str,
) -> Result<(), String> {
    match watcher.watch(path, RecursiveMode::NonRecursive) {
        Ok(()) => Ok(()),
        Err(error) if is_limit(&error.to_string()) => {
            watch_error(output, label, &error.to_string());
            Ok(())
        }
        Err(error) => Err(format!("add watch path {path:?}: {error}")),
    }
}

fn is_limit(error: &str) -> bool {
    let error = error.to_lowercase();
    ["no space left on device", "too many open files", "limit"]
        .iter()
        .any(|s| error.contains(s))
}

fn watch_error(output: &ServiceOutput, label: &str, error: &str) {
    if !is_limit(error) {
        output.log_stdout(label, error);
        return;
    }
    if !LIMIT_WARNING.swap(true, Ordering::Relaxed) {
        output.log_stdout(
            label,
            &cliout::warning(
                output.mode(),
                "File watching limit reached (no space left on device or too many open files).",
            ),
        );
        output.log_stdout(
            label,
            "To increase watch limits, run: `sudo sysctl -w fs.inotify.max_user_watches=524288`",
        );
    }
}

pub(crate) struct InputWatch {
    watcher: RecommendedWatcher,
    events: Receiver<notify::Result<Event>>,
    pub inputs: Inputs,
    pending: Option<Instant>,
}

impl InputWatch {
    pub fn new(inputs: Inputs) -> Result<Self, String> {
        let (tx, events) = mpsc::channel();
        let watcher =
            notify::recommended_watcher(tx).map_err(|e| format!("watch manifest: {e}"))?;
        let mut result = Self {
            watcher,
            events,
            inputs: Inputs::default(),
            pending: None,
        };
        result.update(inputs)?;
        Ok(result)
    }

    pub fn update(&mut self, inputs: Inputs) -> Result<(), String> {
        let mut directories = BTreeSet::new();
        for file in &inputs.files {
            add_existing_parent(&mut directories, file.parent());
        }
        for pattern in &inputs.patterns {
            let mut parent = Path::new(pattern).parent();
            while let Some(path) = parent {
                let raw = path.to_string_lossy();
                for entry in glob::glob(&raw)
                    .map_err(|e| format!("watch include pattern {pattern}: {e}"))?
                    .flatten()
                {
                    add_existing_parent(&mut directories, Some(&entry));
                }
                if !raw.contains(['*', '?', '[']) {
                    add_existing_parent(&mut directories, Some(path));
                    break;
                }
                parent = path.parent();
            }
        }
        let previous: BTreeSet<_> = self
            .watcher
            .watched_paths()
            .map_err(|e| format!("list manifest watches: {e}"))?
            .into_iter()
            .map(|watch| watch.path)
            .collect();
        for path in directories.difference(&previous) {
            self.watcher
                .watch(path, RecursiveMode::NonRecursive)
                .map_err(|e| format!("watch manifest directory {}: {e}", path.display()))?;
        }
        for path in previous.difference(&directories) {
            // Removing/replacing a watched directory may already retire its OS watch.
            let _ = self.watcher.unwatch(path);
        }
        self.inputs = inputs;
        Ok(())
    }

    pub fn check(&mut self) {
        self.pending = Some(Instant::now() + DEBOUNCE);
    }

    pub fn poll(&mut self) -> Result<bool, String> {
        while let Ok(event) = self.events.try_recv() {
            let event = event.map_err(|e| format!("manifest watcher: {e}"))?;
            if matches!(
                event.kind,
                EventKind::Create(_)
                    | EventKind::Remove(_)
                    | EventKind::Modify(
                        notify::event::ModifyKind::Data(_)
                            | notify::event::ModifyKind::Name(_)
                            | notify::event::ModifyKind::Any
                            | notify::event::ModifyKind::Other
                    )
            ) && event
                .paths
                .iter()
                .any(|path| self.matches(path, &event.kind))
            {
                #[cfg(test)]
                eprintln!("manifest input event: {event:?}");
                self.check();
            }
        }
        if self
            .pending
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            self.pending = None;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    fn matches(&self, path: &Path, kind: &EventKind) -> bool {
        let directory = fs::metadata(path).map_or(true, |info| info.is_dir());
        if directory
            && matches!(
                kind,
                EventKind::Modify(
                    notify::event::ModifyKind::Data(_) | notify::event::ModifyKind::Metadata(_)
                )
            )
        {
            return false;
        }
        if self
            .inputs
            .files
            .iter()
            .any(|file| file == path || directory && file.starts_with(path))
        {
            return true;
        }
        for pattern in &self.inputs.patterns {
            let mut prefix = Some(Path::new(pattern));
            while let Some(candidate) = prefix {
                let raw = candidate.to_string_lossy();
                let options = glob::MatchOptions {
                    require_literal_separator: true,
                    ..Default::default()
                };
                if glob::Pattern::new(&raw).is_ok_and(|p| p.matches_path_with(path, options)) {
                    return true;
                }
                if !directory {
                    break;
                }
                if !raw.contains(['*', '?', '[']) {
                    if candidate.starts_with(path) {
                        return true;
                    }
                    break;
                }
                prefix = candidate.parent();
            }
        }
        false
    }
}

fn add_existing_parent(directories: &mut BTreeSet<PathBuf>, mut path: Option<&Path>) {
    while let Some(candidate) = path {
        if candidate.is_dir() {
            directories.insert(candidate.to_path_buf());
            return;
        }
        path = candidate.parent();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    fn changed(watch: &mut InputWatch) {
        let until = Instant::now() + Duration::from_secs(3);
        while Instant::now() < until {
            if watch.poll().unwrap() {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("filesystem change did not trigger reload");
    }

    #[test]
    fn manifest_watch_recovers_missing_parents_and_atomic_file_replacement() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("config/deep/config.toml");
        let inputs = Inputs {
            files: vec![path.clone()],
            patterns: Vec::new(),
        };
        let mut watch = InputWatch::new(inputs.clone()).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "initial").unwrap();
        changed(&mut watch);
        watch.update(inputs.clone()).unwrap();
        let replacement = path.with_extension("tmp");
        fs::write(&replacement, "replacement").unwrap();
        fs::rename(replacement, &path).unwrap();
        changed(&mut watch);
        assert_eq!(fs::read_to_string(&path).unwrap(), "replacement");
        fs::remove_dir_all(root.path().join("config")).unwrap();
        changed(&mut watch);
        watch.update(inputs.clone()).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "recreated").unwrap();
        changed(&mut watch);
        watch.update(inputs).unwrap();
        fs::write(&path, "edited again").unwrap();
        changed(&mut watch);
    }

    #[test]
    fn manifest_watch_ignores_permission_metadata_events() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("config.toml");
        fs::write(&path, "initial").unwrap();
        let mut watch = InputWatch::new(Inputs {
            files: vec![path.clone()],
            patterns: Vec::new(),
        })
        .unwrap();
        // FSEvents can deliver pre-watch create/write events after registration.
        // Exercise the metadata contract without treating those as chmod events.
        let (sender, events) = mpsc::channel();
        watch.events = events;
        sender
            .send(Ok(Event::new(EventKind::Modify(
                notify::event::ModifyKind::Metadata(notify::event::MetadataKind::Permissions),
            ))
            .add_path(path)))
            .unwrap();
        assert!(!watch.poll().unwrap());
        assert!(watch.pending.is_none());
    }

    #[test]
    fn include_patterns_match_later_patterns_and_nested_membership() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("one")).unwrap();
        let inputs = Inputs {
            files: Vec::new(),
            patterns: vec![
                root.path().join("one/*.toml").display().to_string(),
                root.path().join("two/*/*.toml").display().to_string(),
            ],
        };
        let mut watch = InputWatch::new(inputs.clone()).unwrap();
        fs::create_dir_all(root.path().join("two/nested")).unwrap();
        changed(&mut watch);
        watch.update(inputs.clone()).unwrap();
        let file = root.path().join("two/nested/service.toml");
        fs::write(&file, "service").unwrap();
        changed(&mut watch);
        fs::remove_file(&file).unwrap();
        changed(&mut watch);
        watch.update(Inputs::default()).unwrap();
        fs::write(file, "retired").unwrap();
        let until = Instant::now() + DEBOUNCE * 2;
        while Instant::now() < until {
            assert!(!watch.poll().unwrap());
            thread::sleep(Duration::from_millis(10));
        }
    }
}
