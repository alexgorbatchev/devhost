use serde_json::{Value, json};
use std::io::{Read, Seek, SeekFrom, Write};

pub(super) struct Journal {
    file: std::fs::File,
    pub sequence: u64,
    pub error: Option<String>,
}

impl Journal {
    pub fn new() -> Result<Self, String> {
        // tempfile is private and unlinked immediately, including on a crash.
        Ok(Self {
            file: tempfile::tempfile().map_err(|e| format!("create chat replay: {e}"))?,
            sequence: 0,
            error: None,
        })
    }

    pub fn append(&mut self, payload: &Value) -> Result<u64, String> {
        if let Some(error) = &self.error {
            return Err(error.clone());
        }
        let sequence = self.sequence + 1;
        let result = (|| {
            self.file.seek(SeekFrom::End(0))?;
            serde_json::to_writer(
                &mut self.file,
                &json!({"sequence":sequence,"payload":payload}),
            )?;
            self.file.write_all(b"\n")
        })();
        match result {
            Ok(()) => {
                self.sequence = sequence;
                Ok(sequence)
            }
            Err(e) => {
                let error = format!("retain chat replay: {e}");
                self.error = Some(error.clone());
                Err(error)
            }
        }
    }

    pub fn events(&mut self) -> Result<Vec<Value>, String> {
        if let Some(error) = &self.error {
            return Err(error.clone());
        }
        self.file.rewind().map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        self.file
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        serde_json::Deserializer::from_slice(&bytes)
            .into_iter::<Value>()
            .map(|r| r.map_err(|e| e.to_string()))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_reports_corruption_and_read_failures_instead_of_partial_history() {
        let mut journal = Journal::new().unwrap();
        journal.append(&json!({"type":"native"})).unwrap();
        journal.file.write_all(b"broken\n").unwrap();
        assert!(journal.events().is_err());
        let directory = tempfile::tempdir().unwrap();
        journal.file = std::fs::File::open(directory.path()).unwrap();
        assert!(journal.events().is_err());
    }
}
