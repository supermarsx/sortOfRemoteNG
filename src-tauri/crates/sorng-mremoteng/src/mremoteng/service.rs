//! High-level orchestrator for mRemoteNG import/export operations.
//!
//! Acts as the single entry point that `commands.rs` delegates to.
//! Manages format detection, file I/O, encryption, and conversion
//! between mRemoteNG and app connection models.

use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex;

use super::converter;
use super::csv_parser;
use super::csv_writer;
use super::error::MremotengResult;
use super::putty_parser;
use super::rdp_parser;
use super::types::*;
use super::xml_parser;
use super::xml_writer;

/// Thread-safe state managed by Tauri.
pub type MremotengServiceState = Arc<Mutex<MremotengService>>;

/// Service that orchestrates all mRemoteNG import/export operations.
pub struct MremotengService {
    /// Default master password for encryption (empty = "mR3m" default).
    pub default_password: String,
    /// Default KDF iteration count.
    pub kdf_iterations: u32,
    /// Last import result.
    pub last_import: Option<MrngImportResult>,
    /// Last export result.
    pub last_export: Option<MrngExportResult>,
}

impl MremotengService {
    /// Create a new service wrapped in `Arc<Mutex<_>>` for Tauri state.
    pub fn new() -> MremotengServiceState {
        Arc::new(Mutex::new(MremotengService {
            default_password: String::new(),
            kdf_iterations: 1000,
            last_import: None,
            last_export: None,
        }))
    }

    // ─── Format Detection ────────────────────────────────────────

    /// Detect the format of a file based on content and extension.
    pub fn detect_format(file_path: &str, content: &str) -> ImportFormat {
        let lower = file_path.to_lowercase();

        if lower.ends_with(".rdp") {
            return ImportFormat::RdpFile;
        }
        if lower.ends_with(".csv") {
            return ImportFormat::MremotengCsv;
        }
        if lower.ends_with(".reg") {
            return ImportFormat::PuttySessions;
        }

        // Sniff content
        let trimmed = content.trim();
        if trimmed.starts_with("<?xml") || trimmed.starts_with("<Connections") || trimmed.starts_with("<Node") {
            return ImportFormat::MremotengXml;
        }
        if trimmed.starts_with("Windows Registry Editor") || trimmed.starts_with("REGEDIT") {
            return ImportFormat::PuttySessions;
        }
        if trimmed.contains("full address:") || trimmed.contains("screen mode id:") {
            return ImportFormat::RdpFile;
        }
        if trimmed.contains(';') && (trimmed.contains("Name;") || trimmed.contains("Hostname;") || trimmed.contains("Protocol;")) {
            return ImportFormat::MremotengCsv;
        }

        // Default: try XML
        ImportFormat::MremotengXml
    }

    /// Get list of supported import formats.
    pub fn supported_import_formats() -> Vec<Value> {
        vec![
            serde_json::json!({
                "format": "MremotengXml",
                "name": ImportFormat::MremotengXml.as_str(),
                "extensions": [".xml"],
                "description": "mRemoteNG XML connection file (confCons.xml)"
            }),
            serde_json::json!({
                "format": "MremotengCsv",
                "name": ImportFormat::MremotengCsv.as_str(),
                "extensions": [".csv"],
                "description": "mRemoteNG CSV export file"
            }),
            serde_json::json!({
                "format": "RdpFile",
                "name": ImportFormat::RdpFile.as_str(),
                "extensions": [".rdp"],
                "description": "Microsoft Remote Desktop Connection file"
            }),
            serde_json::json!({
                "format": "PuttySessions",
                "name": ImportFormat::PuttySessions.as_str(),
                "extensions": [".reg"],
                "description": "PuTTY sessions (from registry or .reg export)"
            }),
        ]
    }

    /// Get list of supported export formats.
    pub fn supported_export_formats() -> Vec<Value> {
        vec![
            serde_json::json!({
                "format": "MremotengXml",
                "name": ExportFormat::MremotengXml.as_str(),
                "extensions": [".xml"],
                "description": "mRemoteNG XML connection file (confCons.xml)"
            }),
            serde_json::json!({
                "format": "MremotengCsv",
                "name": ExportFormat::MremotengCsv.as_str(),
                "extensions": [".csv"],
                "description": "mRemoteNG CSV export file"
            }),
        ]
    }

    // ─── Import Operations ───────────────────────────────────────

    /// Import from mRemoteNG XML (confCons.xml).
    pub fn import_xml(&mut self, xml_content: &str, config: &MrngImportConfig) -> MremotengResult<MrngImportResult> {
        let password = config.password.as_deref().unwrap_or(&self.default_password);
        let file = xml_parser::parse_xml(xml_content, password)?;

        let connections = file.root.children.clone();
        let total = count_connections(&connections);

        let result = MrngImportResult {
            total,
            imported: total,
            skipped: 0,
            errors: Vec::new(),
            connections,
        };

        self.last_import = Some(result.clone());
        Ok(result)
    }

