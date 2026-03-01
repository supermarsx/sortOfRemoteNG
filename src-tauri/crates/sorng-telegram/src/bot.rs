//! Bot management — configure, validate, and manage bot instances.

use crate::client::TelegramClient;
use crate::types::*;
use chrono::Utc;
use log::{debug, info, warn};
use std::collections::HashMap;

/// Manages multiple Telegram bot configurations and their clients.
#[derive(Debug)]
pub struct BotManager {
    /// Configured bots keyed by name.
    configs: HashMap<String, TelegramBotConfig>,
    /// Active clients keyed by bot name.
    clients: HashMap<String, TelegramClient>,
    /// Cached bot user info keyed by bot name.
    bot_users: HashMap<String, TgUser>,
    /// Per-bot message counters.
    sent_counts: HashMap<String, u64>,
    /// Per-bot failure counters.
    failed_counts: HashMap<String, u64>,
    /// Per-bot last activity timestamp.
    last_activity: HashMap<String, chrono::DateTime<Utc>>,
}

impl BotManager {
    pub fn new() -> Self {
        Self {
            configs: HashMap::new(),
            clients: HashMap::new(),
            bot_users: HashMap::new(),
            sent_counts: HashMap::new(),
            failed_counts: HashMap::new(),
            last_activity: HashMap::new(),
        }
    }

    /// Add or update a bot configuration.
    pub fn add_bot(&mut self, config: TelegramBotConfig) -> Result<(), String> {
        if config.name.is_empty() {
            return Err("Bot name must not be empty".into());
        }
        if config.token.is_empty() {
            return Err("Bot token must not be empty".into());
        }

        let name = config.name.clone();
        if config.enabled {
            let client = TelegramClient::new(&config)?;
            self.clients.insert(name.clone(), client);
        } else {
            self.clients.remove(&name);
        }

        info!("Bot '{}' configured (enabled={})", name, config.enabled);
        self.configs.insert(name, config);
        Ok(())
    }

    /// Remove a bot configuration.
    pub fn remove_bot(&mut self, name: &str) -> Result<(), String> {
        if self.configs.remove(name).is_none() {
            return Err(format!("Bot '{}' not found", name));
        }
        self.clients.remove(name);
        self.bot_users.remove(name);
        self.sent_counts.remove(name);
        self.failed_counts.remove(name);
        self.last_activity.remove(name);
        info!("Bot '{}' removed", name);
        Ok(())
    }

    /// Get a reference to a bot's client.
    pub fn client(&self, name: &str) -> Result<&TelegramClient, String> {
        self.clients
            .get(name)
            .ok_or_else(|| format!("Bot '{}' not found or not enabled", name))
    }

    /// Get a bot's configuration.
    pub fn config(&self, name: &str) -> Option<&TelegramBotConfig> {
        self.configs.get(name)
    }

    /// List all configured bot names.
    pub fn list_bot_names(&self) -> Vec<String> {
        self.configs.keys().cloned().collect()
    }

    /// Get all bot configurations.
    pub fn list_bots(&self) -> Vec<&TelegramBotConfig> {
        self.configs.values().collect()
    }

    /// Validate a bot token by calling getMe.
    pub async fn validate_bot(&mut self, name: &str) -> Result<TgUser, String> {
        let client = self
            .clients
            .get(name)
            .ok_or_else(|| format!("Bot '{}' not found or not enabled", name))?;

        debug!("Validating bot '{}'", name);
        let user = client.get_me().await?;
        self.bot_users.insert(name.to_string(), user.clone());
        info!(
            "Bot '{}' validated: @{} (id={})",
            name,
            user.username.as_deref().unwrap_or("unknown"),
            user.id
        );
        Ok(user)
    }

    /// Get cached bot user info.
    pub fn bot_user(&self, name: &str) -> Option<&TgUser> {
        self.bot_users.get(name)
    }

    /// Enable or disable a bot.
    pub fn set_enabled(&mut self, name: &str, enabled: bool) -> Result<(), String> {
        let config = self
            .configs
            .get_mut(name)
            .ok_or_else(|| format!("Bot '{}' not found", name))?;

        config.enabled = enabled;

        if enabled {
            let client = TelegramClient::new(config)?;
            self.clients.insert(name.to_string(), client);
        } else {
            self.clients.remove(name);
        }

        info!("Bot '{}' enabled={}", name, enabled);
        Ok(())
    }

    /// Update a bot's token (re-creates the client).
    pub fn update_token(&mut self, name: &str, new_token: String) -> Result<(), String> {
        let config = self
            .configs
            .get_mut(name)
            .ok_or_else(|| format!("Bot '{}' not found", name))?;

        config.token = new_token;
        self.bot_users.remove(name);

        if config.enabled {
            let client = TelegramClient::new(config)?;
            self.clients.insert(name.to_string(), client);
        }

        info!("Bot '{}' token updated", name);
        Ok(())
    }

    /// Record a successful message send.
    pub fn record_success(&mut self, name: &str) {
        *self.sent_counts.entry(name.to_string()).or_insert(0) += 1;
        self.last_activity
            .insert(name.to_string(), Utc::now());
    }

    /// Record a failed message send.
    pub fn record_failure(&mut self, name: &str) {
        *self.failed_counts.entry(name.to_string()).or_insert(0) += 1;
        self.last_activity
            .insert(name.to_string(), Utc::now());
    }

