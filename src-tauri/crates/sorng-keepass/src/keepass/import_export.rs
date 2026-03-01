// ── sorng-keepass / import_export ──────────────────────────────────────────────
//
// Import from and export to various password manager formats:
//   KeePass XML, CSV, JSON, 1Password, LastPass, Bitwarden, Chrome, Firefox.
// Also provides merge/sync capabilities.

use uuid::Uuid;
use chrono::Utc;
use std::collections::HashMap;

use super::types::*;
use super::service::KeePassService;

impl KeePassService {
    // ─── Import ───────────────────────────────────────────────────────

    /// Import entries from an external source.
    pub fn import_entries(
        &mut self,
        db_id: &str,
        config: ImportConfig,
    ) -> Result<ImportResult, String> {
        let raw_data = std::fs::read_to_string(&config.file_path)
            .map_err(|e| format!("Cannot read import file: {}", e))?;

        let parsed = match config.format {
            ImportFormat::KeePassXml => self.parse_keepass_xml(&raw_data)?,
            ImportFormat::KeePassCsv => self.parse_keepass_csv(&raw_data, &config)?,
            ImportFormat::GenericCsv => self.parse_generic_csv(&raw_data, &config)?,
            ImportFormat::LastPassCsv => self.parse_lastpass_csv(&raw_data)?,
            ImportFormat::BitwardenJson => self.parse_bitwarden_json(&raw_data)?,
            ImportFormat::BitwardenCsv => self.parse_bitwarden_csv(&raw_data)?,
            ImportFormat::OnePasswordCsv => self.parse_1password_csv(&raw_data)?,
            ImportFormat::ChromeCsv => self.parse_chrome_csv(&raw_data)?,
            ImportFormat::FirefoxCsv => self.parse_firefox_csv(&raw_data)?,
            ImportFormat::KeePassXmlV1 => self.parse_keepass_xml_v1(&raw_data)?,
            ImportFormat::Kdbx => return Err("KDBX import (database merge) should use merge_database()".to_string()),
        };

        // Insert parsed entries into the database
        let target_group = config.target_group_uuid.clone().unwrap_or_default();

        // Ensure target group exists; fall back to root
        let actual_group = {
            let db = self.get_database_mut(db_id)?;
            if target_group.is_empty() || !db.groups.contains_key(&target_group) {
                db.info.root_group_id.clone()
            } else {
                target_group
            }
        };

        let mut entries_imported = 0;
        let mut entries_skipped = 0;
        let mut entries_merged = 0;
        let mut groups_created = 0;
        let errors: Vec<ImportError> = Vec::new();

        for (_line_num, parsed_entry) in parsed.into_iter().enumerate() {
            // Check duplicate handling
            if config.duplicate_handling != DuplicateHandling::ImportAll {
                let db = self.get_database_mut(db_id)?;
                let is_duplicate = db.entries.values().any(|existing| {
                    existing.title == parsed_entry.title
                        && existing.username == parsed_entry.username
                        && existing.url == parsed_entry.url
                });

                if is_duplicate {
                    match config.duplicate_handling {
                        DuplicateHandling::Skip => {
                            entries_skipped += 1;
                            continue;
                        }
                        DuplicateHandling::Replace => {
                            let existing_id = db.entries.iter()
                                .find(|(_, e)| {
                                    e.title == parsed_entry.title
                                        && e.username == parsed_entry.username
                                        && e.url == parsed_entry.url
                                })
                                .map(|(id, _)| id.clone());

                            if let Some(id) = existing_id {
                                db.entries.remove(&id);
                            }
                        }
                        DuplicateHandling::Merge => {
                            entries_merged += 1;
                            let existing_id = db.entries.iter()
                                .find(|(_, e)| {
                                    e.title == parsed_entry.title
                                        && e.username == parsed_entry.username
                                        && e.url == parsed_entry.url
                                })
                                .map(|(id, _)| id.clone());

                            if let Some(id) = existing_id {
                                if let Some(existing) = db.entries.get_mut(&id) {
                                    if existing.password.is_empty() && !parsed_entry.password.is_empty() {
                                        existing.password = parsed_entry.password.clone();
                                    }
                                    if existing.notes.is_empty() && !parsed_entry.notes.is_empty() {
                                        existing.notes = parsed_entry.notes.clone();
                                    }
                                }
                            }
                            continue;
                        }
                        _ => {}
                    }
                }
            }

            // Create group path if needed
            let entry_group = if let Some(ref group_path) = parsed_entry.group_path {
                self.ensure_group_path(db_id, &actual_group, group_path, &mut groups_created)?
            } else {
                actual_group.clone()
            };

            let entry_uuid = Uuid::new_v4().to_string();
            let now = Utc::now().to_rfc3339();

            let entry = KeePassEntry {
                uuid: entry_uuid.clone(),
                title: parsed_entry.title,
                username: parsed_entry.username,
                password: parsed_entry.password,
                url: parsed_entry.url,
                notes: parsed_entry.notes,
                icon_id: parsed_entry.icon_id.unwrap_or(0),
                custom_icon_uuid: None,
                tags: parsed_entry.tags,
                foreground_color: None,
                background_color: None,
                override_url: None,
                auto_type: None,
                otp: None,
                custom_fields: parsed_entry.custom_fields.into_iter()
                    .map(|cf| (cf.key.clone(), CustomField { value: cf.value, is_protected: cf.is_protected }))
                    .collect(),
                attachments: Vec::new(),
                times: KeePassTimes {
                    created: now.clone(),
                    last_modified: now.clone(),
                    last_accessed: now.clone(),
                    expiry_time: None,
                    expires: false,
                    usage_count: 0,
                    location_changed: Some(now.clone()),
                },
                group_uuid: entry_group.clone(),
                password_quality: None,
                history_count: 0,
                is_recycled: false,
            };

            // Re-borrow db after ensure_group_path
            let db = self.get_database_mut(db_id)?;
            db.entries.insert(entry_uuid, entry);
            entries_imported += 1;
        }

        let db = self.get_database_mut(db_id)?;
        db.mark_modified();
        db.rebuild_counts();

        Ok(ImportResult {
            entries_imported,
            entries_skipped,
            entries_merged,
            groups_created,
            errors,
            warnings: Vec::new(),
        })
    }

