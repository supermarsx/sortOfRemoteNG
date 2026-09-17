//! The Yealink servlet login contract — page grammar, password wrapper and
//! response classification — implemented **once**.
//!
//! Two callers share this module: the native VoIP-phone driver
//! ([`super::yealink`]) and the HTTP proxy's native pre-authentication. They
//! used to have no shared code at all, which is how the driver's request shape
//! and the browser fixtures drifted apart without anything failing.
//!
//! The contract (attested by four independent open-source implementations; no
//! firmware was downloaded or decrypted):
//!
//! 1. `GET /servlet?m=mod_listener&p=login&q=loginForm` → `Set-Cookie:
//!    JSESSIONID=…` plus per-session `var g_rsa_n="<hex>"` / `g_rsa_e="<hex>"`,
//!    and the non-secret `g_phonetype` / `g_strFirmware`.
//! 2. `POST …&q=login` with `username`, and a password that the page's own
//!    JavaScript wraps:
//!    * a random 16-byte AES-128 key and IV, each carried to the phone as a
//!      32-character lower-case hex string,
//!    * `pwd   = base64(AES-128-CBC-ZeroPad("<nonce>;<JSESSIONID>;<password>"))`,
//!    * `rsakey = base64(RSA-PKCS#1v1.5(<key hex>))`,
//!    * `rsaiv  = base64(RSA-PKCS#1v1.5(<iv hex>))`.
//! 3. The answer carries `{"authstatus":"done"|"none"|"lock"}`. `none` and
//!    `lock` are **terminal**: nothing in this crate may retry a login.
//!
//! **Secret hygiene.** Nothing here logs. The password, the AES key, the AES
//! IV and the session id never appear in a return value, an error message or a
//! diagnostic hint — the only text that can reach an error is the *response*
//! body, and only for an answer we could not classify.
//!
//! **Purity.** No I/O: the caller performs the requests and hands the bytes in.
//! That is what lets both callers share it, and what makes every branch below
//! unit-testable.

use aes::Aes128;
use base64::Engine;
use cbc::cipher::{BlockEncryptMut, KeyIvInit};
use rand::{CryptoRng, RngCore};
use regex::Regex;
use rsa::{BigUint, Pkcs1v15Encrypt, RsaPublicKey};

use crate::endpoints::servlet;
use crate::error::{VoipPhoneError, VoipPhoneResult};
use crate::types::LoginOutcome;

type Aes128CbcEnc = cbc::Encryptor<Aes128>;

/// AES-128: a 16-byte key and a 16-byte IV.
const AES_BYTES: usize = 16;
/// Length of the random anti-replay nonce that prefixes the plaintext, in bytes.
const NONCE_BYTES: usize = 8;

// ── login page ───────────────────────────────────────────────────────────────

/// Everything the login page tells us before we authenticate.
///
/// `phone_type` and `firmware` are readable without credentials and are not
/// secret — they are the two values this crate is allowed to log.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LoginFormFacts {
    /// RSA modulus (hex), per session. `None` means the page carried no key.
    pub rsa_n: Option<String>,
    /// RSA public exponent (hex). `None` falls back to
    /// [`servlet::RSA_EXPONENT_HEX`].
    pub rsa_e: Option<String>,
    /// `g_phonetype`, e.g. `T21P_E2`.
    pub phone_type: Option<String>,
    /// `g_strFirmware`, e.g. `52.84.0.15`.
    pub firmware: Option<String>,
}

impl LoginFormFacts {
    /// Whether the page asks for the RSA+AES wrapper. When `false` the caller
    /// must decide what to do — this module refuses to invent a plaintext
    /// fallback, because posting a password in clear to a phone that expects
    /// ciphertext is exactly the bug it replaces.
    pub fn is_encrypted(&self) -> bool {
        self.rsa_n.is_some()
    }

    /// The exponent to use, falling back to the firmware default.
    pub fn exponent_hex(&self) -> &str {
        self.rsa_e.as_deref().unwrap_or(servlet::RSA_EXPONENT_HEX)
    }
}

/// Append the cache-buster the phone's own pages carry
/// (`…&Random=<n>` on the login-page GET, `…&Rajax=<n>` on the login POST).
///
/// A native client has no cache to bust, but firmware has been seen to treat
/// the parameter as part of the request shape, so both callers send it and
/// build it the same way here.
pub fn with_cache_buster(path: &str, param: &str, rng: &mut impl RngCore) -> String {
    format!("{path}&{param}={}", rng.next_u32())
}

fn first_capture(haystack: &str, patterns: &[&str]) -> Option<String> {
    patterns.iter().find_map(|pat| {
        Regex::new(pat)
            .ok()?
            .captures(haystack)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
    })
}

/// Scrape the login page. Never fails: an unrecognised page yields an empty
/// [`LoginFormFacts`], which the caller reports as "could not classify" rather
/// than silently downgrading the login.
pub fn parse_login_form(html: &str) -> LoginFormFacts {
    LoginFormFacts {
        rsa_n: first_capture(html, servlet::RSA_N_PATTERNS),
        rsa_e: first_capture(html, servlet::RSA_E_PATTERNS),
        phone_type: first_capture(html, &[servlet::PHONETYPE_PATTERN]),
        firmware: first_capture(html, &[servlet::FIRMWARE_PATTERN]),
    }
}

