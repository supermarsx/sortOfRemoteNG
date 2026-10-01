//! Closed AI chat provider grants. No credentials are stored in this module.
//! Issuing a child document neither selects it nor replaces another page's nonce.
use crate::http::{ReviewedApplicationProfile, UpstreamAuthMode};
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

const READINESS: Duration = Duration::from_secs(120);
const PASSWORD: Duration = Duration::from_secs(30);
const MAX_PAGES: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Provider {
    Chatgpt,
    Claude,
}

impl Provider {
    pub(super) fn from_mode(mode: UpstreamAuthMode) -> Option<Self> {
        match mode {
            UpstreamAuthMode::ChatgptForm => Some(Self::Chatgpt),
            UpstreamAuthMode::ClaudeForm => Some(Self::Claude),
            _ => None,
        }
    }
    pub(super) fn marker(self) -> ReviewedApplicationProfile {
        match self {
            Self::Chatgpt => ReviewedApplicationProfile::Chatgpt,
            Self::Claude => ReviewedApplicationProfile::Claude,
        }
    }
    pub(super) fn source(self) -> &'static str {
        match self {
            Self::Chatgpt => "https://chatgpt.com",
            Self::Claude => "https://claude.ai",
        }
    }
    pub(super) fn flow(self) -> &'static str {
        match self {
            Self::Chatgpt => "chatgpt",
            Self::Claude => "claude",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Document {
    ChatgptEmail,
    OpenaiEmail,
    OpenaiPassword,
    ClaudeEmail,
}

impl Document {
    pub(super) fn url(self) -> &'static str {
        match self {
            Self::ChatgptEmail => "https://chatgpt.com/auth/login",
            Self::OpenaiEmail => "https://auth.openai.com/log-in",
            Self::OpenaiPassword => "https://auth.openai.com/log-in/password",
            Self::ClaudeEmail => "https://claude.ai/login",
        }
    }
    pub(super) fn origin(self) -> &'static str {
        match self {
            Self::ChatgptEmail => "https://chatgpt.com",
            Self::OpenaiEmail | Self::OpenaiPassword => "https://auth.openai.com",
            Self::ClaudeEmail => "https://claude.ai",
        }
    }
}

pub(super) fn document(provider: Provider, value: &str) -> Option<Document> {
    let url = reqwest::Url::parse(value).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    match (
        provider,
        url.origin().ascii_serialization().as_str(),
        url.path(),
    ) {
        (Provider::Chatgpt, "https://chatgpt.com", "/auth/login") => Some(Document::ChatgptEmail),
        (Provider::Chatgpt, "https://auth.openai.com", "/log-in") => Some(Document::OpenaiEmail),
        (Provider::Chatgpt, "https://auth.openai.com", "/log-in/password") => {
            Some(Document::OpenaiPassword)
        }
        (Provider::Claude, "https://claude.ai", "/login" | "/login/") => {
            Some(Document::ClaudeEmail)
        }
        _ => None,
    }
}

struct Page {
    nonce: String,
    kind: Document,
}

struct Continuation {
    nonce: String,
    document: u64,
    kind: Document,
    issued: Instant,
}

/// The outer session owns this value and provides a selected-document lease.
/// No Debug/Serialize: grant tokens must not enter diagnostics.
pub(super) struct AiChatGrant {
    provider: Provider,
    started: Instant,
    pages: BTreeMap<u64, Page>,
    continuation: Option<Continuation>,
    spent: bool,
}

pub(super) enum EmailRelease {
    Chatgpt(String),
    Claude,
}

impl AiChatGrant {
    pub(super) fn new(provider: Provider) -> Self {
        Self {
            provider,
            started: Instant::now(),
            pages: BTreeMap::new(),
            continuation: None,
            spent: false,
        }
    }

    fn live(&self) -> bool {
        !self.spent
            && self.continuation.as_ref().map_or_else(
                || self.started.elapsed() < READINESS,
                |grant| grant.issued.elapsed() < PASSWORD,
            )
    }

    /// Native-recorded authority, never a Referer or the hosted root target_url.
    /// A selected auth email grant expressly permits one SPA password transition;
    /// reviewed JS checks its live route and DOM. Native cannot observe pushState.
    /// Source-origin email requires a new, selected exact auth password document.
    pub(super) fn redemption_document(
        &self,
        provider: Provider,
        selected: u64,
        password: bool,
    ) -> Option<Document> {
        if self.provider != provider || selected == 0 || !self.live() {
            return None;
        }
        if password {
            if provider != Provider::Chatgpt {
                return None;
            }
            let grant = self.continuation.as_ref()?;
            if selected == grant.document && grant.kind == Document::OpenaiEmail {
                return Some(Document::OpenaiPassword);
            }
            return self
                .pages
                .get(&selected)
                .filter(|page| selected > grant.document && page.kind == Document::OpenaiPassword)
                .map(|page| page.kind);
        }
        if self.continuation.is_some() {
            return None;
        }
        self.pages.get(&selected).map(|page| page.kind)
    }

