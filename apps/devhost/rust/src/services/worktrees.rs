mod git;
mod selection;
#[cfg(test)]
mod tests;

use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

use super::{
    resolve::ResolvedManifest,
    stop::{GitRepository, discover_git_repository},
};
use crate::{
    caddy::stacks::{self, LiveStack},
    devtools::{WorktreeDirectory, WorktreeOwner, WorktreeRepository},
    manifest::{self, Manifest},
};

/// Owned by the stack loop; no Git or filesystem work runs under a shared lock.
#[derive(Clone)]
pub(crate) struct Worktrees {
    groups: Vec<Group>,
    selection_file: PathBuf,
    caddy_dir: PathBuf,
}

#[derive(Clone)]
struct Group {
    repository: GitRepository,
    view: WorktreeRepository,
    manifest_offset: PathBuf,
    configuration_paths: BTreeMap<PathBuf, PathBuf>,
}

pub(super) fn key(path: &Path) -> String {
    format!("{:x}", Sha256::digest(path.as_os_str().as_encoded_bytes()))
}

fn path_text(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("worktree path is not UTF-8: {}", path.display()))
}

impl Worktrees {
    pub(crate) fn build(
        manifest: &ResolvedManifest,
        state: &Path,
        previous: Option<&Self>,
    ) -> Result<Option<Self>, String> {
        if !manifest.worktrees.enabled {
            return Ok(None);
        }
        let absolute =
            std::path::absolute(&manifest.manifest_path).map_err(|error| error.to_string())?;
        let selection_file = selection::file(&absolute, state);
        let saved = if previous.is_none() {
            selection::read(&selection_file)?
        } else {
            None
        };
        let mut result = Self {
            groups: Vec::new(),
            selection_file,
            caddy_dir: state.join("caddy"),
        };
        let mut names = manifest.service_order.clone();
        names.extend(
            manifest
                .services
                .keys()
                .filter(|name| !manifest.service_order.contains(name))
                .cloned(),
        );
        for name in names {
            let Some(service) = manifest.services.get(&name) else {
                continue;
            };
            let (repository, _) = configured_repository(&service.cwd, previous)?;
            if repository.root.as_os_str().is_empty() {
                continue;
            }
            let id = key(&repository.common_dir);
            if !result.groups.iter().any(|group| group.view.id == id) {
                let configuration_path = manifest
                    .configuration
                    .as_ref()
                    .map(|configuration| &configuration.manifest_path)
                    .unwrap_or(&absolute);
                let offset = configuration_path
                    .strip_prefix(&repository.root)
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|_| {
                        absolute.file_name().map(PathBuf::from).unwrap_or_default()
                    });
                let mut group = Group {
                    view: WorktreeRepository {
                        id: id.clone(),
                        name: repository
                            .root
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into_owned(),
                        configured_path: path_text(&repository.root)?,
                        selected_path: path_text(&repository.root)?,
                        ..Default::default()
                    },
                    repository: repository.clone(),
                    manifest_offset: offset,
                    configuration_paths: BTreeMap::new(),
                };
                if let Some(old) = previous
                    .and_then(|previous| previous.groups.iter().find(|group| group.view.id == id))
                {
                    group.view.name = old.view.name.clone();
                    group.view.configured_path = old.view.configured_path.clone();
                    group.configuration_paths = old.configuration_paths.clone();
                }
                group
                    .configuration_paths
                    .insert(repository.root.clone(), configuration_path.clone());
                result.groups.push(group);
            }
            let group = result.group_mut(&id)?;
            if group.repository.root != repository.root {
                return Err(format!(
                    "services in repository {} have cwd values in different checkouts; configure one checkout before enabling worktrees",
                    group.view.name
                ));
            }
            group.view.service_names.push(name.clone());
            if !service.managed && service.command.is_empty() && service.serve.is_empty() {
                group.view.blocked_reason = format!(
                    "Service {name} is external; devhost cannot switch every service in this repository."
                );
            }
        }
        if let Some(saved) = saved
            && let Some(group) = result
                .groups
                .iter_mut()
                .find(|group| group.view.id == saved.repository_id)
        {
            group.view.selected_path = path_text(&saved.path)?;
        }
        result.refresh()?;
        Ok(Some(result))
    }

    pub(crate) fn snapshot(&self) -> Vec<WorktreeRepository> {
        self.groups.iter().map(|group| group.view.clone()).collect()
    }

    pub(crate) fn refresh(&mut self) -> Result<(), String> {
        for group in &mut self.groups {
            group.refresh(&self.caddy_dir)?;
        }
        Ok(())
    }

    pub(crate) fn restore(&mut self) -> (Option<Manifest>, BTreeMap<String, String>) {
        let mut blocked = BTreeMap::new();
        for group in &mut self.groups {
            if Path::new(&group.view.selected_path) == group.repository.root {
                continue;
            }
            match group.validate_selection(Path::new(&group.view.selected_path)) {
                Ok(configuration) => return (Some(configuration), blocked),
                Err(error) => {
                    group.view.error = error.clone();
                    for name in &group.view.service_names {
                        blocked.insert(name.clone(), error.clone());
                    }
                }
            }
        }
        (None, blocked)
    }

    pub(crate) fn prepare(&mut self, id: &str, path: &Path) -> Result<Manifest, String> {
        let caddy_dir = self.caddy_dir.clone();
        let group = self.group_mut(id)?;
        if !group.view.blocked_reason.is_empty() {
            return Err(group.view.blocked_reason.clone());
        }
        group.refresh(&caddy_dir)?;
        group.validate_selection(path)
    }

    pub(crate) fn select(&mut self, id: &str, path: &Path) -> Result<(), String> {
        let selected = path_text(path)?;
        selection::write(
            &self.selection_file,
            Some(&selection::Selection {
                repository_id: id.to_owned(),
                path: path.to_owned(),
            }),
        )?;
        let group = self.group_mut(id)?;
        group.view.selected_path = selected;
        group.view.switching = true;
        group.view.error.clear();
        Ok(())
    }

    pub(crate) fn saved(&self) -> Result<Option<selection::Selection>, String> {
        selection::read(&self.selection_file)
    }

    pub(crate) fn restore_saved(&self, saved: Option<&selection::Selection>) -> Result<(), String> {
        selection::write(&self.selection_file, saved)
    }

    pub(crate) fn forget(manifest: &Path, state: &Path) -> Result<(), String> {
        let absolute = std::path::absolute(manifest).map_err(|error| error.to_string())?;
        selection::write(&selection::file(&absolute, state), None)
    }

    pub(crate) fn finish(&mut self, blocked: &BTreeMap<String, String>) {
        for group in &mut self.groups {
            group.view.switching = false;
            group.view.error = group
                .view
                .service_names
                .iter()
                .find_map(|name| blocked.get(name))
                .cloned()
                .unwrap_or_default();
            group.view.running_path = if group.view.error.is_empty() {
                group.view.selected_path.clone()
            } else {
                String::new()
            };
        }
    }

    pub(crate) fn expand_affected(
        &self,
        affected: &mut BTreeSet<String>,
        previous: &ResolvedManifest,
    ) {
        for group in &self.groups {
            if group
                .view
                .service_names
                .iter()
                .any(|name| affected.contains(name) && previous.services.contains_key(name))
            {
                affected.extend(group.view.service_names.iter().cloned());
            }
        }
    }

    pub(crate) fn occupant(
        &mut self,
        id: &str,
        path: &Path,
        owner_id: &str,
    ) -> Result<LiveStack, String> {
        let caddy_dir = self.caddy_dir.clone();
        let group = self.group_mut(id)?;
        group.refresh(&caddy_dir)?;
        if group
            .view
            .worktrees
            .iter()
            .any(|entry| Path::new(&entry.path) == path)
        {
            let configuration = group.configuration(path)?;
            for owner in occupants(&caddy_dir, &configuration)? {
                if occupant_id(&owner) == owner_id {
                    return Ok(owner);
                }
            }
        }
        Err("stack ownership changed; refresh worktrees before stopping a stack".to_owned())
    }

    fn group_mut(&mut self, id: &str) -> Result<&mut Group, String> {
        self.groups
            .iter_mut()
            .find(|group| group.view.id == id)
            .ok_or_else(|| format!("unknown repository: {id}"))
    }
}

