//! Central service façade for SMTP operations.
//!
//! Aggregates profiles, contacts, templates, the send queue, and the
//! low-level SMTP client behind a single `SmtpService` struct that can
//! be managed as Tauri state.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use chrono::Utc;
use log::{debug, info};
use tokio::sync::Mutex;

use crate::auth;
use crate::client::SmtpClient;
use crate::contacts::ContactStore;
use crate::diagnostics;
use crate::dkim;
use crate::message;
use crate::queue::SendQueue;
use crate::templates;
use crate::types::*;

/// Thread-safe service state for Tauri.
pub type SmtpServiceState = Arc<Mutex<SmtpService>>;

/// The core SMTP service combining all subsystems.
pub struct SmtpService {
    /// Named SMTP profiles.
    profiles: Vec<SmtpProfile>,
    /// Email templates.
    email_templates: Vec<EmailTemplate>,
    /// Contact / address book.
    contacts: ContactStore,
    /// Send queue.
    queue: SendQueue,
    /// Queue configuration.
    queue_config: QueueConfig,
    /// Counter of messages sent in this session.
    messages_sent: u64,
    /// Last activity timestamp.
    last_activity: Option<String>,
}

impl SmtpService {
    /// Create a new service wrapped in `Arc<Mutex<_>>` for Tauri state management.
    pub fn new() -> SmtpServiceState {
        let service = Self {
            profiles: Vec::new(),
            email_templates: Vec::new(),
            contacts: ContactStore::new(),
            queue: SendQueue::new(QueueConfig::default()),
            queue_config: QueueConfig::default(),
            messages_sent: 0,
            last_activity: None,
        };
        Arc::new(Mutex::new(service))
    }

    fn touch(&mut self) {
        self.last_activity = Some(Utc::now().to_rfc3339());
    }

    // ── Profiles ─────────────────────────────────────────────────

    /// Add a profile.
    pub fn add_profile(&mut self, profile: SmtpProfile) -> SmtpResult<String> {
        if self.profiles.iter().any(|p| p.name == profile.name) {
            return Err(SmtpError::config(format!(
                "Profile '{}' already exists",
                profile.name
            )));
        }
        let id = profile.id.clone();
        info!("Adding SMTP profile: {} ({})", profile.name, id);
        self.profiles.push(profile);
        self.touch();
        Ok(id)
    }

    /// Update a profile.
    pub fn update_profile(&mut self, profile: SmtpProfile) -> SmtpResult<()> {
        let existing = self
            .profiles
            .iter_mut()
            .find(|p| p.id == profile.id)
            .ok_or_else(|| SmtpError::config(format!("Profile not found: {}", profile.id)))?;
        *existing = SmtpProfile {
            updated_at: Utc::now(),
            ..profile
        };
        self.touch();
        Ok(())
    }

    /// Delete a profile by ID.
    pub fn delete_profile(&mut self, id: &str) -> SmtpResult<()> {
        let pos = self
            .profiles
            .iter()
            .position(|p| p.id == id)
            .ok_or_else(|| SmtpError::config(format!("Profile not found: {}", id)))?;
        self.profiles.remove(pos);
        self.touch();
        Ok(())
    }

    /// Get a profile by ID.
    pub fn get_profile(&self, id: &str) -> Option<&SmtpProfile> {
        self.profiles.iter().find(|p| p.id == id)
    }

    /// Find a profile by name.
    pub fn find_profile_by_name(&self, name: &str) -> Option<&SmtpProfile> {
        self.profiles.iter().find(|p| p.name == name)
    }

    /// Get the default profile (or the first one).
    pub fn default_profile(&self) -> Option<&SmtpProfile> {
        self.profiles
            .iter()
            .find(|p| p.is_default)
            .or_else(|| self.profiles.first())
    }

    /// Set a profile as default (un-defaults all others).
    pub fn set_default_profile(&mut self, id: &str) -> SmtpResult<()> {
        let found = self.profiles.iter().any(|p| p.id == id);
        if !found {
            return Err(SmtpError::config(format!("Profile not found: {}", id)));
        }
        for p in &mut self.profiles {
            p.is_default = p.id == id;
        }
        self.touch();
        Ok(())
    }

    /// List all profiles.
    pub fn list_profiles(&self) -> &[SmtpProfile] {
        &self.profiles
    }

