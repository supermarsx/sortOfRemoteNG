//! Real loopback redirect/Digest exchanges and protected browser responses.
//! All cookie values, authorities and credentials below are synthetic.
use super::*;
use reqwest::cookie::CookieStore;

struct Peer {
    origin: String,
    seen: Arc<std::sync::Mutex<Vec<(String, String, HeaderMap)>>>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Peer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn peer(
    respond: impl Fn(&str, &HeaderMap) -> Response<Body> + Send + Sync + 'static,
) -> Peer {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured = seen.clone();
    let respond = Arc::new(respond);
    let router = axum::Router::new().fallback(move |request: axum::extract::Request| {
        let captured = captured.clone();
        let respond = respond.clone();
        async move {
            let path = request.uri().path().to_owned();
            captured.lock().unwrap().push((
                path.clone(),
                request.method().to_string(),
                request.headers().clone(),
            ));
            respond(&path, request.headers())
        }
    });
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    Peer { origin, seen, task }
}

fn response(status: u16, location: Option<&str>, cookies: &[&str]) -> Response<Body> {
    let mut builder = Response::builder()
        .status(status)
        .header("Content-Type", "text/plain");
    if let Some(location) = location {
        builder = builder.header("Location", location);
    }
    for cookie in cookies {
        builder = builder.header("Set-Cookie", *cookie);
    }
    builder.body(Body::from("synthetic response")).unwrap()
}

fn cookie_client(jar: Arc<reqwest::cookie::Jar>) -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .cookie_provider(jar)
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap()
}

async fn request(proxy: &FixtureProxy, browser: &reqwest::Client, path: &str) -> reqwest::Response {
    browser
        .get(format!("{}{path}", proxy.base))
        .header("Host", &proxy.state.proxy_authority)
        .header("Origin", &proxy.state.proxy_origin)
        .header("Sec-Fetch-Dest", "empty")
        .header("Sec-Fetch-Mode", "cors")
        .send()
        .await
        .unwrap()
}

fn pairs(headers: &HeaderMap) -> Vec<String> {
    headers
        .get_all("cookie")
        .iter()
        .flat_map(|value| value.to_str().unwrap().split(';'))
        .map(|value| value.trim().to_owned())
        .collect()
}

const FREEPBX_FORM: &str = "username=fixture%2Badmin&password=synthetic%26pass";

// Synthetic PHP session contract, not real FreePBX authentication. Validate the
// prelogin cookie and POST bytes, rotate on both a redirect and its terminal GET.
async fn freepbx_peer(redirect_status: u16, http_only: bool) -> Peer {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured = seen.clone();
    let router = axum::Router::new().fallback(move |request: axum::extract::Request| {
        let captured = captured.clone();
        async move {
            let (parts, body) = request.into_parts();
            let body = axum::body::to_bytes(body, 4096).await.unwrap();
            let path = parts.uri.path();
            let session: Vec<_> = pairs(&parts.headers)
                .into_iter()
                .filter(|pair| pair.starts_with("PHPSESSID="))
                .collect();
            captured.lock().unwrap().push((
                path.to_owned(),
                parts.method.to_string(),
                parts.headers.clone(),
            ));
            let cookie = |value: &str| {
                format!(
                    "PHPSESSID={value}; Path=/admin{}",
                    if http_only { "; HttpOnly" } else { "" }
                )
            };
            let plain = |text: &'static str| {
                Response::builder()
                    .header("Content-Type", "text/plain")
                    .body(Body::from(text))
                    .unwrap()
            };
            match (parts.method.as_str(), path) {
                ("GET", "/admin/") => response(200, None, &[&cookie("prelogin")]),
                ("POST", "/admin/" | "/admin/config.php") => {
                    if body.as_ref() != FREEPBX_FORM.as_bytes()
                        || parts
                            .headers
                            .get("content-type")
                            .and_then(|v| v.to_str().ok())
                            != Some("application/x-www-form-urlencoded")
                        || session != ["PHPSESSID=prelogin"]
                    {
                        return Response::builder()
                            .status(400)
                            .body(Body::from("invalid synthetic prelogin session or POST"))
                            .unwrap();
                    }
                    if redirect_status == 200 {
                        let mut result = plain("authenticated");
                        result
                            .headers_mut()
                            .insert("set-cookie", cookie("active-session").parse().unwrap());
                        return result;
                    }
                    response(
                        redirect_status,
                        Some("/admin/config.php"),
                        &[&cookie("redirect-session")],
                    )
                }
                ("GET", "/admin/config.php") if session == ["PHPSESSID=redirect-session"] => {
                    let mut result = plain("authenticated");
                    result
                        .headers_mut()
                        .insert("set-cookie", cookie("active-session").parse().unwrap());
                    result
                }
                ("GET", "/admin/config.php") if session == ["PHPSESSID=active-session"] => {
                    plain("authenticated")
                }
                ("POST", "/admin/logout") => response(
                    redirect_status,
                    Some("/admin/config.php"),
                    // A deletion need not repeat HttpOnly.
                    &["PHPSESSID=; Max-Age=0; Path=/admin"],
                ),
                _ => plain("signed-out"),
            }
        }
    });
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    Peer { origin, seen, task }
}