    /// Import from mRemoteNG XML and convert to app Connection JSON.
    pub fn import_xml_as_app_connections(&mut self, xml_content: &str, config: &MrngImportConfig) -> MremotengResult<Vec<Value>> {
        let import_result = self.import_xml(xml_content, config)?;
        let mut app_connections = Vec::new();

        for mrng_conn in &import_result.connections {
            let flat = converter::mrng_tree_to_flat_connections(mrng_conn);
            app_connections.extend(flat);
        }

        Ok(app_connections)
    }

    /// Import from CSV.
    pub fn import_csv(&mut self, csv_content: &str, config: &MrngImportConfig) -> MremotengResult<MrngImportResult> {
        let password = config.password.as_deref().unwrap_or(&self.default_password);
        let connections = csv_parser::parse_csv(csv_content, password, self.kdf_iterations)?;
        let total = connections.len();

        let result = MrngImportResult {
            total,
            imported: total,
            skipped: 0,
            errors: Vec::new(),
            connections,
        };

        self.last_import = Some(result.clone());
        Ok(result)
    }

    /// Import from CSV and convert to app Connection JSON.
    pub fn import_csv_as_app_connections(&mut self, csv_content: &str, config: &MrngImportConfig) -> MremotengResult<Vec<Value>> {
        let import_result = self.import_csv(csv_content, config)?;
        Ok(import_result.connections.iter()
            .map(converter::mrng_to_app_connection)
            .collect())
    }

    /// Import from .rdp file(s).
    pub fn import_rdp_files(&mut self, files: &[(String, String)]) -> MremotengResult<MrngImportResult> {
        let mut connections = Vec::new();
        let mut errors = Vec::new();

        for result in rdp_parser::parse_rdp_files(files) {
            match result {
                Ok(conn) => connections.push(conn),
                Err(e) => errors.push(e.to_string()),
            }
        }

        let total = connections.len() + errors.len();
        let result = MrngImportResult {
            total,
            imported: connections.len(),
            skipped: errors.len(),
            errors,
            connections,
        };

        self.last_import = Some(result.clone());
        Ok(result)
    }

    /// Import .rdp files and convert to app Connection JSON.
    pub fn import_rdp_as_app_connections(&mut self, files: &[(String, String)]) -> MremotengResult<Vec<Value>> {
        let import_result = self.import_rdp_files(files)?;
        Ok(import_result.connections.iter()
            .map(converter::mrng_to_app_connection)
            .collect())
    }

    /// Import PuTTY sessions from a .reg file.
    pub fn import_putty_from_reg(&mut self, reg_content: &str) -> MremotengResult<MrngImportResult> {
        let sessions = putty_parser::parse_reg_file(reg_content)?;
        let connections = putty_parser::putty_sessions_to_connections(&sessions);
        let total = connections.len();

        let result = MrngImportResult {
            total,
            imported: total,
            skipped: 0,
            errors: Vec::new(),
            connections,
        };

        self.last_import = Some(result.clone());
        Ok(result)
    }

    /// Import PuTTY sessions from the Windows registry.
    pub fn import_putty_from_registry(&mut self) -> MremotengResult<MrngImportResult> {
        let sessions = putty_parser::read_registry_sessions()?;
        let connections = putty_parser::putty_sessions_to_connections(&sessions);
        let total = connections.len();

        let result = MrngImportResult {
            total,
            imported: total,
            skipped: 0,
            errors: Vec::new(),
            connections,
        };

        self.last_import = Some(result.clone());
        Ok(result)
    }

    /// Import PuTTY sessions and convert to app Connection JSON.
    pub fn import_putty_as_app_connections(&mut self, reg_content: Option<&str>) -> MremotengResult<Vec<Value>> {
        let import_result = if let Some(content) = reg_content {
            self.import_putty_from_reg(content)?
        } else {
            self.import_putty_from_registry()?
        };

        Ok(import_result.connections.iter()
            .map(converter::mrng_to_app_connection)
            .collect())
    }

    /// Auto-detect format and import.
    pub fn import_auto(&mut self, file_path: &str, content: &str, config: &MrngImportConfig) -> MremotengResult<MrngImportResult> {
        let format = Self::detect_format(file_path, content);

        match format {
            ImportFormat::MremotengXml => self.import_xml(content, config),
            ImportFormat::MremotengCsv => self.import_csv(content, config),
            ImportFormat::RdpFile => self.import_rdp_files(&[(file_path.to_string(), content.to_string())]),
            ImportFormat::PuttySessions => self.import_putty_from_reg(content),
        }
    }

    /// Auto-detect format and import as app connections.
    pub fn import_auto_as_app_connections(&mut self, file_path: &str, content: &str, config: &MrngImportConfig) -> MremotengResult<Vec<Value>> {
        let import_result = self.import_auto(file_path, content, config)?;
        let mut result = Vec::new();

        for mrng_conn in &import_result.connections {
            // For XML hierarchical data, flatten the tree
            if mrng_conn.node_type == MrngNodeType::Container || mrng_conn.node_type == MrngNodeType::Root {
                result.extend(converter::mrng_tree_to_flat_connections(mrng_conn));
            } else {
                result.push(converter::mrng_to_app_connection(mrng_conn));
            }
        }

        Ok(result)
    }

