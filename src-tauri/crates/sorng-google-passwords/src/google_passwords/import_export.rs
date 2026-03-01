use crate::google_passwords::types::{
    Credential, ExportFormat, ExportResult, GooglePasswordsError, ImportResult, ImportSource,
};

/// Import credentials from Google/Chrome CSV format.
/// Expected header: name,url,username,password,note
pub fn import_google_csv(csv_data: &str) -> Result<(Vec<Credential>, ImportResult), GooglePasswordsError> {
    let mut credentials = Vec::new();
    let mut result = ImportResult {
        total_records: 0,
        imported: 0,
        skipped: 0,
        duplicates: 0,
        errors: Vec::new(),
    };

    let lines: Vec<&str> = csv_data.lines().collect();
    if lines.is_empty() {
        return Err(GooglePasswordsError::import_error("Empty CSV data"));
    }

    // Skip header
    for (idx, line) in lines[1..].iter().enumerate() {
        result.total_records += 1;
        let fields = parse_csv_line(line);

        if fields.len() < 4 {
            result.errors.push(format!("Line {}: insufficient fields", idx + 2));
            result.skipped += 1;
            continue;
        }

        let name = fields.first().cloned().unwrap_or_default();
        let url = fields.get(1).cloned().unwrap_or_default();
        let username = fields.get(2).cloned().unwrap_or_default();
        let password = fields.get(3).cloned().unwrap_or_default();
        let notes = fields.get(4).cloned().filter(|s| !s.is_empty());

        if username.is_empty() && password.is_empty() {
            result.skipped += 1;
            continue;
        }

        let display_name = if name.is_empty() {
            extract_domain(&url)
        } else {
            name
        };

        credentials.push(Credential {
            id: uuid::Uuid::new_v4().to_string(),
            name: display_name,
            url,
            username,
            password,
            notes,
            folder: Some("Google Import".to_string()),
            created_at: Some(chrono::Utc::now().to_rfc3339()),
            modified_at: None,
            last_used_at: None,
            compromised: false,
            weak: false,
            reused: false,
            password_strength: None,
            android_app: None,
        });
        result.imported += 1;
    }

    Ok((credentials, result))
}

/// Import credentials from LastPass CSV format.
pub fn import_lastpass_csv(csv_data: &str) -> Result<(Vec<Credential>, ImportResult), GooglePasswordsError> {
    let mut credentials = Vec::new();
    let mut result = ImportResult {
        total_records: 0,
        imported: 0,
        skipped: 0,
        duplicates: 0,
        errors: Vec::new(),
    };

    let lines: Vec<&str> = csv_data.lines().collect();
    if lines.is_empty() {
        return Err(GooglePasswordsError::import_error("Empty CSV data"));
    }

    for (idx, line) in lines[1..].iter().enumerate() {
        result.total_records += 1;
        let fields = parse_csv_line(line);

        if fields.len() < 4 {
            result.errors.push(format!("Line {}: insufficient fields", idx + 2));
            result.skipped += 1;
            continue;
        }

        // LastPass CSV: url,username,password,totp,extra,name,grouping,fav
        let url = fields.first().cloned().unwrap_or_default();
        let username = fields.get(1).cloned().unwrap_or_default();
        let password = fields.get(2).cloned().unwrap_or_default();
        let notes = fields.get(4).cloned().filter(|s| !s.is_empty());
        let name = fields.get(5).cloned().unwrap_or_else(|| extract_domain(&url));
        let folder = fields.get(6).cloned().filter(|s| !s.is_empty());

        credentials.push(Credential {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            url,
            username,
            password,
            notes,
            folder: folder.or_else(|| Some("LastPass Import".to_string())),
            created_at: Some(chrono::Utc::now().to_rfc3339()),
            modified_at: None,
            last_used_at: None,
            compromised: false,
            weak: false,
            reused: false,
            password_strength: None,
            android_app: None,
        });
        result.imported += 1;
    }

    Ok((credentials, result))
}

/// Import from any supported source.
pub fn import_credentials(
    csv_data: &str,
    source: &ImportSource,
) -> Result<(Vec<Credential>, ImportResult), GooglePasswordsError> {
    match source {
        ImportSource::GoogleCsv | ImportSource::ChromeCsv => import_google_csv(csv_data),
        ImportSource::LastPassCsv => import_lastpass_csv(csv_data),
        ImportSource::GenericCsv => import_google_csv(csv_data),
        _ => import_google_csv(csv_data), // best effort
    }
}

/// Export credentials to Google CSV format.
pub fn export_google_csv(credentials: &[Credential]) -> ExportResult {
    let mut csv = String::from("name,url,username,password,note\n");
    for cred in credentials {
        csv.push_str(&format!(
            "{},{},{},{},{}\n",
            csv_escape(&cred.name),
            csv_escape(&cred.url),
            csv_escape(&cred.username),
            csv_escape(&cred.password),
            csv_escape(cred.notes.as_deref().unwrap_or("")),
        ));
    }

    ExportResult {
        format: ExportFormat::GoogleCsv,
        total_items: credentials.len() as u64,
        data: csv,
    }
}

/// Export credentials to JSON format.
pub fn export_json(credentials: &[Credential]) -> Result<ExportResult, GooglePasswordsError> {
    let json = serde_json::to_string_pretty(credentials)
        .map_err(|e| GooglePasswordsError::export_error(format!("JSON serialization failed: {}", e)))?;

    Ok(ExportResult {
        format: ExportFormat::Json,
        total_items: credentials.len() as u64,
        data: json,
    })
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn parse_csv_line(line: &str) -> Vec<String> {
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
    fields
}

fn extract_domain(url: &str) -> String {
    let cleaned = url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("www.");
    if let Some(slash) = cleaned.find('/') {
        cleaned[..slash].to_string()
    } else {
        cleaned.to_string()
    }
}
