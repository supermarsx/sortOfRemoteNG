// ── procmail recipe management ───────────────────────────────────────────────

use crate::client::ProcmailClient;
use crate::error::{ProcmailError, ProcmailResult};
use crate::types::*;
use uuid::Uuid;

pub struct RecipeManager;

impl RecipeManager {
    /// List all recipes from the user's procmailrc.
    pub async fn list(client: &ProcmailClient, user: &str) -> ProcmailResult<Vec<ProcmailRecipe>> {
        let content = client.get_procmailrc(user).await?;
        Ok(parse_recipes(&content))
    }

    /// Get a single recipe by id.
    pub async fn get(
        client: &ProcmailClient,
        user: &str,
        id: &str,
    ) -> ProcmailResult<ProcmailRecipe> {
        let recipes = Self::list(client, user).await?;
        recipes
            .into_iter()
            .find(|r| r.id == id)
            .ok_or_else(|| ProcmailError::recipe_not_found(id))
    }

    /// Create a new recipe and append (or insert at position) in the procmailrc.
    pub async fn create(
        client: &ProcmailClient,
        user: &str,
        req: CreateRecipeRequest,
    ) -> ProcmailResult<ProcmailRecipe> {
        let mut recipes = Self::list(client, user).await?;
        let id = Uuid::new_v4().to_string();
        let flags = req.flags.clone().unwrap_or_default();
        let raw = build_recipe_raw(
            &flags,
            &req.lockfile,
            &req.comment,
            &req.condition_lines,
            &req.action,
            req.enabled.unwrap_or(true),
        );
        let position = req.position.unwrap_or(recipes.len());
        let recipe = ProcmailRecipe {
            id: id.clone(),
            condition_lines: req.condition_lines,
            action: req.action,
            flags,
            lockfile: req.lockfile,
            comment: req.comment,
            enabled: req.enabled.unwrap_or(true),
            position,
            raw: raw.clone(),
        };
        if position >= recipes.len() {
            recipes.push(recipe.clone());
        } else {
            recipes.insert(position, recipe.clone());
        }
        reindex_and_write(client, user, &mut recipes).await?;
        Ok(recipe)
    }

    /// Update an existing recipe by id.
    pub async fn update(
        client: &ProcmailClient,
        user: &str,
        id: &str,
        req: UpdateRecipeRequest,
    ) -> ProcmailResult<ProcmailRecipe> {
        let mut recipes = Self::list(client, user).await?;
        let idx = recipes
            .iter()
            .position(|r| r.id == id)
            .ok_or_else(|| ProcmailError::recipe_not_found(id))?;

        let r = &mut recipes[idx];
        if let Some(conds) = req.condition_lines {
            r.condition_lines = conds;
        }
        if let Some(action) = req.action {
            r.action = action;
        }
        if let Some(flags) = req.flags {
            r.flags = flags;
        }
        if let Some(lockfile) = req.lockfile {
            r.lockfile = Some(lockfile);
        }
        if let Some(comment) = req.comment {
            r.comment = Some(comment);
        }
        if let Some(enabled) = req.enabled {
            r.enabled = enabled;
        }
        if let Some(position) = req.position {
            let recipe = recipes.remove(idx);
            let insert_at = position.min(recipes.len());
            recipes.insert(insert_at, recipe);
        }

        // Rebuild raw for the modified recipe
        let r = &recipes[recipes.iter().position(|r| r.id == id).unwrap()];
        let raw = build_recipe_raw(
            &r.flags,
            &r.lockfile,
            &r.comment,
            &r.condition_lines,
            &r.action,
            r.enabled,
        );
        let idx = recipes.iter().position(|r| r.id == id).unwrap();
        let r = &mut recipes[idx];
        r.raw = raw;

        let updated = r.clone();
        reindex_and_write(client, user, &mut recipes).await?;
        Ok(updated)
    }

    /// Delete a recipe by id.
    pub async fn delete(
        client: &ProcmailClient,
        user: &str,
        id: &str,
    ) -> ProcmailResult<()> {
        let mut recipes = Self::list(client, user).await?;
        let idx = recipes
            .iter()
            .position(|r| r.id == id)
            .ok_or_else(|| ProcmailError::recipe_not_found(id))?;
        recipes.remove(idx);
        reindex_and_write(client, user, &mut recipes).await
    }

    /// Enable a recipe.
    pub async fn enable(
        client: &ProcmailClient,
        user: &str,
        id: &str,
    ) -> ProcmailResult<()> {
        let mut recipes = Self::list(client, user).await?;
        let r = recipes
            .iter_mut()
            .find(|r| r.id == id)
            .ok_or_else(|| ProcmailError::recipe_not_found(id))?;
        r.enabled = true;
        r.raw = build_recipe_raw(
            &r.flags,
            &r.lockfile,
            &r.comment,
            &r.condition_lines,
            &r.action,
            true,
        );
        reindex_and_write(client, user, &mut recipes).await
    }