    /// Ensure a group path exists, creating groups as needed.
    fn ensure_group_path(
        &mut self,
        db_id: &str,
        root_group: &str,
        path: &str,
        groups_created: &mut usize,
    ) -> Result<String, String> {
        let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
        let mut current_group = root_group.to_string();

        for part in parts {
            let db = self.get_database(db_id)?;

            // Check if child group with this name exists under current parent
            let existing = db.groups.iter().find(|(_, g)| {
                g.name == part && g.parent_uuid.as_deref() == Some(&current_group)
            }).map(|(id, _)| id.clone());

            if let Some(existing_id) = existing {
                current_group = existing_id;
            } else {
                // Create new group
                let group_uuid = Uuid::new_v4().to_string();
                let now = Utc::now().to_rfc3339();
                let group = KeePassGroup {
                    uuid: group_uuid.clone(),
                    name: part.to_string(),
                    notes: String::new(),
                    icon_id: 48,
                    custom_icon_uuid: None,
                    parent_uuid: Some(current_group.clone()),
                    is_expanded: true,
                    default_auto_type_sequence: None,
                    enable_auto_type: None,
                    enable_searching: None,
                    last_top_visible_entry: None,
                    is_recycle_bin: false,
                    entry_count: 0,
                    child_group_count: 0,
                    total_entry_count: 0,
                    times: KeePassTimes {
                        created: now.clone(),
                        last_modified: now.clone(),
                        last_accessed: now.clone(),
                        expiry_time: None,
                        expires: false,
                        usage_count: 0,
                        location_changed: Some(now),
                    },
                    tags: Vec::new(),
                    custom_data: HashMap::new(),
                };

                let db = self.get_database_mut(db_id)?;
                db.groups.insert(group_uuid.clone(), group);

                *groups_created += 1;
                current_group = group_uuid;
            }
        }

        Ok(current_group)
    }

    // ─── Export ───────────────────────────────────────────────────────

