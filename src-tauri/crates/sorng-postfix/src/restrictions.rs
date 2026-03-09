// ── postfix restriction management ───────────────────────────────────────────

use crate::client::PostfixClient;
use crate::error::{PostfixError, PostfixResult};
use crate::types::*;

pub struct RestrictionManager;

impl RestrictionManager {
    /// List all restrictions across all stages.
    pub async fn list(client: &PostfixClient) -> PostfixResult<Vec<PostfixRestriction>> {
        let mut restrictions = Vec::new();
        let stages = [
            RestrictionStage::SmtpdRelay,
            RestrictionStage::SmtpdRecipient,
            RestrictionStage::SmtpdSender,
            RestrictionStage::SmtpdClient,
        ];
        for stage in &stages {
            let names = Self::get(client, stage).await?;
            for (pos, name) in names.iter().enumerate() {
                restrictions.push(PostfixRestriction {
                    name: name.clone(),
                    stage: stage.clone(),
                    position: pos as u32,
                });
            }
        }
        Ok(restrictions)
    }

    /// Get restrictions for a specific stage.
    pub async fn get(
        client: &PostfixClient,
        stage: &RestrictionStage,
    ) -> PostfixResult<Vec<String>> {
        let raw = client.postconf(stage.param_name()).await?;
        let restrictions: Vec<String> = raw
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        Ok(restrictions)
    }

    /// Replace all restrictions for a stage.
    pub async fn set(
        client: &PostfixClient,
        stage: &RestrictionStage,
        restrictions: &[String],
    ) -> PostfixResult<()> {
        let value = restrictions.join(", ");
        client.postconf_set(stage.param_name(), &value).await
    }

    /// Add a restriction at a specific position in a stage.
    pub async fn add(
        client: &PostfixClient,
        stage: &RestrictionStage,
        restriction: &str,
        position: Option<u32>,
    ) -> PostfixResult<()> {
        let mut current = Self::get(client, stage).await?;
        // Check for duplicate
        if current.iter().any(|r| r == restriction) {
            return Err(PostfixError::new(
                crate::error::PostfixErrorKind::InternalError,
                format!(
                    "Restriction '{}' already exists in {}",
                    restriction,
                    stage.param_name()
                ),
            ));
        }
        match position {
            Some(pos) => {
                let idx = (pos as usize).min(current.len());
                current.insert(idx, restriction.to_string());
            }
            None => {
                current.push(restriction.to_string());
            }
        }
        Self::set(client, stage, &current).await
    }

    /// Remove a restriction from a stage.
    pub async fn remove(
        client: &PostfixClient,
        stage: &RestrictionStage,
        restriction: &str,
    ) -> PostfixResult<()> {
        let current = Self::get(client, stage).await?;
        let new_restrictions: Vec<String> =
            current.into_iter().filter(|r| r != restriction).collect();
        Self::set(client, stage, &new_restrictions).await
    }
}