fn freepbx_config(peer: &Peer) -> BasicAuthProxyConfig {
    serde_json::from_value(serde_json::json!({
        "target_url": format!("{}/", peer.origin),
        "username": "", "password": "", "upstream_auth_mode": "none",
        "reviewed_application_profile": "freepbx"
    }))
    .unwrap()
}

async fn freepbx_proxy(peer: &Peer, native_override: Option<reqwest::Client>) -> FixtureProxy {
    let mut config = freepbx_config(peer);
    let target = reqwest::Url::parse(&config.target_url).unwrap();
    let mut registry = attempt::AttemptRegistry::default();
    for automatic in [false, true] {
        config.http_auto_login = automatic;
        assert!(registry
            .start(&config, &target, "synthetic-freepbx-session")
            .unwrap()
            .is_none());
    }
    let native = native_override.unwrap_or_else(|| {
        proxy_start::proxy_client_builder_with_cookies(
            &config.transport_settings,
            config.verify_ssl,
            config.accepted_cert_fingerprint.as_deref(),
            &config.min_tls_version,
            config.upstream_proxy_url.as_deref(),
            config.require_ca_verification,
            target.host_str(),
            None,
            true,
        )
        .unwrap()
    });
    let proxy = proxy_with_policy_and_network(
        config.target_url,
        native,
        config.upstream_auth_mode,
        config.proxy_policy.unwrap_or_default(),
        config.custom_headers,
        Arc::new(
            ProxyNetworkState::default()
                .with_reviewed_application_profile(config.reviewed_application_profile)
                .with_freepbx_cookies(&peer.origin)
                .unwrap(),
        ),
    )
    .await;
    assert!(proxy.state.attempt.is_none());
    assert!(proxy.state.network.has_freepbx_cookie_compatibility());
    proxy
}

fn freepbx_request(
    proxy: &FixtureProxy,
    method: reqwest::Method,
    path: &str,
    cookie: Option<&str>,
) -> reqwest::RequestBuilder {
    let mut request = client()
        .request(method, format!("{}{path}", proxy.base))
        .header("Host", &proxy.state.proxy_authority)
        .header("Origin", &proxy.state.proxy_origin)
        .header("Sec-Fetch-Dest", "iframe")
        .header("Sec-Fetch-Mode", "navigate");
    if let Some(cookie) = cookie {
        request = request.header("Cookie", cookie);
    }
    request
}

async fn freepbx_login(peer: &Peer, proxy: &FixtureProxy, cookie: Option<&str>) {
    let prelogin = freepbx_request(proxy, reqwest::Method::GET, "/admin/", None)
        .send()
        .await
        .unwrap();
    assert_eq!(prelogin.status(), StatusCode::OK);
    let login = freepbx_request(proxy, reqwest::Method::POST, "/admin/", cookie)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(FREEPBX_FORM)
        .send()
        .await
        .unwrap();
    assert_eq!(login.status(), StatusCode::OK);
    assert_eq!(login.text().await.unwrap(), "authenticated");
    let seen = peer.seen.lock().unwrap();
    let post = &seen[seen.len() - 2];
    assert_eq!((&*post.0, &*post.1), ("/admin/", "POST"));
    assert_eq!(post.2["content-length"], FREEPBX_FORM.len().to_string());
    assert_eq!(post.2["origin"], peer.origin);
    let redirected = seen.last().unwrap();
    assert_eq!(
        (&*redirected.0, &*redirected.1),
        ("/admin/config.php", "GET")
    );
    assert!(pairs(&redirected.2).contains(&"PHPSESSID=redirect-session".into()));
}