    /// Export entries to a file.
    pub fn export_entries(
        &self,
        db_id: &str,
        config: ExportConfig,
    ) -> Result<ExportResult, String> {
        let db = self.get_database(db_id)?;

        // Collect entries to export
        let entries: Vec<&KeePassEntry> = if let Some(ref group_uuid) = config.group_uuid {
            db.entries.values()
                .filter(|e| e.group_uuid == *group_uuid)
                .collect()
        } else {
            db.entries.values().collect()
        };

        let content = match config.format {
            ExportFormat::KeePassXml => self.export_keepass_xml(db, &entries)?,
            ExportFormat::KeePassCsv | ExportFormat::Csv | ExportFormat::GenericCsv => {
                self.export_csv(&entries, &config)?
            }
            ExportFormat::Json => self.export_json(&entries)?,
            ExportFormat::Html => self.export_html(db, &entries)?,
            ExportFormat::PlainText => self.export_plain_text(&entries)?,
        };

        std::fs::write(&config.file_path, &content)
            .map_err(|e| format!("Failed to write export file: {}", e))?;

        Ok(ExportResult {
            entries_exported: entries.len(),
            file_path: config.file_path,
            file_size: content.len() as u64,
            format: config.format,
        })
    }

    // ─── Import Parsers ──────────────────────────────────────────────

    fn parse_keepass_xml(&self, data: &str) -> Result<Vec<ParsedEntry>, String> {
        // Parse KeePass 2.x XML export format
        let mut entries = Vec::new();

        // Simple XML parsing for KeePass export format
        let mut current_group_path = String::new();
        let mut in_entry = false;
        let mut in_string = false;
        let mut current_key = String::new();
        let mut current_value = String::new();
        let mut entry_fields: HashMap<String, String> = HashMap::new();
        let mut custom_fields: Vec<ParsedCustomField> = Vec::new();
        let _in_key = false;
        let _in_value = false;

        for line in data.lines() {
            let trimmed = line.trim();

            if trimmed.starts_with("<Group>") {
                // Enter a group
            } else if trimmed.starts_with("<Name>") && !in_entry {
                let name = Self::extract_xml_value(trimmed, "Name");
                if !name.is_empty() {
                    if !current_group_path.is_empty() {
                        current_group_path.push('/');
                    }
                    current_group_path.push_str(&name);
                }
            } else if trimmed == "</Group>" {
                // Pop last path segment
                if let Some(pos) = current_group_path.rfind('/') {
                    current_group_path.truncate(pos);
                } else {
                    current_group_path.clear();
                }
            } else if trimmed == "<Entry>" {
                in_entry = true;
                entry_fields.clear();
                custom_fields.clear();
            } else if trimmed == "</Entry>" && in_entry {
                in_entry = false;
                let entry = ParsedEntry {
                    title: entry_fields.get("Title").cloned().unwrap_or_default(),
                    username: entry_fields.get("UserName").cloned().unwrap_or_default(),
                    password: entry_fields.get("Password").cloned().unwrap_or_default(),
                    url: entry_fields.get("URL").cloned().unwrap_or_default(),
                    notes: entry_fields.get("Notes").cloned().unwrap_or_default(),
                    group_path: if current_group_path.is_empty() { None } else { Some(current_group_path.clone()) },
                    tags: Vec::new(),
                    custom_fields: custom_fields.clone(),
                    icon_id: None,
                };
                entries.push(entry);
            } else if trimmed == "<String>" && in_entry {
                in_string = true;
                current_key.clear();
                current_value.clear();
            } else if trimmed == "</String>" && in_string {
                in_string = false;
                let standard_keys = ["Title", "UserName", "Password", "URL", "Notes"];
                if standard_keys.contains(&current_key.as_str()) {
                    entry_fields.insert(current_key.clone(), current_value.clone());
                } else if !current_key.is_empty() {
                    custom_fields.push(ParsedCustomField {
                        key: current_key.clone(),
                        value: current_value.clone(),
                        is_protected: false,
                    });
                }
            } else if trimmed.starts_with("<Key>") && in_string {
                current_key = Self::extract_xml_value(trimmed, "Key");
            } else if trimmed.starts_with("<Value") && in_string {
                current_value = Self::extract_xml_value(trimmed, "Value");
            }
        }

        Ok(entries)
    }

    fn parse_keepass_csv(&self, data: &str, _config: &ImportConfig) -> Result<Vec<ParsedEntry>, String> {
        self.parse_csv_with_mapping(data, &[
            ("Title", "title"),
            ("User Name", "username"),
            ("Password", "password"),
            ("URL", "url"),
            ("Notes", "notes"),
            ("Group", "group_path"),
        ])
    }

