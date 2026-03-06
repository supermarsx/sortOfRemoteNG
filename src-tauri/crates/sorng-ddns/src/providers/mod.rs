//! # DDNS Providers
//!
//! Individual provider implementations for updating DNS records.

pub mod afraid;
pub mod changeip;
pub mod cloudflare;
pub mod custom;
pub mod dnspod;
pub mod duckdns;
pub mod dynu;
pub mod gandi;
pub mod godaddy;
pub mod google_domains;
pub mod hurricane;
pub mod namecheap;
pub mod noip;
pub mod ovh;
pub mod porkbun;
pub mod ydns;

use crate::types::*;

/// Trait that all DDNS providers implement.
pub trait DdnsProviderImpl: Send + Sync {
    /// Update the DNS record with a new IP address.
    fn update(
        &self,
        profile: &DdnsProfile,
        ip: &str,
        ipv6: Option<&str>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<DdnsUpdateResult, String>> + Send + '_>>;
}

/// Dispatch an update to the correct provider implementation.
pub async fn dispatch_update(
    profile: &DdnsProfile,
    ip: &str,
    ipv6: Option<&str>,
) -> Result<DdnsUpdateResult, String> {
    match &profile.provider {
        DdnsProvider::Cloudflare => cloudflare::update(profile, ip, ipv6).await,
        DdnsProvider::NoIp => noip::update(profile, ip).await,
        DdnsProvider::DuckDns => duckdns::update(profile, ip, ipv6).await,
        DdnsProvider::AfraidDns => afraid::update(profile, ip).await,
        DdnsProvider::Dynu => dynu::update(profile, ip, ipv6).await,
        DdnsProvider::Namecheap => namecheap::update(profile, ip).await,
        DdnsProvider::GoDaddy => godaddy::update(profile, ip).await,
        DdnsProvider::GoogleDomains => google_domains::update(profile, ip).await,
        DdnsProvider::HurricaneElectric => hurricane::update(profile, ip).await,
        DdnsProvider::ChangeIp => changeip::update(profile, ip).await,
        DdnsProvider::Ydns => ydns::update(profile, ip).await,
        DdnsProvider::DnsPod => dnspod::update(profile, ip).await,
        DdnsProvider::Ovh => ovh::update(profile, ip).await,
        DdnsProvider::Porkbun => porkbun::update(profile, ip).await,
        DdnsProvider::Gandi => gandi::update(profile, ip).await,
        DdnsProvider::Custom => custom::update(profile, ip, ipv6).await,
    }
}

/// Get capabilities for a specific provider.
pub fn get_capabilities(provider: &DdnsProvider) -> ProviderCapabilities {
    match provider {
        DdnsProvider::Cloudflare => ProviderCapabilities {
            provider: DdnsProvider::Cloudflare,
            label: "Cloudflare".to_string(),
            supports_ipv4: true,
            supports_ipv6: true,
            supports_ttl: true,
            supports_proxy: true,
            supports_txt: true,
            supports_multi_host: true,
            auth_methods: vec!["API Token".to_string(), "Global API Key".to_string()],
            has_free_tier: true,
            website: "https://cloudflare.com".to_string(),
            api_docs: Some("https://developers.cloudflare.com/api/".to_string()),
            min_update_interval_secs: 60,
        },
        DdnsProvider::NoIp => ProviderCapabilities {
            provider: DdnsProvider::NoIp,
            label: "No-IP".to_string(),
            supports_ipv4: true,
            supports_ipv6: false,
            supports_ttl: false,
            supports_proxy: false,
            supports_txt: false,
            supports_multi_host: true,
            auth_methods: vec!["Username/Password".to_string()],
            has_free_tier: true,
            website: "https://www.noip.com".to_string(),
            api_docs: Some("https://www.noip.com/integrate/request".to_string()),
            min_update_interval_secs: 300,
        },
        DdnsProvider::DuckDns => ProviderCapabilities {
            provider: DdnsProvider::DuckDns,
            label: "DuckDNS".to_string(),
            supports_ipv4: true,
            supports_ipv6: true,
            supports_ttl: false,
            supports_proxy: false,
            supports_txt: true,
            supports_multi_host: true,
            auth_methods: vec!["Token".to_string()],
            has_free_tier: true,
            website: "https://www.duckdns.org".to_string(),
            api_docs: Some("https://www.duckdns.org/spec.jsp".to_string()),
            min_update_interval_secs: 300,
        },
        DdnsProvider::AfraidDns => ProviderCapabilities {
            provider: DdnsProvider::AfraidDns,
            label: "Afraid DNS (FreeDNS)".to_string(),
            supports_ipv4: true,
            supports_ipv6: true,
            supports_ttl: false,
            supports_proxy: false,
            supports_txt: false,
            supports_multi_host: true,
            auth_methods: vec!["Hash Auth".to_string(), "Direct URL".to_string()],
            has_free_tier: true,
            website: "https://freedns.afraid.org".to_string(),
            api_docs: Some("https://freedns.afraid.org/dynamic/".to_string()),
            min_update_interval_secs: 300,
        },
        DdnsProvider::Dynu => ProviderCapabilities {
            provider: DdnsProvider::Dynu,
            label: "Dynu".to_string(),
            supports_ipv4: true,
            supports_ipv6: true,
            supports_ttl: true,
            supports_proxy: false,
            supports_txt: false,
            supports_multi_host: true,
            auth_methods: vec!["Username/Password".to_string(), "API Key".to_string()],
            has_free_tier: true,
            website: "https://www.dynu.com".to_string(),
            api_docs: Some("https://www.dynu.com/DynamicDNS/IP-Update-Protocol".to_string()),
            min_update_interval_secs: 120,
        },
        DdnsProvider::Namecheap => ProviderCapabilities {
            provider: DdnsProvider::Namecheap,
            label: "Namecheap".to_string(),
            supports_ipv4: true,
            supports_ipv6: false,
            supports_ttl: false,
            supports_proxy: false,
            supports_txt: false,
            supports_multi_host: true,
            auth_methods: vec!["Password (DDNS password)".to_string()],
            has_free_tier: true,
            website: "https://www.namecheap.com".to_string(),
            api_docs: Some("https://www.namecheap.com/support/knowledgebase/article.aspx/36/11/how-do-i-start-using-dynamic-dns/".to_string()),
            min_update_interval_secs: 300,
        },
        DdnsProvider::GoDaddy => ProviderCapabilities {
            provider: DdnsProvider::GoDaddy,
            label: "GoDaddy".to_string(),
            supports_ipv4: true,
            supports_ipv6: true,
            supports_ttl: true,
            supports_proxy: false,
            supports_txt: true,
            supports_multi_host: true,
            auth_methods: vec!["API Key + Secret".to_string()],
            has_free_tier: false,
            website: "https://www.godaddy.com".to_string(),
            api_docs: Some("https://developer.godaddy.com/doc/endpoint/domains".to_string()),
            min_update_interval_secs: 600,
        },
        DdnsProvider::GoogleDomains => ProviderCapabilities {
            provider: DdnsProvider::GoogleDomains,
            label: "Google Domains".to_string(),
            supports_ipv4: true,
            supports_ipv6: true,
            supports_ttl: false,
            supports_proxy: false,
            supports_txt: false,
            supports_multi_host: false,
            auth_methods: vec!["Username/Password".to_string()],
            has_free_tier: true,
            website: "https://domains.google.com".to_string(),
            api_docs: Some("https://support.google.com/domains/answer/6147083".to_string()),
            min_update_interval_secs: 300,
        },
        DdnsProvider::HurricaneElectric => ProviderCapabilities {
            provider: DdnsProvider::HurricaneElectric,
            label: "Hurricane Electric".to_string(),
            supports_ipv4: true,
            supports_ipv6: true,
            supports_ttl: false,
            supports_proxy: false,
            supports_txt: false,
            supports_multi_host: true,
            auth_methods: vec!["Username/Password (key)".to_string()],
            has_free_tier: true,
            website: "https://dns.he.net".to_string(),
            api_docs: Some("https://dns.he.net/docs.html".to_string()),
            min_update_interval_secs: 300,
        },
        DdnsProvider::ChangeIp => ProviderCapabilities {
            provider: DdnsProvider::ChangeIp,
            label: "ChangeIP".to_string(),
            supports_ipv4: true,
            supports_ipv6: false,
            supports_ttl: false,
            supports_proxy: false,
            supports_txt: false,
            supports_multi_host: false,
            auth_methods: vec!["Username/Password".to_string()],
            has_free_tier: true,
            website: "https://www.changeip.com".to_string(),
            api_docs: None,
            min_update_interval_secs: 300,
        },
        DdnsProvider::Ydns => ProviderCapabilities {
            provider: DdnsProvider::Ydns,
            label: "YDNS".to_string(),
            supports_ipv4: true,
            supports_ipv6: true,
            supports_ttl: false,
            supports_proxy: false,
            supports_txt: false,
            supports_multi_host: true,
            auth_methods: vec!["Username/Password".to_string()],
            has_free_tier: true,
            website: "https://ydns.io".to_string(),
            api_docs: Some("https://ydns.io/faq.html".to_string()),
            min_update_interval_secs: 300,
        },
        DdnsProvider::DnsPod => ProviderCapabilities {
            provider: DdnsProvider::DnsPod,
            label: "DNSPod".to_string(),
            supports_ipv4: true,
            supports_ipv6: true,
            supports_ttl: true,
            supports_proxy: false,
            supports_txt: true,
            supports_multi_host: true,
            auth_methods: vec!["Token ID + Token".to_string()],
            has_free_tier: true,
            website: "https://www.dnspod.cn".to_string(),
            api_docs: Some("https://docs.dnspod.cn/api/".to_string()),
            min_update_interval_secs: 120,
        },
        DdnsProvider::Ovh => ProviderCapabilities {
            provider: DdnsProvider::Ovh,
            label: "OVH".to_string(),
            supports_ipv4: true,
            supports_ipv6: true,
            supports_ttl: true,
            supports_proxy: false,
            supports_txt: false,
            supports_multi_host: true,
            auth_methods: vec!["DynHost Auth".to_string(), "REST API".to_string()],
            has_free_tier: true,
            website: "https://www.ovh.com".to_string(),
            api_docs: Some("https://api.ovh.com/".to_string()),
            min_update_interval_secs: 300,
        },
        DdnsProvider::Porkbun => ProviderCapabilities {
            provider: DdnsProvider::Porkbun,
            label: "Porkbun".to_string(),
            supports_ipv4: true,
            supports_ipv6: true,
            supports_ttl: true,
            supports_proxy: false,
            supports_txt: true,
            supports_multi_host: true,
            auth_methods: vec!["API Key + Secret".to_string()],
            has_free_tier: false,
            website: "https://porkbun.com".to_string(),
            api_docs: Some("https://porkbun.com/api/json/v3/documentation".to_string()),
            min_update_interval_secs: 300,
        },
        DdnsProvider::Gandi => ProviderCapabilities {
            provider: DdnsProvider::Gandi,
            label: "Gandi".to_string(),
            supports_ipv4: true,
            supports_ipv6: true,
            supports_ttl: true,
            supports_proxy: false,
            supports_txt: true,
            supports_multi_host: true,
            auth_methods: vec!["Personal Access Token".to_string()],
            has_free_tier: false,
            website: "https://www.gandi.net".to_string(),
            api_docs: Some("https://api.gandi.net/docs/livedns/".to_string()),
            min_update_interval_secs: 300,
        },
        DdnsProvider::Custom => ProviderCapabilities {
            provider: DdnsProvider::Custom,
            label: "Custom".to_string(),
            supports_ipv4: true,
            supports_ipv6: true,
            supports_ttl: false,
            supports_proxy: false,
            supports_txt: false,
            supports_multi_host: true,
            auth_methods: vec!["Custom Headers".to_string(), "Basic Auth".to_string(), "Token".to_string()],
            has_free_tier: true,
            website: "".to_string(),
            api_docs: None,
            min_update_interval_secs: 60,
        },
    }
}

/// Get capabilities for all providers.
pub fn get_all_capabilities() -> Vec<ProviderCapabilities> {
    DdnsProvider::all()
        .iter()
        .map(|p| get_capabilities(p))
        .collect()
}
