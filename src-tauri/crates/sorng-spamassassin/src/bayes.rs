// ── SpamAssassin Bayesian filter management ─────────────────────────────────

use crate::client::{shell_escape, SpamAssassinClient};
use crate::error::{SpamAssassinError, SpamAssassinResult};
use crate::types::*;

pub struct BayesManager;

impl BayesManager {
    /// Get current Bayes database status via `sa-learn --dump magic`.
    pub async fn status(client: &SpamAssassinClient) -> SpamAssassinResult<BayesStatus> {
        let out = client.sa_learn("--dump magic").await?;
        let mut status = BayesStatus {
            nspam: 0,
            nham: 0,
            ntokens: 0,
            oldest_token: None,
            newest_token: None,
            last_journal_sync: None,
            last_expire: None,
            last_expire_count: None,
        };

        for line in out.stdout.lines() {
            let trimmed = line.trim();
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() < 2 {
                continue;
            }
            // Format: "0.000   0          3          0  non-token data: nspam"
            // We parse the last token description and the values
            if trimmed.contains("nspam") {
                if let Some(val) = extract_magic_value(trimmed) {
                    status.nspam = val;
                }
            } else if trimmed.contains("nham") {
                if let Some(val) = extract_magic_value(trimmed) {
                    status.nham = val;
                }
            } else if trimmed.contains("ntokens") {
                if let Some(val) = extract_magic_value(trimmed) {
                    status.ntokens = val;
                }
            } else if trimmed.contains("oldest atime") {
                status.oldest_token = extract_timestamp_value(trimmed);
            } else if trimmed.contains("newest atime") {
                status.newest_token = extract_timestamp_value(trimmed);
            } else if trimmed.contains("last journal sync atime") {
                status.last_journal_sync = extract_timestamp_value(trimmed);
            } else if trimmed.contains("last expiry atime") {
                status.last_expire = extract_timestamp_value(trimmed);
            } else if trimmed.contains("last expire reduce count") {
                if let Some(val) = extract_magic_value(trimmed) {
                    status.last_expire_count = Some(val);
                }
            }
        }

        Ok(status)
    }

    /// Learn a message as spam by piping content to sa-learn.
    pub async fn learn_spam(
        client: &SpamAssassinClient,
        message: &str,
    ) -> SpamAssassinResult<BayesLearnResult> {
        let escaped = message.replace('\'', "'\\''");
        let cmd = format!(
            "echo '{}' | sudo {} --spam --no-sync",
            escaped,
            client.sa_learn_bin()
        );
        let out = client.exec_ssh(&cmd).await?;
        Ok(parse_learn_output(&out))
    }

    /// Learn a message as ham by piping content to sa-learn.
    pub async fn learn_ham(
        client: &SpamAssassinClient,
        message: &str,
    ) -> SpamAssassinResult<BayesLearnResult> {
        let escaped = message.replace('\'', "'\\''");
        let cmd = format!(
            "echo '{}' | sudo {} --ham --no-sync",
            escaped,
            client.sa_learn_bin()
        );
        let out = client.exec_ssh(&cmd).await?;
        Ok(parse_learn_output(&out))
    }

    /// Learn all messages in a user's maildir folder as spam.
    pub async fn learn_spam_folder(
        client: &SpamAssassinClient,
        user: &str,
        folder: &str,
    ) -> SpamAssassinResult<BayesLearnResult> {
        let cmd = format!(
            "sudo {} --spam --dir {} --username {}",
            client.sa_learn_bin(),
            shell_escape(folder),
            shell_escape(user)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(SpamAssassinError::bayes_error(format!(
                "learn_spam_folder failed: {}",
                out.stderr
            )));
        }
        Ok(parse_learn_output(&out))
    }

    /// Learn all messages in a user's maildir folder as ham.
    pub async fn learn_ham_folder(
        client: &SpamAssassinClient,
        user: &str,
        folder: &str,
    ) -> SpamAssassinResult<BayesLearnResult> {
        let cmd = format!(
            "sudo {} --ham --dir {} --username {}",
            client.sa_learn_bin(),
            shell_escape(folder),
            shell_escape(user)
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(SpamAssassinError::bayes_error(format!(
                "learn_ham_folder failed: {}",
                out.stderr
            )));
        }
        Ok(parse_learn_output(&out))
    }

