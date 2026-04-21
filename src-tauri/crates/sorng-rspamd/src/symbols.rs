// ── rspamd symbol management ─────────────────────────────────────────────────

use crate::client::RspamdClient;
use crate::error::{RspamdError, RspamdErrorKind, RspamdResult};
use crate::types::*;
use log::debug;

pub struct SymbolManager;

impl SymbolManager {
    /// GET /symbols — list all symbols
    pub async fn list(client: &RspamdClient) -> RspamdResult<Vec<RspamdSymbol>> {
        debug!("RSPAMD list_symbols");
        let raw: serde_json::Value = client.get("/symbols").await?;
        Self::parse_symbols(&raw)
    }

    /// Get a specific symbol by name
    pub async fn get(client: &RspamdClient, name: &str) -> RspamdResult<RspamdSymbol> {
        debug!("RSPAMD get_symbol: {name}");
        let symbols = Self::list(client).await?;
        symbols.into_iter().find(|s| s.name == name).ok_or_else(|| {
            RspamdError::new(
                RspamdErrorKind::SymbolNotFound,
                format!("Symbol not found: {name}"),
            )
        })
    }

    /// List all symbol groups
    pub async fn list_groups(client: &RspamdClient) -> RspamdResult<Vec<RspamdSymbolGroup>> {
        debug!("RSPAMD list_symbol_groups");
        let raw: serde_json::Value = client.get("/symbols").await?;
        Self::parse_groups(&raw)
    }

    /// Get a specific symbol group by name
    pub async fn get_group(client: &RspamdClient, name: &str) -> RspamdResult<RspamdSymbolGroup> {
        debug!("RSPAMD get_symbol_group: {name}");
        let groups = Self::list_groups(client).await?;
        groups
            .into_iter()
            .find(|g| g.name == name)
            .ok_or_else(|| RspamdError::not_found(format!("Symbol group not found: {name}")))
    }

    // ── Internal helpers ─────────────────────────────────────────────

    fn parse_symbols(raw: &serde_json::Value) -> RspamdResult<Vec<RspamdSymbol>> {
        let mut symbols = Vec::new();

        // Rspamd /symbols returns an array of groups, each with symbols
        if let Some(groups) = raw.as_array() {
            for group in groups {
                let group_name = group
                    .get("group")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if let Some(syms) = group.get("rules").and_then(|v| v.as_array()) {
                    for sym in syms {
                        symbols.push(RspamdSymbol {
                            name: sym
                                .get("symbol")
                                .or_else(|| sym.get("name"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            group: Some(group_name.clone()),
                            description: sym
                                .get("description")
                                .and_then(|v| v.as_str())
                                .map(String::from),
                            weight: sym.get("weight").and_then(|v| v.as_f64()),
                            score: sym.get("score").and_then(|v| v.as_f64()),
                            is_composite: sym.get("is_composite").and_then(|v| v.as_bool()),
                            is_virtual: sym.get("is_virtual").and_then(|v| v.as_bool()),
                            enabled: sym.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true),
                        });
                    }
                }
            }
        } else if let Some(obj) = raw.as_object() {
            // Alternative format: object keyed by symbol name
            for (name, info) in obj {
                symbols.push(RspamdSymbol {
                    name: name.clone(),
                    group: info.get("group").and_then(|v| v.as_str()).map(String::from),
                    description: info
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    weight: info.get("weight").and_then(|v| v.as_f64()),
                    score: info.get("score").and_then(|v| v.as_f64()),
                    is_composite: info.get("is_composite").and_then(|v| v.as_bool()),
                    is_virtual: info.get("is_virtual").and_then(|v| v.as_bool()),
                    enabled: info
                        .get("enabled")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true),
                });
            }
        }

        Ok(symbols)
    }

    fn parse_groups(raw: &serde_json::Value) -> RspamdResult<Vec<RspamdSymbolGroup>> {
        let mut groups = Vec::new();

        if let Some(arr) = raw.as_array() {
            for group in arr {
                let name = group
                    .get("group")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let description = group
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let max_score = group.get("max_score").and_then(|v| v.as_f64());
                let enabled = group
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);

                let symbols = group
                    .get("rules")
                    .and_then(|v| v.as_array())
                    .map(|rules| {
                        rules
                            .iter()
                            .filter_map(|r| {
                                r.get("symbol")
                                    .or_else(|| r.get("name"))
                                    .and_then(|v| v.as_str())
                                    .map(String::from)
                            })
                            .collect()
                    })
                    .unwrap_or_default();

                groups.push(RspamdSymbolGroup {
                    name,
                    description,
                    symbols,
                    max_score,
                    enabled,
                });
            }
        }

        Ok(groups)
    }
}
