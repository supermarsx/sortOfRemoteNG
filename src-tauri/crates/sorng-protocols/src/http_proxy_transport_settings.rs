//! Session-scoped website transport tuning, independent of routing and TLS policy.
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProxyAddressFamily {
    #[default]
    System,
    Ipv4First,
    Ipv6First,
    Ipv4Only,
    Ipv6Only,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProxyHttpErrorConversion { #[default] Off, ServerErrors, AllErrors }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct ProxyTransportSettings {
    pub version: u32,
    pub connect_timeout_seconds: u64,
    pub request_timeout_seconds: u64,
    pub pool_idle_timeout_seconds: u64,
    pub max_idle_connections_per_host: usize,
    /// Zero disables TCP keepalive; it is never passed as a zero socket interval.
    pub tcp_keepalive_seconds: u64,
    pub tcp_no_delay: bool,
    pub max_clients: usize,
    pub max_connections_per_host: usize,
    pub dns_concurrency: usize,
    pub include_error_trace: bool,
    pub expand_error_details: bool,
    pub http_error_conversion: ProxyHttpErrorConversion,
    pub max_header_bytes: usize,
    pub header_timeout_seconds: u64,
    pub response_timeout_seconds: u64,
    pub http_response_timeout_seconds: u64,
    pub http_idle_timeout_seconds: u64,
    pub dns_timeout_seconds: u64,
    pub dns_cache_ttl_seconds: u64,
    pub dns_cache_max_entries: usize,
    pub address_family: ProxyAddressFamily,
}

impl Default for ProxyTransportSettings {
    fn default() -> Self {
        Self {
            version: 1,
            connect_timeout_seconds: 15,
            request_timeout_seconds: 120,
            pool_idle_timeout_seconds: 20,
            max_idle_connections_per_host: 4,
            tcp_keepalive_seconds: 30,
            tcp_no_delay: true,
            max_clients: 256,
            max_connections_per_host: 6,
            dns_concurrency: 16,
            include_error_trace: true,
            expand_error_details: false,
            http_error_conversion: ProxyHttpErrorConversion::Off,
            max_header_bytes: 8192,
            header_timeout_seconds: 10,
            response_timeout_seconds: 5,
            http_response_timeout_seconds: 60,
            http_idle_timeout_seconds: 60,
            dns_timeout_seconds: 10,
            dns_cache_ttl_seconds: 0,
            dns_cache_max_entries: 256,
            address_family: ProxyAddressFamily::System,
        }
    }
}

impl ProxyTransportSettings {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("Proxy transport settings version must be 1".into());
        }
        for (name, value, min, max) in [
            (
                "connectTimeoutSeconds",
                self.connect_timeout_seconds,
                1,
                120,
            ),
            (
                "requestTimeoutSeconds",
                self.request_timeout_seconds,
                5,
                600,
            ),
            (
                "poolIdleTimeoutSeconds",
                self.pool_idle_timeout_seconds,
                0,
                300,
            ),
            ("tcpKeepaliveSeconds", self.tcp_keepalive_seconds, 0, 300),
            ("maxClients", self.max_clients as u64, 16, 256),
            ("maxConnectionsPerHost", self.max_connections_per_host as u64, 1, 64),
            ("dnsConcurrency", self.dns_concurrency as u64, 1, 16),
            ("maxHeaderBytes", self.max_header_bytes as u64, 1024, 16384),
            ("headerTimeoutSeconds", self.header_timeout_seconds, 1, 120),
            (
                "responseTimeoutSeconds",
                self.response_timeout_seconds,
                1,
                120,
            ),
            (
                "httpResponseTimeoutSeconds",
                self.http_response_timeout_seconds,
                5,
                120,
            ),
            (
                "httpIdleTimeoutSeconds",
                self.http_idle_timeout_seconds,
                5,
                120,
            ),
            ("dnsTimeoutSeconds", self.dns_timeout_seconds, 1, 60),
            ("dnsCacheTtlSeconds", self.dns_cache_ttl_seconds, 0, 3600),
            (
                "dnsCacheMaxEntries",
                self.dns_cache_max_entries as u64,
                16,
                4096,
            ),
        ] {
            if !(min..=max).contains(&value) {
                return Err(format!(
                    "Proxy transport {name} must be between {min} and {max}"
                ));
            }
        }
        if self.max_idle_connections_per_host > 32 {
            return Err(
                "Proxy transport maxIdleConnectionsPerHost must be between 0 and 32".into(),
            );
        }
        if self.request_timeout_seconds < self.connect_timeout_seconds {
            return Err(
                "Proxy transport requestTimeoutSeconds must be at least connectTimeoutSeconds"
                    .into(),
            );
        }
        Ok(())
    }

    pub fn connect_timeout(&self) -> Duration {
        Duration::from_secs(self.connect_timeout_seconds)
    }

    pub fn request_timeout(&self) -> Duration {
        Duration::from_secs(self.request_timeout_seconds)
    }

    pub fn tcp_keepalive(&self) -> Option<Duration> {
        (self.tcp_keepalive_seconds != 0).then(|| Duration::from_secs(self.tcp_keepalive_seconds))
    }

    pub fn relay_limits(&self) -> Result<crate::private_forward_proxy::ProxyLimits, String> {
        self.validate()?;
        Ok(crate::private_forward_proxy::ProxyLimits {
            max_clients: self.max_clients,
            max_header_bytes: self.max_header_bytes,
            transport: Some(*self),
            header_timeout: Duration::from_secs(self.header_timeout_seconds),
            dial_timeout: self.connect_timeout(),
            response_timeout: Duration::from_secs(self.response_timeout_seconds),
            http_response_timeout: Duration::from_secs(self.http_response_timeout_seconds),
            http_idle_timeout: Duration::from_secs(self.http_idle_timeout_seconds),
        })
    }

    /// Apply only transport budgets/pooling. Callers retain their explicit
    /// route, TLS verifier, redirect rules, headers and cookie ownership.
    pub fn apply_to_client_builder(
        &self,
        builder: reqwest::ClientBuilder,
    ) -> Result<reqwest::ClientBuilder, String> {
        self.validate()?;
        Ok(builder
            .tcp_nodelay(self.tcp_no_delay)
            .dns_resolver(std::sync::Arc::new(
                crate::browser_dns::BrowserDnsResolver::new(*self)?,
            ))
            .connect_timeout(self.connect_timeout())
            .timeout(self.request_timeout())
            // Zero expires idle connections immediately, not an unlimited pool.
            .pool_idle_timeout(Duration::from_secs(self.pool_idle_timeout_seconds))
            .pool_max_idle_per_host(self.max_idle_connections_per_host)
            .tcp_keepalive(self.tcp_keepalive()))
    }
}

#[cfg(test)]
#[path = "http_proxy_transport_settings_tests.rs"]
mod tests;