#[tokio::test]
async fn freepbx_login_rotation_survives_partial_and_stale_browser_cookies() {
    for status in [302, 303] {
        for http_only in [false, true] {
            for post_cookie in [
                None,
                Some("theme=dark"),
                Some("PHPSESSID=stale; theme=dark"),
                Some("PHPSESSID=prelogin; theme=dark"),
            ] {
                let peer = freepbx_peer(status, http_only).await;
                let proxy = freepbx_proxy(&peer, None).await;
                freepbx_login(&peer, &proxy, post_cookie).await;
                // No browser jar: these headers explicitly model withheld or stale
                // browser copies, including two same-name values with unknown paths.
                for cookie in [
                    None,
                    Some("theme=dark"),
                    Some("theme=light; PHPSESSID=prelogin"),
                    Some("PHPSESSID=redirect-session; theme=dark; PHPSESSID=prelogin"),
                ] {
                    let result =
                        freepbx_request(&proxy, reqwest::Method::GET, "/admin/config.php", cookie)
                            .send()
                            .await
                            .unwrap();
                    assert_eq!(result.status(), StatusCode::OK);
                    let body = result.text().await.unwrap();
                    let seen = peer.seen.lock().unwrap();
                    let forwarded = pairs(&seen.last().unwrap().2);
                    assert_eq!(body, "authenticated", "status={status}, HttpOnly={http_only}, browser={cookie:?}, upstream={forwarded:?}");
                    assert_eq!(
                        forwarded
                            .iter()
                            .map(String::as_str)
                            .filter(|value| value.starts_with("PHPSESSID="))
                            .collect::<Vec<_>>(),
                        ["PHPSESSID=active-session"]
                    );
                    if let Some(value) = cookie.and_then(|header| {
                        header
                            .split(';')
                            .map(str::trim)
                            .find(|pair| pair.starts_with("theme="))
                    }) {
                        assert!(forwarded.iter().any(|pair| pair == value));
                    }
                }
            }
        }
    }
}

#[tokio::test]
async fn freepbx_direct_200_post_session_survives_next_browser_request() {
    for http_only in [false, true] {
        let peer = freepbx_peer(200, http_only).await;
        let proxy = freepbx_proxy(&peer, None).await;
        let prelogin = freepbx_request(&proxy, reqwest::Method::GET, "/admin/", None)
            .send()
            .await
            .unwrap();
        assert_eq!(prelogin.status(), StatusCode::OK);
        // The upstream validates these form bytes AND its prelogin session.
        // The renderer supplies only a preference, never the required session.
        let login = freepbx_request(
            &proxy,
            reqwest::Method::POST,
            "/admin/config.php",
            Some("theme=dark"),
        )
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(FREEPBX_FORM)
        .send()
        .await
        .unwrap();
        assert_eq!(login.status(), StatusCode::OK);
        assert!(!login.headers().contains_key("location"));
        assert_eq!(login.text().await.unwrap(), "authenticated");
        {
            let seen = peer.seen.lock().unwrap();
            assert_eq!(
                seen.len(),
                2,
                "direct POST success must not invent a redirect hop"
            );
            assert_eq!((&*seen[0].0, &*seen[0].1), ("/admin/", "GET"));
            assert_eq!((&*seen[1].0, &*seen[1].1), ("/admin/config.php", "POST"));
            assert!(pairs(&seen[1].2).contains(&"PHPSESSID=prelogin".into()));
        }
        for cookie in ["theme=dark", "PHPSESSID=prelogin; theme=light"] {
            let result = freepbx_request(
                &proxy,
                reqwest::Method::GET,
                "/admin/config.php",
                Some(cookie),
            )
            .send()
            .await
            .unwrap();
            assert_eq!(result.status(), StatusCode::OK);
            assert_eq!(result.text().await.unwrap(), "authenticated");
            let forwarded = pairs(&peer.seen.lock().unwrap().last().unwrap().2);
            assert!(forwarded.contains(&"PHPSESSID=active-session".into()));
            assert!(!forwarded.contains(&"PHPSESSID=prelogin".into()));
        }
    }
}

