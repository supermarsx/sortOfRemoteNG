use crate::dashlane::types::{
    DashlaneCredential, DashlaneError, ImportSource, ImportResult, ExportFormat, ExportResult,
    SecureNote,
};

/// Export credentials to CSV format.
pub fn export_csv(credentials: &[DashlaneCredential]) -> Result<ExportResult, DashlaneError> {
    let mut lines = Vec::new();
    lines.push("title,url,username,username2,password,note,category,otpsecret".to_string());

    for cred in credentials {
        lines.push(format!(
            "{},{},{},{},{},{},{},{}",
            csv_escape(&cred.title),
            csv_escape(&cred.url),
            csv_escape(&cred.login),
            csv_escape(cred.secondary_login.as_deref().unwrap_or("")),
            csv_escape(&cred.password),
            csv_escape(cred.notes.as_deref().unwrap_or("")),
            csv_escape(cred.category.as_deref().unwrap_or("")),
            csv_escape(cred.otp_secret.as_deref().unwrap_or("")),
        ));
    }

    let content = lines.join("\n");
    Ok(ExportResult {
        format: ExportFormat::Csv,
        data: content,
        item_count: credentials.len(),
    })
}

/// Export credentials to JSON format.
pub fn export_json(credentials: &[DashlaneCredential]) -> Result<ExportResult, DashlaneError> {
    let data = serde_json::to_string_pretty(credentials)
        .map_err(|e| DashlaneError::ExportFailed(e.to_string()))?;

    Ok(ExportResult {
        format: ExportFormat::Json,
        data,
        item_count: credentials.len(),
    })
}

/// Import credentials from Dashlane CSV export.
pub fn import_dashlane_csv(csv_content: &str) -> Result<ImportResult, DashlaneError> {
    let mut credentials = Vec::new();
    let mut errors = Vec::new();
    let lines: Vec<&str> = csv_content.lines().collect();

    if lines.is_empty() {
        return Ok(ImportResult {
            source: ImportSource::DashlaneCsv,
            imported_count: 0,
            skipped_count: 0,
            errors,
        });
    }

    // Skip header
    for (idx, line) in lines.iter().skip(1).enumerate() {
        if line.trim().is_empty() {
            continue;
        }

        match parse_csv_line(line) {
            Ok(fields) if fields.len() >= 5 => {
                let now = chrono::Utc::now().to_rfc3339();
                credentials.push(DashlaneCredential {
                    id: uuid::Uuid::new_v4().to_string(),
                    title: fields.first().cloned().unwrap_or_default(),
                    url: fields.get(1).cloned().unwrap_or_default(),
                    login: fields.get(2).cloned().unwrap_or_default(),
                    secondary_login: fields.get(3).map(|s| s.clone()).filter(|s| !s.is_empty()),
                    password: fields.get(4).cloned().unwrap_or_default(),
                    notes: fields.get(5).map(|s| s.clone()).filter(|s| !s.is_empty()),
                    category: fields.get(6).map(|s| s.clone()).filter(|s| !s.is_empty()),
                    auto_login: false,
                    auto_protect: false,
                    otp_secret: fields.get(7).map(|s| s.clone()).filter(|s| !s.is_empty()),
                    otp_url: None,
                    linked_services: Vec::new(),
                    created_at: Some(now.clone()),
                    modified_at: Some(now),
                    last_used_at: None,
                    password_strength: None,
                    compromised: false,
                    reused: false,
                });
            }
            Ok(_) => {
                errors.push(format!("Line {}: insufficient columns", idx + 2));
            }
            Err(e) => {
                errors.push(format!("Line {}: {}", idx + 2, e));
            }
        }
    }

    let imported_count = credentials.len();
    Ok(ImportResult {
        source: ImportSource::DashlaneCsv,
        imported_count,
        skipped_count: errors.len(),
        errors,
    })
}

/// Import from 1Password CSV.
pub fn import_1password_csv(csv_content: &str) -> Result<ImportResult, DashlaneError> {
    import_generic_csv(csv_content, ImportSource::OnePasswordCsv, &["Title", "Url", "Username", "Password", "Notes"])
}

/// Import from LastPass CSV.
pub fn import_lastpass_csv(csv_content: &str) -> Result<ImportResult, DashlaneError> {
    import_generic_csv(csv_content, ImportSource::LastPassCsv, &["name", "url", "username", "password", "extra"])
}

/// Import from Chrome CSV.
pub fn import_chrome_csv(csv_content: &str) -> Result<ImportResult, DashlaneError> {
    import_generic_csv(csv_content, ImportSource::ChromeCsv, &["name", "url", "username", "password", "note"])
}

/// Generic CSV import with column mapping.
fn import_generic_csv(
    csv_content: &str,
    source: ImportSource,
    _expected_headers: &[&str],
) -> Result<ImportResult, DashlaneError> {
    let mut credentials = Vec::new();
    let mut errors = Vec::new();
    let lines: Vec<&str> = csv_content.lines().collect();

    if lines.is_empty() {
        return Ok(ImportResult {
            source,
            imported_count: 0,
            skipped_count: 0,
            errors,
        });
    }

    for (idx, line) in lines.iter().skip(1).enumerate() {
        if line.trim().is_empty() {
            continue;
        }

        match parse_csv_line(line) {
            Ok(fields) if fields.len() >= 4 => {
                let now = chrono::Utc::now().to_rfc3339();
                credentials.push(DashlaneCredential {
                    id: uuid::Uuid::new_v4().to_string(),
                    title: fields.first().cloned().unwrap_or_default(),
                    url: fields.get(1).cloned().unwrap_or_default(),
                    login: fields.get(2).cloned().unwrap_or_default(),
                    secondary_login: None,
                    password: fields.get(3).cloned().unwrap_or_default(),
                    notes: fields.get(4).map(|s| s.clone()).filter(|s| !s.is_empty()),
                    category: None,
                    auto_login: false,
                    auto_protect: false,
                    otp_secret: None,
                    otp_url: None,
                    linked_services: Vec::new(),
                    created_at: Some(now.clone()),
                    modified_at: Some(now),
                    last_used_at: None,
                    password_strength: None,
                    compromised: false,
                    reused: false,
                });
            }
            Ok(_) => errors.push(format!("Line {}: insufficient columns", idx + 2)),
            Err(e) => errors.push(format!("Line {}: {}", idx + 2, e)),
        }
    }

    let imported_count = credentials.len();
    Ok(ImportResult {
        source,
        imported_count,
        skipped_count: errors.len(),
        errors,
    })
}

/// Export secure notes to JSON.
pub fn export_notes_json(notes: &[SecureNote]) -> Result<ExportResult, DashlaneError> {
    let data = serde_json::to_string_pretty(notes)
        .map_err(|e| DashlaneError::ExportFailed(e.to_string()))?;

    Ok(ExportResult {
        format: ExportFormat::Json,
        data,
        item_count: notes.len(),
    })
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn parse_csv_line(line: &str) -> Result<Vec<String>, DashlaneError> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();

    while let Some(ch) = chars.next() {
        if in_quotes {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    current.push('"');
                } else {
                    in_quotes = false;
                }
            } else {
                current.push(ch);
            }
        } else if ch == '"' {
            in_quotes = true;
        } else if ch == ',' {
            fields.push(current.clone());
            current.clear();
        } else {
            current.push(ch);
        }
    }
    fields.push(current);

    Ok(fields)
}
