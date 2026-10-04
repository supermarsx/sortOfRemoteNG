//! Inverse-map only the reviewed Exchange ECP/OWA form's destination field.
//! Never rewrite credentials, flags, unrelated bodies or arbitrary URL values.
use std::borrow::Cow;

const INVALID: &str = "The Exchange login destination is invalid or outside the configured application on the saved HTTPS origin. Credentials were not sent.";
const INVALID_FORM: &str = "The Exchange login requires an uncompressed URL-encoded form with one destination. Credentials were not sent.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ExchangeDestination {
    Ecp,
    Owa,
}

impl ExchangeDestination {
    fn permits(self, path: &str) -> bool {
        let path = path.to_ascii_lowercase();
        match self {
            Self::Ecp => path == "/ecp" || path.starts_with("/ecp/"),
            Self::Owa => {
                (path == "/owa" || path.starts_with("/owa/"))
                    && path != "/owa/auth"
                    && !path.starts_with("/owa/auth/")
                    && !path.starts_with("/owa/auth.")
            }
        }
    }
}

fn decode_component(input: &[u8]) -> Result<String, &'static str> {
    let mut decoded = Vec::with_capacity(input.len());
    let mut index = 0;
    while index < input.len() {
        match input[index] {
            b'%' => {
                let hi = input
                    .get(index + 1)
                    .and_then(|value| (*value as char).to_digit(16));
                let lo = input
                    .get(index + 2)
                    .and_then(|value| (*value as char).to_digit(16));
                let (Some(hi), Some(lo)) = (hi, lo) else {
                    return Err(INVALID_FORM);
                };
                decoded.push((hi * 16 + lo) as u8);
                index += 3;
            }
            b'+' => {
                decoded.push(b' ');
                index += 1;
            }
            value => {
                decoded.push(value);
                index += 1;
            }
        }
    }
    String::from_utf8(decoded).map_err(|_| INVALID_FORM)
}

fn destination(
    value: &str,
    saved: &reqwest::Url,
    proxy: &reqwest::Url,
    application: ExchangeDestination,
) -> Result<reqwest::Url, &'static str> {
    // URL parsing normalizes controls/backslashes. Refuse these spellings
    // instead of allowing an IIS/browser parser disagreement about authority.
    if value.len() > 16_384
        || value
            .chars()
            .any(|ch| ch.is_ascii_control() || ch.is_whitespace() || ch == '\\')
    {
        return Err(INVALID);
    }
    let raw_path = if value.starts_with('/') && !value.starts_with("//") {
        value
    } else {
        let (_, authority) = value.split_once("://").ok_or(INVALID)?;
        let start = authority.find('/').ok_or(INVALID)?;
        &authority[start..]
    }
    .split(['?', '#'])
    .next()
    .unwrap_or_default();
    if raw_path.contains('%')
        || raw_path.contains("//")
        || raw_path
            .split('/')
            .any(|segment| segment == "." || segment == "..")
    {
        return Err(INVALID);
    }
    let parsed = if value.starts_with('/') && !value.starts_with("//") {
        saved.join(value).map_err(|_| INVALID)?
    } else {
        reqwest::Url::parse(value).map_err(|_| INVALID)?
    };
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
        || (parsed.origin() != saved.origin() && parsed.origin() != proxy.origin())
        || !application.permits(parsed.path())
    {
        return Err(INVALID);
    }
    Ok(parsed)
}