    /// Get sent count for a bot.
    pub fn sent_count(&self, name: &str) -> u64 {
        self.sent_counts.get(name).copied().unwrap_or(0)
    }

    /// Get failed count for a bot.
    pub fn failed_count(&self, name: &str) -> u64 {
        self.failed_counts.get(name).copied().unwrap_or(0)
    }

    /// Get last activity for a bot.
    pub fn last_activity(&self, name: &str) -> Option<&chrono::DateTime<Utc>> {
        self.last_activity.get(name)
    }

    /// Build summaries for all bots.
    pub fn summaries(&self) -> Vec<BotSummary> {
        self.configs
            .values()
            .map(|config| {
                let name = &config.name;
                BotSummary {
                    name: name.clone(),
                    enabled: config.enabled,
                    bot_user: self.bot_users.get(name).cloned(),
                    connected: self.clients.contains_key(name),
                    api_base: config
                        .api_base_url
                        .clone()
                        .unwrap_or_else(|| "https://api.telegram.org".to_string()),
                    messages_sent: self.sent_count(name),
                    messages_failed: self.failed_count(name),
                    last_activity: self.last_activity.get(name).cloned(),
                }
            })
            .collect()
    }

    /// Check if a bot exists and is enabled.
    pub fn is_active(&self, name: &str) -> bool {
        self.clients.contains_key(name)
    }

    /// Get the number of configured bots.
    pub fn count(&self) -> usize {
        self.configs.len()
    }

    /// Get the number of active/enabled bots.
    pub fn active_count(&self) -> usize {
        self.clients.len()
    }

    /// Test connectivity for all enabled bots.
    pub async fn validate_all(&mut self) -> Vec<(String, Result<TgUser, String>)> {
        let names: Vec<String> = self.clients.keys().cloned().collect();
        let mut results = Vec::new();
        for name in names {
            let result = self.validate_bot(&name).await;
            if let Err(ref e) = result {
                warn!("Bot '{}' validation failed: {}", name, e);
            }
            results.push((name, result));
        }
        results
    }
}

impl Default for BotManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config(name: &str) -> TelegramBotConfig {
        TelegramBotConfig {
            name: name.to_string(),
            token: "123456:ABCDEF".to_string(),
            enabled: true,
            ..Default::default()
        }
    }

    #[test]
    fn add_and_list_bots() {
        let mut mgr = BotManager::new();
        mgr.add_bot(test_config("bot1")).unwrap();
        mgr.add_bot(test_config("bot2")).unwrap();
        assert_eq!(mgr.count(), 2);
        assert_eq!(mgr.active_count(), 2);
    }

    #[test]
    fn remove_bot() {
        let mut mgr = BotManager::new();
        mgr.add_bot(test_config("bot1")).unwrap();
        mgr.remove_bot("bot1").unwrap();
        assert_eq!(mgr.count(), 0);
        assert!(mgr.remove_bot("nonexistent").is_err());
    }

    #[test]
    fn empty_name_rejected() {
        let mut mgr = BotManager::new();
        let mut config = test_config("");
        config.name = "".to_string();
        assert!(mgr.add_bot(config).is_err());
    }

    #[test]
    fn empty_token_rejected() {
        let mut mgr = BotManager::new();
        let mut config = test_config("bot");
        config.token = "".to_string();
        assert!(mgr.add_bot(config).is_err());
    }

    #[test]
    fn disabled_bot_has_no_client() {
        let mut mgr = BotManager::new();
        let mut config = test_config("bot1");
        config.enabled = false;
        mgr.add_bot(config).unwrap();
        assert_eq!(mgr.count(), 1);
        assert_eq!(mgr.active_count(), 0);
        assert!(!mgr.is_active("bot1"));
    }

    #[test]
    fn enable_disable_bot() {
        let mut mgr = BotManager::new();
        mgr.add_bot(test_config("bot1")).unwrap();
        assert!(mgr.is_active("bot1"));
        mgr.set_enabled("bot1", false).unwrap();
        assert!(!mgr.is_active("bot1"));
        mgr.set_enabled("bot1", true).unwrap();
        assert!(mgr.is_active("bot1"));
    }

    #[test]
    fn update_token() {
        let mut mgr = BotManager::new();
        mgr.add_bot(test_config("bot1")).unwrap();
        mgr.update_token("bot1", "999:NEW".to_string()).unwrap();
        let config = mgr.config("bot1").unwrap();
        assert_eq!(config.token, "999:NEW");
    }

    #[test]
    fn record_counters() {
        let mut mgr = BotManager::new();
        mgr.add_bot(test_config("bot1")).unwrap();
        mgr.record_success("bot1");
        mgr.record_success("bot1");
        mgr.record_failure("bot1");
        assert_eq!(mgr.sent_count("bot1"), 2);
        assert_eq!(mgr.failed_count("bot1"), 1);
        assert!(mgr.last_activity("bot1").is_some());
    }

    #[test]
    fn summaries() {
        let mut mgr = BotManager::new();
        mgr.add_bot(test_config("bot1")).unwrap();
        mgr.record_success("bot1");
        let summaries = mgr.summaries();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].name, "bot1");
        assert!(summaries[0].connected);
        assert_eq!(summaries[0].messages_sent, 1);
    }

    #[test]
    fn default_bot_manager() {
        let mgr = BotManager::default();
        assert_eq!(mgr.count(), 0);
    }
}