    /// Resolve a profile by name, falling back to default.
    fn resolve_profile(&self, name: Option<&str>) -> SmtpResult<&SmtpProfile> {
        match name {
            Some(n) => self
                .find_profile_by_name(n)
                .ok_or_else(|| SmtpError::config(format!("Profile not found: {}", n))),
            None => self
                .default_profile()
                .ok_or_else(|| SmtpError::config("No SMTP profiles configured")),
        }
    }

    // ── Templates ────────────────────────────────────────────────

    /// Add a template.
    pub fn add_template(&mut self, tpl: EmailTemplate) -> SmtpResult<String> {
        if self.email_templates.iter().any(|t| t.name == tpl.name) {
            return Err(SmtpError::template(format!(
                "Template '{}' already exists",
                tpl.name
            )));
        }
        let id = tpl.id.clone();
        self.email_templates.push(tpl);
        self.touch();
        Ok(id)
    }

    /// Update a template.
    pub fn update_template(&mut self, tpl: EmailTemplate) -> SmtpResult<()> {
        let existing = self
            .email_templates
            .iter_mut()
            .find(|t| t.id == tpl.id)
            .ok_or_else(|| SmtpError::template(format!("Template not found: {}", tpl.id)))?;
        *existing = EmailTemplate {
            updated_at: Utc::now(),
            ..tpl
        };
        self.touch();
        Ok(())
    }

    /// Delete a template by ID.
    pub fn delete_template(&mut self, id: &str) -> SmtpResult<()> {
        let pos = self
            .email_templates
            .iter()
            .position(|t| t.id == id)
            .ok_or_else(|| SmtpError::template(format!("Template not found: {}", id)))?;
        self.email_templates.remove(pos);
        self.touch();
        Ok(())
    }

    /// Get a template by ID.
    pub fn get_template(&self, id: &str) -> Option<&EmailTemplate> {
        self.email_templates.iter().find(|t| t.id == id)
    }

    /// Find a template by name.
    pub fn find_template_by_name(&self, name: &str) -> Option<&EmailTemplate> {
        self.email_templates.iter().find(|t| t.name == name)
    }

    /// List all templates.
    pub fn list_templates(&self) -> &[EmailTemplate] {
        &self.email_templates
    }

    /// Render a template with variables.
    pub fn render_template(
        &self,
        template_id: &str,
        variables: &HashMap<String, String>,
    ) -> SmtpResult<EmailMessage> {
        let tpl = self
            .get_template(template_id)
            .ok_or_else(|| SmtpError::template(format!("Template not found: {}", template_id)))?;
        let profile = self
            .default_profile()
            .ok_or_else(|| SmtpError::config("No default profile for from address"))?;
        let from = &profile.from_address;
        templates::render_template(tpl, variables, from, &[])
    }

    /// Extract variables from a template.
    pub fn extract_template_variables(&self, template_id: &str) -> SmtpResult<Vec<String>> {
        let tpl = self
            .get_template(template_id)
            .ok_or_else(|| SmtpError::template(format!("Template not found: {}", template_id)))?;
        let mut vars = templates::extract_variables(&tpl.subject_template);
        if let Some(ref text) = tpl.text_template {
            for v in templates::extract_variables(text) {
                if !vars.contains(&v) {
                    vars.push(v);
                }
            }
        }
        if let Some(ref html) = tpl.html_template {
            for v in templates::extract_variables(html) {
                if !vars.contains(&v) {
                    vars.push(v);
                }
            }
        }
        Ok(vars)
    }

    /// Validate a template.
    pub fn validate_template(&self, template_id: &str) -> SmtpResult<Vec<String>> {
        let tpl = self
            .get_template(template_id)
            .ok_or_else(|| SmtpError::template(format!("Template not found: {}", template_id)))?;
        templates::validate_template(tpl)
    }

    // ── Contacts ─────────────────────────────────────────────────

    /// Get a reference to the contact store.
    pub fn contacts(&self) -> &ContactStore {
        &self.contacts
    }

    /// Get a mutable reference to the contact store.
    pub fn contacts_mut(&mut self) -> &mut ContactStore {
        self.touch();
        &mut self.contacts
    }

    // ── Queue ────────────────────────────────────────────────────

