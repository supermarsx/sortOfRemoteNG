//! Service façade for the RDP file parser/generator.
//!
//! Wraps all RDP file operations behind a single `Arc<Mutex<..>>` state
//! compatible with Tauri's managed-state model.

use std::sync::Arc;
use tokio::sync::Mutex;

use crate::batch;
use crate::converter;
use crate::error::RdpFileError;
use crate::generator::{self, GenerateOptions};
use crate::parser;
use crate::types::*;

/// Type alias for the Tauri managed state.
pub type RdpFileServiceState = Arc<Mutex<RdpFileService>>;

/// Top-level façade for all RDP file operations.
pub struct RdpFileService {
    /// Default generation options used when none are specified.
    pub default_options: GenerateOptions,
}

impl RdpFileService {
    /// Create a new `RdpFileService` wrapped in `Arc<Mutex<..>>`.
    pub fn new() -> RdpFileServiceState {
        let service = Self {
            default_options: GenerateOptions::default(),
        };
        Arc::new(Mutex::new(service))
    }

    // ── Parse ───────────────────────────────────────────────────

    /// Parse `.rdp` file content.
    pub fn parse(&self, content: &str) -> Result<RdpParseResult, RdpFileError> {
        parser::parse_rdp_file(content)
    }

    // ── Generate ────────────────────────────────────────────────

    /// Generate `.rdp` file content from an `RdpFile`.
    pub fn generate(&self, rdp: &RdpFile) -> String {
        generator::generate_rdp_file(rdp)
    }

    /// Generate with specific options.
    pub fn generate_with_options(&self, rdp: &RdpFile, options: &GenerateOptions) -> String {
        generator::generate_with_options(rdp, options)
    }

    // ── Import / Export ─────────────────────────────────────────

    /// Import: parse .rdp content and convert to a `ConnectionImport`.
    pub fn import(&self, content: &str) -> Result<ConnectionImport, RdpFileError> {
        let result = parser::parse_rdp_file(content)?;
        Ok(converter::rdp_to_connection(&result.rdp_file))
    }

    /// Export: convert a connection JSON to .rdp content.
    pub fn export(&self, connection_json: &serde_json::Value) -> Result<String, RdpFileError> {
        let rdp = converter::connection_to_rdp(connection_json)?;
        Ok(generator::generate_rdp_file(&rdp))
    }

    // ── Batch ───────────────────────────────────────────────────

    /// Batch export connections to RDP files.
    pub fn batch_export(&self, connections: &[serde_json::Value]) -> Vec<(String, String)> {
        batch::generate_batch(connections)
    }

    /// Batch import from RDP file contents.
    pub fn batch_import(
        &self,
        files: &[(String, String)],
    ) -> Vec<(String, Result<RdpParseResult, RdpFileError>)> {
        batch::parse_batch(files)
    }

    // ── Validate ────────────────────────────────────────────────

    /// Validate RDP file content and return any warnings/errors.
    pub fn validate(&self, content: &str) -> Result<Vec<String>, RdpFileError> {
        let result = parser::parse_rdp_file(content)?;
        let mut issues = result.warnings;
        if result.rdp_file.full_address.is_empty() {
            issues.push("'full address' is empty — connection will fail".to_string());
        }
        if !result.unknown_settings.is_empty() {
            issues.push(format!(
                "{} unknown setting(s): {}",
                result.unknown_settings.len(),
                result.unknown_settings.join(", ")
            ));
        }
        Ok(issues)
    }
}
