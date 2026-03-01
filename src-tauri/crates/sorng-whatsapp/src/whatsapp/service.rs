//! High-level WhatsApp service facade.
//!
//! `WhatsAppService` ties together the Cloud API (official) and
//! unofficial WA Web client, manages sessions, and exposes a
//! unified interface consumed by Tauri commands.

use crate::whatsapp::analytics::WaAnalytics;
use crate::whatsapp::api_client::CloudApiClient;
use crate::whatsapp::auth::WaAuthManager;
use crate::whatsapp::business_profile::WaBusinessProfileManager;
use crate::whatsapp::contacts::WaContacts;
use crate::whatsapp::error::{WhatsAppError, WhatsAppResult};
use crate::whatsapp::flows::WaFlows;
use crate::whatsapp::groups::WaGroups;
use crate::whatsapp::media::WaMedia;
use crate::whatsapp::messaging::WaMessaging;
use crate::whatsapp::pairing::PairingManager;
use crate::whatsapp::phone_numbers::WaPhoneNumbers;
use crate::whatsapp::templates::WaTemplates;
use crate::whatsapp::types::*;
use crate::whatsapp::unofficial::{
    UnofficialClient, UnofficialConfig,
};
use crate::whatsapp::webhooks::WaWebhooks;
use log::info;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

/// Shared Tauri state type.
pub type WhatsAppServiceState = Arc<Mutex<WhatsAppService>>;

/// Service layer wrapping all WhatsApp functionality.
pub struct WhatsAppService {
    // ── Official (Cloud API) ─────────────────────────────────────
    config: Option<WaConfig>,
    client: Option<CloudApiClient>,
    auth: Option<WaAuthManager>,
    messaging: Option<WaMessaging>,
    media: Option<WaMedia>,
    templates: Option<WaTemplates>,
    contacts: Option<WaContacts>,
    groups: Option<WaGroups>,
    flows: Option<WaFlows>,
    business_profile: Option<WaBusinessProfileManager>,
    phone_numbers: Option<WaPhoneNumbers>,
    analytics: Option<WaAnalytics>,
    webhooks: Option<WaWebhooks>,

    // ── Unofficial (WA Web) ──────────────────────────────────────
    unofficial: Option<Arc<UnofficialClient>>,
    pairing_mgr: Option<Arc<PairingManager>>,

    // ── Session store ────────────────────────────────────────────
    sessions: HashMap<String, WaSession>,

    // ── Chat history (in-memory cache) ───────────────────────────
    conversations: Arc<RwLock<HashMap<String, WaConversationThread>>>,
}

