use super::*;
use crate::http::{
    tactical_rmm::{TacticalRmmApiRoute, PTISP_SOURCE},
    BrowserCompatibility, HttpProxyPolicy, PageScripts, ReviewedApplicationProfile,
};

fn script(route: Option<&TacticalRmmApiRoute>, source: &str, page_scripts: PageScripts) -> String {
    readiness_script(
        "ptisp-tour-fixture",
        None, // Manual login needs no auto-login nonce or navigation token.
        1,
        ReadinessNetworkContext {
            source_origin: source,
            proxy_origin: "http://p0123456789abcdef0123456789abcdef.localhost:43123",
            policy: &HttpProxyPolicy {
                page_scripts,
                ..Default::default()
            },
            tactical_rmm_api: route,
            google: None,
            popup_parent_sequence: None,
            tactical_mesh: None,
            cloudflare_challenge: None,
            exchange_cookies: false,
            exchange_owa: false,
            browser_compatibility: BrowserCompatibility::default(),
        },
    )
    .unwrap()
}

fn has_tour(script: &str) -> bool {
    script.contains("__sorng_ptisp_tour_v1")
}

#[test]
fn ptisp_tour_requires_reviewed_profile_even_on_exact_origin() {
    for profile in [
        None,
        Some(ReviewedApplicationProfile::TacticalRmm),
        Some(ReviewedApplicationProfile::GoogleHosted),
        Some(ReviewedApplicationProfile::AdobeAdminConsole),
        Some(ReviewedApplicationProfile::Chatgpt),
        Some(ReviewedApplicationProfile::Claude),
        Some(ReviewedApplicationProfile::Instagram),
        Some(ReviewedApplicationProfile::Canva),
        Some(ReviewedApplicationProfile::Cloudflare),
        Some(ReviewedApplicationProfile::Porkbun),
        Some(ReviewedApplicationProfile::Cpanel),
        Some(ReviewedApplicationProfile::Freepbx),
        Some(ReviewedApplicationProfile::ExchangeEcp),
        Some(ReviewedApplicationProfile::ExchangeOwa),
        Some(ReviewedApplicationProfile::Ptisp),
    ] {
        let route = TacticalRmmApiRoute::new(
            profile,
            &reqwest::Url::parse(PTISP_SOURCE).unwrap(),
            None,
            reqwest::Client::new(),
        );
        let result = script(route.as_ref(), PTISP_SOURCE, PageScripts::Allow);
        assert_eq!(
            has_tour(&result),
            profile == Some(ReviewedApplicationProfile::Ptisp)
        );
        assert!(result.contains("proxy_dom_ready"));
    }
}

#[test]
fn ptisp_tour_requires_current_exact_origin_and_unblocked_page_scripts() {
    let route = TacticalRmmApiRoute::new(
        Some(ReviewedApplicationProfile::Ptisp),
        &reqwest::Url::parse(PTISP_SOURCE).unwrap(),
        None,
        reqwest::Client::new(),
    )
    .unwrap();
    assert!(route.is_ptisp());
    for source in [
        PTISP_SOURCE,
        "http://my.ptisp.pt",
        "https://my.ptisp.pt:8443",
        "https://my.ptisp.pt.evil.test",
        "https://my.ptisp.pt.",
        "https://api3.ptisp.pt",
        "https://other.ptisp.pt",
        "https://user:secret@my.ptisp.pt",
    ] {
        for page_scripts in [
            PageScripts::Allow,
            PageScripts::InlineOnly,
            PageScripts::Block,
        ] {
            let result = script(Some(&route), source, page_scripts);
            assert_eq!(
                has_tour(&result),
                source == PTISP_SOURCE && page_scripts != PageScripts::Block,
                "source={source}, page_scripts={page_scripts:?}"
            );
            assert!(result.contains("proxy_dom_ready"));
        }
    }
    let result = script(Some(&route), PTISP_SOURCE, PageScripts::Allow);
    assert!(result.contains(include_str!("ptisp_tour_client.js")));
    assert_eq!(result.matches("<script>").count(), 1);
    assert_eq!(result.matches("</script>").count(), 1);
}
