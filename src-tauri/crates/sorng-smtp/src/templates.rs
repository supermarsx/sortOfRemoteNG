//! Email template engine with variable substitution.
//!
//! Supports `{{variable}}` syntax in subject, text body and HTML body templates.

use std::collections::HashMap;

use log::debug;

use crate::types::*;

/// Render a template with the given variables, producing an `EmailMessage`.
pub fn render_template(
    template: &EmailTemplate,
    variables: &HashMap<String, String>,
    from: &EmailAddress,
    to: &[EmailAddress],
) -> SmtpResult<EmailMessage> {
    // Check required variables
    for var in &template.variables {
        if var.required && !variables.contains_key(&var.name) && var.default_value.is_none() {
            return Err(SmtpError::template(format!(
                "Missing required variable: {}",
                var.name
            )));
        }
    }

    // Build effective variable map (user values + defaults)
    let effective = build_effective_variables(template, variables);

    debug!(
        "Rendering template '{}' with {} variables",
        template.name,
        effective.len()
    );

    let subject = substitute(&template.subject_template, &effective);
    let text_body = template
        .text_template
        .as_ref()
        .map(|t| substitute(t, &effective));
    let html_body = template
        .html_template
        .as_ref()
        .map(|t| substitute(t, &effective));

    if text_body.is_none() && html_body.is_none() {
        return Err(SmtpError::template(
            "Template must have at least a text or HTML body template",
        ));
    }

    let msg = EmailMessage {
        from: from.clone(),
        to: to.to_vec(),
        subject,
        text_body,
        html_body,
        ..Default::default()
    };

    Ok(msg)
}

/// Build effective variables by merging user-provided values with template defaults.
fn build_effective_variables(
    template: &EmailTemplate,
    user_vars: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut effective = HashMap::new();

    // Start with defaults
    for var in &template.variables {
        if let Some(ref dv) = var.default_value {
            effective.insert(var.name.clone(), dv.clone());
        }
    }

    // Override with user-provided values
    for (k, v) in user_vars {
        effective.insert(k.clone(), v.clone());
    }

    effective
}

/// Substitute `{{variable}}` patterns in a template string.
pub fn substitute(template: &str, variables: &HashMap<String, String>) -> String {
    let mut result = template.to_string();
    for (key, value) in variables {
        let pattern = format!("{{{{{}}}}}", key);
        result = result.replace(&pattern, value);
    }
    result
}

/// Extract variable names from a template string.
pub fn extract_variables(template: &str) -> Vec<String> {
    let mut vars = Vec::new();
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        rest = &rest[start + 2..];
        if let Some(end) = rest.find("}}") {
            let var_name = rest[..end].trim().to_string();
            if !var_name.is_empty() && !vars.contains(&var_name) {
                vars.push(var_name);
            }
            rest = &rest[end + 2..];
        } else {
            break;
        }
    }
    vars
}

/// Validate a template's variables against declared variables.
pub fn validate_template(template: &EmailTemplate) -> SmtpResult<Vec<String>> {
    let mut all_vars = Vec::new();

    // Collect variables from all template parts
    all_vars.extend(extract_variables(&template.subject_template));
    if let Some(ref text) = template.text_template {
        all_vars.extend(extract_variables(text));
    }
    if let Some(ref html) = template.html_template {
        all_vars.extend(extract_variables(html));
    }

    // Deduplicate
    all_vars.sort();
    all_vars.dedup();

    // Check that all used variables are declared
    let declared: Vec<&str> = template.variables.iter().map(|v| v.name.as_str()).collect();
    let undeclared: Vec<String> = all_vars
        .iter()
        .filter(|v| !declared.contains(&v.as_str()))
        .cloned()
        .collect();

    if !undeclared.is_empty() {
        return Err(SmtpError::template(format!(
            "Undeclared variables used in template: {}",
            undeclared.join(", ")
        )));
    }

    Ok(all_vars)
}

