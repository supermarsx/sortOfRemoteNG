//! RFC 7616 challenge-only authentication, bounded and without Basic fallback.
use reqwest::header::HeaderMap;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Algorithm {
    Md5,
    Sha256,
}
pub(super) struct Challenge {
    algorithm: Algorithm,
    session: bool,
    realm: String,
    nonce: String,
    opaque: Option<String>,
    auth_qop: bool,
    utf8: bool,
    userhash: bool,
    pub stale: bool,
}

const INVALID: &str = "The server sent an invalid HTTP Digest challenge.";
const UNSUPPORTED: &str = "HTTP Digest supports MD5/SHA-256 (including -sess), qop=auth or legacy no-qop, and UTF-8. The server offered no supported challenge; Basic fallback was not attempted.";

fn parameters(input: &str) -> Result<HashMap<String, String>, &'static str> {
    let mut result = HashMap::new();
    let bytes = input.as_bytes();
    let mut cursor = 0;
    while cursor < bytes.len() {
        while cursor < bytes.len() && (bytes[cursor].is_ascii_whitespace() || bytes[cursor] == b',')
        {
            cursor += 1;
        }
        let start = cursor;
        while cursor < bytes.len()
            && (bytes[cursor].is_ascii_alphanumeric() || matches!(bytes[cursor], b'-' | b'_'))
        {
            cursor += 1;
        }
        if cursor == start {
            return Err(INVALID);
        }
        let key = input[start..cursor].to_ascii_lowercase();
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        // A new auth scheme in a combined WWW-Authenticate header.
        if bytes.get(cursor) != Some(&b'=') {
            break;
        }
        cursor += 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        let value = if bytes.get(cursor) == Some(&b'"') {
            cursor += 1;
            let mut value = Vec::new();
            let mut closed = false;
            while cursor < bytes.len() {
                let byte = bytes[cursor];
                cursor += 1;
                if byte == b'"' {
                    closed = true;
                    break;
                }
                if byte == b'\\' {
                    let next = *bytes.get(cursor).ok_or(INVALID)?;
                    value.push(next);
                    cursor += 1;
                } else {
                    value.push(byte);
                }
            }
            if !closed {
                return Err(INVALID);
            }
            String::from_utf8(value).map_err(|_| INVALID)?
        } else {
            let start = cursor;
            while cursor < bytes.len()
                && bytes[cursor] != b','
                && !bytes[cursor].is_ascii_whitespace()
            {
                cursor += 1;
            }
            input[start..cursor].to_string()
        };
        if value.chars().any(|c| c.is_ascii_control())
            || value.len() > 4096
            || result.insert(key, value).is_some()
            || result.len() > 24
        {
            return Err(INVALID);
        }
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor < bytes.len() && bytes[cursor] != b',' {
            return Err(INVALID);
        }
    }
    Ok(result)
}

fn parse(input: &str) -> Result<Challenge, &'static str> {
    let mut values = parameters(input)?;
    let algorithm = values
        .remove("algorithm")
        .unwrap_or_else(|| "MD5".into())
        .to_ascii_lowercase();
    let (algorithm, session) = match algorithm.as_str() {
        "md5" => (Algorithm::Md5, false),
        "md5-sess" => (Algorithm::Md5, true),
        "sha-256" => (Algorithm::Sha256, false),
        "sha-256-sess" => (Algorithm::Sha256, true),
        _ => return Err(UNSUPPORTED),
    };
    let auth_qop = if let Some(qop) = values.remove("qop") {
        if !qop
            .split(',')
            .any(|part| part.trim().eq_ignore_ascii_case("auth"))
        {
            return Err(UNSUPPORTED);
        }
        true
    } else {
        false
    };
    let utf8 = match values.remove("charset") {
        None => false,
        Some(value) if value.eq_ignore_ascii_case("UTF-8") => true,
        _ => return Err(UNSUPPORTED),
    };
    let boolean = |name: &str| -> Result<bool, &'static str> {
        match values.get(name).map(String::as_str) {
            None | Some("false") => Ok(false),
            Some("true") => Ok(true),
            _ => Err(INVALID),
        }
    };
    let stale = boolean("stale")?;
    let userhash = boolean("userhash")?;
    let realm = values.remove("realm").ok_or(INVALID)?;
    let nonce = values
        .remove("nonce")
        .filter(|v| !v.is_empty())
        .ok_or(INVALID)?;
    Ok(Challenge {
        algorithm,
        session,
        realm,
        nonce,
        opaque: values.remove("opaque"),
        auth_qop,
        utf8,
        userhash,
        stale,
    })
}

