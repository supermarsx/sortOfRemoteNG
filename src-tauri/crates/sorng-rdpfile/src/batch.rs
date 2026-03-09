//! Batch import/export operations for RDP files.

use crate::converter;
use crate::error::RdpFileError;
use crate::generator;
use crate::parser;
use crate::types::RdpParseResult;

/// Generate RDP file content for a batch of connections.
///
/// Each connection is a JSON value representing an app connection.
/// Returns a list of `(filename, rdp_content)` pairs.
///
/// The filename is derived from the connection's hostname (with `.rdp` extension).
pub fn generate_batch(connections: &[serde_json::Value]) -> Vec<(String, String)> {
    let mut results = Vec::with_capacity(connections.len());

    for (index, conn) in connections.iter().enumerate() {
        match converter::connection_to_rdp(conn) {
            Ok(rdp) => {
                let hostname = rdp.full_address.clone();
                let safe_name = sanitize_filename(&hostname, index);
                let content = generator::generate_rdp_file(&rdp);
                results.push((format!("{safe_name}.rdp"), content));
            }
            Err(_) => {
                // Skip connections that can't be converted; the caller
                // can use parse_batch for detailed error reporting.
                let fallback_name = format!("connection_{}.rdp", index + 1);
                results.push((
                    fallback_name,
                    format!("; Error: could not convert connection at index {index}\r\n"),
                ));
            }
        }
    }

    results
}

/// Parse multiple RDP file contents.
///
/// Accepts a list of `(filename, content)` pairs.
/// Returns a list of `(filename, Result<RdpParseResult>)` for each file.
pub fn parse_batch(
    files: &[(String, String)],
) -> Vec<(String, Result<RdpParseResult, RdpFileError>)> {
    files
        .iter()
        .map(|(filename, content)| {
            let result = parser::parse_rdp_file(content);
            (filename.clone(), result)
        })
        .collect()
}

/// Sanitize a hostname into a safe filename component.
fn sanitize_filename(hostname: &str, fallback_index: usize) -> String {
    if hostname.is_empty() {
        return format!("connection_{}", fallback_index + 1);
    }

    let sanitized: String = hostname
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();

    if sanitized.is_empty() {
        format!("connection_{}", fallback_index + 1)
    } else {
        sanitized
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_batch_basic() {
        let connections = vec![
            serde_json::json!({ "hostname": "server1", "port": 3389 }),
            serde_json::json!({ "hostname": "server2", "port": 3390, "username": "admin" }),
        ];
        let results = generate_batch(&connections);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].0, "server1.rdp");
        assert_eq!(results[1].0, "server2.rdp");
        assert!(results[0].1.contains("full address:s:server1"));
        assert!(results[1].1.contains("full address:s:server2"));
    }

    #[test]
    fn generate_batch_invalid_connection() {
        let connections = vec![
            serde_json::json!({ "port": 3389 }), // missing hostname
        ];
        let results = generate_batch(&connections);
        assert_eq!(results.len(), 1);
        assert!(results[0].1.contains("Error"));
    }

    #[test]
    fn parse_batch_basic() {
        let files = vec![
            (
                "test1.rdp".to_string(),
                "full address:s:host1\r\n".to_string(),
            ),
            (
                "test2.rdp".to_string(),
                "full address:s:host2\r\nserver port:i:3390\r\n".to_string(),
            ),
        ];
        let results = parse_batch(&files);
        assert_eq!(results.len(), 2);
        assert!(results[0].1.is_ok());
        assert!(results[1].1.is_ok());

        let r1 = results[0].1.as_ref().unwrap();
        assert_eq!(r1.rdp_file.full_address, "host1");

        let r2 = results[1].1.as_ref().unwrap();
        assert_eq!(r2.rdp_file.full_address, "host2");
        assert_eq!(r2.rdp_file.server_port, Some(3390));
    }

    #[test]
    fn parse_batch_with_error() {
        let files = vec![("empty.rdp".to_string(), "".to_string())];
        let results = parse_batch(&files);
        assert_eq!(results.len(), 1);
        assert!(results[0].1.is_err());
    }

    #[test]
    fn sanitize_filename_basic() {
        assert_eq!(sanitize_filename("my-server.local", 0), "my-server.local");
        assert_eq!(
            sanitize_filename("server with spaces", 0),
            "server_with_spaces"
        );
        assert_eq!(sanitize_filename("", 0), "connection_1");
        assert_eq!(sanitize_filename("192.168.1.1", 0), "192.168.1.1");
    }
}
