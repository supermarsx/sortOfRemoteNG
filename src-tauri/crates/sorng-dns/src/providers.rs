//! # DNS Provider Presets
//!
//! Pre-configured DNS server definitions for popular public DNS providers
//! supporting plain DNS, DoH, DoT, and optional DNSSEC filtering.

use crate::types::{DnsProtocol, DnsResolverConfig, DnsServer};
use serde::{Deserialize, Serialize};

/// Named provider profiles with metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsProvider {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub privacy_policy: &'static str,
    pub supports_doh: bool,
    pub supports_dot: bool,
    pub supports_dnssec: bool,
    pub supports_ecs: bool,
    pub filtering: bool,
    pub servers: Vec<DnsServer>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Provider constructors
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

pub fn cloudflare() -> DnsProvider {
    DnsProvider {
        id: "cloudflare",
        name: "Cloudflare",
        description: "Fast, privacy-focused DNS (1.1.1.1)",
        privacy_policy: "https://developers.cloudflare.com/1.1.1.1/privacy/public-dns-resolver/",
        supports_doh: true,
        supports_dot: true,
        supports_dnssec: true,
        supports_ecs: false,
        filtering: false,
        servers: vec![
            DnsServer::plain("1.1.1.1"),
            DnsServer::plain("1.0.0.1"),
            DnsServer::doh("https://cloudflare-dns.com/dns-query"),
            DnsServer::dot("1.1.1.1", "cloudflare-dns.com"),
            DnsServer::dot("1.0.0.1", "cloudflare-dns.com"),
        ],
    }
}

pub fn cloudflare_security() -> DnsProvider {
    DnsProvider {
        id: "cloudflare-security",
        name: "Cloudflare Security",
        description: "Cloudflare with malware blocking (1.1.1.2)",
        privacy_policy: "https://developers.cloudflare.com/1.1.1.1/privacy/public-dns-resolver/",
        supports_doh: true,
        supports_dot: true,
        supports_dnssec: true,
        supports_ecs: false,
        filtering: true,
        servers: vec![
            DnsServer::plain("1.1.1.2"),
            DnsServer::plain("1.0.0.2"),
            DnsServer::doh("https://security.cloudflare-dns.com/dns-query"),
        ],
    }
}

pub fn google() -> DnsProvider {
    DnsProvider {
        id: "google",
        name: "Google Public DNS",
        description: "Google's public DNS service (8.8.8.8)",
        privacy_policy: "https://developers.google.com/speed/public-dns/privacy",
        supports_doh: true,
        supports_dot: true,
        supports_dnssec: true,
        supports_ecs: true,
        filtering: false,
        servers: vec![
            DnsServer::plain("8.8.8.8"),
            DnsServer::plain("8.8.4.4"),
            DnsServer::doh("https://dns.google/dns-query"),
            DnsServer::dot("8.8.8.8", "dns.google"),
            DnsServer::dot("8.8.4.4", "dns.google"),
        ],
    }
}

pub fn quad9() -> DnsProvider {
    DnsProvider {
        id: "quad9",
        name: "Quad9",
        description: "Security-focused DNS with threat blocking (9.9.9.9)",
        privacy_policy: "https://www.quad9.net/privacy/policy/",
        supports_doh: true,
        supports_dot: true,
        supports_dnssec: true,
        supports_ecs: false,
        filtering: true,
        servers: vec![
            DnsServer::plain("9.9.9.9"),
            DnsServer::plain("149.112.112.112"),
            DnsServer::doh("https://dns.quad9.net/dns-query"),
            DnsServer::dot("9.9.9.9", "dns.quad9.net"),
        ],
    }
}

pub fn quad9_unfiltered() -> DnsProvider {
    DnsProvider {
        id: "quad9-unfiltered",
        name: "Quad9 Unfiltered",
        description: "Quad9 without threat blocking (9.9.9.10)",
        privacy_policy: "https://www.quad9.net/privacy/policy/",
        supports_doh: true,
        supports_dot: true,
        supports_dnssec: true,
        supports_ecs: false,
        filtering: false,
        servers: vec![
            DnsServer::plain("9.9.9.10"),
            DnsServer::plain("149.112.112.10"),
            DnsServer::doh("https://dns10.quad9.net/dns-query"),
        ],
    }
}

