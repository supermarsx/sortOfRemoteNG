//! Paced native credential typing. The host must supply a fresh owner/consent
//! and focused-field receipt for every tick; this module grants no authority.
//! Deliberately separate from cef_browser so its owner can integrate it without
//! sharing that file. No JavaScript value assignment or OS-global key injection.
use sorng_protocols::origin_browser::BrowserIdentity;
use std::time::{Duration, Instant};
use zeroize::{Zeroize, Zeroizing};

/// Host-created target from a verified private renderer field receipt. Never
/// accept these fields from ordinary page IPC. No Debug: URLs may contain tokens.
pub struct NativeAuthTarget {
    pub identity: BrowserIdentity,
    pub browser_id: i32,
    pub frame_id: String,
    pub document_sequence: u64,
    pub document_url: String,
    pub field_token: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TypingStatus {
    Waiting,
    Sent,
    Complete,
    Cancelled,
}

pub struct NativeAuthTyping {
    target: NativeAuthTarget,
    text: Zeroizing<Vec<u16>>,
    offset: usize,
    next_at: Instant,
    expires: Instant,
    interval: Duration,
    status: TypingStatus,
}

impl NativeAuthTyping {
    pub fn units_sent(&self) -> usize {
        self.offset
    }
    pub fn new(
        target: NativeAuthTarget,
        text: &str,
        interval: Duration,
        now: Instant,
        expires: Instant,
    ) -> Option<Self> {
        let url = url::Url::parse(&target.document_url).ok()?;
        if target.browser_id <= 0
            || target.frame_id.is_empty()
            || target.frame_id.len() > 128
            || target.field_token.is_empty()
            || target.field_token.len() > 128
            || target.document_url.len() > 8192
            || url.scheme() != "https"
            || !url.has_host()
            || !url.username().is_empty()
            || url.password().is_some()
            || target
                .document_url
                .chars()
                .any(|c| c.is_control() || c.is_whitespace() || c == '\\')
            || text.is_empty()
            || text.len() > 16_384
            || text.chars().any(char::is_control)
            || interval < Duration::from_millis(1)
            || interval > Duration::from_millis(250)
            || expires <= now
        {
            return None;
        }
        let text = Zeroizing::new(text.encode_utf16().collect::<Vec<_>>());
        if text.len() > 4096
            || interval.checked_mul(text.len().saturating_sub(1) as u32)?
                >= expires.duration_since(now)
        {
            return None;
        }
        Some(Self {
            target,
            text,
            offset: 0,
            next_at: now,
            expires,
            interval,
            status: TypingStatus::Waiting,
        })
    }

    pub fn cancel(&mut self) {
        self.text.zeroize();
        self.text.clear();
        self.status = TypingStatus::Cancelled;
    }

    /// One UTF-16 input unit per tick; never sleep or queue the entire secret.
    /// `current` must verify the exact attempt, live owner/consent, document
    /// sequence and still-focused field token. A stale/missing receipt denies.
    /// Manual input, navigation, blur or close must invalidate that receipt.
    pub fn tick(
        &mut self,
        now: Instant,
        mut current: impl FnMut(&NativeAuthTarget) -> bool,
        mut send: impl FnMut(&NativeAuthTarget, u16) -> bool,
    ) -> TypingStatus {
        if matches!(
            self.status,
            TypingStatus::Complete | TypingStatus::Cancelled
        ) {
            return self.status;
        }
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if now >= self.expires || !current(&self.target) {
                return TypingStatus::Cancelled;
            }
            if now < self.next_at {
                return TypingStatus::Waiting;
            }
            let unit = self.text[self.offset];
            if !current(&self.target) || !send(&self.target, unit) {
                return TypingStatus::Cancelled;
            }
            self.text[self.offset] = 0;
            self.offset += 1;
            // UTF-16 surrogate pairs form one character and must reach the
            // renderer together before its next focused-field acknowledgement.
            if (0xD800..=0xDBFF).contains(&unit)
                && self.offset < self.text.len()
                && (0xDC00..=0xDFFF).contains(&self.text[self.offset])
            {
                if !current(&self.target) || !send(&self.target, self.text[self.offset]) {
                    return TypingStatus::Cancelled;
                }
                self.text[self.offset] = 0;
                self.offset += 1;
            }
            self.next_at = now + self.interval;
            if self.offset == self.text.len() {
                TypingStatus::Complete
            } else {
                TypingStatus::Sent
            }
        }))
        .unwrap_or(TypingStatus::Cancelled);
        if outcome == TypingStatus::Cancelled {
            self.cancel();
        } else {
            self.status = outcome;
            if outcome == TypingStatus::Complete {
                self.text.zeroize();
                self.text.clear();
            }
        }
        self.status
    }
}

/// CEF UI-thread adapter. Does not focus a browser/field, clear existing text,
/// click or submit: the verified target must already be focused and empty.
/// Caller still supplies the owner/consent/field receipt to NativeAuthTyping.
#[cfg(feature = "cef-host")]
pub fn send_cef_character(browser: &cef::Browser, target: &NativeAuthTarget, unit: u16) -> bool {
    use cef::{ImplBrowser, ImplBrowserHost, ImplFrame};
    if cef::currently_on(cef::ThreadId::UI) != 1
        || browser.is_valid() != 1
        || browser.identifier() != target.browser_id
    {
        return false;
    }
    let Some(frame) = browser.focused_frame() else {
        return false;
    };
    if frame.is_valid() != 1
        || frame.is_main() != 1
        || frame.is_focused() != 1
        || cef::CefString::from(&frame.identifier()).to_string() != target.frame_id
        || cef::CefString::from(&frame.url()).to_string() != target.document_url
    {
        return false;
    }
    let Some(host) = browser.host() else {
        return false;
    };
    for event in cef_character_events(unit) {
        host.send_key_event(Some(&event));
    }
    true
}