/// Create a simple template for common use cases.
pub fn create_simple_template(
    name: &str,
    subject: &str,
    html_body: &str,
    text_body: Option<&str>,
) -> EmailTemplate {
    let mut template = EmailTemplate::new(name);
    template.subject_template = subject.into();
    template.html_template = Some(html_body.into());
    template.text_template = text_body.map(|t| t.into());

    // Auto-discover variables
    let mut vars = extract_variables(subject);
    if let Some(ref html) = template.html_template {
        for v in extract_variables(html) {
            if !vars.contains(&v) {
                vars.push(v);
            }
        }
    }
    if let Some(ref text) = template.text_template {
        for v in extract_variables(text) {
            if !vars.contains(&v) {
                vars.push(v);
            }
        }
    }

    template.variables = vars
        .into_iter()
        .map(|v| TemplateVariable {
            name: v,
            description: None,
            default_value: None,
            required: true,
        })
        .collect();

    template
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn substitute_variables() {
        let mut vars = HashMap::new();
        vars.insert("name".into(), "Alice".into());
        vars.insert("company".into(), "Acme".into());
        let result = substitute("Hello {{name}} from {{company}}!", &vars);
        assert_eq!(result, "Hello Alice from Acme!");
    }

    #[test]
    fn substitute_missing_variable() {
        let vars = HashMap::new();
        let result = substitute("Hello {{name}}!", &vars);
        assert_eq!(result, "Hello {{name}}!");
    }

    #[test]
    fn extract_vars_simple() {
        let vars = extract_variables("Hello {{name}}, welcome to {{company}}!");
        assert_eq!(vars, vec!["name", "company"]);
    }

    #[test]
    fn extract_vars_deduplication() {
        let vars = extract_variables("{{name}} and {{name}} again");
        assert_eq!(vars, vec!["name"]);
    }

    #[test]
    fn extract_vars_empty_template() {
        let vars = extract_variables("No variables here");
        assert!(vars.is_empty());
    }

    #[test]
    fn render_template_basic() {
        let template = create_simple_template(
            "Welcome",
            "Welcome {{name}}!",
            "<h1>Hello {{name}}</h1><p>Welcome to {{company}}.</p>",
            Some("Hello {{name}}, welcome to {{company}}."),
        );

        let mut vars = HashMap::new();
        vars.insert("name".into(), "Bob".into());
        vars.insert("company".into(), "Acme".into());

        let msg = render_template(
            &template,
            &vars,
            &EmailAddress::new("noreply@acme.com"),
            &[EmailAddress::new("bob@example.com")],
        )
        .unwrap();

        assert_eq!(msg.subject, "Welcome Bob!");
        assert_eq!(msg.text_body.unwrap(), "Hello Bob, welcome to Acme.");
        assert!(msg.html_body.unwrap().contains("<h1>Hello Bob</h1>"));
    }

    #[test]
    fn render_template_missing_required() {
        let template = create_simple_template("Test", "Hi {{name}}", "<p>{{name}}</p>", None);

        let vars = HashMap::new();
        let result = render_template(
            &template,
            &vars,
            &EmailAddress::new("a@b.com"),
            &[EmailAddress::new("c@d.com")],
        );
        assert!(result.is_err());
    }

    #[test]
    fn render_template_with_default() {
        let mut template =
            create_simple_template("Test", "Hi {{name}}", "<p>From {{company}}</p>", None);
        // Set defaults
        for v in &mut template.variables {
            if v.name == "company" {
                v.default_value = Some("DefaultCo".into());
                v.required = false;
            }
        }

        let mut vars = HashMap::new();
        vars.insert("name".into(), "Alice".into());

        let msg = render_template(
            &template,
            &vars,
            &EmailAddress::new("a@b.com"),
            &[EmailAddress::new("c@d.com")],
        )
        .unwrap();

        assert!(msg.html_body.unwrap().contains("DefaultCo"));
    }

    #[test]
    fn validate_template_ok() {
        let template = create_simple_template("Test", "Hi {{name}}", "<p>{{name}}</p>", None);
        let vars = validate_template(&template).unwrap();
        assert_eq!(vars, vec!["name"]);
    }

    #[test]
    fn validate_template_undeclared() {
        let mut template = EmailTemplate::new("Test");
        template.subject_template = "Hi {{unknown}}".into();
        template.html_template = Some("<p>test</p>".into());
        let result = validate_template(&template);
        assert!(result.is_err());
    }

    #[test]
    fn create_simple_template_auto_discovers() {
        let template = create_simple_template(
            "Newsletter",
            "{{month}} Newsletter",
            "<p>Dear {{name}}, here is news for {{month}}.</p>",
            None,
        );
        let var_names: Vec<&str> = template.variables.iter().map(|v| v.name.as_str()).collect();
        assert!(var_names.contains(&"month"));
        assert!(var_names.contains(&"name"));
    }
}
