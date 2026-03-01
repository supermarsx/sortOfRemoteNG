//! Templates — reusable message templates with variable substitution.

use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;

/// Manages reusable message templates.
#[derive(Debug)]
pub struct TemplateManager {
    templates: Vec<MessageTemplate>,
}

impl TemplateManager {
    pub fn new() -> Self {
        Self {
            templates: Vec::new(),
        }
    }

    /// Add or update a template.
    pub fn upsert(&mut self, template: MessageTemplate) {
        if let Some(existing) = self.templates.iter_mut().find(|t| t.id == template.id) {
            *existing = template;
        } else {
            self.templates.push(template);
        }
    }

    /// Remove a template by ID.
    pub fn remove(&mut self, template_id: &str) -> Result<(), String> {
        let initial = self.templates.len();
        self.templates.retain(|t| t.id != template_id);
        if self.templates.len() == initial {
            return Err(format!("Template '{}' not found", template_id));
        }
        Ok(())
    }

    /// Get a template by ID.
    pub fn get(&self, template_id: &str) -> Option<&MessageTemplate> {
        self.templates.iter().find(|t| t.id == template_id)
    }

    /// List all templates.
    pub fn list(&self) -> &[MessageTemplate] {
        &self.templates
    }

    /// Render a template with provided variables.
    ///
    /// Variables from the request override those in the template's defaults.
    pub fn render(
        &self,
        template_id: &str,
        variables: &HashMap<String, String>,
    ) -> Result<String, String> {
        let template = self
            .get(template_id)
            .ok_or_else(|| format!("Template '{}' not found", template_id))?;

        // Merge defaults with provided variables (provided wins).
        let mut merged = template.default_variables.clone();
        for (k, v) in variables {
            merged.insert(k.clone(), v.clone());
        }

        Ok(render_body(&template.body, &merged))
    }

    /// Count templates.
    pub fn count(&self) -> usize {
        self.templates.len()
    }

    /// Create some built-in templates for common use cases.
    pub fn load_builtins(&mut self) {
        let now = Utc::now();

        self.upsert(MessageTemplate {
            id: "builtin-connection-status".to_string(),
            name: "Connection Status".to_string(),
            body: "🔌 *Connection {{status}}*\n\
                   Host: `{{host}}`\n\
                   Protocol: {{protocol}}\n\
                   User: {{username}}\n\
                   _{{timestamp}}_"
                .to_string(),
            parse_mode: Some(ParseMode::MarkdownV2),
            default_variables: HashMap::new(),
            reply_markup: None,
            description: Some("Notify about connection status changes".to_string()),
            created_at: now,
            updated_at: None,
        });

        self.upsert(MessageTemplate {
            id: "builtin-server-alert".to_string(),
            name: "Server Alert".to_string(),
            body: "🚨 *Server Alert*\n\
                   Server: `{{server}}`\n\
                   Issue: {{issue}}\n\
                   Severity: {{severity}}\n\
                   _{{timestamp}}_"
                .to_string(),
            parse_mode: Some(ParseMode::MarkdownV2),
            default_variables: {
                let mut m = HashMap::new();
                m.insert("severity".to_string(), "Warning".to_string());
                m
            },
            reply_markup: None,
            description: Some("Alert about server issues".to_string()),
            created_at: now,
            updated_at: None,
        });

        self.upsert(MessageTemplate {
            id: "builtin-daily-digest".to_string(),
            name: "Daily Digest".to_string(),
            body: "📊 *Daily Digest — {{date}}*\n\n\
                   Active sessions: {{active_sessions}}\n\
                   Connections today: {{connections_today}}\n\
                   Failed: {{failed_connections}}\n\
                   Alerts: {{alerts_count}}\n\n\
                   {{custom_notes}}"
                .to_string(),
            parse_mode: Some(ParseMode::MarkdownV2),
            default_variables: {
                let mut m = HashMap::new();
                m.insert("custom_notes".to_string(), String::new());
                m
            },
            reply_markup: None,
            description: Some("Daily status digest report".to_string()),
            created_at: now,
            updated_at: None,
        });

        self.upsert(MessageTemplate {
            id: "builtin-file-transfer".to_string(),
            name: "File Transfer".to_string(),
            body: "📁 *File Transfer {{status}}*\n\
                   File: `{{file_name}}`\n\
                   Size: {{file_size}}\n\
                   Host: `{{host}}`\n\
                   Direction: {{direction}}\n\
                   _{{timestamp}}_"
                .to_string(),
            parse_mode: Some(ParseMode::MarkdownV2),
            default_variables: {
                let mut m = HashMap::new();
                m.insert("direction".to_string(), "upload".to_string());
                m
            },
            reply_markup: None,
            description: Some("Notify about file transfer events".to_string()),
            created_at: now,
            updated_at: None,
        });
    }
}

impl Default for TemplateManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Render a template body by replacing `{{key}}` with values.
fn render_body(body: &str, variables: &HashMap<String, String>) -> String {
    let mut result = body.to_string();
    for (key, value) in variables {
        result = result.replace(&format!("{{{{{}}}}}", key), value);
    }
    result
}