    fn parse_generic_csv(&self, data: &str, config: &ImportConfig) -> Result<Vec<ParsedEntry>, String> {
        // For generic CSV, try auto-detecting columns
        let field_mapping = config.field_mapping.as_ref();

        if let Some(mapping) = field_mapping {
            let map: Vec<(&str, &str)> = mapping.iter()
                .map(|m| (m.key.as_str(), m.value.as_str()))
                .collect();
            self.parse_csv_with_mapping(data, &map)
        } else {
            // Auto-detect common header names
            self.parse_csv_with_mapping(data, &[
                ("title", "title"), ("name", "title"),
                ("username", "username"), ("user", "username"), ("login", "username"), ("email", "username"),
                ("password", "password"), ("pass", "password"),
                ("url", "url"), ("website", "url"), ("site", "url"),
                ("notes", "notes"), ("comment", "notes"), ("comments", "notes"),
                ("group", "group_path"), ("folder", "group_path"),
            ])
        }
    }

    fn parse_lastpass_csv(&self, data: &str) -> Result<Vec<ParsedEntry>, String> {
        self.parse_csv_with_mapping(data, &[
            ("name", "title"),
            ("username", "username"),
            ("password", "password"),
            ("url", "url"),
            ("extra", "notes"),
            ("grouping", "group_path"),
        ])
    }

