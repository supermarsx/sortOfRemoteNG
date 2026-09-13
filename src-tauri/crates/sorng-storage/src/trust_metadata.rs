//! Descriptive metadata only: edits never approve, revoke, replace or rescope
//! an identity. The caller holds the existing native trust I/O lease.
use super::{TrustRecord, TrustScopeDecision, MAX_TAGS};
use serde::Deserialize;
#[cfg(test)]
#[path = "trust_metadata_tests.rs"]
mod tests;

const MAX_DESCRIPTION_BYTES: usize = 4096;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewedTrustMetadata {
    pub expected_tags: Vec<String>,
    pub expected_description: Option<String>,
    pub expected_decision: TrustScopeDecision,
    pub tags: Vec<String>,
    pub description: Option<String>,
}

pub(super) fn validate_description(description: Option<&str>) -> Result<(), String> {
    if description.is_some_and(|text| text.len() > MAX_DESCRIPTION_BYTES || text.contains('\0')) {
        Err("Trust description must be at most 4096 UTF-8 bytes without NUL characters".into())
    } else {
        Ok(())
    }
}

impl ReviewedTrustMetadata {
    pub(super) fn validate(&self) -> Result<(), String> {
        for tags in [&self.tags, &self.expected_tags] {
            if tags.len() > MAX_TAGS || tags.iter().any(|tag| tag.len() > 256 || tag.contains('\0'))
            {
                return Err("Invalid trust tags".into());
            }
        }
        validate_description(self.description.as_deref())?;
        validate_description(self.expected_description.as_deref())
    }

    pub(super) fn check_current(&self, record: &TrustRecord) -> Result<(), String> {
        if record.tags != self.expected_tags
            || record.description != self.expected_description
            || TrustScopeDecision::from(record) != self.expected_decision
        {
            return Err("Trust identity or metadata changed; refresh before editing. No metadata changes were written".into());
        }
        Ok(())
    }
}
