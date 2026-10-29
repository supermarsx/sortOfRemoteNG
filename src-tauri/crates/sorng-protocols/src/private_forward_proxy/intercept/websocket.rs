//! HTTP/1.1 WebSocket upgrades inside an intercepted tunnel or on a plain
//! proxy connection: a dedicated, trust-evaluated upstream HTTP/1.1
//! connection (never pooled), then bytes spliced both ways after `101`.
//! Never cached; hooks see heads only.

use super::forward::{
    has_connection_token, host_text, status_response, strip_hop_by_hop, upstream_uri, Exchange,
};
use super::hooks::ExchangeCtx;
use super::server::ConnectionTasks;
use super::ProxyBody;
use hyper::body::Incoming;
use hyper::http::{header, HeaderValue, Method, Request, Response, StatusCode, Uri, Version};
use hyper_util::rt::TokioIo;

const RELAY_BUFFER: usize = 32 * 1024;

fn mark_upgrade(headers: &mut hyper::http::HeaderMap) {
    headers.insert(header::CONNECTION, HeaderValue::from_static("upgrade"));
    headers.insert(header::UPGRADE, HeaderValue::from_static("websocket"));
}

pub(crate) async fn upgrade(
    exchange: &Exchange,
    ctx: ExchangeCtx,
    mut request: Request<Incoming>,
    tasks: &ConnectionTasks,
) -> Response<ProxyBody> {
    if request.method() != Method::GET || request.version() != Version::HTTP_11 {
        return status_response(StatusCode::BAD_REQUEST);
    }
    let client_upgrade = hyper::upgrade::on(&mut request);
    let (mut parts, body) = request.into_parts();
    drop(body);
    let path = parts.uri.path_and_query().map_or("/", |p| p.as_str());
    let (Ok(target), Some(absolute)) = (path.parse::<Uri>(), upstream_uri(&ctx, &parts.uri)) else {
        return status_response(StatusCode::BAD_REQUEST);
    };
    // Hooks see the same absolute URI as for ordinary exchanges.
    parts.uri = absolute;
    strip_hop_by_hop(&mut parts.headers);
    let Ok(host) = HeaderValue::from_str(&host_text(&ctx.authority, ctx.secure)) else {
        return status_response(StatusCode::BAD_REQUEST);
    };
    parts.headers.insert(header::HOST, host);
    if let Err(response) = exchange.request_hooks(&ctx, &mut parts) {
        return *response;
    }
    // The dedicated upstream connection speaks HTTP/1.1 origin-form.
    parts.uri = target;
    parts.version = Version::HTTP_11;
    mark_upgrade(&mut parts.headers);
    parts.headers.remove(header::CONTENT_LENGTH);

    let deadline = exchange.response_head_timeout();
    let connected = tokio::time::timeout(
        deadline,
        exchange.pool.connect_upgrade(&ctx.authority, ctx.secure),
    )
    .await;
    let (mut sender, _admission) = match connected {
        Ok(Ok(connected)) => connected,
        Ok(Err(failure)) => return exchange.upstream_failure(failure),
        Err(_) => return exchange.head_timeout(),
    };
    let sent = tokio::time::timeout(
        deadline,
        sender.send_request(Request::from_parts(parts, super::forward::empty_body())),
    )
    .await;
    let mut response = match sent {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => {
            return exchange.upstream_failure(super::upstream::UpstreamFailure::RouteFailed)
        }
        Err(_) => return exchange.head_timeout(),
    };
    if response.status() != StatusCode::SWITCHING_PROTOCOLS {
        // A refusal (e.g. 403) is an ordinary response to serve.
        return match exchange.downstream(response) {
            Ok(response) => exchange.serve(&ctx, response),
            Err(failure) => *failure,
        };
    }
    if !response
        .headers()
        .get(header::UPGRADE)
        .is_some_and(|v| v.as_bytes().eq_ignore_ascii_case(b"websocket"))
        || !has_connection_token(response.headers(), "upgrade")
    {
        return exchange.upstream_failure(super::upstream::UpstreamFailure::RouteFailed);
    }
    let upstream_upgrade = hyper::upgrade::on(&mut response);
    let (mut head, body) = response.into_parts();
    drop(body);
    strip_hop_by_hop(&mut head.headers);
    head.headers.remove(header::CONTENT_LENGTH);
    let served = exchange.serve(
        &ctx,
        Response::from_parts(head, super::forward::empty_body()),
    );
    if served.status() != StatusCode::SWITCHING_PROTOCOLS {
        // A response hook failed; the upstream upgrade is dropped unused.
        return served;
    }
    let (mut head, body) = served.into_parts();
    mark_upgrade(&mut head.headers);
    tasks.spawn(async move {
        if let (Ok(client), Ok(upstream)) = tokio::join!(client_upgrade, upstream_upgrade) {
            let _ = tokio::io::copy_bidirectional_with_sizes(
                &mut TokioIo::new(client),
                &mut TokioIo::new(upstream),
                RELAY_BUFFER,
                RELAY_BUFFER,
            )
            .await;
        }
    });
    Response::from_parts(head, body)
}
