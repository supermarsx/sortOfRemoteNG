// ── Prompt Template Engine ────────────────────────────────────────────────────

use std::collections::HashMap;
use chrono::Utc;
use regex::Regex;
use uuid::Uuid;

use super::types::*;

// ── Template Registry ────────────────────────────────────────────────────────

pub struct TemplateRegistry {
    templates: HashMap<String, PromptTemplate>,
}

impl TemplateRegistry {
    pub fn new() -> Self { Self { templates: HashMap::new() } }

    pub fn register(&mut self, template: PromptTemplate) {
        self.templates.insert(template.id.clone(), template);
    }

    pub fn get(&self, id: &str) -> Option<&PromptTemplate> { self.templates.get(id) }
    pub fn remove(&mut self, id: &str) -> bool { self.templates.remove(id).is_some() }
    pub fn list(&self) -> Vec<&PromptTemplate> { self.templates.values().collect() }

    pub fn find_by_name(&self, name: &str) -> Option<&PromptTemplate> {
        self.templates.values().find(|t| t.name == name)
    }

    pub fn find_by_tag(&self, tag: &str) -> Vec<&PromptTemplate> {
        self.templates.values().filter(|t| t.tags.contains(&tag.to_string())).collect()
    }

    pub fn create(
        &mut self, name: &str, template: &str, description: &str,
        variables: Vec<TemplateVariable>, tags: Vec<String>,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let pt = PromptTemplate {
            id: id.clone(), name: name.into(), description: description.into(),
            template: template.into(), variables, category: None, tags,
            version: 1, created_at: now, updated_at: now,
        };
        self.templates.insert(id.clone(), pt);
        id
    }

    pub fn update(&mut self, id: &str, template_text: Option<&str>, description: Option<&str>, variables: Option<Vec<TemplateVariable>>) -> Result<(), String> {
        let pt = self.templates.get_mut(id).ok_or_else(|| format!("Template {} not found", id))?;
        if let Some(t) = template_text { pt.template = t.to_string(); }
        if let Some(d) = description { pt.description = d.to_string(); }
        if let Some(v) = variables { pt.variables = v; }
        pt.version += 1;
        pt.updated_at = Utc::now();
        Ok(())
    }
}

// ── Template Rendering ───────────────────────────────────────────────────────

pub fn render_template(template: &str, variables: &HashMap<String, String>) -> Result<String, String> {
    let re = Regex::new(r"\{\{(\w+)\}\}").map_err(|e| format!("Regex error: {}", e))?;
    let mut result = template.to_string();

    result = re.replace_all(&result, |caps: &regex::Captures| {
        let var_name = &caps[1];
        variables.get(var_name).cloned().unwrap_or_else(|| format!("{{{{{}}}}}", var_name))
    }).to_string();

    // Handle conditional blocks: {{#if var}}...{{/if}}
    let cond_re = Regex::new(r"\{\{#if (\w+)\}\}([\s\S]*?)\{\{/if\}\}").map_err(|e| format!("{}", e))?;
    result = cond_re.replace_all(&result, |caps: &regex::Captures| {
        let var = &caps[1];
        let body = &caps[2];
        match variables.get(var) {
            Some(v) if !v.is_empty() && v != "false" && v != "0" => body.to_string(),
            _ => String::new(),
        }
    }).to_string();

    // Handle {{#each items}}...{{/each}}
    let each_re = Regex::new(r"\{\{#each (\w+)\}\}([\s\S]*?)\{\{/each\}\}").map_err(|e| format!("{}", e))?;
    result = each_re.replace_all(&result, |caps: &regex::Captures| {
        let var = &caps[1];
        let body_template = &caps[2];
        match variables.get(var) {
            Some(list_str) => list_str.split(',').enumerate().map(|(i, item)| {
                body_template.replace("{{this}}", item.trim()).replace("{{@index}}", &i.to_string())
            }).collect::<Vec<_>>().join(""),
            None => String::new(),
        }
    }).to_string();

    Ok(result)
}

pub fn validate_template_variables(
    template: &PromptTemplate, variables: &HashMap<String, String>,
) -> Result<(), String> {
    let missing: Vec<_> = template.variables.iter()
        .filter(|v| v.required && !variables.contains_key(&v.name))
        .map(|v| v.name.clone())
        .collect();
    if missing.is_empty() { Ok(()) }
    else { Err(format!("Missing required variables: {}", missing.join(", "))) }
}