#[cfg(feature = "cef-host")]
fn cef_character_events(unit: u16) -> [cef::KeyEvent; 3] {
    // Character events deliver UTF-16 text through Chromium's input pipeline.
    // For non-ASCII text, do not reinterpret a Unicode scalar as a virtual key.
    let virtual_key = match unit {
        0x61..=0x7a => i32::from(unit - 0x20),
        0x41..=0x5a | 0x30..=0x39 | 0x20 => i32::from(unit),
        _ => 0,
    };
    [
        cef::KeyEventType::RAWKEYDOWN,
        cef::KeyEventType::CHAR,
        cef::KeyEventType::KEYUP,
    ]
    .map(|kind| cef::KeyEvent {
        type_: kind,
        windows_key_code: if kind == cef::KeyEventType::CHAR {
            i32::from(unit)
        } else {
            virtual_key
        },
        character: unit,
        unmodified_character: unit,
        focus_on_editable_field: 1,
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sorng_protocols::origin_browser::OriginBrowserPolicy;
    #[cfg(feature = "cef-host")]
    #[test]
    fn cef_typing_uses_real_keydown_character_keyup_packets_for_every_digit() {
        for unit in "12345678".encode_utf16() {
            let events = cef_character_events(unit);
            assert!(events[0].type_ == cef::KeyEventType::RAWKEYDOWN);
            assert!(events[1].type_ == cef::KeyEventType::CHAR);
            assert!(events[2].type_ == cef::KeyEventType::KEYUP);
            for event in events {
                assert_eq!(event.windows_key_code, i32::from(unit));
                assert_eq!(event.character, unit);
                assert_eq!(event.modifiers, 0);
                assert_eq!(event.focus_on_editable_field, 1);
            }
        }
    }
    fn target() -> NativeAuthTarget {
        NativeAuthTarget {
            identity: OriginBrowserPolicy::new("db", "connection", "tab", "https://example.test")
                .unwrap()
                .identity()
                .clone(),
            browser_id: 1,
            frame_id: "main".into(),
            document_sequence: 7,
            document_url: "https://example.test/login".into(),
            field_token: "private-field-receipt".into(),
        }
    }
    #[test]
    fn native_auth_input_is_paced_unicode_and_erases_completed_text() {
        let now = Instant::now();
        let mut input = NativeAuthTyping::new(
            target(),
            "a\u{1f642}",
            Duration::from_millis(20),
            now,
            now + Duration::from_secs(1),
        )
        .unwrap();
        let mut sent = Vec::new();
        assert_eq!(
            input.tick(
                now,
                |_| true,
                |_, unit| {
                    sent.push(unit);
                    true
                }
            ),
            TypingStatus::Sent
        );
        assert_eq!(
            input.tick(now, |_| true, |_, _| panic!("must wait")),
            TypingStatus::Waiting
        );
        for millis in [20, 40] {
            input.tick(
                now + Duration::from_millis(millis),
                |_| true,
                |_, unit| {
                    sent.push(unit);
                    true
                },
            );
        }
        assert_eq!(String::from_utf16(&sent).unwrap(), "a\u{1f642}");
        assert_eq!(input.status, TypingStatus::Complete);
        assert!(input.text.is_empty());
        assert_eq!(
            input.tick(now, |_| panic!("terminal"), |_, _| panic!("terminal")),
            TypingStatus::Complete
        );
    }
    #[test]
    fn native_auth_input_stops_on_revocation_expiry_focus_loss_or_sender_failure() {
        let now = Instant::now();
        for failure in 0..4 {
            let mut input = NativeAuthTyping::new(
                target(),
                "secret",
                Duration::from_millis(20),
                now,
                now + Duration::from_secs(1),
            )
            .unwrap();
            let at = if failure == 1 {
                now + Duration::from_secs(1)
            } else {
                now
            };
            let result = input.tick(
                at,
                |_| failure != 0,
                |_, _| {
                    if failure == 3 {
                        panic!("fixed failure")
                    } else {
                        false
                    }
                },
            );
            assert_eq!(result, TypingStatus::Cancelled);
            assert!(input.text.is_empty());
            assert_eq!(
                input.tick(now, |_| true, |_, _| panic!("must stay cancelled")),
                TypingStatus::Cancelled
            );
        }
    }
    #[test]
    fn native_auth_input_does_not_send_after_second_owner_check_fails() {
        let now = Instant::now();
        let mut input = NativeAuthTyping::new(
            target(),
            "secret",
            Duration::from_millis(20),
            now,
            now + Duration::from_secs(1),
        )
        .unwrap();
        let mut checks = 0;
        assert_eq!(
            input.tick(
                now,
                |_| {
                    checks += 1;
                    checks == 1
                },
                |_, _| panic!("revoked")
            ),
            TypingStatus::Cancelled
        );
        assert!(input.text.is_empty());
    }
    #[test]
    fn native_auth_input_rejects_cleartext_shortcut_controls_and_impossible_deadlines() {
        let now = Instant::now();
        let mut cleartext = target();
        cleartext.document_url = "http://example.test/login".into();
        assert!(NativeAuthTyping::new(
            cleartext,
            "secret",
            Duration::from_millis(20),
            now,
            now + Duration::from_secs(1)
        )
        .is_none());
        assert!(NativeAuthTyping::new(
            target(),
            "secret\t\n",
            Duration::from_millis(20),
            now,
            now + Duration::from_secs(1)
        )
        .is_none());
        assert!(NativeAuthTyping::new(
            target(),
            "secret",
            Duration::from_millis(20),
            now,
            now + Duration::from_millis(50)
        )
        .is_none());
    }
}
