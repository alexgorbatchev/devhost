use std::{collections::BTreeMap, env, process::Command};

/// Text used for manifest expansion; opaque OS values stay at the process boundary.
pub fn unicode() -> BTreeMap<String, String> {
    env::vars_os()
        .filter_map(|(key, value)| Some((key.into_string().ok()?, value.into_string().ok()?)))
        .collect()
}

pub fn inherit_non_unicode(command: &mut Command) {
    command.envs(
        env::vars_os().filter(|(key, value)| key.to_str().is_none() || value.to_str().is_none()),
    );
}