pub(super) fn challenge(headers: &HeaderMap) -> Result<Challenge, &'static str> {
    let mut selected = None;
    let mut total = 0;
    let mut count = 0;
    for header in headers.get_all("www-authenticate") {
        let input = header.to_str().map_err(|_| INVALID)?;
        total += input.len();
        if total > 16_384 {
            return Err(INVALID);
        }
        let bytes = input.as_bytes();
        let mut quoted = false;
        let mut escaped = false;
        for cursor in 0..bytes.len() {
            let byte = bytes[cursor];
            if escaped {
                escaped = false;
                continue;
            }
            if quoted && byte == b'\\' {
                escaped = true;
                continue;
            }
            if byte == b'"' {
                quoted = !quoted;
                continue;
            }
            if quoted
                || !(cursor == 0
                    || bytes[cursor - 1] == b','
                    || bytes[cursor - 1].is_ascii_whitespace())
            {
                continue;
            }
            if bytes
                .get(cursor..cursor + 7)
                .is_some_and(|part| part.eq_ignore_ascii_case(b"Digest "))
            {
                count += 1;
                if count > 8 {
                    return Err(INVALID);
                }
                if let Ok(candidate) = parse(&input[cursor + 7..]) {
                    if selected.as_ref().is_none_or(|current: &Challenge| {
                        current.algorithm == Algorithm::Md5
                            && candidate.algorithm == Algorithm::Sha256
                    }) {
                        selected = Some(candidate);
                    }
                }
            }
        }
    }
    selected.ok_or(UNSUPPORTED)
}