    // ─── Export Operations ───────────────────────────────────────

    /// Export connections to mRemoteNG XML format.
    pub fn export_xml(&mut self, connections: &[MrngConnectionInfo], config: &MrngExportConfig) -> MremotengResult<MrngExportResult> {
        let password = config.password.as_deref().unwrap_or(&self.default_password);

        let file = MrngConnectionFile {
            conf_version: config.conf_version.clone(),
            encryption: MrngEncryptionConfig {
                kdf_iterations: config.kdf_iterations,
                ..Default::default()
            },
            root: MrngConnectionInfo {
                name: "Connections".into(),
                node_type: MrngNodeType::Root,
                children: connections.to_vec(),
                ..Default::default()
            },
            ..Default::default()
        };

        let xml = xml_writer::write_xml(&file, password)?;
        let total = count_connections(connections);

        let result = MrngExportResult {
            total,
            exported: total,
            format: ExportFormat::MremotengXml.as_str().to_string(),
            path: None,
            content: Some(xml),
        };

        self.last_export = Some(result.clone());
        Ok(result)
    }

    /// Export app connections (JSON) to mRemoteNG XML.
    pub fn export_app_to_xml(&mut self, app_connections: &[Value], config: &MrngExportConfig) -> MremotengResult<MrngExportResult> {
        let mrng_connections = converter::flat_connections_to_mrng_tree(app_connections)?;
        self.export_xml(&mrng_connections, config)
    }

    /// Export connections to mRemoteNG CSV format.
    pub fn export_csv(&mut self, connections: &[MrngConnectionInfo], config: &MrngExportConfig) -> MremotengResult<MrngExportResult> {
        let password = config.password.as_deref().unwrap_or(&self.default_password);

        let csv = csv_writer::write_csv(
            connections,
            password,
            config.kdf_iterations,
            config.encrypt_passwords,
        )?;

        let total = count_connections(connections);

        let result = MrngExportResult {
            total,
            exported: total,
            format: ExportFormat::MremotengCsv.as_str().to_string(),
            path: None,
            content: Some(csv),
        };

        self.last_export = Some(result.clone());
        Ok(result)
    }

    /// Export app connections (JSON) to mRemoteNG CSV.
    pub fn export_app_to_csv(&mut self, app_connections: &[Value], config: &MrngExportConfig) -> MremotengResult<MrngExportResult> {
        let mrng_connections = converter::flat_connections_to_mrng_tree(app_connections)?;
        self.export_csv(&mrng_connections, config)
    }

    /// Export a single connection to .rdp file format.
    pub fn export_rdp_file(&self, connection: &MrngConnectionInfo) -> String {
        rdp_parser::connection_to_rdp_string(connection)
    }

    /// Export an app connection (JSON) to .rdp file format.
    pub fn export_app_to_rdp(&self, app_connection: &Value) -> MremotengResult<String> {
        let mrng = converter::app_connection_to_mrng(app_connection)?;
        Ok(rdp_parser::connection_to_rdp_string(&mrng))
    }

    // ─── Validation ──────────────────────────────────────────────

    /// Validate an mRemoteNG XML file without fully importing it.
    pub fn validate_xml(&self, xml_content: &str, password: &str) -> MremotengResult<Value> {
        let file = xml_parser::parse_xml(xml_content, password)?;
        let total = count_connections(&file.root.children);
        let containers = count_containers(&file.root.children);

        Ok(serde_json::json!({
            "valid": true,
            "version": file.conf_version,
            "name": file.name,
            "totalConnections": total,
            "containers": containers,
            "encrypted": !file.protected.is_empty(),
            "encryptionEngine": format!("{:?}", file.encryption.engine),
            "encryptionMode": format!("{:?}", file.encryption.mode),
            "kdfIterations": file.encryption.kdf_iterations,
        }))
    }

    /// Get last import result.
    pub fn get_last_import(&self) -> Option<&MrngImportResult> {
        self.last_import.as_ref()
    }

    /// Get last export result.
    pub fn get_last_export(&self) -> Option<&MrngExportResult> {
        self.last_export.as_ref()
    }

    /// Set the default password for operations.
    pub fn set_default_password(&mut self, password: &str) {
        self.default_password = password.to_string();
    }

    /// Set the KDF iteration count.
    pub fn set_kdf_iterations(&mut self, iterations: u32) {
        self.kdf_iterations = iterations;
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────

/// Count all connections in a tree (excluding containers themselves).
fn count_connections(nodes: &[MrngConnectionInfo]) -> usize {
    let mut count = 0;
    for node in nodes {
        if node.node_type == MrngNodeType::Connection {
            count += 1;
        }
        count += count_connections(&node.children);
    }
    count
}

/// Count containers in a tree.
fn count_containers(nodes: &[MrngConnectionInfo]) -> usize {
    let mut count = 0;
    for node in nodes {
        if node.node_type == MrngNodeType::Container {
            count += 1;
        }
        count += count_containers(&node.children);
    }
    count
}
