//! Strict recording command data; validated shape is not recording authority.
use serde::Deserialize;
use sorng_browser_host::ipc::OriginBrowserIdentity;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Request {
    pub identity: OriginBrowserIdentity,
    pub operation: Operation,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Operation {
    Status {},
    Start { metadata_only: bool },
    Stop { recording_id: String },
    Discard { recording_id: String },
    Export { recording_id: String },
}

impl Request {
    pub(crate) fn validate(&self) -> Result<(), String> {
        let invalid = || "Invalid native browser recording request".to_owned();
        self.identity.validate().map_err(|_| invalid())?;
        match &self.operation {
            Operation::Start {
                metadata_only: false,
            } => Err(invalid()),
            Operation::Stop { recording_id }
            | Operation::Discard { recording_id }
            | Operation::Export { recording_id }
                if recording_id.is_empty()
                    || recording_id.len() > 80
                    || !recording_id.bytes().all(|byte| {
                        byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte) || byte == b'-'
                    }) =>
            {
                Err(invalid())
            }
            _ => Ok(()),
        }
    }
}