impl Group {
    fn configuration(&self, root: &Path) -> Result<Manifest, String> {
        let mut path = root.join(&self.manifest_offset);
        if !path.exists()
            && let Some(known) = self.configuration_paths.get(root)
        {
            path = known.clone();
        }
        let configuration = manifest::read_with_inputs(&path).0.map_err(|error| {
            format!(
                "load checkout configuration {}: {}",
                path.display(),
                error.message
            )
        })?;
        for (name, service) in &configuration.services {
            if !service.cwd.is_dir() {
                return Err(format!(
                    "service {name}: cannot access working directory {}",
                    service.cwd.display()
                ));
            }
            if service.cwd.starts_with(root) {
                let actual = fs::canonicalize(&service.cwd).map_err(|error| error.to_string())?;
                if !actual.starts_with(root) {
                    return Err(format!(
                        "service {name} directory escapes checkout: {}",
                        service.cwd.display()
                    ));
                }
            }
        }
        Ok(configuration)
    }

    fn directories(&self, root: &Path) -> Result<Vec<WorktreeDirectory>, String> {
        let repository = discover_git_repository(root)?;
        if repository.root != root || repository.common_dir != self.repository.common_dir {
            return Err(format!(
                "Checkout {} no longer belongs to this repository.",
                root.display()
            ));
        }
        let configuration = self.configuration(root)?;
        super::resolve::resolve_service_order(&configuration)?
            .into_iter()
            .map(|name| {
                Ok(WorktreeDirectory {
                    cwd: path_text(&configuration.services[&name].cwd)?,
                    name,
                })
            })
            .collect()
    }