#[tokio::test]
async fn freepbx_logout_deletion_rejects_stale_browser_and_hidden_native_jar() {
    for status in [302, 303] {
        let peer = freepbx_peer(status, true).await;
        let hidden_jar = Arc::new(reqwest::cookie::Jar::default());
        let proxy = freepbx_proxy(&peer, Some(cookie_client(hidden_jar.clone()))).await;
        freepbx_login(&peer, &proxy, Some("theme=dark")).await;
        let logout = freepbx_request(
            &proxy,
            reqwest::Method::POST,
            "/admin/logout",
            Some("theme=dark; PHPSESSID=active-session"),
        )
        .send()
        .await
        .unwrap();
        assert_eq!(logout.status(), StatusCode::OK);
        assert_eq!(logout.text().await.unwrap(), "signed-out");
        assert!(!pairs(&peer.seen.lock().unwrap().last().unwrap().2)
            .iter()
            .any(|value| value.starts_with("PHPSESSID=")));
        // Deliberately contaminate a separate reqwest jar after deletion. The
        // explicitly empty authoritative header must prevent automatic refill.
        hidden_jar.add_cookie_str(
            "PHPSESSID=active-session; Path=/admin",
            &reqwest::Url::parse(&peer.origin).unwrap(),
        );
        for cookie in [
            None,
            Some("PHPSESSID=active-session"),
            Some("PHPSESSID=prelogin; theme=light"),
        ] {
            let result = freepbx_request(&proxy, reqwest::Method::GET, "/admin/config.php", cookie)
                .send()
                .await
                .unwrap();
            assert_eq!(result.status(), StatusCode::OK);
            assert_eq!(
                result.text().await.unwrap(),
                "signed-out",
                "browser={cookie:?}"
            );
            let seen = peer.seen.lock().unwrap();
            let headers = &seen.last().unwrap().2;
            assert!(!pairs(headers)
                .iter()
                .any(|value| value.starts_with("PHPSESSID=")));
            if cookie.is_none() || cookie == Some("PHPSESSID=active-session") {
                assert_eq!(headers.get("cookie").unwrap(), "");
            } else {
                assert!(pairs(headers).contains(&"theme=light".into()));
            }
        }
    }
}

#[tokio::test]
async fn freepbx_session_cookie_preserves_path_origin_and_session_isolation() {
    let peer = freepbx_peer(303, true).await;
    let first = freepbx_proxy(&peer, None).await;
    freepbx_login(&peer, &first, Some("theme=dark")).await;
    for path in ["/ucp/", "/administrator/", "/admin-extra/"] {
        let result = freepbx_request(
            &first,
            reqwest::Method::GET,
            path,
            Some("PHPSESSID=active-session; theme=dark"),
        )
        .send()
        .await
        .unwrap();
        assert_eq!(result.status(), StatusCode::OK);
        assert_eq!(result.text().await.unwrap(), "signed-out");
        let seen = peer.seen.lock().unwrap();
        assert!(
            !pairs(&seen.last().unwrap().2)
                .iter()
                .any(|value| value.starts_with("PHPSESSID=")),
            "path={path}"
        );
        assert!(pairs(&seen.last().unwrap().2).contains(&"theme=dark".into()));
    }
    let before = peer.seen.lock().unwrap().len();
    assert!(matches!(
        upstream::send(
            &first.state,
            &reqwest::Method::GET,
            "http://unapproved.invalid/admin/config.php",
            &[],
            &[]
        )
        .await,
        Err(upstream::UpstreamError::Policy(_))
    ));
    assert_eq!(peer.seen.lock().unwrap().len(), before);
    let second = freepbx_proxy(&peer, None).await;
    // Neither the native jar nor a supplied browser copy may import another
    // proxy's PHP session, even before this session observes an upstream cookie.
    for cookie in [None, Some("PHPSESSID=active-session; theme=dark")] {
        let fresh = freepbx_request(&second, reqwest::Method::GET, "/admin/config.php", cookie)
            .send()
            .await
            .unwrap();
        assert_eq!(fresh.status(), StatusCode::OK);
        assert_eq!(fresh.text().await.unwrap(), "signed-out");
        assert!(!pairs(&peer.seen.lock().unwrap().last().unwrap().2)
            .iter()
            .any(|value| value.starts_with("PHPSESSID=")));
    }
    let prelogin = freepbx_request(&second, reqwest::Method::GET, "/admin/", None)
        .send()
        .await
        .unwrap();
    assert_eq!(prelogin.status(), StatusCode::OK);
    let result = freepbx_request(
        &second,
        reqwest::Method::GET,
        "/admin/config.php",
        Some("PHPSESSID=active-session; theme=dark"),
    )
    .send()
    .await
    .unwrap();
    assert_eq!(result.status(), StatusCode::OK);
    assert_eq!(result.text().await.unwrap(), "signed-out");
    let forwarded = pairs(&peer.seen.lock().unwrap().last().unwrap().2);
    assert!(forwarded.contains(&"PHPSESSID=prelogin".into()));
    assert!(!forwarded.contains(&"PHPSESSID=active-session".into()));
    // Revoking a separate session must not affect the authenticated owner.
    second.state.network.revoke();
    let result = freepbx_request(
        &first,
        reqwest::Method::GET,
        "/admin/config.php",
        Some("theme=dark"),
    )
    .send()
    .await
    .unwrap();
    assert_eq!(result.text().await.unwrap(), "authenticated");
    first.state.network.revoke();
    let before = peer.seen.lock().unwrap().len();
    let retired = freepbx_request(&first, reqwest::Method::GET, "/admin/config.php", None)
        .send()
        .await
        .unwrap();
    assert!(!retired.status().is_success());
    assert_eq!(peer.seen.lock().unwrap().len(), before);
}

