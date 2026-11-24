use std::{ffi::OsString, io, os::unix::ffi::OsStringExt};

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Launch {
    pub args: Vec<OsString>,
    pub environment: Vec<(OsString, OsString)>,
}

#[cfg(target_os = "macos")]
pub(super) fn read_launch(pid: i32) -> io::Result<Launch> {
    let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
    let mut size = 0;
    // SAFETY: the MIB and size pointer are valid; null output requests its size.
    if unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as _,
            std::ptr::null_mut(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    } != 0
    {
        return Err(io::Error::last_os_error());
    }
    let mut bytes = vec![0; size];
    // SAFETY: bytes owns the writable buffer whose capacity is passed in size.
    if unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as _,
            bytes.as_mut_ptr().cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    } != 0
    {
        return Err(io::Error::last_os_error());
    }
    if size > bytes.len() {
        return Err(invalid_data());
    }
    bytes.truncate(size);
    parse_launch(&bytes)
}

fn invalid_data() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "incomplete macOS launch information",
    )
}

fn take_entry<'a>(bytes: &mut &'a [u8]) -> io::Result<&'a [u8]> {
    let end = bytes
        .iter()
        .position(|byte| *byte == 0)
        .ok_or_else(invalid_data)?;
    let entry = &bytes[..end];
    *bytes = &bytes[end + 1..];
    Ok(entry)
}

fn parse_launch(bytes: &[u8]) -> io::Result<Launch> {
    let (count, mut bytes) = bytes.split_first_chunk::<4>().ok_or_else(invalid_data)?;
    let count = i32::from_ne_bytes(*count);
    if count < 1 || count as usize > bytes.len() {
        return Err(invalid_data());
    }
    take_entry(&mut bytes)?; // Executable path precedes alignment padding and argv.
    while bytes.first() == Some(&0) {
        bytes = &bytes[1..];
    }
    let mut args = Vec::new();
    for _ in 0..count {
        args.push(OsString::from_vec(take_entry(&mut bytes)?.to_vec()));
    }
    let mut environment = Vec::new();
    loop {
        let entry = take_entry(&mut bytes)?;
        if entry.is_empty() {
            break; // The remaining Apple vector is not part of environ.
        }
        if let Some(index) = entry.iter().position(|byte| *byte == b'=') {
            environment.push((
                OsString::from_vec(entry[..index].to_vec()),
                OsString::from_vec(entry[index + 1..].to_vec()),
            ));
        }
    }
    Ok(Launch { args, environment })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_empty_arguments_and_environment_bytes_without_loader_metadata() {
        let mut bytes = 3i32.to_ne_bytes().to_vec();
        bytes.extend_from_slice(b"/bin/devhost\0\0devhost\0start\0\0NAME=\xff=opaque\0ptr_munge=user-value\0\0ptr_munge=loader-value\0executable_file=ignored\0");
        let launch = parse_launch(&bytes).unwrap();
        assert_eq!(launch.args, ["devhost", "start", ""].map(OsString::from));
        assert_eq!(
            launch.environment,
            vec![
                ("NAME".into(), OsString::from_vec(b"\xff=opaque".to_vec())),
                ("ptr_munge".into(), "user-value".into()),
            ]
        );
        let mut empty = 2i32.to_ne_bytes().to_vec();
        empty.extend_from_slice(b"/bin/sh\0\0sh\0start\0\0executable_file=ignored\0");
        assert!(parse_launch(&empty).unwrap().environment.is_empty());
        for invalid in [b"".as_slice(), &bytes[..3], &bytes[..8], &bytes[..20]] {
            assert_eq!(
                parse_launch(invalid).unwrap_err().kind(),
                io::ErrorKind::InvalidData
            );
        }
        let mut negative = (-1i32).to_ne_bytes().to_vec();
        negative.extend_from_slice(b"/bin/sh\0sh\0\0");
        assert!(parse_launch(&negative).is_err());
    }
}