/// Validate a template body — check for balanced `{{…}}` markers.
pub fn validate_template_body(body: &str) -> Result<Vec<String>, String> {
    let mut variables = Vec::new();
    let mut remaining = body;

    while let Some(start) = remaining.find("{{") {
        let after_start = &remaining[start + 2..];
        if let Some(end) = after_start.find("}}") {
            let var_name = &after_start[..end];
            if var_name.is_empty() {
                return Err(format!(
                    "Empty variable name at position {}",
                    body.len() - remaining.len() + start
                ));
            }
            if !var_name
                .chars()
                .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
            {
                return Err(format!("Invalid variable name: '{}'", var_name));
            }
            if !variables.contains(&var_name.to_string()) {
                variables.push(var_name.to_string());
            }
            remaining = &after_start[end + 2..];
        } else {
            return Err(format!(
                "Unclosed '{{{{' at position {}",
                body.len() - remaining.len() + start
            ));
        }
    }

    Ok(variables)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_template(id: &str) -> MessageTemplate {
        MessageTemplate {
            id: id.to_string(),
            name: format!("Template {}", id),
            body: "Hello {{name}}, welcome to {{place}}!".to_string(),
            parse_mode: None,
            default_variables: {
                let mut m = HashMap::new();
                m.insert("place".to_string(), "HQ".to_string());
                m
            },
            reply_markup: None,
            description: None,
            created_at: Utc::now(),
            updated_at: None,
        }
    }

    #[test]
    fn add_and_list() {
        let mut mgr = TemplateManager::new();
        mgr.upsert(test_template("t1"));
        mgr.upsert(test_template("t2"));
        assert_eq!(mgr.count(), 2);
    }

    #[test]
    fn update_template() {
        let mut mgr = TemplateManager::new();
        mgr.upsert(test_template("t1"));
        let mut updated = test_template("t1");
        updated.name = "Updated".to_string();
        mgr.upsert(updated);
        assert_eq!(mgr.count(), 1);
        assert_eq!(mgr.get("t1").unwrap().name, "Updated");
    }

    #[test]
    fn remove_template() {
        let mut mgr = TemplateManager::new();
        mgr.upsert(test_template("t1"));
        mgr.remove("t1").unwrap();
        assert_eq!(mgr.count(), 0);
        assert!(mgr.remove("t1").is_err());
    }

    #[test]
    fn render_template_defaults() {
        let mut mgr = TemplateManager::new();
        mgr.upsert(test_template("t1"));

        let vars = HashMap::from([("name".to_string(), "Alice".to_string())]);
        let result = mgr.render("t1", &vars).unwrap();
        assert_eq!(result, "Hello Alice, welcome to HQ!");
    }

    #[test]
    fn render_template_override_default() {
        let mut mgr = TemplateManager::new();
        mgr.upsert(test_template("t1"));

        let vars = HashMap::from([
            ("name".to_string(), "Bob".to_string()),
            ("place".to_string(), "NYC".to_string()),
        ]);
        let result = mgr.render("t1", &vars).unwrap();
        assert_eq!(result, "Hello Bob, welcome to NYC!");
    }

    #[test]
    fn render_template_not_found() {
        let mgr = TemplateManager::new();
        let vars = HashMap::new();
        assert!(mgr.render("nonexistent", &vars).is_err());
    }

    #[test]
    fn render_template_unresolved_vars() {
        let mut mgr = TemplateManager::new();
        mgr.upsert(test_template("t1"));

        // Don't provide "name" → remains as {{name}}.
        let vars = HashMap::new();
        let result = mgr.render("t1", &vars).unwrap();
        assert!(result.contains("{{name}}"));
        assert!(result.contains("HQ")); // default for "place"
    }

    #[test]
    fn validate_body_valid() {
        let vars = validate_template_body("Hello {{name}}, you are {{age}} years old").unwrap();
        assert_eq!(vars, vec!["name", "age"]);
    }

    #[test]
    fn validate_body_duplicate_vars() {
        let vars = validate_template_body("{{x}} and {{x}} again").unwrap();
        assert_eq!(vars, vec!["x"]);
    }

    #[test]
    fn validate_body_empty_var() {
        assert!(validate_template_body("Hello {{}}").is_err());
    }

    #[test]
    fn validate_body_invalid_char() {
        assert!(validate_template_body("Hello {{name with space}}").is_err());
    }

    #[test]
    fn validate_body_unclosed() {
        assert!(validate_template_body("Hello {{name").is_err());
    }

    #[test]
    fn validate_body_no_vars() {
        let vars = validate_template_body("No variables here").unwrap();
        assert!(vars.is_empty());
    }

    #[test]
    fn load_builtins() {
        let mut mgr = TemplateManager::new();
        mgr.load_builtins();
        assert!(mgr.count() >= 4);
        assert!(mgr.get("builtin-connection-status").is_some());
        assert!(mgr.get("builtin-server-alert").is_some());
        assert!(mgr.get("builtin-daily-digest").is_some());
        assert!(mgr.get("builtin-file-transfer").is_some());
    }

    #[test]
    fn render_builtin_template() {
        let mut mgr = TemplateManager::new();
        mgr.load_builtins();

        let vars = HashMap::from([
            ("status".to_string(), "Connected".to_string()),
            ("host".to_string(), "server01".to_string()),
            ("protocol".to_string(), "SSH".to_string()),
            ("username".to_string(), "admin".to_string()),
            ("timestamp".to_string(), "2025-01-01T00:00:00Z".to_string()),
        ]);

        let result = mgr.render("builtin-connection-status", &vars).unwrap();
        assert!(result.contains("Connected"));
        assert!(result.contains("server01"));
        assert!(result.contains("SSH"));
    }

    #[test]
    fn default_template_manager() {
        let mgr = TemplateManager::default();
        assert_eq!(mgr.count(), 0);
    }
}
