//! syslog-ng configuration management.
use crate::client;
use crate::error::SyslogError;
use crate::types::*;
use std::collections::HashMap;

pub async fn get_config(host: &SyslogHost) -> Result<SyslogNgConfig, SyslogError> {
    let content = client::read_file(host, "/etc/syslog-ng/syslog-ng.conf").await?;
    Ok(parse_syslog_ng_conf(&content))
}

pub async fn restart(host: &SyslogHost) -> Result<(), SyslogError> {
    client::exec_ok(host, "systemctl", &["restart", "syslog-ng"]).await?;
    Ok(())
}

pub async fn check_config(host: &SyslogHost) -> Result<bool, SyslogError> {
    let (_, _, code) = client::exec(host, "syslog-ng", &["--syntax-only"]).await?;
    Ok(code == 0)
}

/// Parse syslog-ng.conf into structured configuration.
///
/// syslog-ng config blocks look like:
/// ```text
/// @version: 3.38
/// source s_local { system(); internal(); };
/// destination d_file { file("/var/log/messages"); };
/// filter f_error { level(err..emerg); };
/// log { source(s_local); filter(f_error); destination(d_file); };
/// ```
fn parse_syslog_ng_conf(content: &str) -> SyslogNgConfig {
    let mut config = SyslogNgConfig {
        version: None,
        sources: Vec::new(),
        destinations: Vec::new(),
        filters: Vec::new(),
        log_paths: Vec::new(),
    };

    // Strip comments (# to EOL, but not inside strings)
    let stripped = strip_comments(content);

    // Extract @version directive
    for line in stripped.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("@version:") {
            config.version = Some(rest.trim().to_string());
            break;
        }
    }

    // Flatten to a single string and extract top-level blocks.
    // syslog-ng blocks are: `keyword name { ... };`
    let flat = stripped.lines().collect::<Vec<_>>().join(" ");
    let blocks = extract_blocks(&flat);

    for (keyword, name, body) in blocks {
        match keyword.as_str() {
            "source" => {
                let (driver, options) = parse_driver_body(&body);
                config.sources.push(SyslogNgSource {
                    name,
                    driver,
                    options,
                });
            }
            "destination" => {
                let (driver, options) = parse_driver_body(&body);
                let path = options.get("file").or_else(|| options.get("path")).cloned();
                config.destinations.push(SyslogNgDestination {
                    name,
                    driver,
                    path,
                    options,
                });
            }
            "filter" => {
                config.filters.push(SyslogNgFilter {
                    name,
                    expression: body.trim().to_string(),
                });
            }
            "log" => {
                let mut sources = Vec::new();
                let mut filters = Vec::new();
                let mut destinations = Vec::new();
                for call in extract_function_calls(&body) {
                    match call.0.as_str() {
                        "source" => sources.push(call.1),
                        "filter" => filters.push(call.1),
                        "destination" => destinations.push(call.1),
                        _ => {}
                    }
                }
                config.log_paths.push(SyslogNgLogPath {
                    sources,
                    filters,
                    destinations,
                });
            }
            _ => {}
        }
    }

    config
}

/// Strip line comments (lines starting with # or inline # outside quotes).
fn strip_comments(content: &str) -> String {
    let mut result = String::with_capacity(content.len());
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }
        // Simple inline comment removal (not inside quotes)
        let mut in_quote = false;
        let mut comment_pos = None;
        for (i, ch) in trimmed.char_indices() {
            if ch == '"' || ch == '\'' {
                in_quote = !in_quote;
            } else if ch == '#' && !in_quote {
                comment_pos = Some(i);
                break;
            }
        }
        if let Some(pos) = comment_pos {
            result.push_str(&trimmed[..pos]);
        } else {
            result.push_str(trimmed);
        }
        result.push('\n');
    }
    result
}

