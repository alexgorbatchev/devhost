use std::{collections::BTreeMap, env, ffi::OsString, process::Command};

#[cfg(unix)]
use std::os::unix::ffi::{OsStrExt, OsStringExt};

use crate::services::{
    containment::SERVICE_CONTAINMENT_TOKEN_ENV,
    detach::{DETACHED_LOG_ENV, STACK_LOG_ENV},
};

/// Remove private devhost launch and containment variables so a child process or
/// sibling stack launched from inside a running service never inherits them.
pub fn strip_internal_vars(environment: &mut BTreeMap<String, String>) {
    environment.remove(SERVICE_CONTAINMENT_TOKEN_ENV);
    environment.remove(DETACHED_LOG_ENV);
    environment.remove(STACK_LOG_ENV);
}

/// Text used for manifest expansion; opaque OS values stay at the process boundary.
pub fn unicode() -> BTreeMap<String, String> {
    env::vars_os()
        .filter_map(|(key, value)| Some((key.into_string().ok()?, value.into_string().ok()?)))
        .collect()
}

/// UTF-8 launch environment for a stack or serve session, stripped of private
/// devhost internal variables inherited from an enclosing service process.
pub fn sanitized_unicode() -> BTreeMap<String, String> {
    let mut env = unicode();
    strip_internal_vars(&mut env);
    env
}

/// Raw Unix byte pairs for environment variables whose key or value is not valid UTF-8.
pub type NonUnicodeEnv = Vec<(Vec<u8>, Vec<u8>)>;

/// Capture non-UTF-8 environment variables from the current process so they can be
/// forwarded across the daemon boundary and applied to that stack's child processes.
#[cfg(unix)]
pub fn non_unicode() -> NonUnicodeEnv {
    env::vars_os()
        .filter(|(key, value)| key.to_str().is_none() || value.to_str().is_none())
        .map(|(key, value)| (key.as_bytes().to_vec(), value.as_bytes().to_vec()))
        .collect()
}

#[cfg(not(unix))]
pub fn non_unicode() -> NonUnicodeEnv {
    Vec::new()
}

/// Split raw OS environment pairs into sanitized UTF-8 and non-UTF-8 buckets.
#[cfg(unix)]
pub fn split_os_environment(
    pairs: &[(OsString, OsString)],
) -> (BTreeMap<String, String>, NonUnicodeEnv) {
    let mut unicode_env = BTreeMap::new();
    let mut non_unicode_env = Vec::new();
    for (key, value) in pairs {
        match (key.to_str(), value.to_str()) {
            (Some(k), Some(v)) => {
                unicode_env.insert(k.to_owned(), v.to_owned());
            }
            _ => {
                non_unicode_env.push((key.as_bytes().to_vec(), value.as_bytes().to_vec()));
            }
        }
    }
    strip_internal_vars(&mut unicode_env);
    (unicode_env, non_unicode_env)
}

#[cfg(unix)]
pub fn apply_non_unicode(command: &mut Command, vars: &[(Vec<u8>, Vec<u8>)]) {
    for (key, value) in vars {
        command.env(
            OsString::from_vec(key.clone()),
            OsString::from_vec(value.clone()),
        );
    }
}

#[cfg(not(unix))]
pub fn apply_non_unicode(_command: &mut Command, _vars: &[(Vec<u8>, Vec<u8>)]) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_and_split_drop_internal_vars_and_preserve_non_utf8() {
        let mut env = BTreeMap::new();
        env.insert(SERVICE_CONTAINMENT_TOKEN_ENV.to_owned(), "tok-1".to_owned());
        env.insert(DETACHED_LOG_ENV.to_owned(), "/tmp/a.log".to_owned());
        env.insert(STACK_LOG_ENV.to_owned(), "/tmp/b.log".to_owned());
        env.insert("KEEP".to_owned(), "1".to_owned());
        strip_internal_vars(&mut env);
        assert_eq!(env.len(), 1);
        assert_eq!(env.get("KEEP").map(String::as_str), Some("1"));

        #[cfg(unix)]
        {
            let pairs = vec![
                (OsString::from("GOOD"), OsString::from("val")),
                (
                    OsString::from(SERVICE_CONTAINMENT_TOKEN_ENV),
                    OsString::from("leak"),
                ),
                (OsString::from("RAW"), OsString::from_vec(vec![0xff, b'x'])),
            ];
            let (u, nu) = split_os_environment(&pairs);
            assert_eq!(u.get("GOOD").map(String::as_str), Some("val"));
            assert!(!u.contains_key(SERVICE_CONTAINMENT_TOKEN_ENV));
            assert_eq!(nu, vec![(b"RAW".to_vec(), vec![0xff, b'x'])]);
        }
    }
}
