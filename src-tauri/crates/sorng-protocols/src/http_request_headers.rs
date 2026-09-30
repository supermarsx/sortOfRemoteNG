//! Request-header predicates shared by native proxy forwarding paths.
//!
//! Origin/referrer mapping, native cookie jars, and internal credential-mode
//! selection remain in their existing owners.

/// Whether a field belongs to the incoming connection (RFC 9110, 7.6.1).
/// Pass every Connection field value, including repeated field lines.
/// Inspect raw bytes so an invalid option cannot hide valid adjacent options.
/// Apply before constructing the outgoing WebSocket handshake; its own Upgrade
/// and Connection fields must be generated after filtering incoming headers.
pub(crate) fn is_hop_by_hop<'a>(
    name: &str,
    connection_values: impl IntoIterator<Item = &'a [u8]>,
) -> bool {
    const HOP_HEADERS: &[&str] = &[
        "connection",
        "keep-alive",
        "proxy-connection",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ];
    HOP_HEADERS
        .iter()
        .any(|header| name.eq_ignore_ascii_case(header))
        || connection_values.into_iter().any(|value| {
            value.split(|byte| *byte == b',').any(|option| {
                let option = option.trim_ascii();
                !option.is_empty() && option.eq_ignore_ascii_case(name.as_bytes())
            })
        })
}

/// The challenge alias's closed browser-header set. Forward only received
/// values, unchanged; never synthesize a UA or hints from another identity.
/// Enumerate known UA hints rather than allowing arbitrary sec-* extensions.
/// Hop-by-hop filtering still takes precedence over this allowlist.
pub(crate) fn is_cloudflare_browser_header(name: &str) -> bool {
    const ALLOWED: &[&str] = &[
        "accept",
        "accept-language",
        "content-type",
        "user-agent",
        "sec-ch-ua",
        "sec-ch-ua-mobile",
        "sec-ch-ua-platform",
        "sec-ch-ua-arch",
        "sec-ch-ua-bitness",
        "sec-ch-ua-form-factors",
        // Preserve a legacy hint if the actual WebView still sends it.
        "sec-ch-ua-full-version",
        "sec-ch-ua-full-version-list",
        "sec-ch-ua-model",
        "sec-ch-ua-platform-version",
        "sec-ch-ua-wow64",
        "access-control-request-method",
        "access-control-request-headers",
    ];
    ALLOWED
        .iter()
        .any(|header| name.eq_ignore_ascii_case(header))
}