/// Extract top-level `keyword name { body };` blocks.
fn extract_blocks(input: &str) -> Vec<(String, String, String)> {
    let mut blocks = Vec::new();
    let mut chars = input.char_indices().peekable();
    let keywords = ["source", "destination", "filter", "log", "rewrite", "parser", "template"];

    while let Some(&(i, _)) = chars.peek() {
        // Try to match a keyword at position i
        let rest = &input[i..];
        let mut matched = None;
        for kw in &keywords {
            if rest.starts_with(kw) {
                let after = rest.as_bytes().get(kw.len());
                if after.is_none_or(|&b| b == b' ' || b == b'\t' || b == b'{') {
                    matched = Some(*kw);
                    break;
                }
            }
        }

        if let Some(kw) = matched {
            // Advance past keyword
            for _ in 0..kw.len() {
                chars.next();
            }

            // Skip whitespace to get name
            while let Some(&(_, ch)) = chars.peek() {
                if ch.is_whitespace() {
                    chars.next();
                } else {
                    break;
                }
            }

            // For "log" blocks, there's no name — body starts at {
            let (name, _) = if kw == "log" {
                ("".to_string(), 0)
            } else {
                // Collect name until { or whitespace
                let mut name = String::new();
                while let Some(&(_, ch)) = chars.peek() {
                    if ch == '{' || ch.is_whitespace() {
                        break;
                    }
                    name.push(ch);
                    chars.next();
                }
                (name, 0)
            };

            // Find opening brace
            while let Some(&(_, ch)) = chars.peek() {
                if ch == '{' {
                    chars.next();
                    break;
                }
                chars.next();
            }

            // Collect body until matching closing brace
            let mut depth = 1;
            let mut body = String::new();
            while let Some(&(_, ch)) = chars.peek() {
                chars.next();
                if ch == '{' {
                    depth += 1;
                    body.push(ch);
                } else if ch == '}' {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                    body.push(ch);
                } else {
                    body.push(ch);
                }
            }

            blocks.push((kw.to_string(), name, body));
        } else {
            chars.next();
        }
    }

    blocks
}

/// Parse the body of a source/destination block to extract driver name and options.
/// Example: `file("/var/log/messages" owner("root") group("adm") perm(0640));`
fn parse_driver_body(body: &str) -> (String, HashMap<String, String>) {
    let mut options = HashMap::new();
    let trimmed = body.trim().trim_end_matches(';').trim();

    // Driver is the first word/function call
    let driver_end = trimmed
        .find(|c: char| c == '(' || c == ';' || c.is_whitespace())
        .unwrap_or(trimmed.len());
    let driver = trimmed[..driver_end].trim().to_string();

    // Extract key(value) pairs
    for call in extract_function_calls(trimmed) {
        options.insert(call.0, call.1);
    }

    // If driver itself has a parenthesized argument (like `file("/path")`),
    // extract that as a "file" or "path" option
    if !driver.is_empty() {
        let rest = &trimmed[driver_end..];
        if let Some(val) = extract_first_paren_value(rest) {
            options
                .entry(driver.clone())
                .or_insert_with(|| val.trim_matches('"').to_string());
        }
    }

    (driver, options)
}

/// Extract `name(value)` calls from a body string.
fn extract_function_calls(body: &str) -> Vec<(String, String)> {
    let mut calls = Vec::new();
    let mut i = 0;
    let bytes = body.as_bytes();
    while i < bytes.len() {
        // Find a word followed by (
        if bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_' {
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
                i += 1;
            }
            let name = &body[start..i];
            // Skip whitespace
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            if i < bytes.len() && bytes[i] == b'(' {
                i += 1;
                let mut depth = 1;
                let val_start = i;
                while i < bytes.len() && depth > 0 {
                    match bytes[i] {
                        b'(' => depth += 1,
                        b')' => depth -= 1,
                        _ => {}
                    }
                    if depth > 0 {
                        i += 1;
                    }
                }
                let val = body[val_start..i].trim().trim_matches('"').to_string();
                calls.push((name.to_string(), val));
                if i < bytes.len() {
                    i += 1; // skip closing )
                }
            }
        } else {
            i += 1;
        }
    }
    calls
}