// ── password wrapper ─────────────────────────────────────────────────────────

fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// AES-128-CBC with zero padding, matching the phone's own `aes.js`: the
/// plaintext is padded with `0x00` up to the block boundary, and an already
/// aligned plaintext gets **no** extra block.
fn aes_cbc_zero_padded(key: &[u8; AES_BYTES], iv: &[u8; AES_BYTES], plain: &[u8]) -> Vec<u8> {
    let padded_len = plain.len().div_ceil(AES_BYTES) * AES_BYTES;
    let mut buf = vec![0u8; padded_len];
    buf[..plain.len()].copy_from_slice(plain);

    let mut enc = Aes128CbcEnc::new(key.into(), iv.into());
    for block in buf.as_chunks_mut::<AES_BYTES>().0 {
        enc.encrypt_block_mut(block.into());
    }
    buf
}

fn rsa_wrap(
    key: &RsaPublicKey,
    plain: &str,
    rng: &mut (impl RngCore + CryptoRng),
) -> VoipPhoneResult<String> {
    let cipher = key
        .encrypt(rng, Pkcs1v15Encrypt, plain.as_bytes())
        .map_err(|e| VoipPhoneError::parse(format!("RSA encryption failed: {e}")))?;
    Ok(if servlet::RSA_CIPHERTEXT_IS_BASE64 {
        base64::engine::general_purpose::STANDARD.encode(cipher)
    } else {
        hex_lower(&cipher)
    })
}

fn rsa_public_key(facts: &LoginFormFacts) -> VoipPhoneResult<RsaPublicKey> {
    let modulus_hex = facts
        .rsa_n
        .as_deref()
        .ok_or_else(|| VoipPhoneError::parse("Login page carried no RSA public key"))?;
    let n = BigUint::parse_bytes(modulus_hex.as_bytes(), 16)
        .ok_or_else(|| VoipPhoneError::parse("RSA modulus in login page is not hex"))?;
    let e = BigUint::parse_bytes(facts.exponent_hex().as_bytes(), 16)
        .ok_or_else(|| VoipPhoneError::parse("RSA exponent in login page is not hex"))?;
    RsaPublicKey::new(n, e)
        .map_err(|e| VoipPhoneError::parse(format!("RSA public key rejected: {e}")))
}

/// Build the form body for `POST …&q=login`.
///
/// `session_id` is the `JSESSIONID` value the login-page GET issued: the phone
/// binds the ciphertext to that session, so a body built for one session is
/// worthless in another. `rng` is injected so the wrapper can be round-tripped
/// deterministically in tests.
///
/// The returned pairs are safe to hand to a form encoder and *only* those
/// pairs: no field carries the password, the AES key or the IV in the clear.
pub fn build_login_body(
    username: &str,
    password: &str,
    session_id: &str,
    facts: &LoginFormFacts,
    rng: &mut (impl RngCore + CryptoRng),
) -> VoipPhoneResult<Vec<(&'static str, String)>> {
    let public = rsa_public_key(facts)?;

    let mut aes_key = [0u8; AES_BYTES];
    let mut aes_iv = [0u8; AES_BYTES];
    let mut nonce = [0u8; NONCE_BYTES];
    rng.fill_bytes(&mut aes_key);
    rng.fill_bytes(&mut aes_iv);
    rng.fill_bytes(&mut nonce);

    // The phone's JS derives the key and IV as `hex_md5(<random>)` and sends
    // that 32-character hex string through RSA. Random bytes hex-encoded are
    // the same wire shape — the phone can never tell the difference — so the
    // hash buys nothing and is not computed here.
    let key_hex = hex_lower(&aes_key);
    let iv_hex = hex_lower(&aes_iv);

    let plain = format!("{};{};{}", hex_lower(&nonce), session_id, password);
    let cipher = aes_cbc_zero_padded(&aes_key, &aes_iv, plain.as_bytes());

    Ok(vec![
        (servlet::FIELD_USERNAME, username.to_string()),
        (
            servlet::FIELD_PASSWORD,
            base64::engine::general_purpose::STANDARD.encode(cipher),
        ),
        (servlet::FIELD_RSAKEY, rsa_wrap(&public, &key_hex, rng)?),
        (servlet::FIELD_RSAIV, rsa_wrap(&public, &iv_hex, rng)?),
    ])
}

// ── login answer ─────────────────────────────────────────────────────────────

/// First bytes of a response, for an error a human has to act on. Only ever
/// built from a *response* body, which carries no credential of ours.
pub fn response_hint(status: u16, body: &str) -> String {
    let snippet: String = body.chars().take(200).collect();
    let snippet = snippet.replace(['\r', '\n'], " ");
    format!("HTTP {status} — first bytes: {snippet:?}")
}