pub fn nextdns() -> DnsProvider {
    DnsProvider {
        id: "nextdns",
        name: "NextDNS",
        description: "Configurable DNS with analytics and filtering",
        privacy_policy: "https://nextdns.io/privacy",
        supports_doh: true,
        supports_dot: true,
        supports_dnssec: true,
        supports_ecs: true,
        filtering: true,
        servers: vec![
            DnsServer::plain("45.90.28.0"),
            DnsServer::plain("45.90.30.0"),
            DnsServer::doh("https://dns.nextdns.io/"),
            DnsServer::dot("45.90.28.0", "dns.nextdns.io"),
        ],
    }
}

pub fn mullvad() -> DnsProvider {
    DnsProvider {
        id: "mullvad",
        name: "Mullvad DNS",
        description: "Privacy-first DNS from Mullvad VPN — no logging",
        privacy_policy: "https://mullvad.net/en/help/dns-over-https-and-dns-over-tls/",
        supports_doh: true,
        supports_dot: true,
        supports_dnssec: true,
        supports_ecs: false,
        filtering: false,
        servers: vec![
            DnsServer::doh("https://dns.mullvad.net/dns-query"),
            DnsServer::dot("194.242.2.2", "dns.mullvad.net"),
        ],
    }
}

pub fn mullvad_adblock() -> DnsProvider {
    DnsProvider {
        id: "mullvad-adblock",
        name: "Mullvad DNS (Ad-block)",
        description: "Mullvad DNS with ad/tracker blocking",
        privacy_policy: "https://mullvad.net/en/help/dns-over-https-and-dns-over-tls/",
        supports_doh: true,
        supports_dot: true,
        supports_dnssec: true,
        supports_ecs: false,
        filtering: true,
        servers: vec![
            DnsServer::doh("https://adblock.dns.mullvad.net/dns-query"),
            DnsServer::dot("194.242.2.3", "adblock.dns.mullvad.net"),
        ],
    }
}

pub fn adguard() -> DnsProvider {
    DnsProvider {
        id: "adguard",
        name: "AdGuard DNS",
        description: "Ad-blocking DNS by AdGuard",
        privacy_policy: "https://adguard-dns.io/en/privacy.html",
        supports_doh: true,
        supports_dot: true,
        supports_dnssec: true,
        supports_ecs: false,
        filtering: true,
        servers: vec![
            DnsServer::plain("94.140.14.14"),
            DnsServer::plain("94.140.15.15"),
            DnsServer::doh("https://dns.adguard-dns.com/dns-query"),
            DnsServer::dot("94.140.14.14", "dns.adguard-dns.com"),
        ],
    }
}

pub fn adguard_unfiltered() -> DnsProvider {
    DnsProvider {
        id: "adguard-unfiltered",
        name: "AdGuard DNS (Unfiltered)",
        description: "AdGuard DNS without filtering",
        privacy_policy: "https://adguard-dns.io/en/privacy.html",
        supports_doh: true,
        supports_dot: true,
        supports_dnssec: true,
        supports_ecs: false,
        filtering: false,
        servers: vec![
            DnsServer::plain("94.140.14.140"),
            DnsServer::plain("94.140.14.141"),
            DnsServer::doh("https://unfiltered.adguard-dns.com/dns-query"),
        ],
    }
}

pub fn control_d() -> DnsProvider {
    DnsProvider {
        id: "control-d",
        name: "Control D",
        description: "Customizable DNS with privacy and filtering",
        privacy_policy: "https://controld.com/privacy",
        supports_doh: true,
        supports_dot: true,
        supports_dnssec: true,
        supports_ecs: false,
        filtering: true,
        servers: vec![
            DnsServer::plain("76.76.2.0"),
            DnsServer::plain("76.76.10.0"),
            DnsServer::doh("https://freedns.controld.com/p0"),
            DnsServer::dot("76.76.2.0", "p0.freedns.controld.com"),
        ],
    }
}

