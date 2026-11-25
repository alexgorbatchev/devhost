use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::SystemTime,
};

pub const DEV_SOURCE_DIR_ENV: &str = "DEVHOST_DEV_SOURCE_DIR";
pub const DEVTOOLS_BUNDLE_RECIPE: &str = "build-devtools-bundle";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DevSourceCheckout {
    root_path: PathBuf,
    source_directory_path: PathBuf,
    assets_directory_path: PathBuf,
    justfile_path: PathBuf,
}

impl DevSourceCheckout {
    pub fn new(root_path: &Path) -> Result<Self, String> {
        let app_dir = root_path.join("apps/devhost");
        let checkout = Self {
            root_path: root_path.to_path_buf(),
            source_directory_path: root_path.join("packages/devhost-ui/src/devtools"),
            assets_directory_path: app_dir.join("dist/devtools"),
            justfile_path: app_dir.join("justfile"),
        };
        require_dev_source_path(root_path, &checkout.source_directory_path, true)?;
        require_dev_source_path(root_path, &checkout.justfile_path, false)?;
        Ok(checkout)
    }

    pub fn root_path(&self) -> &Path {
        &self.root_path
    }

    pub fn source_directory_path(&self) -> &Path {
        &self.source_directory_path
    }

    pub fn assets_directory_path(&self) -> &Path {
        &self.assets_directory_path
    }

    pub fn asset_path(&self, name: &str) -> PathBuf {
        self.assets_directory_path.join(name)
    }

    pub fn build_assets(&self) -> Result<(), String> {
        let output = Command::new("just")
            .args([
                "--justfile",
                &self.justfile_path.to_string_lossy(),
                DEVTOOLS_BUNDLE_RECIPE,
            ])
            .env("DEVHOST_DEVTOOLS_DEVELOPMENT", "1")
            .output()
            .map_err(|err| format!("build devtools assets: {err}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            let detail = if stderr.is_empty() {
                format!("exit status: {}", output.status)
            } else {
                stderr
            };
            return Err(format!("build devtools assets: {detail}"));
        }
        Ok(())
    }
}

fn require_dev_source_path(
    root_path: &Path,
    path: &Path,
    want_directory: bool,
) -> Result<(), String> {
    let info = fs::metadata(path)
        .map_err(|err| format!("{} is not a devhost checkout: {err}", root_path.display()))?;
    if info.is_dir() != want_directory {
        return Err(format!(
            "{} is not a devhost checkout: unexpected file type at {}",
            root_path.display(),
            path.display()
        ));
    }
    Ok(())
}

pub fn resolve_dev_source_directory(
    environment: &BTreeMap<String, String>,
    manifest_directory: &Path,
) -> Option<PathBuf> {
    let raw = if environment.is_empty() {
        env::var(DEV_SOURCE_DIR_ENV)
            .ok()
            .filter(|s| !s.is_empty())?
    } else {
        environment
            .get(DEV_SOURCE_DIR_ENV)
            .filter(|s| !s.is_empty())
            .cloned()?
    };
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        Some(path)
    } else {
        Some(manifest_directory.join(path))
    }
}

pub fn load_dev_source_checkout(
    environment: &BTreeMap<String, String>,
    manifest_directory: &Path,
    built_in_directory: Option<&Path>,
) -> Result<(Option<DevSourceCheckout>, Option<String>), String> {
    if let Some(source_dir) = resolve_dev_source_directory(environment, manifest_directory) {
        let checkout = DevSourceCheckout::new(&source_dir)
            .map_err(|err| format!("{DEV_SOURCE_DIR_ENV}: {err}"))?;
        return Ok((Some(checkout), None));
    }
    let Some(built_in) = built_in_directory.filter(|p| !p.as_os_str().is_empty()) else {
        return Ok((None, None));
    };
    match DevSourceCheckout::new(built_in) {
        Ok(checkout) => Ok((Some(checkout), None)),
        Err(err) => Ok((
            None,
            Some(format!(
                "This development build serves its embedded devtools assets: {err}"
            )),
        )),
    }
}

