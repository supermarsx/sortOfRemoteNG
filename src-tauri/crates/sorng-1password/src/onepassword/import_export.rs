use super::api_client::OnePasswordApiClient;
use super::types::*;

/// Import and export operations for 1Password items.
pub struct OnePasswordImportExport;

impl OnePasswordImportExport {
    /// Export all items from a vault to JSON format.
    pub async fn export_vault_json(
        client: &OnePasswordApiClient,
        vault_id: &str,
    ) -> Result<ExportResult, OnePasswordError> {
        let items = client.list_items(vault_id, None).await?;
        let mut full_items = Vec::new();

        for item in &items {
            if let Some(id) = &item.id {
                match client.get_item(vault_id, id).await {
                    Ok(full) => full_items.push(full),
                    Err(e) => {
                        log::warn!("Failed to fetch item {}: {}", id, e);
                    }
                }
            }
        }

        let data = serde_json::to_string_pretty(&full_items).map_err(|e| {
            OnePasswordError::parse_error(format!("Failed to serialize items: {}", e))
        })?;

        Ok(ExportResult {
            format: ExportFormat::Json,
            total_items: full_items.len() as u64,
            data,
        })
    }

    /// Export items from a vault in CSV format.
    pub async fn export_vault_csv(
        client: &OnePasswordApiClient,
        vault_id: &str,
    ) -> Result<ExportResult, OnePasswordError> {
        let items = client.list_items(vault_id, None).await?;
        let mut csv_lines = vec!["title,category,username,password,url,notes".to_string()];

        for item in &items {
            if let Some(id) = &item.id {
                if let Ok(full) = client.get_item(vault_id, id).await {
                    let fields = full.fields.unwrap_or_default();
                    let username = fields
                        .iter()
                        .find(|f| f.purpose == Some(FieldPurpose::USERNAME))
                        .and_then(|f| f.value.as_deref())
                        .unwrap_or("");
                    let password = fields
                        .iter()
                        .find(|f| f.purpose == Some(FieldPurpose::PASSWORD))
                        .and_then(|f| f.value.as_deref())
                        .unwrap_or("");
                    let notes = fields
                        .iter()
                        .find(|f| f.purpose == Some(FieldPurpose::NOTES))
                        .and_then(|f| f.value.as_deref())
                        .unwrap_or("");
                    let url = full
                        .urls
                        .as_ref()
                        .and_then(|urls| urls.first())
                        .map(|u| u.href.as_str())
                        .unwrap_or("");

                    csv_lines.push(format!(
                        "\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\"",
                        Self::escape_csv(full.title.as_deref().unwrap_or("")),
                        full.category,
                        Self::escape_csv(username),
                        Self::escape_csv(password),
                        Self::escape_csv(url),
                        Self::escape_csv(notes)
                    ));
                }
            }
        }

        Ok(ExportResult {
            format: ExportFormat::Csv,
            total_items: csv_lines.len() as u64 - 1,
            data: csv_lines.join("\n"),
        })
    }

    /// Import items from a JSON array into a vault.
    pub async fn import_json(
        client: &OnePasswordApiClient,
        vault_id: &str,
        json_data: &str,
    ) -> Result<ImportResult, OnePasswordError> {
        let items: Vec<FullItem> = serde_json::from_str(json_data).map_err(|e| {
            OnePasswordError::parse_error(format!("Invalid JSON: {}", e))
        })?;

        let total = items.len() as u64;
        let mut imported = 0u64;
        let mut skipped = 0u64;
        let mut errors = Vec::new();

        for item in &items {
            let mut create_item = item.clone();
            create_item.vault = ItemVaultRef {
                id: vault_id.to_string(),
            };
            create_item.id = None; // Clear ID so a new one is generated

            match client.create_item(vault_id, &create_item).await {
                Ok(_) => imported += 1,
                Err(e) => {
                    errors.push(format!(
                        "Failed to import '{}': {}",
                        item.title.as_deref().unwrap_or("unknown"),
                        e
                    ));
                    skipped += 1;
                }
            }
        }

        Ok(ImportResult {
            total_records: total,
            imported,
            skipped,
            errors,
        })
    }

