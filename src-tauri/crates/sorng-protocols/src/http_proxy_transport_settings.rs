//! Session-scoped website transport tuning, independent of routing and TLS policy.
use serde::{Deserialize, Serialize};
use std::time::Duration;

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

    fn tcp_keepalive(&self) -> Option<Duration> {
        (self.tcp_keepalive_seconds != 0).then(|| Duration::from_secs(self.tcp_keepalive_seconds))
    }

    /// Apply only transport budgets/pooling. Callers retain their explicit
    /// route, TLS verifier, redirect rules, headers and cookie ownership.
    pub fn apply_to_client_builder(
        &self,
        builder: reqwest::ClientBuilder,
    ) -> Result<reqwest::ClientBuilder, String> {
        self.validate()?;
        Ok(builder
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