pub fn opendns() -> DnsProvider {
    DnsProvider {
        id: "opendns",
        name: "OpenDNS (Cisco)",
        description: "Cisco Umbrella / OpenDNS",
        privacy_policy: "https://www.cisco.com/c/en/us/about/legal/privacy-full.html",
        supports_doh: true,
        supports_dot: false,
        supports_dnssec: true,
        supports_ecs: true,
        filtering: true,
        servers: vec![
            DnsServer::plain("208.67.222.222"),
            DnsServer::plain("208.67.220.220"),
            DnsServer::doh("https://doh.opendns.com/dns-query"),
        ],
    }
}

pub fn cleanbrowsing_security() -> DnsProvider {
    DnsProvider {
        id: "cleanbrowsing-security",
        name: "CleanBrowsing (Security)",
        description: "Blocks malware & phishing domains",
        privacy_policy: "https://cleanbrowsing.org/privacy",
        supports_doh: true,
        supports_dot: true,
        supports_dnssec: true,
        supports_ecs: false,
        filtering: true,
        servers: vec![
            DnsServer::plain("185.228.168.9"),
            DnsServer::plain("185.228.169.9"),
            DnsServer::doh("https://doh.cleanbrowsing.org/doh/security-filter/"),
            DnsServer::dot("185.228.168.9", "security-filter-dns.cleanbrowsing.org"),
        ],
    }
}

pub fn libredns() -> DnsProvider {
    DnsProvider {
        id: "libredns",
        name: "LibreDNS",
        description: "Privacy-focused DNS by LibreOps",
        privacy_policy: "https://libredns.gr/",
        supports_doh: true,
        supports_dot: true,
        supports_dnssec: true,
        supports_ecs: false,
        filtering: false,
        servers: vec![
            DnsServer::plain("116.202.176.26"),
            DnsServer::doh("https://doh.libredns.gr/dns-query"),
            DnsServer::dot("116.202.176.26", "dot.libredns.gr"),
        ],
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Provider discovery
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Return all built-in providers.
pub fn all_providers() -> Vec<DnsProvider> {
    vec![
        cloudflare(),
        cloudflare_security(),
        google(),
        quad9(),
        quad9_unfiltered(),
        nextdns(),
        mullvad(),
        mullvad_adblock(),
        adguard(),
        adguard_unfiltered(),
        control_d(),
        opendns(),
        cleanbrowsing_security(),
        libredns(),
    ]
}

/// Find provider by id.
pub fn provider_by_id(id: &str) -> Option<DnsProvider> {
    all_providers().into_iter().find(|p| p.id == id)
}

/// Get all providers that support DoH.
pub fn doh_providers() -> Vec<DnsProvider> {
    all_providers().into_iter().filter(|p| p.supports_doh).collect()
}

/// Get all providers that support DoT.
pub fn dot_providers() -> Vec<DnsProvider> {
    all_providers().into_iter().filter(|p| p.supports_dot).collect()
}

/// Get only non-filtering (privacy) providers.
pub fn privacy_providers() -> Vec<DnsProvider> {
    all_providers().into_iter().filter(|p| !p.filtering).collect()
}

/// Get only filtering (security) providers.
pub fn filtering_providers() -> Vec<DnsProvider> {
    all_providers().into_iter().filter(|p| p.filtering).collect()
}

/// Build a `DnsResolverConfig` from a provider, choosing the most secure protocol.
pub fn resolver_config_from_provider(provider: &DnsProvider) -> DnsResolverConfig {
    let protocol = if provider.supports_doh {
        DnsProtocol::DoH
    } else if provider.supports_dot {
        DnsProtocol::DoT
    } else {
        DnsProtocol::Udp
    };

    let doh_servers: Vec<DnsServer> = provider
        .servers
        .iter()
        .filter(|s| {
            s.protocol
                .as_ref()
                .map_or(false, |p| *p == DnsProtocol::DoH)
        })
        .cloned()
        .collect();

    let servers = if !doh_servers.is_empty() && protocol == DnsProtocol::DoH {
        doh_servers
    } else {
        provider.servers.clone()
    };

    DnsResolverConfig {
        protocol,
        servers,
        dnssec: provider.supports_dnssec,
        cache_enabled: true,
        cache_max_entries: 1000,
        ..Default::default()
    }
}