pub fn format_js_error(err_log: &str) -> String {
    let quoted = serde_json::to_string(err_log).unwrap_or_else(|_| "\"build error\"".to_owned());
    format!(
        r##"console.error("DEVHOST COMPILATION ERROR:\n" + {quoted});
if (typeof document !== "undefined") {{
	const banner = document.createElement("div");
	banner.style.position = "fixed";
	banner.style.bottom = "0";
	banner.style.left = "0";
	banner.style.right = "0";
	banner.style.background = "#ff3333";
	banner.style.color = "white";
	banner.style.padding = "16px";
	banner.style.zIndex = "999999";
	banner.style.fontFamily = "monospace";
	banner.style.whiteSpace = "pre-wrap";
	banner.style.fontSize = "14px";
	banner.innerText = "DEVHOST COMPILATION ERROR:\n" + {quoted};
	document.body.appendChild(banner);
}}"##
    )
}

pub(crate) fn check_and_build_assets<F>(
    checkout: &DevSourceCheckout,
    build_mu: &Mutex<()>,
    filename: &str,
    on_log: &F,
) -> Result<(Vec<u8>, Option<Vec<u8>>), String>
where
    F: Fn(&str),
{
    let _guard = build_mu.lock().expect("devtools build lock");
    let max_mod = max_source_mod_time(checkout.source_directory_path())?;
    let compiled_path = checkout.asset_path(filename);
    let needs_build = match fs::metadata(&compiled_path) {
        Ok(meta) => {
            let compiled_mod = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            max_mod > compiled_mod
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => true,
        Err(err) => return Err(format!("stat compiled assets: {err}")),
    };
    if needs_build {
        on_log("Changes detected in devtools UI source files. Rebuilding assets...");
        if let Err(err) = checkout.build_assets() {
            on_log(&format!("Compilation failed:\n{err}"));
            return Err(err);
        }
        if !compiled_path.exists() {
            let msg = format!(
                "The {DEVTOOLS_BUNDLE_RECIPE} recipe finished without writing {}.",
                compiled_path.display()
            );
            on_log(&msg);
            return Err(msg);
        }
    }
    read_checkout_asset(checkout, filename)
}

pub(crate) fn read_checkout_asset(
    checkout: &DevSourceCheckout,
    name: &str,
) -> Result<(Vec<u8>, Option<Vec<u8>>), String> {
    let full = checkout.asset_path(name);
    let content = fs::read(&full).map_err(|err| format!("read {}: {err}", full.display()))?;
    let mut compressed = None;
    if name.ends_with(".js") || name.ends_with(".css") {
        let gz_path = checkout.asset_path(&format!("{name}.gz"));
        match fs::read(&gz_path) {
            Ok(bytes) => compressed = Some(bytes),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(format!("read {}: {err}", gz_path.display())),
        }
    }
    Ok((content, compressed))
}

fn max_source_mod_time(dir: &Path) -> Result<SystemTime, String> {
    let mut max_time = SystemTime::UNIX_EPOCH;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = fs::read_dir(&current).map_err(|err| format!("walk source assets: {err}"))?;
        for entry in entries {
            let entry = entry.map_err(|err| format!("walk source assets: {err}"))?;
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with('.') {
                continue;
            }
            let path = entry.path();
            let meta = entry
                .metadata()
                .map_err(|err| format!("walk source assets: {err}"))?;
            if meta.is_dir() {
                stack.push(path);
                continue;
            }
            if name_str.ends_with(".test.ts")
                || name_str.ends_with(".test.tsx")
                || name_str.ends_with(".spec.ts")
                || name_str.ends_with(".spec.tsx")
            {
                continue;
            }
            let modified = meta
                .modified()
                .map_err(|err| format!("walk source assets: {err}"))?;
            if modified > max_time {
                max_time = modified;
            }
        }
    }
    Ok(max_time)
}