fn authstatus(body: &str) -> Option<Result<String, ()>> {
    let re = Regex::new(servlet::AUTHSTATUS_PATTERN).ok()?;
    let mut found: Option<String> = None;
    for cap in re.captures_iter(body) {
        let value = cap[1].to_ascii_lowercase();
        match &found {
            // Two different verdicts in one body: trust neither.
            Some(seen) if *seen != value => return Some(Err(())),
            Some(_) => {}
            None => found = Some(value),
        }
    }
    found.map(Ok)
}

/// Whether a response body is the login page (either markup). Used both to
/// spot a bounced session and to refuse to post anything to a page that is not
/// a Yealink login form at all.
pub fn is_login_page(body: &str) -> bool {
    body.contains(servlet::LOGIN_FORM_MARKER) || body.contains(servlet::USERNAME_ID_MARKER)
}

/// Classify the answer to the login POST. **Fails closed**: it returns
/// [`LoginOutcome::Done`] only on a positive signal, never on the absence of a
/// negative one.
///
/// `location` is the response's `Location` header, if any; the rest of the
/// headers carry nothing that may decide this. In particular the `JSESSIONID`
/// cookie must NOT: the login-page GET has already set it, so "a cookie
/// exists" is true of every rejected login too — that was the false positive
/// this function replaces.
pub fn classify_login_response(status: u16, location: Option<&str>, body: &str) -> LoginOutcome {
    let bounced = location.is_some_and(|l| l.contains(servlet::LOGIN_FORM_QUERY_MARKER));
    let to_data = location.is_some_and(|l| l.contains(servlet::DATA_MARKER));

    match authstatus(body) {
        // Explicit and self-contradicting: it says "signed in" while sending
        // us back to the login page.
        Some(Ok(s)) if s == servlet::AUTHSTATUS_DONE && bounced => {
            LoginOutcome::Unclassified(response_hint(status, body))
        }
        Some(Ok(s)) if s == servlet::AUTHSTATUS_DONE => LoginOutcome::Done,
        Some(Ok(s)) if s == servlet::AUTHSTATUS_NONE => LoginOutcome::BadCredentials,
        Some(Ok(s)) if s == servlet::AUTHSTATUS_LOCK => LoginOutcome::Locked,
        // An `authstatus` we do not know, or several disagreeing ones.
        Some(_) => LoginOutcome::Unclassified(response_hint(status, body)),
        None if bounced => LoginOutcome::SessionLost,
        // Older firmware answers a good login with a redirect into the
        // post-login area instead of an `authstatus` document.
        None if to_data => LoginOutcome::Done,
        None if is_login_page(body) => LoginOutcome::SessionLost,
        None => LoginOutcome::Unclassified(response_hint(status, body)),
    }
}

/// Turn a non-success outcome into the error the user sees.
///
/// `none` and `lock` are terminal by design: the phone locks an account out
/// after repeated failures, so nothing in this crate retries a login.
pub fn login_outcome_error(outcome: LoginOutcome) -> VoipPhoneError {
    match outcome {
        LoginOutcome::Done => VoipPhoneError::auth("Sign-in succeeded"),
        LoginOutcome::BadCredentials => {
            VoipPhoneError::auth("The phone rejected the username or password")
        }
        LoginOutcome::Locked => VoipPhoneError::auth(
            "The phone has locked this account after repeated failed sign-ins. \
             Wait a few minutes before trying again",
        ),
        LoginOutcome::SessionLost => VoipPhoneError::auth(
            "The phone ended the web session before sign-in completed. It allows \
             only one web session at a time — close any browser tab open on the phone",
        ),
        LoginOutcome::Unclassified(hint) => VoipPhoneError::unsupported(format!(
            "Could not classify the phone's answer to the sign-in: {hint}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MOD_HEX: &str = "c0ffee";

    fn facts_with(n: &str) -> LoginFormFacts {
        LoginFormFacts {
            rsa_n: Some(n.into()),
            ..Default::default()
        }
    }

    #[test]
    fn hex_is_lower_case_and_zero_padded() {
        assert_eq!(hex_lower(&[0x00, 0x0f, 0xa0, 0xff]), "000fa0ff");
    }

    #[test]
    fn aligned_plaintext_gets_no_extra_block() {
        let key = [7u8; AES_BYTES];
        let iv = [9u8; AES_BYTES];
        assert_eq!(aes_cbc_zero_padded(&key, &iv, &[1u8; 16]).len(), 16);
        assert_eq!(aes_cbc_zero_padded(&key, &iv, &[1u8; 17]).len(), 32);
        assert_eq!(aes_cbc_zero_padded(&key, &iv, b"").len(), 0);
    }

    #[test]
    fn exponent_falls_back_to_the_firmware_default() {
        assert_eq!(
            facts_with(MOD_HEX).exponent_hex(),
            servlet::RSA_EXPONENT_HEX
        );
        let facts = LoginFormFacts {
            rsa_e: Some("3".into()),
            ..facts_with(MOD_HEX)
        };
        assert_eq!(facts.exponent_hex(), "3");
    }

    #[test]
    fn empty_facts_are_not_encrypted() {
        assert!(!LoginFormFacts::default().is_encrypted());
        assert!(facts_with(MOD_HEX).is_encrypted());
    }
}
