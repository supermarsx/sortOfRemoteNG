//! # MIB Browser & Parser
//!
//! Parse MIB module files, build OID trees, and resolve OID ↔ name mappings.

use crate::error::SnmpResult;
use crate::types::*;
use std::collections::HashMap;

/// In-memory MIB database.
pub struct MibDatabase {
    /// Loaded MIB modules by name.
    modules: HashMap<String, MibModule>,
    /// Flat OID → name mapping for fast lookups.
    oid_to_name: HashMap<String, OidMapping>,
    /// Reverse name → OID mapping.
    name_to_oid: HashMap<String, String>,
}

impl MibDatabase {
    pub fn new() -> Self {
        let mut db = Self {
            modules: HashMap::new(),
            oid_to_name: HashMap::new(),
            name_to_oid: HashMap::new(),
        };
        // Load built-in OID names
        db.load_builtin_mappings();
        db
    }

    /// Load standard MIB-2 OID name mappings.
    fn load_builtin_mappings(&mut self) {
        let builtins = vec![
            ("1.3.6.1.2.1.1", "system", "SNMPv2-MIB"),
            ("1.3.6.1.2.1.1.1", "sysDescr", "SNMPv2-MIB"),
            ("1.3.6.1.2.1.1.2", "sysObjectID", "SNMPv2-MIB"),
            ("1.3.6.1.2.1.1.3", "sysUpTime", "SNMPv2-MIB"),
            ("1.3.6.1.2.1.1.4", "sysContact", "SNMPv2-MIB"),
            ("1.3.6.1.2.1.1.5", "sysName", "SNMPv2-MIB"),
            ("1.3.6.1.2.1.1.6", "sysLocation", "SNMPv2-MIB"),
            ("1.3.6.1.2.1.1.7", "sysServices", "SNMPv2-MIB"),
            ("1.3.6.1.2.1.2", "interfaces", "IF-MIB"),
            ("1.3.6.1.2.1.2.1", "ifNumber", "IF-MIB"),
            ("1.3.6.1.2.1.2.2", "ifTable", "IF-MIB"),
            ("1.3.6.1.2.1.2.2.1", "ifEntry", "IF-MIB"),
            ("1.3.6.1.2.1.2.2.1.1", "ifIndex", "IF-MIB"),
            ("1.3.6.1.2.1.2.2.1.2", "ifDescr", "IF-MIB"),
            ("1.3.6.1.2.1.2.2.1.3", "ifType", "IF-MIB"),
            ("1.3.6.1.2.1.2.2.1.4", "ifMtu", "IF-MIB"),
            ("1.3.6.1.2.1.2.2.1.5", "ifSpeed", "IF-MIB"),
            ("1.3.6.1.2.1.2.2.1.6", "ifPhysAddress", "IF-MIB"),
            ("1.3.6.1.2.1.2.2.1.7", "ifAdminStatus", "IF-MIB"),
            ("1.3.6.1.2.1.2.2.1.8", "ifOperStatus", "IF-MIB"),
            ("1.3.6.1.2.1.2.2.1.9", "ifLastChange", "IF-MIB"),
            ("1.3.6.1.2.1.2.2.1.10", "ifInOctets", "IF-MIB"),
            ("1.3.6.1.2.1.2.2.1.11", "ifInUcastPkts", "IF-MIB"),
            ("1.3.6.1.2.1.2.2.1.13", "ifInDiscards", "IF-MIB"),
            ("1.3.6.1.2.1.2.2.1.14", "ifInErrors", "IF-MIB"),
            ("1.3.6.1.2.1.2.2.1.16", "ifOutOctets", "IF-MIB"),
            ("1.3.6.1.2.1.2.2.1.17", "ifOutUcastPkts", "IF-MIB"),
            ("1.3.6.1.2.1.2.2.1.19", "ifOutDiscards", "IF-MIB"),
            ("1.3.6.1.2.1.2.2.1.20", "ifOutErrors", "IF-MIB"),
            ("1.3.6.1.2.1.31.1.1.1.6", "ifHCInOctets", "IF-MIB"),
            ("1.3.6.1.2.1.31.1.1.1.10", "ifHCOutOctets", "IF-MIB"),
            ("1.3.6.1.2.1.31.1.1.1.15", "ifHighSpeed", "IF-MIB"),
            ("1.3.6.1.2.1.31.1.1.1.18", "ifAlias", "IF-MIB"),
            ("1.3.6.1.2.1.4", "ip", "IP-MIB"),
            ("1.3.6.1.2.1.4.1", "ipForwarding", "IP-MIB"),
            ("1.3.6.1.2.1.4.20", "ipAddrTable", "IP-MIB"),
            ("1.3.6.1.2.1.4.21", "ipRouteTable", "RFC1213-MIB"),
            ("1.3.6.1.2.1.6", "tcp", "TCP-MIB"),
            ("1.3.6.1.2.1.6.13", "tcpConnTable", "TCP-MIB"),
            ("1.3.6.1.2.1.7", "udp", "UDP-MIB"),
            ("1.3.6.1.2.1.11", "snmp", "SNMPv2-MIB"),
            ("1.3.6.1.2.1.25", "host", "HOST-RESOURCES-MIB"),
            ("1.3.6.1.2.1.25.1.1", "hrSystemUptime", "HOST-RESOURCES-MIB"),
            ("1.3.6.1.2.1.25.2.3", "hrStorageTable", "HOST-RESOURCES-MIB"),
            ("1.3.6.1.2.1.25.3.3", "hrProcessorTable", "HOST-RESOURCES-MIB"),
            ("1.3.6.1.2.1.47", "entityMIB", "ENTITY-MIB"),
            ("1.3.6.1.6.3.1.1.4.1", "snmpTrapOID", "SNMPv2-MIB"),
            ("1.3.6.1.6.3.1.1.5.1", "coldStart", "SNMPv2-MIB"),
            ("1.3.6.1.6.3.1.1.5.2", "warmStart", "SNMPv2-MIB"),
            ("1.3.6.1.6.3.1.1.5.3", "linkDown", "IF-MIB"),
            ("1.3.6.1.6.3.1.1.5.4", "linkUp", "IF-MIB"),
            ("1.3.6.1.6.3.1.1.5.5", "authenticationFailure", "SNMPv2-MIB"),
            ("1.3.6.1.4.1", "enterprises", "SNMPv2-SMI"),
        ];

        for (oid, name, module) in builtins {
            self.add_mapping(oid, name, module);
        }
    }