#[tokio::test]
async fn redirect_rotation_reaches_next_hop_and_next_browser_request() {
    let peer = peer(|path, _| match path {
        "/entry" => response(302, Some("/webman/"), &["sid=middle; Path=/; HttpOnly"]),
        "/webman/" => response(200, None, &["sid=final; Path=/; HttpOnly"]),
        _ => response(200, None, &[]),
    })
    .await;
    let proxy = proxy(format!("{}/", peer.origin), cookie_client(Arc::default())).await;
    let jar = Arc::new(reqwest::cookie::Jar::default());
    let browser_url = reqwest::Url::parse(&proxy.base).unwrap();
    jar.add_cookie_str("sid=old; Path=/", &browser_url);
    jar.add_cookie_str("theme=dark; Path=/", &browser_url);
    let browser = cookie_client(jar.clone());
    let result = request(&proxy, &browser, "/entry").await;
    assert_eq!(result.status(), StatusCode::OK);
    let issued: Vec<_> = result
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|value| value.to_str().unwrap())
        .collect();
    assert_eq!(issued.len(), 2);
    assert!(issued[0].starts_with("sid=middle;"));
    assert!(issued[1].starts_with("sid=final;"));
    assert!(issued
        .iter()
        .all(|value| value.contains("HttpOnly") && value.contains("Path=/")));
    assert_eq!(
        request(&proxy, &browser, "/ajax").await.status(),
        StatusCode::OK
    );
    let seen = peer.seen.lock().unwrap();
    assert_eq!(seen.len(), 3);
    assert!(pairs(&seen[0].2).contains(&"sid=old".into()));
    assert!(pairs(&seen[1].2).contains(&"sid=middle".into()));
    assert!(pairs(&seen[2].2).contains(&"sid=final".into()));
    for (_, _, headers) in seen.iter() {
        assert!(pairs(headers).contains(&"theme=dark".into()));
    }
    assert!(!jar
        .cookies(&browser_url)
        .unwrap()
        .to_str()
        .unwrap()
        .contains("sid=old"));
}

#[tokio::test]
async fn deletion_does_not_resurrect_cookie_and_empty_overlay_keeps_native_jar() {
    let peer = peer(|path, _| {
        if path == "/entry" {
            response(302, Some("/done"), &["sid=; Max-Age=0; Path=/"])
        } else {
            response(200, None, &[])
        }
    })
    .await;
    let native_jar = Arc::new(reqwest::cookie::Jar::default());
    let upstream_url = reqwest::Url::parse(&peer.origin).unwrap();
    native_jar.add_cookie_str("sid=old; Path=/", &upstream_url);
    native_jar.add_cookie_str("native_only=keep; Path=/", &upstream_url);
    let proxy = proxy(format!("{}/", peer.origin), cookie_client(native_jar)).await;
    let browser_jar = Arc::new(reqwest::cookie::Jar::default());
    let browser_url = reqwest::Url::parse(&proxy.base).unwrap();
    browser_jar.add_cookie_str("sid=old; Path=/", &browser_url);
    let browser = cookie_client(browser_jar.clone());
    assert_eq!(
        request(&proxy, &browser, "/entry").await.status(),
        StatusCode::OK
    );
    assert_eq!(
        request(&proxy, &browser, "/ajax").await.status(),
        StatusCode::OK
    );
    assert!(browser_jar.cookies(&browser_url).is_none());
    let seen = peer.seen.lock().unwrap();
    assert_eq!(seen.len(), 3);
    for row in &seen[1..] {
        assert_eq!(pairs(&row.2), ["native_only=keep"]);
    }
}

