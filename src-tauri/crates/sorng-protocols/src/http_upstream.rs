//! Request-scoped authentication and redirects. Every hop retains exact origin.
use super::{http_digest, AxumProxyState, UpstreamAuthMode};

pub(super) enum UpstreamError {
    Transport(reqwest::Error),
    Policy(&'static str),
    Deadline,
}
impl From<reqwest::Error> for UpstreamError {
    fn from(error: reqwest::Error) -> Self {
        Self::Transport(error)
    }
}

pub(super) async fn send(
    state: &AxumProxyState,
    method: &reqwest::Method,
    input_url: &str,
    headers: &[(String, String)],
    body: &[u8],
) -> Result<reqwest::Response, UpstreamError> {
    // Keep one overall budget for authentication + all redirect hops, rather
    // than multiplying the client's timeout for each reissued request.
    tokio::time::timeout(
        std::time::Duration::from_secs(120),
        send_inner(state, method, input_url, headers, body),
    )
    .await
    .map_err(|_| UpstreamError::Deadline)?
}

async fn send_inner(
    state: &AxumProxyState,
    method: &reqwest::Method,
    input_url: &str,
    headers: &[(String, String)],
    body: &[u8],
) -> Result<reqwest::Response, UpstreamError> {
    let mut url = state.proxy_policy.request_url(input_url).map_err(|_| {
        UpstreamError::Policy("The configured HTTP query parameters could not be applied.")
    })?;
    let mut method = method.clone();
    let mut body = body.to_vec();
    let (user, password) = (
        state.username.read().map(|g| g.clone()).unwrap_or_default(),
        state.password.read().map(|g| g.clone()).unwrap_or_default(),
    );
    for redirect in 0..=10 {
        if url.origin().ascii_serialization() != state.target_origin
            || !url.username().is_empty()
            || url.password().is_some()
            || (state.proxy_policy.https_only && url.scheme() != "https")
        {
            return Err(UpstreamError::Policy("The upstream redirected outside this connection's approved origin. Credentials were not sent. Open the destination as a separate connection and review its trust."));
        }
        let request = |authorization: Option<String>| {
            let mut request = state.client.request(method.clone(), url.clone());
            for (name, value) in headers {
                if body.is_empty()
                    && method == reqwest::Method::GET
                    && name.eq_ignore_ascii_case("content-type")
                {
                    continue;
                }
                request = request.header(name, value);
            }
            request = state
                .upstream_auth_mode
                .apply_credentials(request, &user, &password);
            if let Some(value) = authorization {
                request = request.header(reqwest::header::AUTHORIZATION, value);
            }
            if !body.is_empty() {
                request = request.body(body.clone());
            }
            request
        };
        let mut response = request(None).send().await?;
        if state.upstream_auth_mode == UpstreamAuthMode::Digest
            && response.status() == reqwest::StatusCode::UNAUTHORIZED
        {
            let mut challenge =
                http_digest::challenge(response.headers()).map_err(UpstreamError::Policy)?;
            if user.is_empty() && password.is_empty() {
                return Err(UpstreamError::Policy("HTTP Digest requires saved credentials. Edit this connection's username and password, then reconnect."));
            }
            for attempt in 0..2 {
                let uri = match url.query() {
                    Some(query) => format!("{}?{query}", url.path()),
                    None => url.path().to_string(),
                };
                let authorization = challenge
                    .authorization(
                        &user,
                        &password,
                        method.as_str(),
                        &uri,
                        &crate::themed_auth::fresh_nonce(),
                    )
                    .map_err(UpstreamError::Policy)?;
                response = request(Some(authorization)).send().await?;
                if response.status() != reqwest::StatusCode::UNAUTHORIZED {
                    break;
                }
                let next =
                    http_digest::challenge(response.headers()).map_err(UpstreamError::Policy)?;
                if attempt != 0 || !next.stale {
                    return Err(UpstreamError::Policy("The server rejected HTTP Digest authentication. Review the saved credentials and server policy, then reconnect; no automatic login loop was started."));
                }
                challenge = next;
            }
        }
        let status = response.status();
        if !matches!(status.as_u16(), 301 | 302 | 303 | 307 | 308) {
            return Ok(response);
        }
        if redirect == 10 {
            return Err(UpstreamError::Policy(
                "The upstream exceeded the allowed redirect count.",
            ));
        }
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .ok_or(UpstreamError::Policy(
                "The upstream returned an invalid redirect.",
            ))?;
        let next = url
            .join(location)
            .map_err(|_| UpstreamError::Policy("The upstream returned an invalid redirect."))?;
        // Check BEFORE another send, even when browsing restrictions are off.
        if next.origin() != url.origin() || !next.username().is_empty() || next.password().is_some()
        {
            return Err(UpstreamError::Policy("The upstream redirected outside this connection's approved origin. Credentials were not sent. Open the destination as a separate connection and review its trust."));
        }
        if (status == reqwest::StatusCode::SEE_OTHER && method != reqwest::Method::HEAD)
            || (matches!(status.as_u16(), 301 | 302) && method == reqwest::Method::POST)
        {
            method = reqwest::Method::GET;
            body.clear();
        }
        url = state.proxy_policy.request_url(next.as_str()).map_err(|_| {
            UpstreamError::Policy("The configured HTTP query parameters could not be applied.")
        })?;
    }
    Err(UpstreamError::Policy(
        "The upstream exceeded the allowed redirect count.",
    ))
}
