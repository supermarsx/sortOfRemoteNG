//! Browser-visible directory canonicalization through the real protected proxy.
use super::*;

struct DirectoryPeer {
    origin: String,
    seen: Arc<std::sync::Mutex<Vec<String>>>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for DirectoryPeer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn directory_peer(status: u16, destination: &str) -> DirectoryPeer {
    directory_peer_at(status, destination, "/admin", false).await
}

async fn directory_peer_at(
    status: u16,
    destination: &str,
    entry: &str,
    loop_back: bool,
) -> DirectoryPeer {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let destination = destination.replace("{origin}", &origin);
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured = seen.clone();
    let entry = entry.to_string();
    let router = axum::Router::new().fallback(move |request: axum::extract::Request| {
        let destination = destination.clone();
        let seen = captured.clone();
        let entry = entry.clone();
        async move {
            seen.lock().unwrap().push(request.uri().to_string());
            match request.uri().path() {
                path if path == entry => Response::builder()
                    .status(status)
                    .header("Location", destination)
                    .header("Set-Cookie", "sid=directory; HttpOnly")
                    .body(Body::empty())
                    .unwrap(),
                path if path == format!("{entry}/") && loop_back => Response::builder()
                    .status(302)
                    .header("Location", &entry)
                    .body(Body::empty())
                    .unwrap(),
                path if path == format!("{entry}/") => Response::builder()
                    .header("Content-Type", "text/html")
                    .body(Body::from(concat!(
                        "<!doctype html><html><head>",
                        "<link rel=stylesheet href=\"assets/css/bootstrap.css\">",
                        "<script src=\"assets/js/jquery.js\"></script></head>",
                        "<body><img src=\"images/tango.png\"></body></html>"
                    )))
                    .unwrap(),
                path if [
                    "assets/css/bootstrap.css",
                    "assets/js/jquery.js",
                    "images/tango.png",
                ]
                .iter()
                .any(|asset| path == format!("{entry}/{asset}")) =>
                {
                    Response::new(Body::from("asset"))
                }
                _ => Response::builder().status(404).body(Body::empty()).unwrap(),
            }
        }
    });
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    DirectoryPeer { origin, seen, task }
}

async fn browser_request(
    proxy: &FixtureProxy,
    method: reqwest::Method,
    path: &str,
) -> reqwest::Response {
    client()
        .request(method, format!("{}{path}", proxy.base))
        .header("Host", &proxy.state.proxy_authority)
        .header("Sec-Fetch-Dest", "iframe")
        .header("Sec-Fetch-Mode", "navigate")
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn freepbx_directory_redirect_keeps_relative_assets_on_the_proxy_under_admin() {
    let peer = directory_peer(301, "{origin}/admin/").await;
    let proxy = proxy(format!("{}/", peer.origin), client()).await;
    let response = browser_request(&proxy, reqwest::Method::GET, "/admin").await;
    assert_eq!(response.status(), 301);
    let location = response.headers()["location"].to_str().unwrap();
    assert_eq!(location, format!("{}/admin/", proxy.state.proxy_origin));
    assert!(response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .contains("Path=/"));
    assert_eq!(*peer.seen.lock().unwrap(), ["/admin"]);

    let base = reqwest::Url::parse(location).unwrap();
    let html = browser_request(&proxy, reqwest::Method::GET, base.path())
        .await
        .text()
        .await
        .unwrap();
    for asset in [
        "assets/css/bootstrap.css",
        "assets/js/jquery.js",
        "images/tango.png",
    ] {
        assert!(html.contains(asset));
        let url = base.join(asset).unwrap();
        assert_eq!(url.origin().ascii_serialization(), proxy.state.proxy_origin);
        assert!(url.path().starts_with("/admin/"));
        assert_eq!(
            browser_request(&proxy, reqwest::Method::GET, url.path())
                .await
                .status(),
            200
        );
    }
    assert_eq!(
        *peer.seen.lock().unwrap(),
        [
            "/admin",
            "/admin/",
            "/admin/assets/css/bootstrap.css",
            "/admin/assets/js/jquery.js",
            "/admin/images/tango.png",
        ]
    );
}

#[tokio::test]
async fn directory_redirect_preserves_safe_methods_statuses_and_query() {
    for status in [301, 302, 303, 307, 308] {
        for method in [reqwest::Method::GET, reqwest::Method::HEAD] {
            let peer = directory_peer(status, "/admin/?display=index").await;
            let proxy = proxy(format!("{}/", peer.origin), client()).await;
            let response = browser_request(&proxy, method, "/admin?display=index").await;
            assert_eq!(response.status().as_u16(), status);
            assert_eq!(
                response.headers()["location"],
                format!("{}/admin/?display=index", proxy.state.proxy_origin)
            );
            assert_eq!(peer.seen.lock().unwrap().len(), 1);
        }
    }
}

#[tokio::test]
async fn post_and_noncanonical_redirects_still_follow_native_policy() {
    for (method, destination, expected_status) in [
        (reqwest::Method::POST, "/admin/", 200),
        (reqwest::Method::GET, "/admin/?changed=1", 200),
        (reqwest::Method::GET, "/different", 404),
        (
            reqwest::Method::GET,
            "http://unapproved.invalid/admin/",
            403,
        ),
        (reqwest::Method::GET, "//unapproved.invalid/admin/", 403),
    ] {
        let peer = directory_peer(302, destination).await;
        let proxy = proxy(format!("{}/", peer.origin), client()).await;
        let response = browser_request(&proxy, method, "/admin").await;
        assert_eq!(response.status().as_u16(), expected_status, "{destination}");
        assert!(!response.headers().contains_key("location"));
        if destination.contains("unapproved.invalid") {
            assert_eq!(*peer.seen.lock().unwrap(), ["/admin"]);
        }
    }
}

#[tokio::test]
async fn directory_redirect_preserves_nested_reverse_proxy_prefix() {
    let entry = "/sites/pbx/admin";
    let peer = directory_peer_at(308, "/sites/pbx/admin/?display=index", entry, false).await;
    // The proxy state stores the upstream origin; the browser route carries
    // the reverse-proxy prefix (the handler concatenates these two values).
    let proxy = proxy(format!("{}/", peer.origin), client()).await;
    let response = browser_request(
        &proxy,
        reqwest::Method::GET,
        &format!("{entry}?display=index"),
    )
    .await;
    assert_eq!(response.status(), 308);
    let base = reqwest::Url::parse(response.headers()["location"].to_str().unwrap()).unwrap();
    assert_eq!(
        base.as_str(),
        format!("{}{entry}/?display=index", proxy.state.proxy_origin)
    );
    for asset in [
        "assets/css/bootstrap.css",
        "assets/js/jquery.js",
        "images/tango.png",
    ] {
        let resolved = base.join(asset).unwrap();
        assert_eq!(resolved.path(), format!("{entry}/{asset}"));
        assert_eq!(resolved.origin(), base.origin());
        assert_eq!(
            browser_request(&proxy, reqwest::Method::GET, resolved.path())
                .await
                .status(),
            200
        );
    }
}

#[tokio::test]
async fn directory_redirect_does_not_turn_a_same_origin_loop_into_browser_redirects() {
    let peer = directory_peer_at(301, "/admin/", "/admin", true).await;
    let proxy = proxy(format!("{}/", peer.origin), client()).await;
    let first = browser_request(&proxy, reqwest::Method::GET, "/admin").await;
    assert_eq!(first.status(), 301);
    let next = reqwest::Url::parse(first.headers()["location"].to_str().unwrap()).unwrap();
    let terminal = browser_request(&proxy, reqwest::Method::GET, next.path()).await;
    assert_eq!(terminal.status(), 508);
    assert!(!terminal.headers().contains_key("location"));
    // One browser-visible canonicalization, then the existing native hop cap.
    assert_eq!(peer.seen.lock().unwrap().len(), 12);
}