    /// Add a single OID → name mapping.
    pub fn add_mapping(&mut self, oid: &str, name: &str, module: &str) {
        let mapping = OidMapping {
            oid: oid.to_string(),
            name: name.to_string(),
            module: module.to_string(),
        };
        self.oid_to_name.insert(oid.to_string(), mapping);
        self.name_to_oid.insert(name.to_string(), oid.to_string());
    }

    /// Resolve an OID to its human-readable name.
    /// If an exact match is not found, finds the longest prefix match and appends the suffix.
    pub fn resolve_oid(&self, oid: &str) -> Option<String> {
        // Exact match
        if let Some(mapping) = self.oid_to_name.get(oid) {
            return Some(mapping.name.clone());
        }

        // Find longest prefix match
        let mut best_prefix = "";
        let mut best_name = "";
        for (prefix_oid, mapping) in &self.oid_to_name {
            if oid.starts_with(prefix_oid) && prefix_oid.len() > best_prefix.len() {
                // Verify it's a proper prefix (followed by '.' or end)
                if oid.len() == prefix_oid.len() || oid.as_bytes().get(prefix_oid.len()) == Some(&b'.') {
                    best_prefix = prefix_oid;
                    best_name = &mapping.name;
                }
            }
        }

        if !best_prefix.is_empty() {
            let suffix = &oid[best_prefix.len()..];
            let suffix = suffix.trim_start_matches('.');
            if suffix.is_empty() {
                Some(best_name.to_string())
            } else {
                Some(format!("{}.{}", best_name, suffix))
            }
        } else {
            None
        }
    }