/// Extract the first parenthesized value: `("foo")` -> `"foo"`.
fn extract_first_paren_value(s: &str) -> Option<String> {
    let start = s.find('(')?;
    let mut depth = 0;
    let mut end = start;
    for (i, ch) in s[start..].char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    end = start + i;
                    break;
                }
            }
            _ => {}
        }
    }
    if end > start + 1 {
        Some(s[start + 1..end].to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_basic_config() {
        let input = r#"
@version: 3.38

# Global options
source s_local {
    system();
    internal();
};

destination d_messages {
    file("/var/log/messages");
};

filter f_error {
    level(err..emerg);
};

log {
    source(s_local);
    filter(f_error);
    destination(d_messages);
};
"#;

        let config = parse_syslog_ng_conf(input);
        assert_eq!(config.version, Some("3.38".to_string()));
        assert_eq!(config.sources.len(), 1);
        assert_eq!(config.sources[0].name, "s_local");
        assert_eq!(config.destinations.len(), 1);
        assert_eq!(config.destinations[0].name, "d_messages");
        assert_eq!(config.filters.len(), 1);
        assert_eq!(config.filters[0].name, "f_error");
        assert_eq!(config.log_paths.len(), 1);
        assert_eq!(config.log_paths[0].sources, vec!["s_local"]);
        assert_eq!(config.log_paths[0].filters, vec!["f_error"]);
        assert_eq!(config.log_paths[0].destinations, vec!["d_messages"]);
    }

    #[test]
    fn test_strip_comments() {
        let input = "# comment\nsource s { system(); };\n";
        let stripped = strip_comments(input);
        assert!(!stripped.contains("# comment"));
        assert!(stripped.contains("source"));
    }

    #[test]
    fn test_parse_empty_input() {
        let config = parse_syslog_ng_conf("");
        assert!(config.version.is_none());
        assert!(config.sources.is_empty());
        assert!(config.destinations.is_empty());
        assert!(config.filters.is_empty());
        assert!(config.log_paths.is_empty());
    }

    #[test]
    fn test_parse_version_only() {
        let config = parse_syslog_ng_conf("@version: 4.0");
        assert_eq!(config.version, Some("4.0".to_string()));
    }

    #[test]
    fn test_multiple_sources_and_destinations() {
        let input = r#"
@version: 3.38
source s_net { tcp(port(514)); };
source s_local { system(); };
destination d_file { file("/var/log/messages"); };
destination d_remote { tcp("10.0.0.1" port(514)); };
log { source(s_net); source(s_local); destination(d_file); destination(d_remote); };
"#;
        let config = parse_syslog_ng_conf(input);
        assert_eq!(config.sources.len(), 2);
        assert_eq!(config.destinations.len(), 2);
        assert_eq!(config.log_paths.len(), 1);
        assert_eq!(config.log_paths[0].sources.len(), 2);
        assert_eq!(config.log_paths[0].destinations.len(), 2);
    }

    #[test]
    fn test_inline_comment_stripped() {
        let input = "source s_local { system(); }; # this is inline";
        let stripped = strip_comments(input);
        assert!(!stripped.contains("this is inline"));
        assert!(stripped.contains("system()"));
    }

    #[test]
    fn test_hash_inside_quotes_preserved() {
        let input = r#"destination d { file("/var/log/#special"); };"#;
        let stripped = strip_comments(input);
        assert!(stripped.contains("#special"));
    }

    #[test]
    fn test_filter_expression_captured() {
        let input = r#"filter f_crit { level(crit..emerg) and facility(kern); };"#;
        let config = parse_syslog_ng_conf(input);
        assert_eq!(config.filters.len(), 1);
        assert_eq!(config.filters[0].name, "f_crit");
        assert!(config.filters[0].expression.contains("level"));
    }

    #[test]
    fn test_nested_braces() {
        let input = r#"source s { tcp(ip("0.0.0.0") port(514) flags(no-parse) { options(); }); };"#;
        let config = parse_syslog_ng_conf(input);
        assert_eq!(config.sources.len(), 1);
        assert_eq!(config.sources[0].name, "s");
    }

    #[test]
    fn test_extract_function_calls_basic() {
        let calls = extract_function_calls("source(s_local); filter(f_err); destination(d_file)");
        assert_eq!(calls.len(), 3);
        assert_eq!(calls[0], ("source".to_string(), "s_local".to_string()));
        assert_eq!(calls[1], ("filter".to_string(), "f_err".to_string()));
        assert_eq!(calls[2], ("destination".to_string(), "d_file".to_string()));
    }

    #[test]
    fn test_extract_function_calls_empty() {
        assert!(extract_function_calls("").is_empty());
    }

    #[test]
    fn test_extract_blocks_unknown_keyword_skipped() {
        let input = "option o { something(); }; source s { system(); };";
        let blocks = extract_blocks(input);
        // "option" is not a recognized keyword, "source" is
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].0, "source");
    }

    #[test]
    fn test_destination_file_path_extracted() {
        let input = r#"destination d_log { file("/var/log/messages"); };"#;
        let config = parse_syslog_ng_conf(input);
        assert_eq!(config.destinations.len(), 1);
        assert_eq!(config.destinations[0].path, Some("/var/log/messages".to_string()));
    }
}