    pub(super) fn record_page(
        &mut self,
        provider: Provider,
        sequence: u64,
        selected: Option<u64>,
        url: &str,
    ) -> Option<(String, &'static str)> {
        if provider != self.provider
            || sequence == 0
            || !self.live()
            || selected.is_some_and(|selected| sequence < selected)
        {
            return None;
        }
        let kind = document(provider, url)?;
        let password_stage = self.continuation.is_some();
        if password_stage != (kind == Document::OpenaiPassword) {
            return None;
        }
        self.pages
            .retain(|sequence, _| selected.is_none_or(|selected| *sequence >= selected));
        let page = self.pages.entry(sequence).or_insert_with(|| Page {
            nonce: crate::themed_auth::fresh_nonce(),
            kind,
        });
        // A document cannot acquire another origin/stage by being recorded twice.
        if page.kind != kind {
            return None;
        }
        let token = page.nonce.clone();
        while self.pages.len() > MAX_PAGES {
            let oldest = self
                .pages
                .keys()
                .copied()
                .find(|value| Some(*value) != selected)?;
            self.pages.remove(&oldest);
        }
        self.pages.contains_key(&sequence).then_some((
            token,
            if password_stage {
                "chatgpt-password"
            } else {
                provider.flow()
            },
        ))
    }

    pub(super) fn email(
        &mut self,
        provider: Provider,
        selected: u64,
        url: &str,
        nonce: &str,
    ) -> Option<EmailRelease> {
        if self.provider != provider
            || !self.live()
            || self.continuation.is_some()
            || nonce.is_empty()
        {
            return None;
        }
        let kind = document(provider, url)?;
        let page = self.pages.get(&selected)?;
        if page.kind != kind || page.nonce != nonce || kind == Document::OpenaiPassword {
            return None;
        }
        self.pages.clear();
        if provider == Provider::Claude {
            self.spent = true;
            return Some(EmailRelease::Claude);
        }
        let nonce = crate::themed_auth::fresh_nonce();
        self.continuation = Some(Continuation {
            nonce: nonce.clone(),
            document: selected,
            kind,
            issued: Instant::now(),
        });
        Some(EmailRelease::Chatgpt(nonce))
    }