/// Reused by upstream forwarding and local redirect-proof continuation. The
/// caller must separately require the reviewed Exchange profile (and HTTPS on
/// the upstream leg). This never approves a foreign origin or a generic hop.
pub(super) fn preserves_redirect(
    application: Option<ExchangeDestination>,
    method: &reqwest::Method,
    status: u16,
    source: &reqwest::Url,
    destination: &reqwest::Url,
) -> bool {
    let Some(application) = application else {
        return false;
    };
    matches!(status, 301 | 302 | 303 | 307 | 308)
        && source.origin() == destination.origin()
        && source.username().is_empty()
        && source.password().is_none()
        && destination.username().is_empty()
        && destination.password().is_none()
        && destination.fragment().is_none()
        && !source.path().contains('%')
        && !destination.path().contains('%')
        && !source.path().contains("//")
        && !destination.path().contains("//")
        && ((matches!(*method, reqwest::Method::GET | reqwest::Method::HEAD)
            && application.permits(source.path())
            && destination
                .path()
                .eq_ignore_ascii_case("/owa/auth/logon.aspx"))
            || (*method == reqwest::Method::POST
                && matches!(status, 302 | 303)
                && source.path().eq_ignore_ascii_case("/owa/auth.owa")
                && (application.permits(destination.path())
                    || destination
                        .path()
                        .eq_ignore_ascii_case("/owa/auth/logon.aspx"))))
}

#[allow(clippy::too_many_arguments)]
pub(super) fn prepare_body<'a>(
    application: Option<ExchangeDestination>,
    method: &reqwest::Method,
    request: &reqwest::Url,
    saved_origin: &str,
    proxy_origin: &str,
    headers: &[(String, String)],
    body: &'a [u8],
) -> Result<Cow<'a, [u8]>, &'static str> {
    let Some(application) = application else {
        return Ok(Cow::Borrowed(body));
    };
    if *method != reqwest::Method::POST || !request.path().eq_ignore_ascii_case("/owa/auth.owa") {
        return Ok(Cow::Borrowed(body));
    }
    let saved = reqwest::Url::parse(saved_origin).map_err(|_| INVALID)?;
    let proxy = reqwest::Url::parse(proxy_origin).map_err(|_| INVALID)?;
    if saved.scheme() != "https"
        || saved.host_str().is_none()
        || !saved.username().is_empty()
        || saved.password().is_some()
        || request.origin() != saved.origin()
        || !proxy.username().is_empty()
        || proxy.password().is_some()
        || proxy.host_str().is_none()
        || !matches!(proxy.scheme(), "http" | "https")
    {
        return Err(INVALID);
    }
    let types: Vec<_> = headers
        .iter()
        .filter(|(name, _)| name.eq_ignore_ascii_case("content-type"))
        .collect();
    if types.len() != 1
        || !types[0]
            .1
            .split(';')
            .next()
            .unwrap_or_default()
            .trim()
            .eq_ignore_ascii_case("application/x-www-form-urlencoded")
        || headers.iter().any(|(name, value)| {
            name.eq_ignore_ascii_case("content-encoding") && !value.eq_ignore_ascii_case("identity")
        })
    {
        return Err(INVALID_FORM);
    }
    let mut found = None;
    let mut offset = 0;
    for field in body.split(|value| *value == b'&') {
        let split = field
            .iter()
            .position(|value| *value == b'=')
            .unwrap_or(field.len());
        let name = decode_component(&field[..split])?;
        // ASP.NET field names are case-insensitive. Count encoded/case aliases
        // too, so an alternate spelling cannot smuggle a second destination.
        if name.eq_ignore_ascii_case("destination") {
            if found.is_some() || split == field.len() {
                return Err(INVALID_FORM);
            }
            let start = offset + split + 1;
            found = Some((start, offset + field.len()));
        }
        offset += field.len() + 1;
    }
    let (start, end) = found.ok_or(INVALID_FORM)?;
    let value = decode_component(&body[start..end])?;
    let parsed = destination(&value, &saved, &proxy, application)?;
    if parsed.origin() == saved.origin() && !value.starts_with('/') {
        return Ok(Cow::Borrowed(body));
    }
    let mapped = format!(
        "{}{}",
        saved.origin().ascii_serialization(),
        &parsed[url::Position::BeforePath..]
    );
    let encoded = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("", &mapped)
        .finish();
    let mut result = Vec::with_capacity(body.len() + encoded.len());
    result.extend_from_slice(&body[..start]);
    result.extend_from_slice(&encoded.as_bytes()[1..]);
    result.extend_from_slice(&body[end..]);
    Ok(Cow::Owned(result))
}

#[cfg(test)]
#[path = "http_exchange_ecp_tests.rs"]
mod tests;