    /// Disable a recipe (comments it out with `#`).
    pub async fn disable(
        client: &ProcmailClient,
        user: &str,
        id: &str,
    ) -> ProcmailResult<()> {
        let mut recipes = Self::list(client, user).await?;
        let r = recipes
            .iter_mut()
            .find(|r| r.id == id)
            .ok_or_else(|| ProcmailError::recipe_not_found(id))?;
        r.enabled = false;
        r.raw = build_recipe_raw(
            &r.flags,
            &r.lockfile,
            &r.comment,
            &r.condition_lines,
            &r.action,
            false,
        );
        reindex_and_write(client, user, &mut recipes).await
    }

    /// Reorder a recipe to a new position.
    pub async fn reorder(
        client: &ProcmailClient,
        user: &str,
        id: &str,
        new_position: usize,
    ) -> ProcmailResult<()> {
        let mut recipes = Self::list(client, user).await?;
        let idx = recipes
            .iter()
            .position(|r| r.id == id)
            .ok_or_else(|| ProcmailError::recipe_not_found(id))?;
        let recipe = recipes.remove(idx);
        let insert_at = new_position.min(recipes.len());
        recipes.insert(insert_at, recipe);
        reindex_and_write(client, user, &mut recipes).await
    }

    /// Test a message against the user's procmail recipes (dry-run via `procmail -m`).
    pub async fn test(
        client: &ProcmailClient,
        user: &str,
        message_content: &str,
    ) -> ProcmailResult<RecipeTestResult> {
        let rc_path = if user.is_empty() {
            client.procmailrc_path().to_string()
        } else {
            client.user_rc_path(user)
        };
        let escaped_msg = message_content.replace('\'', "'\\''");
        let cmd = format!(
            "printf '%s' '{}' | VERBOSE=yes {} -m {} 2>&1",
            escaped_msg,
            client.procmail_bin(),
            crate::client::shell_escape(&rc_path),
        );
        let out = client.exec_ssh(&cmd).await?;
        let log_output = format!("{}\n{}", out.stdout, out.stderr);

        // Parse output for delivery info
        let matched = out.exit_code == 0;
        let mut delivery_target = None;
        let mut matching_recipe_id = None;

        for line in log_output.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("Strstrectdelivering to") || trimmed.starts_with("Delivering to") {
                if let Some(target_str) = trimmed.split_whitespace().last() {
                    delivery_target = Some(parse_delivery_target(target_str));
                }
            }
            if trimmed.starts_with("Match on") {
                if let Some(id_part) = trimmed.split("recipe").nth(1) {
                    matching_recipe_id = Some(id_part.trim().to_string());
                }
            }
        }

        Ok(RecipeTestResult {
            matched,
            matching_recipe_id,
            delivery_target,
            log_output,
        })
    }
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

/// Parse the procmailrc content and extract individual recipes (public for rules module).
pub fn parse_recipes_from_content(content: &str) -> Vec<ProcmailRecipe> {
    parse_recipes(content)
}

/// Parse the procmailrc content and extract individual recipes.
fn parse_recipes(content: &str) -> Vec<ProcmailRecipe> {
    let mut recipes = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;
    let mut position = 0;

    while i < lines.len() {
        let line = lines[i].trim();

        // Detect start of recipe block: `:0` or `#:0` (disabled)
        let (is_recipe_start, disabled) = if line.starts_with(":0") {
            (true, false)
        } else if line.starts_with("#:0") {
            (true, true)
        } else {
            (false, false)
        };

        if !is_recipe_start {
            i += 1;
            continue;
        }

        let recipe_start = i;
        let mut raw_lines = vec![lines[i].to_string()];

        // Parse flags and lockfile from the :0 line
        let header = if disabled {
            line.trim_start_matches('#')
        } else {
            line
        };
        let after_colon0 = header.trim_start_matches(":0").trim();
        let (flags, lockfile) = parse_recipe_header(after_colon0);

        // Check for a comment on the line(s) before
        let comment = if recipe_start > 0 && lines[recipe_start - 1].trim().starts_with('#') {
            let c = lines[recipe_start - 1]
                .trim()
                .trim_start_matches('#')
                .trim()
                .to_string();
            if c.starts_with(":0") || c.starts_with("SORNG-ID:") {
                None
            } else {
                Some(c)
            }
        } else {
            None
        };

        // Check for SORNG-ID comment
        let id = if recipe_start > 0 {
            let prev = lines[recipe_start - 1].trim();
            if prev.starts_with("# SORNG-ID:") {
                prev.trim_start_matches("# SORNG-ID:")
                    .trim()
                    .to_string()
            } else if recipe_start > 1 {
                let prev2 = lines[recipe_start - 2].trim();
                if prev2.starts_with("# SORNG-ID:") {
                    prev2
                        .trim_start_matches("# SORNG-ID:")
                        .trim()
                        .to_string()
                } else {
                    Uuid::new_v4().to_string()
                }
            } else {
                Uuid::new_v4().to_string()
            }
        } else {
            Uuid::new_v4().to_string()
        };

        i += 1;

        // Collect condition lines (start with `*` or `#*` if disabled)
        let mut condition_lines = Vec::new();
        while i < lines.len() {
            let cl = lines[i].trim();
            let cond = if disabled {
                cl.strip_prefix('#').unwrap_or(cl)
            } else {
                cl
            };
            if cond.starts_with('*') {
                condition_lines.push(cond.to_string());
                raw_lines.push(lines[i].to_string());
                i += 1;
            } else {
                break;
            }
        }

        // Next non-empty line is the action
        let mut action = String::new();
        if i < lines.len() {
            let act = lines[i].trim();
            action = if disabled {
                act.strip_prefix('#')
                    .unwrap_or(act)
                    .trim()
                    .to_string()
            } else {
                act.to_string()
            };
            raw_lines.push(lines[i].to_string());
            i += 1;
        }

        // Handle brace-block actions { … }
        if action.trim() == "{" {
            while i < lines.len() {
                let bl = lines[i].trim();
                let bl_clean = if disabled {
                    bl.strip_prefix('#').unwrap_or(bl)
                } else {
                    bl
                };
                raw_lines.push(lines[i].to_string());
                i += 1;
                if bl_clean.trim() == "}" {
                    break;
                }
                action.push('\n');
                action.push_str(bl_clean);
            }
        }

        let raw = raw_lines.join("\n");
        recipes.push(ProcmailRecipe {
            id,
            condition_lines,
            action,
            flags: flags.to_string(),
            lockfile,
            comment,
            enabled: !disabled,
            position,
            raw,
        });
        position += 1;
    }

    recipes
}