    /// Get current queue summary.
    pub fn queue_summary(&self) -> QueueSummary {
        self.queue.summary()
    }

    /// List queue items.
    pub fn queue_list(&self) -> Vec<&QueueItem> {
        self.queue.list(None)
    }

    /// Get a queue item by ID.
    pub fn queue_get(&self, id: &str) -> Option<&QueueItem> {
        self.queue.get(id)
    }

    /// Cancel a queued item.
    pub fn queue_cancel(&mut self, id: &str) -> SmtpResult<()> {
        self.queue.cancel(id)?;
        self.touch();
        Ok(())
    }

    /// Retry all failed items.
    pub fn queue_retry_failed(&mut self) -> usize {
        self.touch();
        self.queue.retry_all_failed()
    }

    /// Purge completed items.
    pub fn queue_purge_completed(&mut self) -> usize {
        self.touch();
        self.queue.purge_completed()
    }

    /// Clear the queue.
    pub fn queue_clear(&mut self) -> usize {
        self.touch();
        self.queue.clear()
    }

    /// Update queue config.
    pub fn set_queue_config(&mut self, config: QueueConfig) {
        self.queue_config = config.clone();
        self.queue = SendQueue::new(config);
        self.touch();
    }

    /// Get queue config.
    pub fn queue_config(&self) -> &QueueConfig {
        &self.queue_config
    }

    // ── Send ─────────────────────────────────────────────────────

    /// Send a single email immediately using the specified (or default) profile.
    pub async fn send_email(
        &mut self,
        msg: &EmailMessage,
        profile_name: Option<&str>,
    ) -> SmtpResult<SendResult> {
        let profile = self.resolve_profile(profile_name)?.clone();
        self.touch();
        send_with_profile(msg, &profile).await.inspect(|_r| {
            self.messages_sent += 1;
            self.last_activity = Some(Utc::now().to_rfc3339());
        })
    }

    /// Enqueue a message for later sending.
    pub fn enqueue(
        &mut self,
        msg: EmailMessage,
        profile_name: Option<String>,
    ) -> SmtpResult<String> {
        let id = if let Some(ref pn) = profile_name {
            self.queue.enqueue_with_profile(msg, pn)?
        } else {
            self.queue.enqueue(msg)?
        };
        self.touch();
        Ok(id)
    }

    /// Enqueue a scheduled message.
    pub fn enqueue_scheduled(
        &mut self,
        msg: EmailMessage,
        schedule: SendSchedule,
        profile_name: Option<String>,
    ) -> SmtpResult<String> {
        let id = self.queue.enqueue_scheduled(msg, schedule)?;
        // If a profile was provided, update the item
        if let Some(pn) = profile_name {
            if let Some(item) = self.queue.items_mut().iter_mut().next_back() {
                item.profile_name = Some(pn);
            }
        }
        self.touch();
        Ok(id)
    }

    /// Process the next batch of pending queue items.
    pub async fn process_queue(&mut self) -> Vec<SendResult> {
        // Collect IDs from the next batch (we can't hold &mut refs across await)
        let item_ids: Vec<String> = self
            .queue
            .next_batch()
            .iter()
            .map(|item| item.id.clone())
            .collect();

        let mut results = Vec::new();

        for item_id in item_ids {
            let _ = self.queue.mark_sending(&item_id);

            let item = match self.queue.get(&item_id) {
                Some(i) => i.clone(),
                None => continue,
            };

            let profile = match self.resolve_profile(item.profile_name.as_deref()) {
                Ok(p) => p.clone(),
                Err(e) => {
                    let _ = self.queue.mark_failed(&item_id, &e.to_string());
                    results.push(SendResult {
                        message_id: item.message.id.clone(),
                        success: false,
                        queue_item_id: Some(item_id),
                        server_message_id: None,
                        recipients: Vec::new(),
                        elapsed_ms: 0,
                        error: Some(e.to_string()),
                    });
                    continue;
                }
            };

            match send_with_profile(&item.message, &profile).await {
                Ok(mut result) => {
                    result.queue_item_id = Some(item_id.clone());
                    let _ = self.queue.mark_sent(&item_id, result.recipients.clone());
                    self.messages_sent += 1;
                    results.push(result);
                }
                Err(e) => {
                    let _ = self.queue.mark_failed(&item_id, &e.to_string());
                    results.push(SendResult {
                        message_id: item.message.id.clone(),
                        success: false,
                        queue_item_id: Some(item_id),
                        server_message_id: None,
                        recipients: Vec::new(),
                        elapsed_ms: 0,
                        error: Some(e.to_string()),
                    });
                }
            }
        }
        self.touch();
        results
    }

