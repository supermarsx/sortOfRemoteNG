use super::api_client::OnePasswordApiClient;
use super::types::*;

/// Import and export operations for 1Password items.
pub struct OnePasswordImportExport;

const MAX_IMPORT_BYTES: usize = 16 * 1024 * 1024;
const MAX_TRANSFER_ITEMS: usize = 1_000;
const MAX_CSV_LINE_BYTES: usize = 64 * 1024;
const MAX_IMPORT_ERRORS: usize = 100;

impl OnePasswordImportExport {
    /// Export all items from a vault to JSON format.
    pub async fn export_vault_json(
        _client: &OnePasswordApiClient,
        _vault_id: &str,
    ) -> Result<ExportResult, OnePasswordError> {
        Err(OnePasswordError::forbidden(
            "Plaintext vault export requires explicit acknowledgement that this API cannot capture",
        ))
    }

    /// Export items from a vault in CSV format.
    pub async fn export_vault_csv(
        _client: &OnePasswordApiClient,
        _vault_id: &str,
    ) -> Result<ExportResult, OnePasswordError> {
        Err(OnePasswordError::forbidden(
            "Plaintext vault export requires explicit acknowledgement that this API cannot capture",
        ))
    }

    /// Import items from a JSON array into a vault.
    pub async fn import_json(
        client: &OnePasswordApiClient,
        vault_id: &str,
        json_data: &str,
    ) -> Result<ImportResult, OnePasswordError> {
        if json_data.len() > MAX_IMPORT_BYTES {
            return Err(OnePasswordError::new(
                OnePasswordErrorKind::FileTooLarge,
                "JSON import exceeded the configured safety limit",
            ));
        }
        let items: Vec<FullItem> = serde_json::from_str(json_data)
            .map_err(|_| OnePasswordError::parse_error("Import data is not valid JSON"))?;
        if items.len() > MAX_TRANSFER_ITEMS {
            return Err(OnePasswordError::new(
                OnePasswordErrorKind::FileTooLarge,
                "JSON import contains too many items",
            ));
        }

        let total = items.len() as u64;
        let mut imported = 0u64;
        let mut skipped = 0u64;
        let mut errors = Vec::new();

        for mut create_item in items {
            create_item.vault = ItemVaultRef {
                id: vault_id.to_string(),
            };
            create_item.id = None; // Clear ID so a new one is generated

            match client.create_item(vault_id, &create_item).await {
                Ok(_) => imported += 1,
                Err(e) => {
                    if errors.len() < MAX_IMPORT_ERRORS {
                        errors.push(format!("Item import failed: {}", e.message));
                    }
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
        if csv_data.len() > MAX_IMPORT_BYTES {
            return Err(OnePasswordError::new(
                OnePasswordErrorKind::FileTooLarge,
                "CSV import exceeded the configured safety limit",
            ));
        }
        let lines: Vec<&str> = csv_data.lines().collect();
        if lines.is_empty() {
            return Ok(ImportResult {
                total_records: 0,
                imported: 0,
                skipped: 0,
                errors: vec!["Empty CSV data".to_string()],
            });
        }
        if lines.len().saturating_sub(1) > MAX_TRANSFER_ITEMS {
            return Err(OnePasswordError::new(
                OnePasswordErrorKind::FileTooLarge,
                "CSV import contains too many rows",
            ));
        }

        let total = (lines.len() - 1) as u64; // Minus header
        let mut imported = 0u64;
        let mut skipped = 0u64;
        let mut errors = Vec::new();

        for (row_index, line) in lines.iter().enumerate().skip(1) {
            if line.len() > MAX_CSV_LINE_BYTES {
                if errors.len() < MAX_IMPORT_ERRORS {
                    errors.push(format!("CSV row {} is too large", row_index + 1));
                }
                skipped += 1;
                continue;
            }
            let cols = match Self::parse_csv_line(line) {
                Ok(cols) => cols,
                Err(()) => {
                    if errors.len() < MAX_IMPORT_ERRORS {
                        errors.push(format!("CSV row {} is malformed", row_index + 1));
                    }
                    skipped += 1;
                    continue;
                }
            };
            if cols.len() < 4 {
                if errors.len() < MAX_IMPORT_ERRORS {
                    errors.push(format!("CSV row {} has too few columns", row_index + 1));
                }
                skipped += 1;
                continue;
            }

            let title = cols[0].as_str();
            let username = cols.get(2).map(String::as_str).unwrap_or("");
            let password = cols.get(3).map(String::as_str).unwrap_or("");
            let url = cols.get(4).map(String::as_str).unwrap_or("");
            let notes = cols.get(5).map(String::as_str).unwrap_or("");

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
                    if errors.len() < MAX_IMPORT_ERRORS {
                        errors.push(format!("Item import failed: {}", e.message));
                    }
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

    fn parse_csv_line(line: &str) -> Result<Vec<String>, ()> {
        let mut cols = Vec::new();
        let mut field = String::new();
        let mut in_quotes = false;
        let mut chars = line.chars().peekable();

        while let Some(ch) = chars.next() {
            match ch {
                '"' if in_quotes && chars.peek() == Some(&'"') => {
                    chars.next();
                    field.push('"');
                }
                '"' => in_quotes = !in_quotes,
                ',' if !in_quotes => {
                    cols.push(std::mem::take(&mut field));
                }
                _ => field.push(ch),
            }
        }
        if in_quotes {
            return Err(());
        }
        cols.push(field);
        Ok(cols)
    }
}