    fn parse_bitwarden_json(&self, data: &str) -> Result<Vec<ParsedEntry>, String> {
        let parsed: serde_json::Value = serde_json::from_str(data)
            .map_err(|e| format!("Invalid Bitwarden JSON: {}", e))?;

        let mut entries = Vec::new();

        if let Some(items) = parsed.get("items").and_then(|v| v.as_array()) {
            for item in items {
                let login = item.get("login");
                let entry = ParsedEntry {
                    title: item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    username: login.and_then(|l| l.get("username")).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    password: login.and_then(|l| l.get("password")).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    url: login.and_then(|l| l.get("uris"))
                        .and_then(|v| v.as_array())
                        .and_then(|a| a.first())
                        .and_then(|u| u.get("uri"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("").to_string(),
                    notes: item.get("notes").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    group_path: item.get("folderId").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    tags: Vec::new(),
                    custom_fields: {
                        let mut cf = Vec::new();
                        if let Some(fields) = item.get("fields").and_then(|v| v.as_array()) {
                            for f in fields {
                                cf.push(ParsedCustomField {
                                    key: f.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                    value: f.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                    is_protected: f.get("type").and_then(|v| v.as_u64()).unwrap_or(0) == 1,
                                });
                            }
                        }
                        cf
                    },
                    icon_id: None,
                };
                entries.push(entry);
            }
        }

        Ok(entries)
    }

    fn parse_bitwarden_csv(&self, data: &str) -> Result<Vec<ParsedEntry>, String> {
        self.parse_csv_with_mapping(data, &[
            ("name", "title"),
            ("login_username", "username"),
            ("login_password", "password"),
            ("login_uri", "url"),
            ("notes", "notes"),
            ("folder", "group_path"),
        ])
    }

    fn parse_1password_csv(&self, data: &str) -> Result<Vec<ParsedEntry>, String> {
        self.parse_csv_with_mapping(data, &[
            ("Title", "title"),
            ("Username", "username"),
            ("Password", "password"),
            ("URL", "url"),
            ("Notes", "notes"),
            ("Type", "group_path"),
        ])
    }

    fn parse_chrome_csv(&self, data: &str) -> Result<Vec<ParsedEntry>, String> {
        self.parse_csv_with_mapping(data, &[
            ("name", "title"),
            ("username", "username"),
            ("password", "password"),
            ("url", "url"),
            ("note", "notes"),
        ])
    }

    fn parse_firefox_csv(&self, data: &str) -> Result<Vec<ParsedEntry>, String> {
        self.parse_csv_with_mapping(data, &[
            ("url", "url"),
            ("username", "username"),
            ("password", "password"),
            ("hostname", "title"),
            ("httpRealm", "notes"),
        ])
    }

    fn parse_keepass_xml_v1(&self, data: &str) -> Result<Vec<ParsedEntry>, String> {
        // KeePass 1.x XML format (slightly different structure)
        let mut entries = Vec::new();
        let mut in_entry = false;
        let mut entry_fields: HashMap<String, String> = HashMap::new();
        let mut current_group = String::new();

        for line in data.lines() {
            let trimmed = line.trim();

            if trimmed.starts_with("<group>") || trimmed.starts_with("<Group>") {
                // Group element
            } else if trimmed.starts_with("<title>") || trimmed.starts_with("<Title>") {
                if !in_entry {
                    current_group = Self::extract_xml_text(trimmed);
                }
            } else if trimmed == "<entry>" || trimmed == "<Entry>" {
                in_entry = true;
                entry_fields.clear();
            } else if trimmed == "</entry>" || trimmed == "</Entry>" {
                in_entry = false;
                entries.push(ParsedEntry {
                    title: entry_fields.get("title").cloned().unwrap_or_default(),
                    username: entry_fields.get("username").cloned().unwrap_or_default(),
                    password: entry_fields.get("password").cloned().unwrap_or_default(),
                    url: entry_fields.get("url").cloned().unwrap_or_default(),
                    notes: entry_fields.get("comment").cloned().unwrap_or_default(),
                    group_path: if current_group.is_empty() { None } else { Some(current_group.clone()) },
                    tags: Vec::new(),
                    custom_fields: Vec::new(),
                    icon_id: None,
                });
            } else if in_entry {
                // Try to extract known fields
                for tag in &["title", "username", "password", "url", "comment"] {
                    if trimmed.to_lowercase().starts_with(&format!("<{}>", tag)) {
                        entry_fields.insert(tag.to_string(), Self::extract_xml_text(trimmed));
                    }
                }
            }
        }

        Ok(entries)
    }

    // ─── Export Formatters ────────────────────────────────────────────

    fn export_keepass_xml(
        &self,
        db: &super::service::DatabaseInstance,
        entries: &[&KeePassEntry],
    ) -> Result<String, String> {
        let mut xml = String::new();
        xml.push_str("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
        xml.push_str("<KeePassFile>\n");
        xml.push_str("\t<Root>\n");
        xml.push_str(&format!("\t\t<Group>\n"));
        xml.push_str(&format!("\t\t\t<Name>{}</Name>\n", Self::xml_escape(&db.info.name)));

        for entry in entries {
            xml.push_str("\t\t\t<Entry>\n");
            xml.push_str(&format!("\t\t\t\t<UUID>{}</UUID>\n", entry.uuid));
            xml.push_str(&Self::xml_string_element("Title", &entry.title));
            xml.push_str(&Self::xml_string_element("UserName", &entry.username));
            xml.push_str(&Self::xml_string_element("Password", &entry.password));
            xml.push_str(&Self::xml_string_element("URL", &entry.url));
            xml.push_str(&Self::xml_string_element("Notes", &entry.notes));

            for (key, cf) in &entry.custom_fields {
                xml.push_str("\t\t\t\t<String>\n");
                xml.push_str(&format!(
                    "\t\t\t\t\t<Key>{}</Key>\n",
                    Self::xml_escape(key)
                ));
                if cf.is_protected {
                    xml.push_str(&format!(
                        "\t\t\t\t\t<Value Protected=\"True\">{}</Value>\n",
                        Self::xml_escape(&cf.value)
                    ));
                } else {
                    xml.push_str(&format!(
                        "\t\t\t\t\t<Value>{}</Value>\n",
                        Self::xml_escape(&cf.value)
                    ));
                }
                xml.push_str("\t\t\t\t</String>\n");
            }

            xml.push_str("\t\t\t</Entry>\n");
        }

        xml.push_str("\t\t</Group>\n");
        xml.push_str("\t</Root>\n");
        xml.push_str("</KeePassFile>\n");

        Ok(xml)
    }

    fn export_csv(
        &self,
        entries: &[&KeePassEntry],
        _config: &ExportConfig,
    ) -> Result<String, String> {
        let mut csv = String::new();
        csv.push_str("\"Title\",\"User Name\",\"Password\",\"URL\",\"Notes\",\"Group\"\n");

        for entry in entries {
            csv.push_str(&format!(
                "\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\"\n",
                Self::csv_escape(&entry.title),
                Self::csv_escape(&entry.username),
                Self::csv_escape(&entry.password),
                Self::csv_escape(&entry.url),
                Self::csv_escape(&entry.notes),
                Self::csv_escape(&entry.group_uuid),
            ));
        }

        Ok(csv)
    }

    fn export_json(&self, entries: &[&KeePassEntry]) -> Result<String, String> {
        let simplified: Vec<serde_json::Value> = entries.iter().map(|e| {
            serde_json::json!({
                "uuid": e.uuid,
                "title": e.title,
                "username": e.username,
                "password": e.password,
                "url": e.url,
                "notes": e.notes,
                "tags": e.tags,
                "group": e.group_uuid,
                "created": e.times.created,
                "modified": e.times.last_modified,
                "custom_fields": e.custom_fields.iter().map(|(key, cf)| {
                    serde_json::json!({
                        "key": key,
                        "value": cf.value,
                        "protected": cf.is_protected,
                    })
                }).collect::<Vec<_>>(),
            })
        }).collect();

        serde_json::to_string_pretty(&simplified)
            .map_err(|e| format!("JSON serialization failed: {}", e))
    }

    fn export_html(
        &self,
        db: &super::service::DatabaseInstance,
        entries: &[&KeePassEntry],
    ) -> Result<String, String> {
        let mut html = String::new();
        html.push_str("<!DOCTYPE html>\n<html>\n<head>\n");
        html.push_str("<meta charset=\"utf-8\">\n");
        html.push_str(&format!("<title>{} - Export</title>\n", Self::html_escape(&db.info.name)));
        html.push_str("<style>\n");
        html.push_str("body { font-family: sans-serif; margin: 20px; }\n");
        html.push_str("table { border-collapse: collapse; width: 100%; }\n");
        html.push_str("th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }\n");
        html.push_str("th { background-color: #4CAF50; color: white; }\n");
        html.push_str("tr:nth-child(even) { background-color: #f2f2f2; }\n");
        html.push_str("</style>\n</head>\n<body>\n");
        html.push_str(&format!("<h1>{}</h1>\n", Self::html_escape(&db.info.name)));
        html.push_str(&format!("<p>Exported: {}</p>\n", Utc::now().to_rfc3339()));
        html.push_str("<table>\n<tr><th>Title</th><th>Username</th><th>Password</th><th>URL</th><th>Notes</th></tr>\n");

        for entry in entries {
            html.push_str(&format!(
                "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>\n",
                Self::html_escape(&entry.title),
                Self::html_escape(&entry.username),
                Self::html_escape(&entry.password),
                if entry.url.is_empty() {
                    String::new()
                } else {
                    format!("<a href=\"{}\">{}</a>", Self::html_escape(&entry.url), Self::html_escape(&entry.url))
                },
                Self::html_escape(&entry.notes),
            ));
        }

        html.push_str("</table>\n</body>\n</html>");

        Ok(html)
    }

    fn export_plain_text(&self, entries: &[&KeePassEntry]) -> Result<String, String> {
        let mut text = String::new();

        for (i, entry) in entries.iter().enumerate() {
            if i > 0 {
                text.push_str("\n---\n\n");
            }
            text.push_str(&format!("Title: {}\n", entry.title));
            text.push_str(&format!("Username: {}\n", entry.username));
            text.push_str(&format!("Password: {}\n", entry.password));
            if !entry.url.is_empty() {
                text.push_str(&format!("URL: {}\n", entry.url));
            }
            if !entry.notes.is_empty() {
                text.push_str(&format!("Notes: {}\n", entry.notes));
            }
            for (key, cf) in &entry.custom_fields {
                text.push_str(&format!("{}: {}\n", key, cf.value));
            }
        }

        Ok(text)
    }

    // ─── CSV Parsing Helpers ─────────────────────────────────────────

    fn parse_csv_with_mapping(
        &self,
        data: &str,
        field_map: &[(&str, &str)],
    ) -> Result<Vec<ParsedEntry>, String> {
        let mut lines = data.lines();

        // Parse header
        let header_line = lines.next().ok_or("CSV file is empty")?;
        let headers: Vec<String> = Self::parse_csv_line(header_line)
            .into_iter()
            .map(|h| h.trim().to_string())
            .collect();

        // Build column to field mapping
        let mut col_map: HashMap<usize, &str> = HashMap::new();
        for (col_idx, header) in headers.iter().enumerate() {
            let lower = header.to_lowercase();
            for (csv_name, target) in field_map {
                if lower == csv_name.to_lowercase() || lower.contains(&csv_name.to_lowercase()) {
                    col_map.insert(col_idx, target);
                    break;
                }
            }
        }

        let mut entries = Vec::new();

        for line in lines {
            if line.trim().is_empty() {
                continue;
            }

            let values = Self::parse_csv_line(line);
            let mut entry = ParsedEntry {
                title: String::new(),
                username: String::new(),
                password: String::new(),
                url: String::new(),
                notes: String::new(),
                group_path: None,
                tags: Vec::new(),
                custom_fields: Vec::new(),
                icon_id: None,
            };

            for (col_idx, value) in values.iter().enumerate() {
                if let Some(field) = col_map.get(&col_idx) {
                    match *field {
                        "title" => entry.title = value.clone(),
                        "username" => entry.username = value.clone(),
                        "password" => entry.password = value.clone(),
                        "url" => entry.url = value.clone(),
                        "notes" => entry.notes = value.clone(),
                        "group_path" => {
                            if !value.is_empty() {
                                entry.group_path = Some(value.clone());
                            }
                        }
                        _ => {}
                    }
                } else if col_idx < headers.len() && !values[col_idx].is_empty() {
                    // Unmapped columns become custom fields
                    entry.custom_fields.push(ParsedCustomField {
                        key: headers[col_idx].clone(),
                        value: value.clone(),
                        is_protected: false,
                    });
                }
            }

            // Skip completely empty entries
            if !entry.title.is_empty() || !entry.username.is_empty() || !entry.password.is_empty() {
                entries.push(entry);
            }
        }

        Ok(entries)
    }

    /// Parse a single CSV line respecting quoted fields.
    fn parse_csv_line(line: &str) -> Vec<String> {
        let mut fields = Vec::new();
        let mut current = String::new();
        let mut in_quotes = false;
        let mut chars = line.chars().peekable();

        while let Some(ch) = chars.next() {
            if in_quotes {
                if ch == '"' {
                    if chars.peek() == Some(&'"') {
                        // Escaped quote
                        current.push('"');
                        chars.next();
                    } else {
                        in_quotes = false;
                    }
                } else {
                    current.push(ch);
                }
            } else {
                match ch {
                    '"' => in_quotes = true,
                    ',' => {
                        fields.push(current.clone());
                        current.clear();
                    }
                    _ => current.push(ch),
                }
            }
        }
        fields.push(current);

        fields
    }

    // ─── XML/HTML Helpers ────────────────────────────────────────────

    fn extract_xml_value(line: &str, tag: &str) -> String {
        let open = format!("<{}", tag);
        let close = format!("</{}>", tag);

        if let Some(start_pos) = line.find(&open) {
            // Find the end of the opening tag
            if let Some(gt_pos) = line[start_pos..].find('>') {
                let content_start = start_pos + gt_pos + 1;
                if let Some(end_pos) = line.find(&close) {
                    return Self::xml_unescape(&line[content_start..end_pos]);
                }
            }
        }
        String::new()
    }

    fn extract_xml_text(line: &str) -> String {
        if let Some(gt) = line.find('>') {
            if let Some(lt) = line[gt..].find('<') {
                return Self::xml_unescape(&line[gt + 1..gt + lt]);
            }
        }
        String::new()
    }

    fn xml_escape(s: &str) -> String {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;")
    }

    fn xml_unescape(s: &str) -> String {
        s.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
    }

    fn html_escape(s: &str) -> String {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    }

    fn csv_escape(s: &str) -> String {
        s.replace('"', "\"\"")
    }

    fn xml_string_element(key: &str, value: &str) -> String {
        format!(
            "\t\t\t\t<String>\n\t\t\t\t\t<Key>{}</Key>\n\t\t\t\t\t<Value>{}</Value>\n\t\t\t\t</String>\n",
            key,
            Self::xml_escape(value),
        )
    }
}

// ─── Parsed Entry (Internal) ─────────────────────────────────────────

/// Internal representation of a parsed import entry before insertion.
#[derive(Debug, Clone)]
pub struct ParsedEntry {
    pub title: String,
    pub username: String,
    pub password: String,
    pub url: String,
    pub notes: String,
    pub group_path: Option<String>,
    pub tags: Vec<String>,
    pub custom_fields: Vec<ParsedCustomField>,
    pub icon_id: Option<u32>,
}

/// Custom field from parsed import data (has key since it's not yet in HashMap).
#[derive(Debug, Clone)]
pub struct ParsedCustomField {
    pub key: String,
    pub value: String,
    pub is_protected: bool,
}
