pub mod caddy;
pub mod cliout;
pub mod config;
pub mod devtools;
pub mod files;
pub mod machine;
pub mod manifest;
pub mod paths;
pub mod procid;
pub mod services;
pub mod statuspage;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    pub message: String,
    pub summary: Option<String>,
    pub hint: Option<String>,
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Self {
            message,
            summary: None,
            hint: None,
        }
    }
}