    /// Bulk send — enqueue multiple personalised messages.
    pub fn bulk_enqueue(&mut self, request: &BulkSendRequest) -> SmtpResult<BulkSendResult> {
        let mut result = BulkSendResult {
            total: request.recipients.len(),
            queued: 0,
            failed: 0,
            queue_item_ids: Vec::new(),
            errors: Vec::new(),
        };

        for recipient in &request.recipients {
            let msg = if let Some(tpl_id) = &request.template_id {
                match self.render_template(tpl_id, &recipient.variables) {
                    Ok(mut m) => {
                        m.to = vec![recipient.address.clone()];
                        m
                    }
                    Err(e) => {
                        result.failed += 1;
                        result
                            .errors
                            .push(format!("{}: {}", recipient.address.address, e));
                        continue;
                    }
                }
            } else if let Some(base) = &request.base_message {
                let mut m = base.clone();
                m.to = vec![recipient.address.clone()];
                m
            } else {
                result.failed += 1;
                result.errors.push(format!(
                    "{}: No template or base message",
                    recipient.address.address
                ));
                continue;
            };

            match self.enqueue_scheduled(
                msg,
                request.schedule.clone(),
                request.profile_name.clone(),
            ) {
                Ok(id) => {
                    result.queued += 1;
                    result.queue_item_ids.push(id);
                }
                Err(e) => {
                    result.failed += 1;
                    result
                        .errors
                        .push(format!("{}: {}", recipient.address.address, e));
                }
            }
        }
        self.touch();
        Ok(result)
    }

    // ── Diagnostics ──────────────────────────────────────────────

    /// Run full diagnostics for a domain.
    pub async fn run_diagnostics(&self, domain: &str) -> DiagnosticsReport {
        diagnostics::run_diagnostics(domain).await
    }

    /// Quick deliverability check.
    pub async fn quick_deliverability_check(&self, domain: &str) -> SmtpResult<String> {
        diagnostics::quick_deliverability_check(domain).await
    }

    /// MX lookup.
    pub async fn lookup_mx(&self, domain: &str) -> Vec<MxRecord> {
        diagnostics::lookup_mx(domain).await
    }

    /// Check port.
    pub async fn check_port(&self, host: &str, port: u16) -> SmtpResult<u64> {
        diagnostics::check_port(host, port).await
    }

    /// Suggest security.
    pub async fn suggest_security(&self, host: &str) -> (u16, SmtpSecurity) {
        diagnostics::suggest_security(host).await
    }

    /// Get DNS TXT records.
    pub async fn get_dns_txt(&self, domain: &str) -> Vec<String> {
        diagnostics::get_dns_txt_records(domain).await
    }

    // ── DKIM ─────────────────────────────────────────────────────

    /// Validate a DKIM config.
    pub fn validate_dkim_config(&self, config: &DkimConfig) -> SmtpResult<()> {
        dkim::validate_config(config)
    }

    /// Generate a DKIM DNS record.
    pub fn generate_dkim_dns_record(&self, config: &DkimConfig) -> SmtpResult<String> {
        // Extract public key from private key PEM (for DNS record)
        // For now just use the stored private key PEM as a placeholder
        // In production, the user would provide the public key
        Ok(dkim::generate_dns_record(
            &config.selector,
            &config.domain,
            &config.private_key_pem,
        ))
    }

    // ── Status ───────────────────────────────────────────────────

    /// Connection summary.
    pub fn connection_summary(&self) -> SmtpConnectionSummary {
        let profile = self.default_profile();
        SmtpConnectionSummary {
            connected: false,
            tls_active: false,
            authenticated: false,
            server_host: profile.map(|p| p.config.host.clone()),
            server_port: profile.map(|p| p.config.port),
            server_name: profile.map(|p| p.name.clone()),
            ehlo_capabilities: None,
            profile_name: profile.map(|p| p.name.clone()),
            messages_sent: self.messages_sent,
            last_activity: self.last_activity.clone(),
        }
    }