    fn refresh(&mut self, caddy_dir: &Path) -> Result<(), String> {
        let mut entries = git::list(&self.repository.common_dir)?;
        self.view.default_branch = git::default_branch(&self.repository.common_dir)?;
        for entry in &mut entries {
            if !entry.reason.is_empty() {
                continue;
            }
            match self.directories(Path::new(&entry.path)) {
                Ok(directories) => entry.directories = directories,
                Err(error) => {
                    entry.reason = error;
                    continue;
                }
            }
            let configuration = self.configuration(Path::new(&entry.path))?;
            entry.owners = occupants(caddy_dir, &configuration)?
                .into_iter()
                .map(|owner| {
                    let id = occupant_id(&owner);
                    WorktreeOwner {
                        id,
                        name: owner.name,
                        pid: owner.pid,
                        manifest_path: owner.manifest_path,
                        urls: owner.urls,
                    }
                })
                .collect();
            if entry.owners.is_empty() {
                entry.available = true;
            } else {
                entry.reason =
                    "In use by another stack. Open it to view, or stop it before switching."
                        .to_owned();
            }
        }
        if !entries
            .iter()
            .any(|entry| entry.path == self.view.selected_path)
        {
            entries.push(crate::devtools::Worktree {
                path: self.view.selected_path.clone(),
                reason: "Saved checkout is no longer registered with Git.".to_owned(),
                ..Default::default()
            });
        }
        self.view.worktrees = entries;
        Ok(())
    }

    fn validate_selection(&self, path: &Path) -> Result<Manifest, String> {
        if !self.view.blocked_reason.is_empty() && path != Path::new(&self.view.configured_path) {
            return Err(self.view.blocked_reason.clone());
        }
        let entry = self
            .view
            .worktrees
            .iter()
            .find(|entry| Path::new(&entry.path) == path)
            .ok_or_else(|| {
                format!(
                    "Worktree {} is not registered with this repository",
                    path.display()
                )
            })?;
        if !entry.available {
            return Err(format!("Worktree is unavailable: {}", entry.reason));
        }
        self.directories(path)?;
        self.configuration(path)
    }
}

fn configured_repository(
    cwd: &Path,
    previous: Option<&Worktrees>,
) -> Result<(GitRepository, PathBuf), String> {
    match discover_git_repository(cwd) {
        Ok(repository) if repository.root.as_os_str().is_empty() => {
            Ok((repository, cwd.to_owned()))
        }
        Ok(repository) => Ok((
            repository,
            fs::canonicalize(cwd).map_err(|error| error.to_string())?,
        )),
        Err(error) => {
            let known = previous
                .into_iter()
                .flat_map(|previous| &previous.groups)
                .filter(|group| {
                    cwd.starts_with(&group.repository.root) && !group.repository.root.exists()
                })
                .max_by_key(|group| group.repository.root.as_os_str().len());
            known
                .map(|group| (group.repository.clone(), cwd.to_owned()))
                .ok_or(error)
        }
    }
}

fn occupants(caddy_dir: &Path, configuration: &Manifest) -> Result<Vec<LiveStack>, String> {
    let mut inputs = configuration.inputs.files.clone();
    inputs.push(configuration.manifest_path.clone());
    let inputs: BTreeSet<_> = inputs
        .iter()
        .map(|path| crate::paths::manifest_identity(path))
        .collect();
    let mut owners: Vec<_> = stacks::read_live_stacks(caddy_dir)?
        .into_iter()
        .filter(|owner| {
            owner.pid != std::process::id() as i32
                && owner
                    .manifest_files
                    .iter()
                    .chain(std::iter::once(&owner.manifest_path))
                    .any(|path| inputs.contains(&crate::paths::manifest_identity(Path::new(path))))
        })
        .collect();
    for owner in &mut owners {
        owner.urls =
            crate::caddy::routes::owner_urls(caddy_dir, owner.pid, &owner.owner_start_identity)?;
    }
    Ok(owners)
}

fn occupant_id(owner: &LiveStack) -> String {
    let value = format!(
        "{}\0{}\0{}\0{}\0{}",
        owner.pid,
        owner.owner_start_identity,
        owner.manifest_path,
        owner.started_at,
        owner.manifest_files.join("\0")
    );
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
