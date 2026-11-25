use serde_json::Value;
use std::path::Path;
use sysinfo::{DiskRefreshKind, Disks};

pub(super) fn read() -> Result<Value, String> {
    let disks = Disks::new_with_refreshed_list_specifics(DiskRefreshKind::nothing().with_storage());
    #[cfg(target_os = "linux")]
    {
        // sysinfo includes virtual mounts such as Docker overlays. The Go
        // reader selects storage filesystems supported by this kernel instead.
        let supported = std::fs::read_to_string("/proc/filesystems")
            .map_err(|error| format!("listing supported filesystems: {error}"))?;
        let supported = storage_filesystems(&supported);
        let mut seen = std::collections::BTreeSet::new();
        let mut mounts = Vec::new();
        for disk in disks.list() {
            if disk.name() == "none"
                || !disk
                    .file_system()
                    .to_str()
                    .is_some_and(|kind| supported.contains(kind))
            {
                continue;
            }
            if !seen.insert(disk.name().to_owned()) {
                continue;
            }
            let device = Path::new(disk.name());
            let resolved = device.canonicalize().unwrap_or_else(|_| device.to_owned());
            let name = resolved.file_name().unwrap_or_default();
            if name.as_encoded_bytes().starts_with(b"loop")
                || removable(
                    Path::new("/sys"),
                    name,
                    &mut std::collections::BTreeSet::new(),
                )
            {
                continue;
            }
            mounts.push(disk.mount_point());
        }
        if mounts.is_empty() {
            mounts.push(Path::new("/"));
        }
        let mut used = 0;
        let mut total = 0;
        for mount in mounts {
            let (u, t) = filesystem(mount)
                .map_err(|error| format!("reading filesystem at {}: {error}", mount.display()))?;
            used += u;
            total += t;
        }
        super::resources::space(used, total)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let disk = disks
            .list()
            .iter()
            .find(|disk| disk.mount_point() == Path::new("/"))
            .ok_or("root filesystem is unavailable")?;
        super::resources::space(
            disk.total_space().saturating_sub(disk.available_space()),
            disk.total_space(),
        )
    }
}

#[cfg(target_os = "linux")]
fn storage_filesystems(supported: &str) -> std::collections::BTreeSet<&str> {
    supported
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let first = fields.next()?;
            if first == "nodev" {
                fields.next().filter(|kind| *kind == "zfs")
            } else {
                Some(first)
            }
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn filesystem(path: &Path) -> Result<(u64, u64), String> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let path = CString::new(path.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let mut stat = std::mem::MaybeUninit::<libc::statfs>::uninit();
    // SAFETY: path is NUL terminated; stat points to a writable statfs value and
    // is read only after the syscall initialized it successfully.
    if unsafe { libc::statfs(path.as_ptr(), stat.as_mut_ptr()) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    // SAFETY: successful statfs initialized every field.
    let stat = unsafe { stat.assume_init() };
    let used = (stat.f_blocks - stat.f_bfree) * stat.f_bsize as u64;
    Ok((used, used + stat.f_bavail * stat.f_bsize as u64))
}

#[cfg(target_os = "linux")]
fn removable(
    sysfs: &Path,
    name: &std::ffi::OsStr,
    seen: &mut std::collections::BTreeSet<std::ffi::OsString>,
) -> bool {
    if !seen.insert(name.to_owned()) {
        return false;
    }
    let Ok(path) = sysfs.join("class/block").join(name).canonicalize() else {
        return false;
    };
    let slaves = std::fs::read_dir(path.join("slaves"))
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    if !slaves.is_empty() {
        return slaves
            .iter()
            .any(|slave| removable(sysfs, &slave.file_name(), seen));
    }
    if path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .and_then(|segment| segment.strip_prefix("usb"))
            .is_some_and(|suffix| {
                !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_digit())
            })
    }) {
        return true;
    }
    let disk = if path.join("partition").exists() {
        path.parent().unwrap_or(&path)
    } else {
        &path
    };
    std::fs::read_to_string(disk.join("removable")).is_ok_and(|value| value.trim() == "1")
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn storage_selection_excludes_virtual_mounts_but_includes_zfs() {
        let selected =
            storage_filesystems("nodev\toverlay\n\text4\nnodev\tzfs\n\tntfs3\nnodev\ttmpfs\n");
        assert_eq!(selected, ["ext4", "ntfs3", "zfs"].into());
        assert!(storage_filesystems("").is_empty());
    }

    #[test]
    fn removable_partition_usb_and_device_mapper_follow_underlying_disks() {
        let root = tempfile::tempdir().unwrap();
        let sysfs = root.path();
        let block = sysfs.join("class/block");
        std::fs::create_dir_all(&block).unwrap();
        let fixed = sysfs.join("devices/pci/block/sda");
        let usb = sysfs.join("devices/usb12/block/sdb");
        let removable_disk = sysfs.join("devices/pci/block/sdc");
        for (name, path, flag) in [
            ("sda", &fixed, "0"),
            ("sdb", &usb, "0"),
            ("sdc", &removable_disk, "1"),
        ] {
            std::fs::create_dir_all(path).unwrap();
            std::fs::write(path.join("removable"), flag).unwrap();
            symlink(path, block.join(name)).unwrap();
        }
        let partition = removable_disk.join("sdc1");
        std::fs::create_dir(&partition).unwrap();
        std::fs::write(partition.join("partition"), "1").unwrap();
        symlink(partition, block.join("sdc1")).unwrap();
        let mapped = sysfs.join("devices/virtual/block/dm-0");
        std::fs::create_dir_all(mapped.join("slaves")).unwrap();
        symlink(&fixed, mapped.join("slaves/sda")).unwrap();
        symlink(&usb, mapped.join("slaves/sdb")).unwrap();
        symlink(mapped, block.join("dm-0")).unwrap();
        for (name, expected) in [
            ("sda", false),
            ("sdb", true),
            ("sdc1", true),
            ("dm-0", true),
            ("missing", false),
        ] {
            assert_eq!(
                removable(sysfs, name.as_ref(), &mut Default::default()),
                expected,
                "{name}"
            );
        }
        assert!(filesystem(&sysfs.join("missing")).is_err());
        assert!(filesystem(Path::new("bad\0path")).is_err());
    }
}