pub fn render_prompt_template(
    template: &PromptTemplate, variables: &HashMap<String, String>,
) -> Result<String, String> {
    let mut vars = HashMap::new();
    for v in &template.variables {
        if let Some(default) = &v.default_value {
            vars.insert(v.name.clone(), default.clone());
        }
    }
    for (k, v) in variables {
        vars.insert(k.clone(), v.clone());
    }
    validate_template_variables(template, &vars)?;
    render_template(&template.template, &vars)
}

// ── Helper to create a TemplateVariable ──────────────────────────────────────

fn tvar(name: &str, desc: &str, required: bool, default: Option<&str>) -> TemplateVariable {
    TemplateVariable {
        name: name.into(), description: desc.into(), required,
        default_value: default.map(String::from), pattern: None,
    }
}

// ── Built-in Templates ───────────────────────────────────────────────────────

pub fn builtin_templates() -> Vec<PromptTemplate> {
    let now = Utc::now();
    vec![
        PromptTemplate {
            id: "builtin-summarise".into(), name: "Summarise Text".into(),
            description: "Summarise the provided text concisely.".into(),
            template: "Please summarise the following text in {{style}} style:\n\n{{text}}".into(),
            variables: vec![
                tvar("text", "The text to summarise", true, None),
                tvar("style", "Summary style (brief, detailed, bullet)", false, Some("brief")),
            ],
            category: Some("builtin".into()), tags: vec!["builtin".into(), "summarisation".into()],
            version: 1, created_at: now, updated_at: now,
        },
        PromptTemplate {
            id: "builtin-translate".into(), name: "Translate Text".into(),
            description: "Translate text to a target language.".into(),
            template: "Translate the following text to {{language}}:\n\n{{text}}".into(),
            variables: vec![
                tvar("text", "Text to translate", true, None),
                tvar("language", "Target language", true, None),
            ],
            category: Some("builtin".into()), tags: vec!["builtin".into(), "translation".into()],
            version: 1, created_at: now, updated_at: now,
        },
        PromptTemplate {
            id: "builtin-explain-code".into(), name: "Explain Code".into(),
            description: "Explain what a code snippet does.".into(),
            template: "Explain the following {{language}} code. Be {{detail_level}}:\n\n```{{language}}\n{{code}}\n```".into(),
            variables: vec![
                tvar("code", "Code to explain", true, None),
                tvar("language", "Programming language", false, Some("auto-detect")),
                tvar("detail_level", "How detailed", false, Some("concise but thorough")),
            ],
            category: Some("builtin".into()), tags: vec!["builtin".into(), "code".into()],
            version: 1, created_at: now, updated_at: now,
        },
        PromptTemplate {
            id: "builtin-system-admin".into(), name: "System Admin Assistant".into(),
            description: "System prompt for a sysadmin AI assistant.".into(),
            template: "You are an expert systems administrator. You help with {{expertise_areas}}. \
                The user is managing {{infrastructure}}. \
                Always prioritize security and provide commands for {{os}} when applicable. \
                {{#if cautious}}Always ask for confirmation before suggesting destructive commands.{{/if}}".into(),
            variables: vec![
                tvar("expertise_areas", "Areas of expertise", false, Some("networking, servers, security, and automation")),
                tvar("infrastructure", "Type of infrastructure", false, Some("a mixed Windows/Linux environment")),
                tvar("os", "Primary OS", false, Some("Linux")),
                tvar("cautious", "Be extra cautious", false, Some("true")),
            ],
            category: Some("builtin".into()), tags: vec!["builtin".into(), "sysadmin".into()],
            version: 1, created_at: now, updated_at: now,
        },
        PromptTemplate {
            id: "builtin-connection-troubleshoot".into(), name: "Connection Troubleshoot".into(),
            description: "Helps troubleshoot connection issues to remote hosts.".into(),
            template: "I'm having trouble connecting to a remote host.\n\
                Protocol: {{protocol}}\nHost: {{host}}\nPort: {{port}}\nError: {{error}}\n\n\
                {{#if additional_context}}Additional context: {{additional_context}}\n\n{{/if}}\
                Please diagnose the issue and suggest solutions step by step.".into(),
            variables: vec![
                tvar("protocol", "Connection protocol (SSH, RDP, VNC, etc.)", true, None),
                tvar("host", "Target hostname or IP", true, None),
                tvar("port", "Target port", true, None),
                tvar("error", "Error message observed", true, None),
                tvar("additional_context", "Any extra info", false, None),
            ],
            category: Some("builtin".into()), tags: vec!["builtin".into(), "connection".into(), "troubleshoot".into()],
            version: 1, created_at: now, updated_at: now,
        },
    ]
}
