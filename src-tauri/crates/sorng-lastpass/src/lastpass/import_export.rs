use crate::lastpass::types::{
    Account, ExportFormat, ExportResult, ImportFormat, ImportResult, LastPassError, LastPassErrorKind,
};

/// Export accounts to CSV format.
pub fn export_csv(accounts: &[Account]) -> ExportResult {
    let mut csv = String::from("url,username,password,totp,extra,name,grouping,fav\n");
    for account in accounts {
        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{}\n",
            csv_escape(&account.url),
            csv_escape(&account.username),
            csv_escape(&account.password),
            csv_escape(account.totp_secret.as_deref().unwrap_or("")),
            csv_escape(&account.notes),
            csv_escape(&account.name),
            csv_escape(&account.group),
            if account.favorite { "1" } else { "0" }
        ));
    }

    ExportResult {
        format: ExportFormat::Csv,
        total_items: accounts.len() as u64,
        data: csv,
    }
}

/// Export accounts to JSON format.
pub fn export_json(accounts: &[Account]) -> Result<ExportResult, LastPassError> {
    let json = serde_json::to_string_pretty(accounts)
        .map_err(|e| LastPassError::parse_error(format!("JSON serialization failed: {}", e)))?;

    Ok(ExportResult {
        format: ExportFormat::Json,
        total_items: accounts.len() as u64,
        data: json,
    })
}

/// Import accounts from LastPass CSV format.
pub fn import_lastpass_csv(csv_data: &str) -> Result<(Vec<Account>, ImportResult), LastPassError> {
    let mut accounts = Vec::new();
    let mut result = ImportResult {
        total_records: 0,
        imported: 0,
        skipped: 0,
        duplicates: 0,
        errors: Vec::new(),
    };

    let lines: Vec<&str> = csv_data.lines().collect();
    if lines.is_empty() {
        return Err(LastPassError::parse_error("Empty CSV data"));
    }

    // Skip header line
    let header = lines[0].to_lowercase();
    let start_line = if header.contains("url") || header.contains("name") { 1 } else { 0 };

    for (idx, line) in lines[start_line..].iter().enumerate() {
        result.total_records += 1;

        let fields = parse_csv_line(line);
        if fields.len() < 4 {
            result.errors.push(format!("Line {}: insufficient fields", idx + start_line + 1));
            result.skipped += 1;
            continue;
        }

        let account = Account {
            id: format!("import_{}", idx),
            url: fields.first().cloned().unwrap_or_default(),
            username: fields.get(1).cloned().unwrap_or_default(),
            password: fields.get(2).cloned().unwrap_or_default(),
            totp_secret: fields.get(3).and_then(|s| if s.is_empty() { None } else { Some(s.clone()) }),
            notes: fields.get(4).cloned().unwrap_or_default(),
            name: fields.get(5).cloned().unwrap_or_default(),
            group: fields.get(6).cloned().unwrap_or_default(),
            folder_id: fields.get(6).and_then(|s| if s.is_empty() { None } else { Some(s.clone()) }),
            favorite: fields.get(7).map(|s| s == "1").unwrap_or(false),
            auto_login: false,
            never_autofill: false,
            realm: None,
            last_modified: None,
            last_touched: None,
            pwprotect: false,
            custom_fields: Vec::new(),
        };

        accounts.push(account);
        result.imported += 1;
    }

    Ok((accounts, result))
}

/// Import accounts from Chrome CSV format (url, username, password, note).
pub fn import_chrome_csv(csv_data: &str) -> Result<(Vec<Account>, ImportResult), LastPassError> {
    let mut accounts = Vec::new();
    let mut result = ImportResult {
        total_records: 0,
        imported: 0,
        skipped: 0,
        duplicates: 0,
        errors: Vec::new(),
    };

    let lines: Vec<&str> = csv_data.lines().collect();
    if lines.is_empty() {
        return Err(LastPassError::parse_error("Empty CSV data"));
    }

    // Skip header
    for (idx, line) in lines[1..].iter().enumerate() {
        result.total_records += 1;
        let fields = parse_csv_line(line);

        if fields.len() < 3 {
            result.errors.push(format!("Line {}: insufficient fields", idx + 2));
            result.skipped += 1;
            continue;
        }

        // Try to derive name from URL
        let url = fields.first().cloned().unwrap_or_default();
        let name = extract_domain_name(&url);

        let account = Account {
            id: format!("chrome_import_{}", idx),
            name,
            url,
            username: fields.get(1).cloned().unwrap_or_default(),
            password: fields.get(2).cloned().unwrap_or_default(),
            notes: fields.get(3).cloned().unwrap_or_default(),
            group: "Chrome Import".to_string(),
            folder_id: Some("Chrome Import".to_string()),
            favorite: false,
            auto_login: false,
            never_autofill: false,
            realm: None,
            totp_secret: None,
            last_modified: None,
            last_touched: None,
            pwprotect: false,
            custom_fields: Vec::new(),
        };

        accounts.push(account);
        result.imported += 1;
    }

    Ok((accounts, result))
}

/// Import from generic CSV with header detection.
pub fn import_generic_csv(csv_data: &str) -> Result<(Vec<Account>, ImportResult), LastPassError> {
    let lines: Vec<&str> = csv_data.lines().collect();
    if lines.is_empty() {
        return Err(LastPassError::parse_error("Empty CSV data"));
    }

    let header = lines[0].to_lowercase();

    // Try to detect format from header
    if header.contains("url") && header.contains("username") && header.contains("password") {
        if header.contains("grouping") || header.contains("fav") || header.contains("extra") {
            import_lastpass_csv(csv_data)
        } else {
            import_chrome_csv(csv_data)
        }
    } else {
        // Best effort generic import
        import_chrome_csv(csv_data)
    }
}

/// Escape a value for CSV output.
fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// Parse a CSV line handling quoted fields.
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

/// Extract a display name from a URL.
fn extract_domain_name(url: &str) -> String {
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