impl Challenge {
    fn hash(&self, value: &str) -> String {
        match self.algorithm {
            Algorithm::Md5 => format!("{:x}", md5::Md5::digest(value.as_bytes())),
            Algorithm::Sha256 => format!("{:x}", Sha256::digest(value.as_bytes())),
        }
    }
    pub(super) fn authorization(
        &self,
        username: &str,
        password: &str,
        method: &str,
        uri: &str,
        cnonce: &str,
    ) -> Result<String, &'static str> {
        if [username, password, uri, cnonce]
            .iter()
            .any(|v| v.chars().any(|c| c.is_ascii_control()))
            || (!self.utf8
                && (!username.is_ascii() || !password.is_ascii() || !self.realm.is_ascii()))
        {
            return Err("HTTP Digest credentials require a supported character encoding and cannot contain control characters.");
        }
        let mut ha1 = self.hash(&format!("{username}:{}:{password}", self.realm));
        if self.session {
            ha1 = self.hash(&format!("{ha1}:{}:{cnonce}", self.nonce));
        }
        let ha2 = self.hash(&format!("{method}:{uri}"));
        let response = if self.auth_qop {
            self.hash(&format!(
                "{ha1}:{}:00000001:{cnonce}:auth:{ha2}",
                self.nonce
            ))
        } else {
            self.hash(&format!("{ha1}:{}:{ha2}", self.nonce))
        };
        let quote =
            |value: &str| format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""));
        let user = if self.userhash {
            self.hash(&format!("{username}:{}", self.realm))
        } else {
            username.into()
        };
        let algorithm = match (self.algorithm, self.session) {
            (Algorithm::Md5, false) => "MD5",
            (Algorithm::Md5, true) => "MD5-sess",
            (Algorithm::Sha256, false) => "SHA-256",
            (Algorithm::Sha256, true) => "SHA-256-sess",
        };
        let mut output = format!(
            "Digest username={}, realm={}, nonce={}, uri={}, algorithm={algorithm}, response={}",
            quote(&user),
            quote(&self.realm),
            quote(&self.nonce),
            quote(uri),
            quote(&response)
        );
        if self.auth_qop {
            output.push_str(&format!(
                ", qop=auth, nc=00000001, cnonce={}",
                quote(cnonce)
            ));
        } else if self.session {
            output.push_str(&format!(", cnonce={}", quote(cnonce)));
        }
        if let Some(opaque) = &self.opaque {
            output.push_str(&format!(", opaque={}", quote(opaque)));
        }
        if self.userhash {
            output.push_str(", userhash=true");
        }
        Ok(output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rfc_md5_vector_and_no_plaintext_password() {
        let c = parse("realm=\"testrealm@host.com\", qop=\"auth,auth-int\", nonce=\"dcd98b7102dd2f0e8b11d0f600bfb0c093\", opaque=\"5ccc069c403ebaf9f0171e9517f40e41\"").unwrap();
        let header = c
            .authorization(
                "Mufasa",
                "Circle Of Life",
                "GET",
                "/dir/index.html",
                "0a4f113b",
            )
            .unwrap();
        assert!(header.contains("6629fae49393a05397450978507c4ef1"));
        assert!(!header.contains("Circle Of Life"));
    }
    #[test]
    fn rfc7616_sha256_vector() {
        // https://www.rfc-editor.org/rfc/rfc7616#section-3.9.1
        let c = parse("realm=\"http-auth@example.org\", qop=\"auth, auth-int\", algorithm=SHA-256, nonce=\"7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v\"").unwrap();
        let result = c
            .authorization(
                "Mufasa",
                "Circle of Life",
                "GET",
                "/dir/index.html",
                "f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ",
            )
            .unwrap();
        assert!(result.contains("753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1"));
    }
    #[test]
    fn strongest_supported_combined_challenge_and_escaped_quotes() {
        let mut headers = HeaderMap::new();
        headers.insert("www-authenticate", "Basic realm=\"Digest fake\", Digest realm=\"a\\\"b\", nonce=\"one\", algorithm=MD5, Digest realm=\"real\", nonce=\"two\", algorithm=SHA-256, qop=\"auth\"".parse().unwrap());
        let c = challenge(&headers).unwrap();
        assert!(c.algorithm == Algorithm::Sha256);
        assert_eq!(c.realm, "real");
        let header = c
            .authorization("u\"s", "secret", "POST", "/?x=1", "cnonce")
            .unwrap();
        assert!(header.contains("username=\"u\\\"s\""));
        assert!(header.contains("algorithm=SHA-256"));
    }
    #[test]
    fn rejects_unsupported_ambiguous_and_oversized_challenges() {
        for input in [
            "realm=\"a\", nonce=\"b\", qop=\"auth-int\"",
            "realm=a, nonce=b, algorithm=SHA-512",
            "realm=a, nonce=b, nonce=c",
            "realm=\"unterminated",
            "realm=a, nonce=b, charset=ISO-8859-1",
        ] {
            assert!(parse(input).is_err());
        }
        let mut headers = HeaderMap::new();
        headers.insert(
            "www-authenticate",
            format!("Digest realm=\"{}\", nonce=\"b\"", "x".repeat(16_384))
                .parse()
                .unwrap(),
        );
        assert!(challenge(&headers).is_err());
        for algorithm in ["MD5-sess", "SHA-256-sess"] {
            let c = parse(&format!(
                "realm=a, nonce=b, algorithm={algorithm}, stale=true"
            ))
            .unwrap();
            assert!(c.stale);
            assert!(c
                .authorization("user", "secret", "GET", "/", "fresh")
                .unwrap()
                .contains("cnonce=\"fresh\""));
        }
    }
}
