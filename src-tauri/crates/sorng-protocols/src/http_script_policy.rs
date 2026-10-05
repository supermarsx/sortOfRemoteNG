//! Explicit connection opt-in only. The mandatory proxy CSP is still intersected
//! with retained upstream meta policies: '*' here never enables direct egress.
//! Upstream header handling stays unchanged, including iframe-embedding repairs.
use super::{cloudflare_challenge, HttpProxyPolicy};

fn directive_name(value: &str) -> &str {
    value.split_ascii_whitespace().next().unwrap_or("")
}

pub(super) fn override_csp(value: &str) -> String {
    // HTTP can combine multiple policies with commas. Each policy must receive
    // the script override; preserving just the first would still block scripts.
    value
        .split(',')
        .map(|policy| {
            let directives: Vec<_> = policy
                .split(';')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .collect();
            let first = |name: &str| {
                directives
                    .iter()
                    .find(|part| directive_name(part).eq_ignore_ascii_case(name))
                    .copied()
            };
            // script-src is also a worker fallback. Preserve its old meaning
            // rather than accidentally allowing blob/network workers here.
            let worker = if first("worker-src").is_none() && first("child-src").is_none() {
                first("script-src")
                    .or_else(|| first("default-src"))
                    .map(|source| format!("worker-src{}", &source[directive_name(source).len()..]))
            } else {
                None
            };
            let mut kept: Vec<String> = directives
                .into_iter()
                .filter(|part| {
                    !["script-src", "script-src-elem", "script-src-attr"]
                        .iter()
                        .any(|name| directive_name(part).eq_ignore_ascii_case(name))
                })
                .map(str::to_owned)
                .collect();
            if let Some(worker) = worker {
                kept.push(worker);
            }
            kept.push("script-src 'self' * data: blob: 'unsafe-inline' 'unsafe-eval'".into());
            kept.join("; ")
        })
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allow_all_scripts_csp_preserves_other_directives_and_worker_fallbacks() {
        let rewritten = override_csp("default-src 'none'; SCRIPT-SRC 'nonce-private' 'strict-dynamic'; script-src-elem 'sha256-private'; script-src-attr 'none'; sandbox allow-scripts; require-trusted-types-for 'script'; style-src 'nonce-style'; connect-src 'none', default-src 'self'; img-src data:");
        assert_eq!(
            rewritten
                .matches("script-src 'self' * data: blob: 'unsafe-inline' 'unsafe-eval'")
                .count(),
            2
        );
        for directive in [
            "sandbox allow-scripts",
            "require-trusted-types-for 'script'",
            "style-src 'nonce-style'",
            "connect-src 'none'",
            "worker-src 'nonce-private' 'strict-dynamic'",
            "worker-src 'self'",
            "img-src data:",
        ] {
            assert!(rewritten.contains(directive), "{rewritten}");
        }
        assert!(!rewritten.contains("script-src-elem") && !rewritten.contains("script-src-attr"));
        assert_eq!(
            override_csp("child-src 'none'; script-src *")
                .matches("worker-src")
                .count(),
            0
        );
        assert_eq!(
            override_csp("worker-src 'none'; script-src *")
                .matches("worker-src")
                .count(),
            1
        );
    }

    #[test]
    fn allow_all_scripts_meta_is_tag_aware_entity_safe_and_opt_in_only() {
        let html = r#"<!-- <meta http-equiv="Content-Security-Policy" content="script-src 'none'"> --><script>var fake = '<meta http-equiv="Content-Security-Policy" content="script-src none">';</script><meta http-equiv="content-security-&#112;olicy" content='default-src &#39;none&#39;; script-src &#39;nonce-old&#39;; style-src &#39;self&#39;; sandbox'><meta http-equiv=Content-Security-Policy content=script-src><meta name=description content="script-src 'none'">"#;
        assert_eq!(rewrite_meta(html, &HttpProxyPolicy::default()), html);
        let enabled = HttpProxyPolicy {
            allow_all_scripts: true,
            ..Default::default()
        };
        let rewritten = rewrite_meta(html, &enabled);
        assert!(rewritten.starts_with(
            "<!-- <meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'none'\"> -->"
        ));
        assert!(rewritten.contains("var fake = '<meta http-equiv=\"Content-Security-Policy\" content=\"script-src none\">';"));
        assert!(rewritten.contains("style-src &#39;self&#39;; sandbox"));
        assert!(rewritten.contains("content=\"worker-src; script-src &#39;self&#39; * data: blob:"));
        assert!(rewritten.contains("<meta name=description content=\"script-src 'none'\">"));
        for policy in [
            HttpProxyPolicy {
                same_origin_only: true,
                ..enabled.clone()
            },
            HttpProxyPolicy {
                page_scripts: super::super::PageScripts::InlineOnly,
                ..enabled
            },
        ] {
            assert_eq!(rewrite_meta(html, &policy), html);
        }
    }

    #[test]
    fn allow_all_scripts_meta_preserves_unquoted_urls_and_ignores_duplicate_equiv() {
        let policy = HttpProxyPolicy {
            allow_all_scripts: true,
            ..Default::default()
        };
        let inert = r#"<meta http-equiv=refresh http-equiv=content-security-policy content="script-src none">"#;
        assert_eq!(rewrite_meta(inert, &policy), inert);
        let html = "<meta http-equiv=content-security-policy content=default-src&#32;https://static.example/path>";
        let rewritten = rewrite_meta(html, &policy);
        assert!(rewritten.contains("content=\"default-src https://static.example/path; worker-src https://static.example/path; script-src"), "{rewritten}");
        assert!(rewritten.ends_with("&#39;unsafe-eval&#39;\">"));
    }
}

pub(super) fn rewrite_meta(html: &str, policy: &HttpProxyPolicy) -> String {
    if !policy.allows_all_scripts() {
        return html.into();
    }
    cloudflare_challenge::rewrite_meta_csp_with(html, &|value, quote| {
        let decoded = cloudflare_challenge::decode_entities(value);
        let rewritten = override_csp(&decoded)
            .replace('&', "&amp;")
            .replace('"', "&quot;")
            .replace('\'', "&#39;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        // The traversal replaces only the attribute value, keeping its original
        // quotes. Unquoted attributes must become quoted before adding spaces.
        Some(if quote.is_none() {
            format!("\"{rewritten}\"")
        } else {
            rewritten
        })
    })
}