#[tokio::test]
async fn no_initial_browser_cookie_preserves_provider_and_syncs_new_cookie() {
    let peer = peer(|path, _| {
        if path == "/entry" {
            response(302, Some("/done"), &["sid=new; Path=/"])
        } else {
            response(200, None, &[])
        }
    })
    .await;
    let native_jar = Arc::new(reqwest::cookie::Jar::default());
    native_jar.add_cookie_str(
        "native_only=keep; Path=/",
        &reqwest::Url::parse(&peer.origin).unwrap(),
    );
    let proxy = proxy(format!("{}/", peer.origin), cookie_client(native_jar)).await;
    let browser = cookie_client(Arc::default());
    assert_eq!(
        request(&proxy, &browser, "/entry").await.status(),
        StatusCode::OK
    );
    assert_eq!(
        request(&proxy, &browser, "/ajax").await.status(),
        StatusCode::OK
    );
    let seen = peer.seen.lock().unwrap();
    assert_eq!(seen.len(), 3);
    assert_eq!(pairs(&seen[0].2), ["native_only=keep"]);
    assert!(pairs(&seen[1].2).contains(&"native_only=keep".into()));
    assert!(pairs(&seen[1].2).contains(&"sid=new".into()));
    assert!(pairs(&seen[2].2).contains(&"sid=new".into()));
}

#[tokio::test]
async fn scoped_updates_preserve_same_name_paths_and_unrelated_browser_values() {
    let peer = peer(|path, _| match path {
        "/entry" => response(
            302,
            Some("/outside"),
            &[
                "sid=root; Path=/",
                "sid=narrow; Path=/webman/",
                "theme=foreign; Domain=other.invalid; Path=/",
                "theme=secure; Secure; Path=/",
                "theme=wrong-path; Path=/elsewhere/",
            ],
        ),
        "/outside" => response(302, Some("/webman/"), &[]),
        _ => response(200, None, &[]),
    })
    .await;
    // The maintained cookie implementation treats loopback as a secure
    // context. Resolve a synthetic ordinary HTTP authority to the fixture so
    // this specifically exercises Secure-cookie refusal on nonsecure HTTP.
    let address: std::net::SocketAddr = peer.origin.trim_start_matches("http://").parse().unwrap();
    let transport = reqwest::Client::builder()
        .no_proxy()
        .resolve("cookies.fixture.test", address)
        .redirect(reqwest::redirect::Policy::none())
        .cookie_store(true)
        .build()
        .unwrap();
    let proxy = proxy(
        format!("http://cookies.fixture.test:{}/", address.port()),
        transport,
    )
    .await;
    let response = client()
        .get(format!("{}/entry", proxy.base))
        .header("Host", &proxy.state.proxy_authority)
        .header(
            "Cookie",
            "sid=stale; theme=dark; duplicate=one; duplicate=two",
        )
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let seen = peer.seen.lock().unwrap();
    assert_eq!(seen.len(), 3);
    assert_eq!(
        pairs(&seen[1].2),
        ["sid=root", "theme=dark", "duplicate=one", "duplicate=two"]
    );
    assert_eq!(
        pairs(&seen[2].2),
        [
            "sid=narrow",
            "sid=root",
            "theme=dark",
            "duplicate=one",
            "duplicate=two"
        ]
    );
}

#[tokio::test]
async fn default_cookie_path_uses_issuing_redirect_not_browser_entry_path() {
    let peer = peer(|path, _| match path {
        "/entry" => response(302, Some("/login/start"), &[]),
        "/login/start" => response(302, Some("/landing"), &["scoped=one"]),
        _ => response(200, None, &[]),
    })
    .await;
    let proxy = proxy(format!("{}/", peer.origin), cookie_client(Arc::default())).await;
    let browser = cookie_client(Arc::default());
    let result = request(&proxy, &browser, "/entry").await;
    assert_eq!(
        result.headers().get("set-cookie").unwrap(),
        "scoped=one; Path=/login"
    );
    request(&proxy, &browser, "/outside").await;
    request(&proxy, &browser, "/login/ajax").await;
    let seen = peer.seen.lock().unwrap();
    assert_eq!(seen.len(), 5);
    assert!(pairs(&seen[2].2).is_empty());
    assert!(pairs(&seen[3].2).is_empty());
    assert_eq!(pairs(&seen[4].2), ["scoped=one"]);
}