    /// Resolve a name to an OID.
    pub fn resolve_name(&self, name: &str) -> Option<String> {
        // Direct lookup
        if let Some(oid) = self.name_to_oid.get(name) {
            return Some(oid.clone());
        }

        // Try name with .0 suffix stripped
        let base_name = name.trim_end_matches(".0");
        if let Some(oid) = self.name_to_oid.get(base_name) {
            if name.ends_with(".0") {
                return Some(format!("{}.0", oid));
            }
            return Some(oid.clone());
        }

        None
    }

    /// Load a MIB module (simplified parser for basic OBJECT-TYPE definitions).
    pub fn load_mib_text(&mut self, text: &str) -> SnmpResult<String> {
        let mut module_name = String::new();
        let mut objects = vec![];

        for line in text.lines() {
            let trimmed = line.trim();

            // Module name from "MODULE-NAME DEFINITIONS ::= BEGIN"
            if trimmed.contains("DEFINITIONS") && trimmed.contains("BEGIN") {
                if let Some(name) = trimmed.split_whitespace().next() {
                    module_name = name.to_string();
                }
            }

            // Simple OBJECT IDENTIFIER assignment: name OBJECT IDENTIFIER ::= { parent sub }
            if trimmed.contains("OBJECT IDENTIFIER") && trimmed.contains("::=") {
                // Parse the assignment
                if let Some(parsed) = parse_oid_assignment(trimmed, &self.name_to_oid) {
                    let mod_name = if module_name.is_empty() { "UNKNOWN" } else { &module_name };
                    self.add_mapping(&parsed.1, &parsed.0, mod_name);
                    objects.push(MibObject {
                        name: parsed.0,
                        oid: parsed.1,
                        syntax: None,
                        access: None,
                        status: None,
                        description: None,
                        parent: None,
                        children: vec![],
                    });
                }
            }
        }

        if module_name.is_empty() {
            module_name = "UNNAMED".to_string();
        }

        let result_name = module_name.clone();
        self.modules.insert(module_name.clone(), MibModule {
            name: module_name,
            last_updated: None,
            organization: None,
            description: None,
            objects,
        });

        Ok(result_name)
    }

    /// Get all loaded module names.
    pub fn list_modules(&self) -> Vec<String> {
        self.modules.keys().cloned().collect()
    }

    /// Get a loaded module by name.
    pub fn get_module(&self, name: &str) -> Option<&MibModule> {
        self.modules.get(name)
    }

    /// Get the number of OID mappings.
    pub fn mapping_count(&self) -> usize {
        self.oid_to_name.len()
    }

    /// Search OID mappings by name pattern (case-insensitive substring).
    pub fn search(&self, pattern: &str) -> Vec<&OidMapping> {
        let pattern_lower = pattern.to_lowercase();
        self.oid_to_name.values()
            .filter(|m| m.name.to_lowercase().contains(&pattern_lower) || m.oid.contains(pattern))
            .collect()
    }

    /// Get the tree of OIDs under a prefix.
    pub fn get_subtree(&self, prefix: &str) -> Vec<&OidMapping> {
        self.oid_to_name.values()
            .filter(|m| m.oid.starts_with(prefix))
            .collect()
    }
}

/// Parse a simple OID assignment line.
fn parse_oid_assignment(line: &str, name_to_oid: &HashMap<String, String>) -> Option<(String, String)> {
    // Format: "name OBJECT IDENTIFIER ::= { parent sub-id }"
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 6 {
        return None;
    }
    let name = parts[0].to_string();

    // Find the { parent sub } part
    let braces_start = line.find('{')?;
    let braces_end = line.find('}')?;
    let inside = &line[braces_start + 1..braces_end].trim();
    let inside_parts: Vec<&str> = inside.split_whitespace().collect();
    if inside_parts.len() != 2 {
        return None;
    }

    let parent_name = inside_parts[0];
    let sub_id = inside_parts[1];

    // Resolve parent to OID
    let parent_oid = name_to_oid.get(parent_name)?;
    let full_oid = format!("{}.{}", parent_oid, sub_id);

    Some((name, full_oid))
}