impl WhatsAppService {
    /// Create an unconfigured service.
    pub fn new() -> Self {
        Self {
            config: None,
            client: None,
            auth: None,
            messaging: None,
            media: None,
            templates: None,
            contacts: None,
            groups: None,
            flows: None,
            business_profile: None,
            phone_numbers: None,
            analytics: None,
            webhooks: None,
            unofficial: None,
            pairing_mgr: None,
            sessions: HashMap::new(),
            conversations: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    // ─── Configuration ───────────────────────────────────────────────

    /// Initialize the official Cloud API services with configuration.
    pub fn configure_cloud_api(&mut self, config: WaConfig) -> WhatsAppResult<()> {
        let client = CloudApiClient::new(&config)?;

        self.auth = Some(WaAuthManager::new(
            client.clone(),
            None, // app_id set separately
            config.app_secret.clone(),
        ));
        self.messaging = Some(WaMessaging::new(client.clone()));
        self.media = Some(WaMedia::new(client.clone()));
        self.templates = Some(WaTemplates::new(client.clone()));
        self.contacts = Some(WaContacts::new(client.clone()));
        self.groups = Some(WaGroups::new(client.clone()));
        self.flows = Some(WaFlows::new(client.clone()));
        self.business_profile = Some(WaBusinessProfileManager::new(client.clone()));
        self.phone_numbers = Some(WaPhoneNumbers::new(client.clone()));
        self.analytics = Some(WaAnalytics::new(client.clone()));
        self.webhooks = Some(WaWebhooks::new(
            config.webhook_verify_token.clone(),
            config.app_secret.clone(),
        ));

        self.client = Some(client);
        self.config = Some(config);

        info!("WhatsApp Cloud API configured");
        Ok(())
    }

    /// Initialize the unofficial WA Web client.
    pub fn configure_unofficial(
        &mut self,
        config: Option<UnofficialConfig>,
    ) {
        let cfg = config.unwrap_or_default();
        self.unofficial = Some(Arc::new(UnofficialClient::new(cfg)));
        self.pairing_mgr = Some(Arc::new(PairingManager::default_manager()));
        info!("WhatsApp unofficial client configured");
    }

    /// Check if the Cloud API is configured.
    pub fn is_cloud_configured(&self) -> bool {
        self.config.is_some()
    }

    /// Check if the unofficial client is configured.
    pub fn is_unofficial_configured(&self) -> bool {
        self.unofficial.is_some()
    }

    /// Get current config (if set).
    pub fn config(&self) -> Option<&WaConfig> {
        self.config.as_ref()
    }

    // ─── Official API accessors ──────────────────────────────────────

    fn require_cloud(&self) -> WhatsAppResult<()> {
        if self.config.is_none() {
            return Err(WhatsAppError::not_configured(
                "Cloud API not configured",
            ));
        }
        Ok(())
    }

    pub fn messaging(&self) -> WhatsAppResult<&WaMessaging> {
        self.require_cloud()?;
        self.messaging.as_ref().ok_or_else(|| {
            WhatsAppError::not_configured("Messaging not initialized")
        })
    }

    pub fn media(&self) -> WhatsAppResult<&WaMedia> {
        self.require_cloud()?;
        self.media.as_ref().ok_or_else(|| {
            WhatsAppError::not_configured("Media not initialized")
        })
    }

    pub fn templates(&self) -> WhatsAppResult<&WaTemplates> {
        self.require_cloud()?;
        self.templates.as_ref().ok_or_else(|| {
            WhatsAppError::not_configured("Templates not initialized")
        })
    }

    pub fn contacts(&self) -> WhatsAppResult<&WaContacts> {
        self.require_cloud()?;
        self.contacts.as_ref().ok_or_else(|| {
            WhatsAppError::not_configured("Contacts not initialized")
        })
    }

    pub fn groups(&self) -> WhatsAppResult<&WaGroups> {
        self.require_cloud()?;
        self.groups.as_ref().ok_or_else(|| {
            WhatsAppError::not_configured("Groups not initialized")
        })
    }

    pub fn flows(&self) -> WhatsAppResult<&WaFlows> {
        self.require_cloud()?;
        self.flows.as_ref().ok_or_else(|| {
            WhatsAppError::not_configured("Flows not initialized")
        })
    }

    pub fn business_profile(&self) -> WhatsAppResult<&WaBusinessProfileManager> {
        self.require_cloud()?;
        self.business_profile.as_ref().ok_or_else(|| {
            WhatsAppError::not_configured("Business profile not initialized")
        })
    }

    pub fn phone_numbers(&self) -> WhatsAppResult<&WaPhoneNumbers> {
        self.require_cloud()?;
        self.phone_numbers.as_ref().ok_or_else(|| {
            WhatsAppError::not_configured("Phone numbers not initialized")
        })
    }

    pub fn analytics(&self) -> WhatsAppResult<&WaAnalytics> {
        self.require_cloud()?;
        self.analytics.as_ref().ok_or_else(|| {
            WhatsAppError::not_configured("Analytics not initialized")
        })
    }

    pub fn webhooks(&self) -> WhatsAppResult<&WaWebhooks> {
        self.require_cloud()?;
        self.webhooks.as_ref().ok_or_else(|| {
            WhatsAppError::not_configured("Webhooks not initialized")
        })
    }

    pub fn auth(&self) -> WhatsAppResult<&WaAuthManager> {
        self.require_cloud()?;
        self.auth.as_ref().ok_or_else(|| {
            WhatsAppError::not_configured("Auth not initialized")
        })
    }

    // ─── Unofficial accessors ────────────────────────────────────────

    pub fn unofficial(&self) -> WhatsAppResult<&Arc<UnofficialClient>> {
        self.unofficial.as_ref().ok_or_else(|| {
            WhatsAppError::not_configured("Unofficial client not configured")
        })
    }

    pub fn pairing(&self) -> WhatsAppResult<&Arc<PairingManager>> {
        self.pairing_mgr.as_ref().ok_or_else(|| {
            WhatsAppError::not_configured("Pairing manager not configured")
        })
    }

    // ─── Session management ──────────────────────────────────────────

    /// Create or update a session.
    pub fn set_session(&mut self, id: &str, session: WaSession) {
        self.sessions.insert(id.to_string(), session);
    }

    /// Get a session by ID.
    pub fn get_session(&self, id: &str) -> WhatsAppResult<&WaSession> {
        self.sessions.get(id).ok_or_else(|| {
            WhatsAppError::session_not_found(id)
        })
    }

    /// Remove a session.
    pub fn remove_session(&mut self, id: &str) -> Option<WaSession> {
        self.sessions.remove(id)
    }

    /// List all active sessions.
    pub fn list_sessions(&self) -> Vec<WaSessionSummary> {
        self.sessions
            .values()
            .map(|s| WaSessionSummary {
                session_id: s.id.clone(),
                phone_number_id: s.phone_number_id.clone(),
                phone_display: s.phone_display.clone(),
                state: format!("{:?}", s.state),
                messages_sent: s.messages_sent,
                messages_received: s.messages_received,
            })
            .collect()
    }

    // ─── Conversation cache ──────────────────────────────────────────

    /// Get the conversations map (read-only).
    pub fn conversations(
        &self,
    ) -> &Arc<RwLock<HashMap<String, WaConversationThread>>> {
        &self.conversations
    }

    /// Store a chat message into the local cache.
    pub async fn store_message(
        &self,
        thread_id: &str,
        message: WaChatMessage,
    ) {
        let mut convs = self.conversations.write().await;
        let thread = convs
            .entry(thread_id.to_string())
            .or_insert_with(|| WaConversationThread {
                contact_wa_id: thread_id.to_string(),
                contact_name: None,
                last_message: None,
                unread_count: 0,
                updated_at: chrono::Utc::now(),
            });

        thread.updated_at = message.timestamp;
        thread.last_message = Some(message.clone());
        // Messages are stored separately — the thread just tracks the latest.
    }

    /// Get conversation thread messages.
    ///
    /// Note: With the current in-memory model, we store last_message per
    /// thread. For full history, an external store would be needed. This
    /// returns the last message (if any) as a convenience.
    pub async fn get_messages(
        &self,
        thread_id: &str,
    ) -> Vec<WaChatMessage> {
        let convs = self.conversations.read().await;
        convs
            .get(thread_id)
            .and_then(|t| t.last_message.clone())
            .into_iter()
            .collect()
    }

    // ─── Unified send (auto-select official vs unofficial) ───────────

    /// Send text via the best available channel.
    pub async fn send_text_auto(
        &self,
        to: &str,
        text: &str,
    ) -> WhatsAppResult<String> {
        // Prefer official API if configured
        if self.is_cloud_configured() {
            let resp = self.messaging()?.send_text(to, text, false, None).await?;
            return Ok(resp.messages.first().map(|m| m.id.clone()).unwrap_or_default());
        }

        // Fall back to unofficial
        if let Some(ref unofficial) = self.unofficial {
            let jid = UnofficialClient::phone_to_jid(to);
            return unofficial.send_text(&jid, text, None).await;
        }

        Err(WhatsAppError::not_configured(
            "No WhatsApp channel configured",
        ))
    }
}

impl Default for WhatsAppService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_service() {
        let svc = WhatsAppService::new();
        assert!(!svc.is_cloud_configured());
        assert!(!svc.is_unofficial_configured());
    }

    #[test]
    fn test_configure_unofficial() {
        let mut svc = WhatsAppService::new();
        svc.configure_unofficial(None);
        assert!(svc.is_unofficial_configured());
        assert!(svc.unofficial().is_ok());
    }

    #[test]
    fn test_require_cloud_fails() {
        let svc = WhatsAppService::new();
        assert!(svc.messaging().is_err());
        assert!(svc.media().is_err());
        assert!(svc.templates().is_err());
    }

    #[test]
    fn test_configure_cloud() {
        let mut svc = WhatsAppService::new();
        let cfg = WaConfig {
            access_token: "test".into(),
            phone_number_id: "123".into(),
            business_account_id: "456".into(),
            api_version: "v21.0".into(),
            base_url: "https://graph.facebook.com".into(),
            webhook_verify_token: None,
            app_secret: None,
            timeout_sec: 30,
            max_retries: 3,
        };

        svc.configure_cloud_api(cfg).unwrap();
        assert!(svc.is_cloud_configured());
        assert!(svc.messaging().is_ok());
        assert!(svc.media().is_ok());
        assert!(svc.templates().is_ok());
    }

    #[test]
    fn test_session_management() {
        let mut svc = WhatsAppService::new();

        let session = WaSession {
            id: "s1".into(),
            phone_number_id: "+1234".into(),
            business_account_id: "biz1".into(),
            phone_display: None,
            state: WaSessionState::Active,
            connected_at: chrono::Utc::now(),
            last_activity: chrono::Utc::now(),
            messages_sent: 0,
            messages_received: 0,
        };

        svc.set_session("s1", session);
        assert!(svc.get_session("s1").is_ok());
        assert!(svc.get_session("s2").is_err());

        let summaries = svc.list_sessions();
        assert_eq!(summaries.len(), 1);

        svc.remove_session("s1");
        assert!(svc.get_session("s1").is_err());
    }

    #[tokio::test]
    async fn test_store_and_get_messages() {
        let svc = WhatsAppService::new();

        let msg = WaChatMessage {
            id: "msg1".into(),
            session_id: "s1".into(),
            direction: WaMessageDirection::Incoming,
            contact_wa_id: "+1234".into(),
            contact_name: Some("Test".into()),
            msg_type: "text".into(),
            body: Some("Hello".into()),
            media_id: None,
            media_url: None,
            media_mime_type: None,
            media_caption: None,
            latitude: None,
            longitude: None,
            template_name: None,
            status: WaLocalMessageStatus::Delivered,
            timestamp: chrono::Utc::now(),
            wa_message_id: None,
            reply_to_id: None,
            reaction_emoji: None,
            raw_payload: None,
        };

        svc.store_message("thread_1", msg).await;
        let msgs = svc.get_messages("thread_1").await;
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].body.as_deref(), Some("Hello"));
    }
}