    /// Get counts.
    pub fn stats(&self) -> SmtpStats {
        SmtpStats {
            profiles: self.profiles.len(),
            templates: self.email_templates.len(),
            contacts: self.contacts.count(),
            contact_groups: self.contacts.group_count(),
            queue_summary: self.queue.summary(),
            messages_sent: self.messages_sent,
        }
    }
}

/// Statistics snapshot.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SmtpStats {
    pub profiles: usize,
    pub templates: usize,
    pub contacts: usize,
    pub contact_groups: usize,
    pub queue_summary: QueueSummary,
    pub messages_sent: u64,
}

// ─── Internal helper ─────────────────────────────────────────────

/// Send a message using a profile (connect, auth, build MIME, optionally DKIM-sign, send).
async fn send_with_profile(msg: &EmailMessage, profile: &SmtpProfile) -> SmtpResult<SendResult> {
    let started = Instant::now();

    // 1. Validate message
    msg.validate()?;

    // 2. Build MIME
    let mut raw = message::build_message(msg)?;

    // 3. DKIM sign if configured
    if let Some(dkim_config) = &profile.dkim {
        let sig_header = dkim::sign_message(&raw, dkim_config)?;
        raw = format!("{}\r\n{}", sig_header, raw);
    }

    // 4. Resolve from address and recipients
    let from = profile.from_address.address.clone();
    let recipients: Vec<String> = msg
        .all_recipients()
        .iter()
        .map(|a| a.address.clone())
        .collect();
    let rcpt_refs: Vec<&str> = recipients.iter().map(|s| s.as_str()).collect();

    // 5. Connect
    debug!(
        "Connecting to {}:{}",
        profile.config.host, profile.config.port
    );
    let mut client = SmtpClient::new(profile.config.clone());
    client.connect().await?;

    // 6. EHLO
    client.ehlo().await?;

    // 7. STARTTLS if needed
    if profile.config.security == SmtpSecurity::StartTls {
        client.starttls().await?;
    }

    // 8. Auth
    if !profile.credentials.username.is_empty() {
        auth::authenticate(&mut client, &profile.credentials).await?;
    }

    // 9. MAIL FROM / RCPT TO / DATA
    let reply = client.send_envelope(&from, &rcpt_refs, &raw).await?;

    // 10. Extract server message ID from reply
    let server_msg_id = reply.lines.first().and_then(|t: &String| {
        // Common pattern: "250 2.0.0 Ok: queued as ABC123"
        t.split_whitespace().last().map(|s: &str| s.to_string())
    });

    // 11. QUIT
    let _ = client.quit().await;

    let elapsed = started.elapsed().as_millis() as u64;

    let recipient_statuses: Vec<RecipientDeliveryStatus> = msg
        .all_recipients()
        .iter()
        .map(|a| RecipientDeliveryStatus {
            address: a.address.clone(),
            accepted: true,
            smtp_code: Some(reply.code),
            smtp_message: reply.lines.first().cloned(),
        })
        .collect();

    Ok(SendResult {
        message_id: msg.id.clone(),
        success: true,
        queue_item_id: None,
        server_message_id: server_msg_id,
        recipients: recipient_statuses,
        elapsed_ms: elapsed,
        error: None,
    })
}