    /// Import items from a CSV string (1Password CSV format).
    pub async fn import_csv(
        client: &OnePasswordApiClient,
        vault_id: &str,
        csv_data: &str,
    ) -> Result<ImportResult, OnePasswordError> {
        let lines: Vec<&str> = csv_data.lines().collect();
        if lines.is_empty() {
            return Ok(ImportResult {
                total_records: 0,
                imported: 0,
                skipped: 0,
                errors: vec!["Empty CSV data".to_string()],
            });
        }

        let total = (lines.len() - 1) as u64; // Minus header
        let mut imported = 0u64;
        let mut skipped = 0u64;
        let mut errors = Vec::new();

        for line in lines.iter().skip(1) {
            let cols: Vec<&str> = Self::parse_csv_line(line);
            if cols.len() < 4 {
                errors.push(format!("Invalid CSV line: {}", line));
                skipped += 1;
                continue;
            }

            let title = cols[0];
            let username = cols.get(2).unwrap_or(&"");
            let password = cols.get(3).unwrap_or(&"");
            let url = cols.get(4).unwrap_or(&"");
            let notes = cols.get(5).unwrap_or(&"");

            let mut fields = vec![];
            if !username.is_empty() {
                fields.push(Field {
                    id: uuid::Uuid::new_v4().to_string(),
                    section: None,
                    field_type: FieldType::STRING,
                    purpose: Some(FieldPurpose::USERNAME),
                    label: Some("username".to_string()),
                    value: Some(username.to_string()),
                    generate: None,
                    recipe: None,
                    entropy: None,
                });
            }
            if !password.is_empty() {
                fields.push(Field {
                    id: uuid::Uuid::new_v4().to_string(),
                    section: None,
                    field_type: FieldType::CONCEALED,
                    purpose: Some(FieldPurpose::PASSWORD),
                    label: Some("password".to_string()),
                    value: Some(password.to_string()),
                    generate: None,
                    recipe: None,
                    entropy: None,
                });
            }
            if !notes.is_empty() {
                fields.push(Field {
                    id: uuid::Uuid::new_v4().to_string(),
                    section: None,
                    field_type: FieldType::STRING,
                    purpose: Some(FieldPurpose::NOTES),
                    label: Some("notesPlain".to_string()),
                    value: Some(notes.to_string()),
                    generate: None,
                    recipe: None,
                    entropy: None,
                });
            }

            let urls = if !url.is_empty() {
                Some(vec![ItemUrl {
                    label: None,
                    primary: Some(true),
                    href: url.to_string(),
                }])
            } else {
                None
            };

            let full_item = FullItem {
                id: None,
                title: Some(title.to_string()),
                vault: ItemVaultRef {
                    id: vault_id.to_string(),
                },
                category: ItemCategory::LOGIN,
                urls,
                favorite: Some(false),
                tags: None,
                version: None,
                state: None,
                created_at: None,
                updated_at: None,
                last_edited_by: None,
                sections: None,
                fields: Some(fields),
                files: None,
            };

            match client.create_item(vault_id, &full_item).await {
                Ok(_) => imported += 1,
                Err(e) => {
                    errors.push(format!("Failed to import '{}': {}", title, e));
                    skipped += 1;
                }
            }
        }

        Ok(ImportResult {
            total_records: total,
            imported,
            skipped,
            errors,
        })
    }

    fn escape_csv(s: &str) -> String {
        s.replace('"', "\"\"")
    }

    fn parse_csv_line(line: &str) -> Vec<&str> {
        // Simple CSV parsing — handles quoted fields
        let mut cols = Vec::new();
        let mut start = 0;
        let mut in_quotes = false;
        let bytes = line.as_bytes();

        for i in 0..bytes.len() {
            match bytes[i] {
                b'"' => in_quotes = !in_quotes,
                b',' if !in_quotes => {
                    let field = &line[start..i];
                    cols.push(field.trim_matches('"'));
                    start = i + 1;
                }
                _ => {}
            }
        }

        cols.push(line[start..].trim_matches('"'));
        cols
    }
}
