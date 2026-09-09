//! Passive, pinned page API asset. Served only inside the already host/origin
//! guarded mediator. This route never forwards, fetches, reads files, or accepts
//! page-provided code/commands; explicit parent consent controls API activation.
use axum::{
    body::Body,
    http::{Method, Response, StatusCode},
};

pub(super) const DARKREADER_PATH: &str = "/__sortofremoteng_web_darkreader_v1.js";
const DARKREADER: &str = include_str!("vendor/darkreader/darkreader.js");

pub(super) fn asset(method: &Method) -> Response<Body> {
    let allowed = matches!(*method, Method::GET | Method::HEAD);
    Response::builder()
        .status(if allowed {
            StatusCode::OK
        } else {
            StatusCode::METHOD_NOT_ALLOWED
        })
        .header("Content-Type", "application/javascript; charset=utf-8")
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "private, max-age=31536000, immutable")
        .header("Cross-Origin-Resource-Policy", "same-origin")
        .body(if *method == Method::GET {
            Body::from(DARKREADER)
        } else {
            Body::empty()
        })
        .expect("static local asset response")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn only_get_receives_pinned_api_source() {
        let result = asset(&Method::GET);
        assert_eq!(result.status(), StatusCode::OK);
        assert_eq!(
            result.headers()["Cross-Origin-Resource-Policy"],
            "same-origin"
        );
        let bytes = axum::body::to_bytes(result.into_body(), 400_000)
            .await
            .unwrap();
        assert_eq!(bytes.as_ref(), DARKREADER.as_bytes());
        for method in [Method::HEAD, Method::POST, Method::DELETE] {
            let result = asset(&method);
            assert_eq!(
                result.status(),
                if method == Method::HEAD {
                    StatusCode::OK
                } else {
                    StatusCode::METHOD_NOT_ALLOWED
                }
            );
            assert!(axum::body::to_bytes(result.into_body(), 1)
                .await
                .unwrap()
                .is_empty());
        }
    }
    #[test]
    fn vendored_api_matches_reviewed_official_bytes() {
        use sha2::{Digest, Sha256};
        assert_eq!(
            format!("{:x}", Sha256::digest(DARKREADER.as_bytes())),
            "bc589aeb7cc9aabd9fc8a20594d364666b72fec9620fe6304a5521b4e545f3c1"
        );
        assert!(include_str!("vendor/darkreader/LICENSE").contains("MIT"));
    }
}