    /// Forget a previously-learned message.
    pub async fn forget(
        client: &SpamAssassinClient,
        message: &str,
    ) -> SpamAssassinResult<BayesLearnResult> {
        let escaped = message.replace('\'', "'\\''");
        let cmd = format!(
            "echo '{}' | sudo {} --forget --no-sync",
            escaped,
            client.sa_learn_bin()
        );
        let out = client.exec_ssh(&cmd).await?;
        Ok(parse_learn_output(&out))
    }

    /// Clear (wipe) the entire Bayes database.
    pub async fn clear(client: &SpamAssassinClient) -> SpamAssassinResult<()> {
        let out = client.sa_learn("--clear").await?;
        if out.exit_code != 0 {
            return Err(SpamAssassinError::bayes_error(format!(
                "bayes clear failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Force a sync of the Bayes journal to the database.
    pub async fn sync(client: &SpamAssassinClient) -> SpamAssassinResult<()> {
        let out = client.sa_learn("--sync").await?;
        if out.exit_code != 0 {
            return Err(SpamAssassinError::bayes_error(format!(
                "bayes sync failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }

    /// Backup the Bayes database to a portable text format.
    pub async fn backup(client: &SpamAssassinClient) -> SpamAssassinResult<String> {
        let out = client.sa_learn("--backup").await?;
        if out.exit_code != 0 {
            return Err(SpamAssassinError::bayes_error(format!(
                "bayes backup failed: {}",
                out.stderr
            )));
        }
        Ok(out.stdout)
    }

    /// Restore a Bayes database from previously backed-up text data.
    pub async fn restore(client: &SpamAssassinClient, data: &str) -> SpamAssassinResult<()> {
        let escaped = data.replace('\'', "'\\''");
        let cmd = format!(
            "echo '{}' | sudo {} --restore",
            escaped,
            client.sa_learn_bin()
        );
        let out = client.exec_ssh(&cmd).await?;
        if out.exit_code != 0 {
            return Err(SpamAssassinError::bayes_error(format!(
                "bayes restore failed: {}",
                out.stderr
            )));
        }
        Ok(())
    }
}

// ─── Parse helpers ───────────────────────────────────────────────────────────

fn extract_magic_value(line: &str) -> Option<u64> {
    // sa-learn --dump magic output format:
    // "<float>\t<int>\t<int>\t<int>\tnon-token data: <label>"
    let parts: Vec<&str> = line.split_whitespace().collect();
    // The count is typically the third numeric field
    if parts.len() >= 4 {
        parts[2]
            .parse::<u64>()
            .ok()
            .or_else(|| parts[1].parse::<u64>().ok())
    } else {
        None
    }
}

fn extract_timestamp_value(line: &str) -> Option<String> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() >= 4 {
        // The timestamp is typically the third field as an epoch
        if let Ok(epoch) = parts[2].parse::<i64>() {
            if epoch > 0 {
                return Some(
                    chrono::DateTime::from_timestamp(epoch, 0)
                        .map(|dt| dt.to_rfc3339())
                        .unwrap_or_else(|| epoch.to_string()),
                );
            }
        }
    }
    None
}

fn parse_learn_output(out: &SshOutput) -> BayesLearnResult {
    let mut learned = 0u64;
    let mut skipped = 0u64;
    let combined = format!("{}\n{}", out.stdout, out.stderr);

    for line in combined.lines() {
        let trimmed = line.trim().to_lowercase();
        if trimmed.contains("learned") {
            // "Learned tokens from 1 message(s) (1 message(s) examined)"
            if let Some(n) = extract_first_number(&trimmed) {
                learned = n;
            }
        }
        if trimmed.contains("skipped") || trimmed.contains("already learned") {
            if let Some(n) = extract_first_number(&trimmed) {
                skipped = n;
            }
        }
    }

    BayesLearnResult {
        messages_learned: learned,
        messages_skipped: skipped,
        message: out.stdout.trim().to_string(),
    }
}

fn extract_first_number(s: &str) -> Option<u64> {
    for word in s.split_whitespace() {
        if let Ok(n) = word.parse::<u64>() {
            return Some(n);
        }
    }
    None
}
