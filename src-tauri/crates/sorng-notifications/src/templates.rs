//! # Template Engine
//!
//! Manages notification templates with `{{variable}}` placeholder substitution.
//! Ships with a set of built-in templates for common notification scenarios.

use crate::error::NotificationError;
use crate::types::{NotificationTemplate, TemplateFormat};
use std::collections::HashMap;

/// Template engine holding a registry of notification templates.
pub struct TemplateEngine {
    /// Templates keyed by template ID.
    templates: HashMap<String, NotificationTemplate>,
}

impl TemplateEngine {
    /// Create a new template engine pre-loaded with built-in templates.
    pub fn new() -> Self {
        let mut engine = Self {
            templates: HashMap::new(),
        };
        engine.register_builtins();
        engine
    }

    // ── CRUD ────────────────────────────────────────────────────────

    /// Register a template. Overwrites if the ID already exists.
    pub fn add_template(&mut self, template: NotificationTemplate) {
        self.templates.insert(template.id.clone(), template);
    }

    /// Remove a template by ID.
    pub fn remove_template(&mut self, id: &str) -> Result<NotificationTemplate, NotificationError> {
        self.templates
            .remove(id)
            .ok_or_else(|| NotificationError::TemplateNotFound(id.to_string()))
    }

    /// Get a reference to a template by ID.
    pub fn get_template(&self, id: &str) -> Result<&NotificationTemplate, NotificationError> {
        self.templates
            .get(id)
            .ok_or_else(|| NotificationError::TemplateNotFound(id.to_string()))
    }

    /// List all registered templates.
    pub fn list_templates(&self) -> Vec<&NotificationTemplate> {
        self.templates.values().collect()
    }

    // ── Rendering ───────────────────────────────────────────────────

    /// Render a template by replacing `{{variable}}` placeholders with values
    /// from the supplied map.
    ///
    /// Returns `(rendered_title, rendered_body)`.
    pub fn render(
        &self,
        template: &NotificationTemplate,
        variables: &HashMap<String, String>,
    ) -> Result<(String, String), NotificationError> {
        let title = Self::substitute(&template.title_template, variables);
        let body = Self::substitute(&template.body_template, variables);
        Ok((title, body))
    }

    /// Render a template looked up by ID.
    pub fn render_by_id(
        &self,
        template_id: &str,
        variables: &HashMap<String, String>,
    ) -> Result<(String, String), NotificationError> {
        let template = self.get_template(template_id)?;
        self.render(template, variables)
    }

    /// Replace all `{{key}}` occurrences in `text` with values from `vars`.
    /// Unknown variables are left as-is.
    fn substitute(text: &str, vars: &HashMap<String, String>) -> String {
        let mut result = text.to_string();
        for (key, value) in vars {
            let placeholder = format!("{{{{{}}}}}", key);
            result = result.replace(&placeholder, value);
        }
        result
    }

    // ── Built-in Templates ──────────────────────────────────────────

    /// Register the default set of built-in templates.
    fn register_builtins(&mut self) {
        self.add_template(NotificationTemplate {
            id: "connection_status".into(),
            name: "Connection Status Change".into(),
            title_template: "Connection {{connection_name}}: {{status}}".into(),
            body_template: "The connection \"{{connection_name}}\" ({{host}}) changed status to {{status}}.\nProtocol: {{protocol}}\nTime: {{timestamp}}".into(),
            variables: vec![
                "connection_name".into(),
                "host".into(),
                "status".into(),
                "protocol".into(),
                "timestamp".into(),
            ],
            format: TemplateFormat::PlainText,
        });

        self.add_template(NotificationTemplate {
            id: "health_alert".into(),
            name: "Health Check Alert".into(),
            title_template: "Health Alert: {{host}} — {{check_name}}".into(),
            body_template: "Health check \"{{check_name}}\" on {{host}} returned {{result}}.\nDetails: {{details}}\nChecked at: {{timestamp}}".into(),
            variables: vec![
                "host".into(),
                "check_name".into(),
                "result".into(),
                "details".into(),
                "timestamp".into(),
            ],
            format: TemplateFormat::PlainText,
        });

        self.add_template(NotificationTemplate {
            id: "cert_expiry".into(),
            name: "Certificate Expiry Warning".into(),
            title_template: "Certificate Expiring: {{host}}".into(),
            body_template: "The {{cert_type}} certificate for {{host}} expires on {{expiry_date}} ({{days_remaining}} days remaining).\nIssuer: {{issuer}}\nSerial: {{serial}}".into(),
            variables: vec![
                "host".into(),
                "cert_type".into(),
                "expiry_date".into(),
                "days_remaining".into(),
                "issuer".into(),
                "serial".into(),
            ],
            format: TemplateFormat::PlainText,
        });

        self.add_template(NotificationTemplate {
            id: "backup_result".into(),
            name: "Backup Result".into(),
            title_template: "Backup {{result}}: {{backup_name}}".into(),
            body_template: "Backup job \"{{backup_name}}\" finished with result: {{result}}.\nDuration: {{duration}}\nSize: {{size}}\nDestination: {{destination}}".into(),
            variables: vec![
                "backup_name".into(),
                "result".into(),
                "duration".into(),
                "size".into(),
                "destination".into(),
            ],
            format: TemplateFormat::PlainText,
        });

        self.add_template(NotificationTemplate {
            id: "credential_expiry".into(),
            name: "Credential Expiry Warning".into(),
            title_template: "Credential Expiring: {{credential_name}}".into(),
            body_template: "The credential \"{{credential_name}}\" ({{username}}) expires on {{expiry_date}} ({{days_remaining}} days remaining).\nVault: {{vault}}".into(),
            variables: vec![
                "credential_name".into(),
                "username".into(),
                "expiry_date".into(),
                "days_remaining".into(),
                "vault".into(),
            ],
            format: TemplateFormat::PlainText,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_simple_template() {
        let engine = TemplateEngine::new();
        let mut vars = HashMap::new();
        vars.insert("connection_name".into(), "prod-db".into());
        vars.insert("host".into(), "10.0.0.5".into());
        vars.insert("status".into(), "disconnected".into());
        vars.insert("protocol".into(), "SSH".into());
        vars.insert("timestamp".into(), "2026-03-04T12:00:00Z".into());

        let (title, body) = engine.render_by_id("connection_status", &vars).unwrap();
        assert_eq!(title, "Connection prod-db: disconnected");
        assert!(body.contains("10.0.0.5"));
        assert!(body.contains("SSH"));
    }

    #[test]
    fn unknown_variables_left_intact() {
        let tmpl = NotificationTemplate {
            id: "test".into(),
            name: "test".into(),
            title_template: "Hello {{name}} and {{unknown}}".into(),
            body_template: "body".into(),
            variables: vec!["name".into()],
            format: TemplateFormat::PlainText,
        };
        let engine = TemplateEngine::new();
        let mut vars = HashMap::new();
        vars.insert("name".into(), "world".into());

        let (title, _) = engine.render(&tmpl, &vars).unwrap();
        assert_eq!(title, "Hello world and {{unknown}}");
    }

    #[test]
    fn builtin_templates_exist() {
        let engine = TemplateEngine::new();
        assert!(engine.get_template("connection_status").is_ok());
        assert!(engine.get_template("health_alert").is_ok());
        assert!(engine.get_template("cert_expiry").is_ok());
        assert!(engine.get_template("backup_result").is_ok());
        assert!(engine.get_template("credential_expiry").is_ok());
    }
}
