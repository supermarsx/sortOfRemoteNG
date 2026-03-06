// ── procmail rule management ─────────────────────────────────────────────────
//! Rules are named groups of recipes, managed as a higher-level abstraction
//! on top of the raw procmailrc recipes.

use crate::client::ProcmailClient;
use crate::error::{ProcmailError, ProcmailResult};
use crate::recipes::RecipeManager;
use crate::types::*;
use uuid::Uuid;

/// In-memory rule registry. Rules are serialised as comment blocks inside the
/// procmailrc that group consecutive recipes under a named rule.
///
/// Format:
/// ```text
/// ## SORNG-RULE: <id> | <name> | <description> | <enabled> | <priority>
/// # SORNG-ID: <recipe-id>
/// :0 flags
/// * condition
/// action
/// ## SORNG-RULE-END: <id>
/// ```
pub struct RuleManager;

impl RuleManager {
    /// List all rules from the user's procmailrc.
    pub async fn list(client: &ProcmailClient, user: &str) -> ProcmailResult<Vec<ProcmailRule>> {
        let content = client.get_procmailrc(user).await?;
        Ok(parse_rules(&content))
    }

    /// Get a single rule by id.
    pub async fn get(
        client: &ProcmailClient,
        user: &str,
        id: &str,
    ) -> ProcmailResult<ProcmailRule> {
        let rules = Self::list(client, user).await?;
        rules
            .into_iter()
            .find(|r| r.id == id)
            .ok_or_else(|| ProcmailError::rule_not_found(id))
    }

    /// Create a new rule with its recipes.
    pub async fn create(
        client: &ProcmailClient,
        user: &str,
        req: CreateRuleRequest,
    ) -> ProcmailResult<ProcmailRule> {
        let id = Uuid::new_v4().to_string();
        let enabled = req.enabled.unwrap_or(true);
        let priority = req.priority.unwrap_or(0);

        // Create each sub-recipe
        let mut recipes = Vec::new();
        for recipe_req in &req.recipes {
            let created = RecipeManager::create(client, user, recipe_req.clone()).await?;
            recipes.push(created);
        }

        // Insert rule markers into the procmailrc
        let mut content = client.get_procmailrc(user).await.unwrap_or_default();
        let desc = req.description.clone().unwrap_or_default();
        let marker = format!(
            "## SORNG-RULE: {} | {} | {} | {} | {}\n",
            id, req.name, desc, enabled, priority,
        );
        let end_marker = format!("## SORNG-RULE-END: {}\n", id);

        // Find insertion point – after all existing content
        if !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(&marker);
        // The recipes are already in the file from RecipeManager::create; we wrap them
        for recipe in &recipes {
            // The SORNG-ID markers are already written by RecipeManager
            content.push_str(&format!("# SORNG-RULE-MEMBER: {} {}\n", id, recipe.id));
        }
        content.push_str(&end_marker);

        client.write_procmailrc(user, &content).await?;

        Ok(ProcmailRule {
            id,
            name: req.name,
            description: req.description,
            recipes,
            enabled,
            priority,
        })
    }

    /// Update an existing rule.
    pub async fn update(
        client: &ProcmailClient,
        user: &str,
        id: &str,
        req: UpdateRuleRequest,
    ) -> ProcmailResult<ProcmailRule> {
        let mut rules = Self::list(client, user).await?;
        let rule = rules
            .iter_mut()
            .find(|r| r.id == id)
            .ok_or_else(|| ProcmailError::rule_not_found(id))?;

        if let Some(name) = req.name {
            rule.name = name;
        }
        if let Some(desc) = req.description {
            rule.description = Some(desc);
        }
        if let Some(enabled) = req.enabled {
            rule.enabled = enabled;
        }
        if let Some(priority) = req.priority {
            rule.priority = priority;
        }

        // If recipes were provided, replace them
        if let Some(recipe_reqs) = req.recipes {
            // Delete old recipes
            for old_recipe in &rule.recipes {
                let _ = RecipeManager::delete(client, user, &old_recipe.id).await;
            }
            // Create new ones
            let mut new_recipes = Vec::new();
            for recipe_req in &recipe_reqs {
                let created = RecipeManager::create(client, user, recipe_req.clone()).await?;
                new_recipes.push(created);
            }
            rule.recipes = new_recipes;
        }

        let updated = rule.clone();

        // Rewrite rule markers
        rewrite_rule_markers(client, user, &rules).await?;

        Ok(updated)
    }

    /// Delete a rule and its associated recipes.
    pub async fn delete(
        client: &ProcmailClient,
        user: &str,
        id: &str,
    ) -> ProcmailResult<()> {
        let rules = Self::list(client, user).await?;
        let rule = rules
            .iter()
            .find(|r| r.id == id)
            .ok_or_else(|| ProcmailError::rule_not_found(id))?;

        // Delete each recipe in the rule
        for recipe in &rule.recipes {
            let _ = RecipeManager::delete(client, user, &recipe.id).await;
        }

        // Remove rule markers from file
        let remaining: Vec<ProcmailRule> = rules.into_iter().filter(|r| r.id != id).collect();
        rewrite_rule_markers(client, user, &remaining).await
    }