/// Parse the flags and lockfile from the `:0` header portion.
fn parse_recipe_header(after_colon0: &str) -> (&str, Option<String>) {
    if after_colon0.is_empty() {
        return ("", None);
    }
    // Flags come first, then optional `: lockfile`
    if let Some(colon_pos) = after_colon0.find(':') {
        let flags = after_colon0[..colon_pos].trim();
        let lockfile = after_colon0[colon_pos + 1..].trim();
        let lf = if lockfile.is_empty() {
            None
        } else {
            Some(lockfile.to_string())
        };
        (flags, lf)
    } else {
        (after_colon0.trim(), None)
    }
}

/// Build the raw text for a single recipe.
fn build_recipe_raw(
    flags: &str,
    lockfile: &Option<String>,
    comment: &Option<String>,
    condition_lines: &[String],
    action: &str,
    enabled: bool,
) -> String {
    let prefix = if enabled { "" } else { "#" };
    let mut out = String::new();

    if let Some(c) = comment {
        out.push_str(&format!("# {}\n", c));
    }

    // :0 flags : lockfile
    out.push_str(prefix);
    out.push_str(":0");
    if !flags.is_empty() {
        out.push(' ');
        out.push_str(flags);
    }
    if let Some(lf) = lockfile {
        out.push_str(": ");
        out.push_str(lf);
    }
    out.push('\n');

    for cond in condition_lines {
        out.push_str(prefix);
        out.push_str(cond);
        out.push('\n');
    }

    out.push_str(prefix);
    out.push_str(action);
    out.push('\n');

    out
}

/// Rebuild the full procmailrc from parsed recipes, preserving variables and includes.
async fn reindex_and_write(
    client: &ProcmailClient,
    user: &str,
    recipes: &mut [ProcmailRecipe],
) -> ProcmailResult<()> {
    // Read existing content for variables/includes
    let existing = client.get_procmailrc(user).await.unwrap_or_default();

    let mut header_lines = Vec::new();
    let lines: Vec<&str> = existing.lines().collect();
    let mut i = 0;

    // Collect header (variable assignments and non-recipe lines)
    while i < lines.len() {
        let trimmed = lines[i].trim();
        if trimmed.starts_with(":0") || trimmed.starts_with("#:0") {
            break;
        }
        // Skip old SORNG-ID lines that precede a recipe
        if trimmed.starts_with("# SORNG-ID:") {
            if i + 1 < lines.len() {
                let next = lines[i + 1].trim();
                if next.starts_with(":0") || next.starts_with("#:0") {
                    i += 1;
                    continue;
                }
            }
        }
        header_lines.push(lines[i].to_string());
        i += 1;
    }

    // Rebuild content
    let mut content = header_lines.join("\n");
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    content.push('\n');

    for (pos, recipe) in recipes.iter_mut().enumerate() {
        recipe.position = pos;
        content.push_str(&format!("# SORNG-ID: {}\n", recipe.id));
        content.push_str(&build_recipe_raw(
            &recipe.flags,
            &recipe.lockfile,
            &recipe.comment,
            &recipe.condition_lines,
            &recipe.action,
            recipe.enabled,
        ));
        content.push('\n');
    }

    client.write_procmailrc(user, &content).await
}

/// Classify the delivery target from an action string.
fn parse_delivery_target(target: &str) -> DeliveryTarget {
    let target_type = if target.ends_with('/') {
        DeliveryTargetType::Maildir
    } else if target.starts_with('|') {
        DeliveryTargetType::Pipe
    } else if target.starts_with('!') {
        DeliveryTargetType::Forward
    } else if target == "/dev/null" {
        DeliveryTargetType::DevNull
    } else {
        DeliveryTargetType::Mbox
    };
    DeliveryTarget {
        target_type,
        path_or_command: target.to_string(),
    }
}