    pub(super) fn password(
        &mut self,
        provider: Provider,
        selected: u64,
        url: &str,
        nonce: &str,
    ) -> bool {
        if provider != Provider::Chatgpt
            || self.provider != provider
            || !self.live()
            || nonce.is_empty()
            || document(provider, url) != Some(Document::OpenaiPassword)
        {
            return false;
        }
        let Some(grant) = self.continuation.as_ref() else {
            return false;
        };
        let same_document = selected == grant.document
            && grant.kind == Document::OpenaiEmail
            && grant.nonce == nonce;
        let password_document = self.pages.get(&selected).is_some_and(|page| {
            selected > grant.document
                && page.kind == Document::OpenaiPassword
                && page.nonce == nonce
        });
        if !same_document && !password_document {
            return false;
        }
        self.continuation = None;
        self.pages.clear();
        self.spent = true;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const EMAIL: &str = "https://auth.openai.com/log-in";
    const PASS: &str = "https://auth.openai.com/log-in/password";
    const SOURCE_EMAIL: &str = "https://chatgpt.com/auth/login";
    const CLAUDE: &str = "https://claude.ai/login";
    fn continuation(release: Option<EmailRelease>) -> String {
        match release {
            Some(EmailRelease::Chatgpt(nonce)) => nonce,
            _ => panic!("expected ChatGPT continuation"),
        }
    }
    fn email_grant(url: &str) -> (AiChatGrant, String) {
        let mut grant = AiChatGrant::new(Provider::Chatgpt);
        let (nonce, flow) = grant
            .record_page(Provider::Chatgpt, 1, Some(1), url)
            .unwrap();
        assert_eq!(flow, "chatgpt");
        let token = continuation(grant.email(Provider::Chatgpt, 1, url, &nonce));
        (grant, token)
    }

    #[test]
    fn ai_chat_documents_are_exact_provider_origin_and_stage() {
        for url in [SOURCE_EMAIL, EMAIL, PASS] {
            assert!(document(Provider::Chatgpt, url).is_some());
        }
        assert_eq!(
            document(Provider::Claude, CLAUDE),
            Some(Document::ClaudeEmail)
        );
        assert!(document(Provider::Claude, "https://claude.ai/login/").is_some());
        for url in [
            "http://auth.openai.com/log-in",
            "https://auth.openai.com:444/log-in",
            "https://user@auth.openai.com/log-in",
            "https://auth.openai.com.evil.invalid/log-in",
            "https://auth.openai.com/log-in/otp",
            "https://auth.openai.com/sign-up",
            "https://chatgpt.com/log-in/password",
            "https://auth.openai.com/",
            CLAUDE,
        ] {
            assert!(document(Provider::Chatgpt, url).is_none(), "{url}");
        }
        for url in [
            EMAIL,
            PASS,
            SOURCE_EMAIL,
            "https://claude.ai/login/password",
            "http://claude.ai/login",
        ] {
            assert!(document(Provider::Claude, url).is_none(), "{url}");
        }
    }

    #[test]
    fn ai_chat_claude_email_ends_the_entire_attempt_without_password() {
        let mut grant = AiChatGrant::new(Provider::Claude);
        let (nonce, flow) = grant
            .record_page(Provider::Claude, 1, Some(1), CLAUDE)
            .unwrap();
        assert_eq!(flow, "claude");
        assert!(grant.email(Provider::Chatgpt, 1, EMAIL, &nonce).is_none());
        assert!(matches!(
            grant.email(Provider::Claude, 1, CLAUDE, &nonce),
            Some(EmailRelease::Claude)
        ));
        assert!(grant.email(Provider::Claude, 1, CLAUDE, &nonce).is_none());
        assert!(!grant.password(Provider::Claude, 1, CLAUDE, &nonce));
        assert!(!grant.password(Provider::Chatgpt, 1, PASS, &nonce));
        assert!(grant
            .record_page(Provider::Claude, 2, Some(2), CLAUDE)
            .is_none());
        assert!(grant.continuation.is_none());
    }

    #[test]
    fn ai_chat_spa_password_requires_exact_auth_password_path_and_single_use() {
        let (mut grant, token) = email_grant(EMAIL);
        assert!(!grant.password(Provider::Chatgpt, 1, EMAIL, &token));
        assert!(!grant.password(Provider::Chatgpt, 1, SOURCE_EMAIL, &token));
        assert!(!grant.password(Provider::Chatgpt, 1, PASS, "wrong"));
        assert!(!grant.password(Provider::Claude, 1, PASS, &token));
        assert!(!grant.password(Provider::Chatgpt, 2, PASS, &token));
        assert!(grant.password(Provider::Chatgpt, 1, PASS, &token));
        assert!(!grant.password(Provider::Chatgpt, 1, PASS, &token));
        assert!(grant
            .record_page(Provider::Chatgpt, 2, Some(2), PASS)
            .is_none());
    }

    #[test]
    fn ai_chat_source_email_cannot_redeem_password_without_new_selected_auth_document() {
        let (mut grant, original) = email_grant(SOURCE_EMAIL);
        assert!(!grant.password(Provider::Chatgpt, 1, PASS, &original));
        let (child, flow) = grant
            .record_page(Provider::Chatgpt, 2, Some(1), PASS)
            .unwrap();
        assert_eq!(flow, "chatgpt-password");
        assert!(!grant.password(Provider::Chatgpt, 1, PASS, &child));
        let (primary, _) = grant
            .record_page(Provider::Chatgpt, 3, Some(1), PASS)
            .unwrap();
        assert!(!grant.password(Provider::Chatgpt, 3, PASS, &child));
        assert!(!grant.password(Provider::Chatgpt, 3, PASS, &original));
        assert!(grant.password(Provider::Chatgpt, 3, PASS, &primary));
    }

    #[test]
    fn ai_chat_child_issuance_does_not_replace_selected_email_or_spa_continuation() {
        let mut grant = AiChatGrant::new(Provider::Chatgpt);
        let (first, _) = grant
            .record_page(Provider::Chatgpt, 1, Some(1), EMAIL)
            .unwrap();
        let (child, _) = grant
            .record_page(Provider::Chatgpt, 2, Some(1), EMAIL)
            .unwrap();
        assert!(grant.email(Provider::Chatgpt, 1, EMAIL, &child).is_none());
        let token = continuation(grant.email(Provider::Chatgpt, 1, EMAIL, &first));
        assert!(grant.email(Provider::Chatgpt, 2, EMAIL, &child).is_none());
        for sequence in 3..20 {
            let _ = grant.record_page(Provider::Chatgpt, sequence, Some(1), PASS);
        }
        assert!(grant.pages.len() <= MAX_PAGES);
        assert!(grant.password(Provider::Chatgpt, 1, PASS, &token));
    }

    #[test]
    fn ai_chat_latest_selected_page_requires_its_own_nonce() {
        let mut grant = AiChatGrant::new(Provider::Chatgpt);
        let (old, _) = grant
            .record_page(Provider::Chatgpt, 1, Some(1), EMAIL)
            .unwrap();
        let (new, _) = grant
            .record_page(Provider::Chatgpt, 2, Some(2), EMAIL)
            .unwrap();
        assert!(grant.email(Provider::Chatgpt, 2, EMAIL, &old).is_none());
        assert!(grant.email(Provider::Chatgpt, 2, EMAIL, &new).is_some());
        assert!(grant
            .record_page(Provider::Chatgpt, 1, Some(2), EMAIL)
            .is_none());
    }

    #[test]
    fn ai_chat_readiness_and_password_deadlines_cannot_be_renewed_by_new_pages() {
        let mut grant = AiChatGrant::new(Provider::Chatgpt);
        let (nonce, _) = grant
            .record_page(Provider::Chatgpt, 1, Some(1), EMAIL)
            .unwrap();
        grant.started = Instant::now() - READINESS;
        assert!(grant.email(Provider::Chatgpt, 1, EMAIL, &nonce).is_none());
        assert!(grant
            .record_page(Provider::Chatgpt, 2, Some(1), EMAIL)
            .is_none());
        let (mut grant, token) = email_grant(EMAIL);
        grant.continuation.as_mut().unwrap().issued = Instant::now() - PASSWORD;
        assert!(!grant.password(Provider::Chatgpt, 1, PASS, &token));
        assert!(grant
            .record_page(Provider::Chatgpt, 2, Some(1), PASS)
            .is_none());
    }

    #[test]
    fn ai_chat_initial_password_page_and_mutated_document_identity_never_mint_grants() {
        let mut grant = AiChatGrant::new(Provider::Chatgpt);
        assert!(grant
            .record_page(Provider::Chatgpt, 1, Some(1), PASS)
            .is_none());
        assert!(grant
            .record_page(Provider::Chatgpt, 0, Some(1), EMAIL)
            .is_none());
        assert!(grant
            .record_page(Provider::Claude, 1, Some(1), CLAUDE)
            .is_none());
        let (nonce, _) = grant
            .record_page(Provider::Chatgpt, 1, Some(1), SOURCE_EMAIL)
            .unwrap();
        assert!(grant
            .record_page(Provider::Chatgpt, 1, Some(1), EMAIL)
            .is_none());
        assert!(grant.email(Provider::Chatgpt, 1, EMAIL, &nonce).is_none());
    }

    #[test]
    fn ai_chat_redemption_scope_comes_from_selected_native_candidate_not_request_url() {
        let mut grant = AiChatGrant::new(Provider::Chatgpt);
        let (nonce, _) = grant
            .record_page(Provider::Chatgpt, 1, Some(1), SOURCE_EMAIL)
            .unwrap();
        assert_eq!(
            grant.redemption_document(Provider::Chatgpt, 1, false),
            Some(Document::ChatgptEmail)
        );
        assert_eq!(grant.redemption_document(Provider::Chatgpt, 1, true), None);
        assert_eq!(grant.redemption_document(Provider::Claude, 1, false), None);
        let _ = grant
            .email(Provider::Chatgpt, 1, SOURCE_EMAIL, &nonce)
            .unwrap();
        assert_eq!(grant.redemption_document(Provider::Chatgpt, 1, true), None);
        let (token, _) = grant
            .record_page(Provider::Chatgpt, 2, Some(1), PASS)
            .unwrap();
        assert_eq!(grant.redemption_document(Provider::Chatgpt, 1, true), None);
        let native = grant
            .redemption_document(Provider::Chatgpt, 2, true)
            .unwrap();
        assert_eq!(native.origin(), "https://auth.openai.com");
        assert_eq!(native.url(), PASS);
        assert!(grant.password(Provider::Chatgpt, 2, native.url(), &token));
        let (grant, _) = email_grant(EMAIL);
        assert_eq!(
            grant.redemption_document(Provider::Chatgpt, 1, true),
            Some(Document::OpenaiPassword)
        );
    }
}
