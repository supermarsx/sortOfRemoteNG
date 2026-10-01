//! Adobe-only, same-document SPA grants. Routing permission is not a grant.
use std::time::{Duration, Instant};

pub(super) const SOURCE: &str = "https://adminconsole.adobe.com";
pub(super) const LOGIN: &str = "https://auth.services.adobe.com";
const READINESS: Duration = Duration::from_secs(120);
const PASSWORD: Duration = Duration::from_secs(30);

pub(super) fn login_document(value: &str) -> bool {
    reqwest::Url::parse(value).is_ok_and(|url| {
        url.origin().ascii_serialization() == LOGIN
            && url.username().is_empty()
            && url.password().is_none()
            && url.path() == "/en_US/index.html"
    })
}

#[derive(PartialEq, Eq)]
enum Stage {
    Email,
    Password,
    Spent,
}

pub(super) struct AdobeGrant {
    token: String,
    sequence: u64,
    issued: Instant,
    stage: Stage,
}

impl AdobeGrant {
    pub(super) fn new(sequence: u64) -> Self {
        Self {
            token: crate::themed_auth::fresh_nonce(),
            sequence,
            issued: Instant::now(),
            stage: Stage::Email,
        }
    }

    pub(super) fn bootstrap(&self, sequence: u64) -> Option<String> {
        (sequence != 0
            && self.sequence == sequence
            && self.stage == Stage::Email
            && self.issued.elapsed() < READINESS)
            .then(|| self.token.clone())
    }

    fn accepts(&self, origin: &str, selected: u64, token: &str, stage: Stage) -> bool {
        origin == LOGIN
            && selected != 0
            && selected == self.sequence
            && !token.is_empty()
            && token == self.token
            && self.stage == stage
            && self.issued.elapsed()
                < if stage == Stage::Email {
                    READINESS
                } else {
                    PASSWORD
                }
    }

    pub(super) fn email(&mut self, origin: &str, selected: u64, token: &str) -> Option<String> {
        if !self.accepts(origin, selected, token, Stage::Email) {
            return None;
        }
        self.stage = Stage::Password;
        self.token = crate::themed_auth::fresh_nonce();
        self.issued = Instant::now();
        Some(self.token.clone())
    }

    pub(super) fn password(&mut self, origin: &str, selected: u64, token: &str) -> bool {
        if !self.accepts(origin, selected, token, Stage::Password) {
            return false;
        }
        self.stage = Stage::Spent;
        self.token.clear();
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adobe_document_is_exact_https_not_an_ims_or_source_grant() {
        assert!(login_document(
            "https://auth.services.adobe.com/en_US/index.html?client_id=fixture#/password"
        ));
        for url in [
            "http://auth.services.adobe.com/en_US/index.html",
            "https://auth.services.adobe.com:444/en_US/index.html",
            "https://person@auth.services.adobe.com/en_US/index.html",
            "https://auth.services.adobe.com.evil.invalid/en_US/index.html",
            "https://adminconsole.adobe.com/en_US/index.html",
            "https://ims-na1.adobelogin.com/en_US/index.html",
            "https://auth.services.adobe.com/en_US/other.html",
            "https://auth.services.adobe.com/fr_FR/index.html",
        ] {
            assert!(!login_document(url), "{url}");
        }
    }

    #[test]
    fn adobe_grant_never_crosses_origin_stage_document_or_replays() {
        let mut grant = AdobeGrant::new(7);
        let first = grant.bootstrap(7).unwrap();
        assert!(grant.bootstrap(8).is_none());
        assert!(!grant.password(LOGIN, 7, &first));
        assert!(grant.email(SOURCE, 7, &first).is_none());
        assert!(grant
            .email("https://accounts.google.com", 7, &first)
            .is_none());
        assert!(grant.email(LOGIN, 8, &first).is_none());
        assert!(grant.email(LOGIN, 0, &first).is_none());
        assert!(grant.email(LOGIN, 7, "wrong").is_none());
        let second = grant.email(LOGIN, 7, &first).unwrap();
        assert_ne!(first, second);
        assert!(grant.bootstrap(7).is_none());
        assert!(grant.email(LOGIN, 7, &first).is_none());
        assert!(!grant.password(LOGIN, 7, &first));
        assert!(!grant.password(SOURCE, 7, &second));
        assert!(!grant.password(LOGIN, 8, &second));
        assert!(grant.password(LOGIN, 7, &second));
        assert!(!grant.password(LOGIN, 7, &second));
    }

    #[test]
    fn adobe_readiness_is_bounded_and_password_window_is_not_extended() {
        let mut grant = AdobeGrant::new(7);
        let first = grant.bootstrap(7).unwrap();
        grant.issued = Instant::now() - READINESS;
        assert!(grant.bootstrap(7).is_none());
        assert!(grant.email(LOGIN, 7, &first).is_none());
        let mut grant = AdobeGrant::new(7);
        let first = grant.bootstrap(7).unwrap();
        grant.issued = Instant::now() - Duration::from_secs(90);
        let second = grant.email(LOGIN, 7, &first).unwrap();
        grant.issued = Instant::now() - PASSWORD;
        assert!(!grant.password(LOGIN, 7, &second));
        assert!(grant.bootstrap(7).is_none());
    }
}