    /// Enable a rule and all its recipes.
    pub async fn enable(
        client: &ProcmailClient,
        user: &str,
        id: &str,
    ) -> ProcmailResult<()> {
        let rules = Self::list(client, user).await?;
        let rule = rules
            .iter()
            .find(|r| r.id == id)
            .ok_or_else(|| ProcmailError::rule_not_found(id))?;

        for recipe in &rule.recipes {
            RecipeManager::enable(client, user, &recipe.id).await?;
        }

        let mut updated_rules = rules;
        if let Some(r) = updated_rules.iter_mut().find(|r| r.id == id) {
            r.enabled = true;
        }
        rewrite_rule_markers(client, user, &updated_rules).await
    }

    /// Disable a rule and all its recipes.
    pub async fn disable(
        client: &ProcmailClient,
        user: &str,
        id: &str,
    ) -> ProcmailResult<()> {
        let rules = Self::list(client, user).await?;
        let rule = rules
            .iter()
            .find(|r| r.id == id)
            .ok_or_else(|| ProcmailError::rule_not_found(id))?;

        for recipe in &rule.recipes {
            RecipeManager::disable(client, user, &recipe.id).await?;
        }

        let mut updated_rules = rules;
        if let Some(r) = updated_rules.iter_mut().find(|r| r.id == id) {
            r.enabled = false;
        }
        rewrite_rule_markers(client, user, &updated_rules).await
    }
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

fn parse_rules(content: &str) -> Vec<ProcmailRule> {
    let mut rules = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let trimmed = lines[i].trim();
        if trimmed.starts_with("## SORNG-RULE:") && !trimmed.contains("RULE-END") && !trimmed.contains("RULE-MEMBER") {
            let header_part = trimmed.trim_start_matches("## SORNG-RULE:").trim();
            let parts: Vec<&str> = header_part.splitn(5, '|').collect();

            let id = parts.first().map(|s| s.trim().to_string()).unwrap_or_default();
            let name = parts.get(1).map(|s| s.trim().to_string()).unwrap_or_default();
            let description = parts.get(2).map(|s| {
                let d = s.trim().to_string();
                if d.is_empty() { None } else { Some(d) }
            }).unwrap_or(None);
            let enabled = parts
                .get(3)
                .map(|s| s.trim() == "true")
                .unwrap_or(true);
            let priority = parts
                .get(4)
                .and_then(|s| s.trim().parse::<u32>().ok())
                .unwrap_or(0);

            // Collect recipe member IDs until RULE-END
            let mut member_ids = Vec::new();
            i += 1;
            while i < lines.len() {
                let l = lines[i].trim();
                if l.starts_with(&format!("## SORNG-RULE-END: {}", id)) {
                    i += 1;
                    break;
                }
                if l.starts_with("# SORNG-RULE-MEMBER:") {
                    let member_part = l.trim_start_matches("# SORNG-RULE-MEMBER:").trim();
                    let member_parts: Vec<&str> = member_part.splitn(2, ' ').collect();
                    if member_parts.len() >= 2 {
                        member_ids.push(member_parts[1].trim().to_string());
                    }
                }
                i += 1;
            }

            // Resolve the recipe objects from the full list
            let all_recipes = crate::recipes::parse_recipes_from_content(content);
            let matched_recipes: Vec<ProcmailRecipe> = member_ids
                .iter()
                .filter_map(|mid| all_recipes.iter().find(|r| r.id == *mid).cloned())
                .collect();

            rules.push(ProcmailRule {
                id,
                name,
                description,
                recipes: matched_recipes,
                enabled,
                priority,
            });
        } else {
            i += 1;
        }
    }

    rules
}

/// Rewrite all rule markers in the procmailrc while preserving everything else.
async fn rewrite_rule_markers(
    client: &ProcmailClient,
    user: &str,
    rules: &[ProcmailRule],
) -> ProcmailResult<()> {
    let content = client.get_procmailrc(user).await.unwrap_or_default();
    let mut output_lines: Vec<String> = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    // Strip existing rule markers
    while i < lines.len() {
        let trimmed = lines[i].trim();
        if trimmed.starts_with("## SORNG-RULE:") && !trimmed.contains("RULE-END") && !trimmed.contains("RULE-MEMBER") {
            // Skip until RULE-END
            while i < lines.len() {
                if lines[i].trim().starts_with("## SORNG-RULE-END:") {
                    i += 1;
                    break;
                }
                i += 1;
            }
        } else if trimmed.starts_with("# SORNG-RULE-MEMBER:") {
            i += 1;
        } else {
            output_lines.push(lines[i].to_string());
            i += 1;
        }
    }

    let mut new_content = output_lines.join("\n");
    if !new_content.ends_with('\n') {
        new_content.push('\n');
    }

    // Append all rule markers
    for rule in rules {
        let desc = rule.description.as_deref().unwrap_or("");
        new_content.push_str(&format!(
            "## SORNG-RULE: {} | {} | {} | {} | {}\n",
            rule.id, rule.name, desc, rule.enabled, rule.priority,
        ));
        for recipe in &rule.recipes {
            new_content.push_str(&format!("# SORNG-RULE-MEMBER: {} {}\n", rule.id, recipe.id));
        }
        new_content.push_str(&format!("## SORNG-RULE-END: {}\n", rule.id));
    }

    client.write_procmailrc(user, &new_content).await
}