#[tokio::test]
async fn digest_challenge_cookie_rotations_apply_before_each_bounded_retry() {
    let count = Arc::new(AtomicU64::new(0));
    let calls = count.clone();
    let peer = peer(move |_, headers| {
        let n = calls.fetch_add(1, Ordering::SeqCst);
        if n < 2 {
            Response::builder().status(401)
                .header("WWW-Authenticate", format!("Digest realm=\"fixture\", nonce=\"nonce-{n}\", algorithm=SHA-256, qop=\"auth\", stale={}", n == 1))
                .header("Set-Cookie", format!("sid=challenge-{n}; Path=/"))
                .body(Body::empty()).unwrap()
        } else {
            assert!(headers.get("authorization").unwrap().to_str().unwrap().starts_with("Digest "));
            response(200, None, &[])
        }
    }).await;
    let proxy = proxy_with_mode(
        format!("{}/", peer.origin),
        cookie_client(Arc::default()),
        UpstreamAuthMode::Digest,
    )
    .await;
    *proxy.state.username.write().unwrap() = "synthetic-user".into();
    *proxy.state.password.write().unwrap() = "synthetic-password".into();
    let response = client()
        .get(format!("{}/login", proxy.base))
        .header("Host", &proxy.state.proxy_authority)
        .header("Cookie", "sid=old; theme=dark")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers().get_all("set-cookie").iter().count(), 2);
    let seen = peer.seen.lock().unwrap();
    assert_eq!(seen.len(), 3);
    assert_eq!(pairs(&seen[1].2), ["sid=challenge-0", "theme=dark"]);
    assert_eq!(pairs(&seen[2].2), ["sid=challenge-1", "theme=dark"]);
}

#[tokio::test]
async fn foreign_redirect_evidence_is_actual_response_after_internal_hop_without_cookie_leak() {
    let foreign = peer(|_, _| response(200, None, &[])).await;
    let destination = format!("{}/foreign", foreign.origin);
    let next = destination.clone();
    let peer = peer(move |path, _| {
        if path == "/start" {
            response(303, Some("/internal"), &["sid=rotated; Path=/"])
        } else {
            response(302, Some(&next), &["sid=foreign-stage; Path=/"])
        }
    })
    .await;
    let proxy = proxy(format!("{}/", peer.origin), cookie_client(Arc::default())).await;
    let result = upstream::send(
        &proxy.state,
        &reqwest::Method::POST,
        &format!("{}/start", peer.origin),
        &[("Cookie".into(), "sid=old".into())],
        b"synthetic",
    )
    .await;
    let Err(upstream::UpstreamError::CrossOriginRedirect(redirect)) = result else {
        panic!("expected reviewed foreign redirect evidence");
    };
    assert_eq!(redirect.destination.as_str(), destination);
    assert_eq!(
        redirect.response_url.as_str(),
        format!("{}/internal", peer.origin)
    );
    assert_eq!(redirect.status, 302);
    assert_eq!(redirect.method, reqwest::Method::GET);
    assert_eq!(redirect.same_origin_redirects, 1);
    assert_eq!(foreign.seen.lock().unwrap().len(), 0);
    assert_eq!(peer.seen.lock().unwrap().len(), 2);
    let response = request(&proxy, &client(), "/start").await;
    assert!(response.headers().get("set-cookie").is_none());
    assert_eq!(foreign.seen.lock().unwrap().len(), 0);
}