// ─── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_creates_state() {
        let state = SmtpService::new();
        let service = state.try_lock().unwrap();
        assert_eq!(service.messages_sent, 0);
    }

    #[test]
    fn profile_crud() {
        let state = SmtpService::new();
        let mut svc = state.try_lock().unwrap();

        let p = SmtpProfile::new("Test");
        let id = svc.add_profile(p).unwrap();
        assert_eq!(svc.list_profiles().len(), 1);
        assert!(svc.get_profile(&id).is_some());
        assert!(svc.find_profile_by_name("Test").is_some());

        svc.delete_profile(&id).unwrap();
        assert_eq!(svc.list_profiles().len(), 0);
    }

    #[test]
    fn duplicate_profile_rejected() {
        let state = SmtpService::new();
        let mut svc = state.try_lock().unwrap();
        svc.add_profile(SmtpProfile::new("Test")).unwrap();
        assert!(svc.add_profile(SmtpProfile::new("Test")).is_err());
    }

    #[test]
    fn set_default_profile() {
        let state = SmtpService::new();
        let mut svc = state.try_lock().unwrap();
        let id1 = svc.add_profile(SmtpProfile::new("A")).unwrap();
        let id2 = svc.add_profile(SmtpProfile::new("B")).unwrap();

        svc.set_default_profile(&id2).unwrap();
        assert_eq!(svc.default_profile().unwrap().id, id2);

        svc.set_default_profile(&id1).unwrap();
        assert_eq!(svc.default_profile().unwrap().id, id1);
    }

    #[test]
    fn template_crud() {
        let state = SmtpService::new();
        let mut svc = state.try_lock().unwrap();

        let mut tpl = EmailTemplate::new("Welcome");
        tpl.subject_template = "Hello {{name}}".into();
        tpl.text_template = Some("Dear {{name}}, welcome!".into());

        let id = svc.add_template(tpl).unwrap();
        assert_eq!(svc.list_templates().len(), 1);
        assert!(svc.get_template(&id).is_some());

        let vars = svc.extract_template_variables(&id).unwrap();
        assert!(vars.contains(&"name".to_string()));

        svc.delete_template(&id).unwrap();
        assert_eq!(svc.list_templates().len(), 0);
    }

    #[test]
    fn contacts_through_service() {
        let state = SmtpService::new();
        let mut svc = state.try_lock().unwrap();

        svc.contacts_mut()
            .add_contact(Contact::new("alice@x.com"))
            .unwrap();
        assert_eq!(svc.contacts().count(), 1);
    }

    #[test]
    fn queue_operations() {
        let state = SmtpService::new();
        let mut svc = state.try_lock().unwrap();

        let msg = EmailMessage {
            from: EmailAddress::new("a@x.com"),
            to: vec![EmailAddress::new("b@x.com")],
            subject: "Test".into(),
            text_body: Some("hi".into()),
            ..Default::default()
        };

        let id = svc.enqueue(msg, None).unwrap();
        assert_eq!(svc.queue_summary().total, 1);
        assert_eq!(svc.queue_summary().pending, 1);

        svc.queue_cancel(&id).unwrap();
        assert!(svc.queue_get(&id).is_some());

        let purged = svc.queue_clear();
        assert!(purged > 0);
    }

    #[test]
    fn connection_summary_empty() {
        let state = SmtpService::new();
        let svc = state.try_lock().unwrap();
        let summary = svc.connection_summary();
        assert!(!summary.connected);
        assert_eq!(summary.messages_sent, 0);
    }

    #[test]
    fn stats() {
        let state = SmtpService::new();
        let svc = state.try_lock().unwrap();
        let s = svc.stats();
        assert_eq!(s.profiles, 0);
        assert_eq!(s.templates, 0);
        assert_eq!(s.contacts, 0);
    }

    #[test]
    fn resolve_profile_requires_profile() {
        let state = SmtpService::new();
        let svc = state.try_lock().unwrap();
        assert!(svc.resolve_profile(None).is_err());
    }

    #[test]
    fn bulk_enqueue_no_template() {
        let state = SmtpService::new();
        let mut svc = state.try_lock().unwrap();

        let base = EmailMessage {
            from: EmailAddress::new("sender@x.com"),
            to: vec![],
            subject: "Bulk".into(),
            text_body: Some("Hello".into()),
            ..Default::default()
        };

        let request = BulkSendRequest {
            template_id: None,
            base_message: Some(base),
            recipients: vec![
                BulkRecipient {
                    address: EmailAddress::new("a@x.com"),
                    variables: HashMap::new(),
                },
                BulkRecipient {
                    address: EmailAddress::new("b@x.com"),
                    variables: HashMap::new(),
                },
            ],
            profile_name: None,
            schedule: SendSchedule::Immediate,
        };

        let result = svc.bulk_enqueue(&request).unwrap();
        assert_eq!(result.total, 2);
        assert_eq!(result.queued, 2);
        assert_eq!(result.failed, 0);
    }

    #[test]
    fn set_queue_config() {
        let state = SmtpService::new();
        let mut svc = state.try_lock().unwrap();
        let mut cfg = QueueConfig::default();
        cfg.max_size = 500;
        svc.set_queue_config(cfg);
        assert_eq!(svc.queue_config().max_size, 500);
    }
}