#[tokio::test]
async fn bounded_cookie_updates_refuse_before_next_request_without_exposing_values() {
    let peer = peer(|_, _| {
        let mut response = response(302, Some("/next"), &[]);
        for i in 0..129 {
            response.headers_mut().append(
                "set-cookie",
                format!("synthetic-{i}=private-value; Path=/")
                    .parse()
                    .unwrap(),
            );
        }
        response
    })
    .await;
    let proxy = proxy(format!("{}/", peer.origin), cookie_client(Arc::default())).await;
    let response = request(&proxy, &client(), "/entry").await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(response.headers().get("set-cookie").is_none());
    assert!(!response.text().await.unwrap().contains("private-value"));
    assert_eq!(peer.seen.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn validated_domain_cookies_project_to_one_proxy_host_and_survive_browser_roundtrip() {
    let peer = peer(|path, _| match path {
        "/entry" => response(
            302,
            Some("/done"),
            &[
                "parent=one; Domain=fixture.test; Path=/; HttpOnly; SameSite=Lax",
                "rejected=foreign; Domain=other.invalid; Path=/",
            ],
        ),
        "/done" => response(
            200,
            None,
            &[
                "host=two; Domain=login.fixture.test; Path=/",
                "invalid=foreign; Domain=other.invalid; Path=/",
                "__Host-invalid=private; Domain=login.fixture.test; Path=/; Secure",
                "__Secure-invalid=private; Path=/",
            ],
        ),
        _ => response(200, None, &[]),
    })
    .await;
    let address: std::net::SocketAddr = peer.origin.trim_start_matches("http://").parse().unwrap();
    let upstream = reqwest::Client::builder()
        .no_proxy()
        .resolve("login.fixture.test", address)
        .redirect(reqwest::redirect::Policy::none())
        .cookie_store(true)
        .build()
        .unwrap();
    let proxy = proxy(
        format!("http://login.fixture.test:{}/", address.port()),
        upstream,
    )
    .await;
    let browser_jar = Arc::new(reqwest::cookie::Jar::default());
    let local_address = proxy.base.trim_start_matches("http://").parse().unwrap();
    let local_url = reqwest::Url::parse(&proxy.state.proxy_origin).unwrap();
    let browser = reqwest::Client::builder()
        .no_proxy()
        .resolve(local_url.host_str().unwrap(), local_address)
        .redirect(reqwest::redirect::Policy::none())
        .cookie_provider(browser_jar.clone())
        .build()
        .unwrap();
    let result = browser
        .get(format!("{}/entry", proxy.state.proxy_origin))
        .send()
        .await
        .unwrap();
    assert_eq!(result.status(), StatusCode::OK);
    let values: Vec<_> = result
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|value| value.to_str().unwrap())
        .collect();
    assert_eq!(values.len(), 2);
    assert!(values[0].starts_with("parent=one;"));
    assert!(values[0].contains("HttpOnly") && values[0].contains("SameSite=Lax"));
    assert!(values[1].starts_with("host=two;"));
    assert!(values
        .iter()
        .all(|value| !value.to_ascii_lowercase().contains("domain=")));
    browser
        .get(format!("{}/ajax", proxy.state.proxy_origin))
        .send()
        .await
        .unwrap();
    let seen = peer.seen.lock().unwrap();
    assert_eq!(seen.len(), 3);
    let ajax_cookies = pairs(&seen[2].2);
    assert!(ajax_cookies.contains(&"parent=one".into()));
    assert!(ajax_cookies.contains(&"host=two".into()));
    assert!(ajax_cookies
        .iter()
        .all(|pair| !pair.contains("foreign") && !pair.contains("private")));
    assert!(browser_jar
        .cookies(&reqwest::Url::parse("http://another-proxy.localhost/ajax").unwrap())
        .is_none());
}

#[tokio::test]
async fn changed_duplicate_browser_scopes_stop_without_discarding_or_replaying_values() {
    let peer = peer(|_, _| response(302, Some("/webman/end"), &["sid=new-root; Path=/"])).await;
    let proxy = proxy(format!("{}/", peer.origin), cookie_client(Arc::default())).await;
    let response = client()
        .get(format!("{}/webman/start", proxy.base))
        .header("Host", &proxy.state.proxy_authority)
        .header("Cookie", "sid=narrow; sid=old-root; theme=dark")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(response.headers().get("set-cookie").is_none());
    assert!(response.headers().get("location").is_none());
    let body = response.text().await.unwrap();
    assert!(body.contains("Clear session cookies and retry"));
    assert!(!body.contains("sid=") && !body.contains("old-root"));
    let seen = peer.seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(
        pairs(&seen[0].2),
        ["sid=narrow", "sid=old-root", "theme=dark"]
    );
}

#[tokio::test]
async fn ordinary_auth_errors_keep_status_and_synchronize_valid_cookie_changes() {
    for status in [401, 403] {
        let peer = peer(move |path, _| {
            if path == "/entry" {
                response(302, Some("/login/failed"), &["sid=middle; Path=/"])
            } else {
                response(
                    status,
                    None,
                    &["sid=; Max-Age=0; Path=/", "csrf=next; HttpOnly"],
                )
            }
        })
        .await;
        let proxy = proxy(format!("{}/", peer.origin), cookie_client(Arc::default())).await;
        let browser_jar = Arc::new(reqwest::cookie::Jar::default());
        let url = reqwest::Url::parse(&proxy.base).unwrap();
        browser_jar.add_cookie_str("sid=old; Path=/", &url);
        let browser = cookie_client(browser_jar.clone());
        let result = request(&proxy, &browser, "/entry").await;
        assert_eq!(result.status().as_u16(), status);
        assert_eq!(result.headers().get_all("set-cookie").iter().count(), 3);
        assert!(browser_jar.cookies(&url).is_none());
        let login = reqwest::Url::parse(&format!("{}/login/ajax", proxy.base)).unwrap();
        assert_eq!(browser_jar.cookies(&login).unwrap(), "csrf=next");
        assert_eq!(peer.seen.lock().unwrap().len(), 2);
    }
}
