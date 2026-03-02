use serde::{Serialize, Deserialize};
use crate::types::{SessionContext, ShellType, OsType};
use crate::error::AiAssistError;

/// Builds rich context strings for LLM prompts based on the current session state.

pub struct ContextBuilder;

impl ContextBuilder {
    /// Build a system prompt fragment describing the SSH session environment.
    pub fn build_environment_context(ctx: &SessionContext) -> String {
        let mut parts: Vec<String> = Vec::new();

        parts.push(format!("Connected to: {}@{}", ctx.username, ctx.host));
        parts.push(format!("Shell: {}", ctx.shell.display_name()));
        parts.push(format!("OS: {}", ctx.os.display_name()));
        parts.push(format!("Working directory: {}", ctx.cwd));

        if ctx.sudo_available {
            parts.push("Sudo: available".to_string());
        }

        if !ctx.installed_tools.is_empty() {
            let tools_str = ctx.installed_tools.join(", ");
            parts.push(format!("Installed tools: {}", tools_str));
        }

        if !ctx.env_vars.is_empty() {
            let relevant: Vec<String> = ctx.env_vars.iter()
                .filter(|(k, _)| is_relevant_env_var(k))
                .map(|(k, v)| format!("{}={}", k, v))
                .collect();
            if !relevant.is_empty() {
                parts.push(format!("Environment: {}", relevant.join(", ")));
            }
        }

        parts.join("\n")
    }

    /// Build a context string from recent command history.
    pub fn build_history_context(ctx: &SessionContext, max_entries: usize) -> String {
        let recent = ctx.recent_commands(max_entries);
        if recent.is_empty() {
            return String::from("No recent command history.");
        }

        let mut lines: Vec<String> = Vec::new();
        lines.push("Recent commands:".to_string());
        for (i, cmd) in recent.iter().enumerate() {
            lines.push(format!("  {}. {}", i + 1, cmd));
        }
        lines.join("\n")
    }

    /// Build context about the last command's output if available.
    pub fn build_output_context(ctx: &SessionContext) -> Option<String> {
        let output = ctx.last_output.as_ref()?;
        let truncated = if output.len() > 2000 {
            format!("{}...(truncated)", &output[..2000])
        } else {
            output.clone()
        };

        let exit_info = match ctx.last_exit_code {
            Some(0) => "Exit code: 0 (success)".to_string(),
            Some(code) => format!("Exit code: {} (error)", code),
            None => "Exit code: unknown".to_string(),
        };

        Some(format!("Last command output:\n{}\n{}", exit_info, truncated))
    }

    /// Build a full system prompt for the AI assistant.
    pub fn build_system_prompt(ctx: &SessionContext, task: &str) -> String {
        let env = Self::build_environment_context(ctx);
        let history = Self::build_history_context(ctx, 20);
        let output = Self::build_output_context(ctx).unwrap_or_default();

        format!(
            r#"You are an expert SSH terminal assistant. You help users with command-line tasks.

Task: {}

=== Environment ===
{}

=== History ===
{}

{}

=== Guidelines ===
- Only suggest commands compatible with the detected shell ({}) and OS ({}).
- Prefer safe, reversible commands when possible.
- If a command is destructive or risky, clearly warn the user.
- Be concise and precise in your responses.
- When suggesting multiple commands, explain the purpose of each.
- Consider the current working directory and installed tools.
- Respect the user's existing environment and conventions."#,
            task,
            env,
            history,
            output,
            ctx.shell.display_name(),
            ctx.os.display_name(),
        )
    }

    /// Build a completion-specific prompt.
    pub fn build_completion_prompt(
        input: &str,
        cursor_pos: usize,
        ctx: &SessionContext,
        max_suggestions: usize,
    ) -> String {
        let before_cursor = if cursor_pos <= input.len() {
            &input[..cursor_pos]
        } else {
            input
        };

        let after_cursor = if cursor_pos < input.len() {
            &input[cursor_pos..]
        } else {
            ""
        };

        let env = Self::build_environment_context(ctx);
        let history = Self::build_history_context(ctx, 10);

        format!(
            r#"Suggest up to {} completions for an SSH terminal command.

Current input: `{}`
Text before cursor: `{}`
Text after cursor: `{}`

{}
{}

Respond with a JSON array of objects, each with:
- "text": the completed command or argument
- "description": brief description
- "kind": one of "command", "flag", "argument", "path", "variable", "pipe", "redirect"
- "confidence": 0.0-1.0

Only include high-quality suggestions. Order by relevance."#,
            max_suggestions,
            input,
            before_cursor,
            after_cursor,
            env,
            history,
        )
    }

    /// Build an error-explanation prompt.
    pub fn build_error_prompt(
        error_output: &str,
        command: Option<&str>,
        ctx: &SessionContext,
    ) -> String {
        let env = Self::build_environment_context(ctx);
        let cmd_info = command.map(|c| format!("Command that caused the error: `{}`\n", c))
            .unwrap_or_default();

        format!(
            r#"Explain this terminal error and suggest fixes.

{}Error output:
```
{}
```

{}

Respond with JSON:
{{
  "summary": "one-line summary",
  "detailed_explanation": "paragraph explanation",
  "probable_causes": ["cause1", "cause2"],
  "suggested_fixes": [
    {{
      "description": "what to do",
      "command": "optional command to run",
      "risk_level": "safe|low|medium|high|critical",
      "auto_applicable": true/false,
      "steps": ["step1", "step2"]
    }}
  ],
  "related_commands": ["man page or related cmd"],
  "documentation_links": ["url1"]
}}"#,
            cmd_info,
            error_output,
            env,
        )
    }

    /// Build a natural-language-to-command prompt.
    pub fn build_nl_to_command_prompt(
        query: &str,
        ctx: &SessionContext,
        constraints: &[String],
    ) -> String {
        let env = Self::build_environment_context(ctx);
        let constraint_str = if constraints.is_empty() {
            String::new()
        } else {
            format!("\nConstraints:\n{}", constraints.iter()
                .map(|c| format!("- {}", c))
                .collect::<Vec<_>>()
                .join("\n"))
        };

        format!(
            r#"Convert this natural language request into shell commands.

Request: "{}"

{}
{}

Respond with JSON:
{{
  "commands": [
    {{
      "command": "the actual command",
      "explanation": "what it does",
      "risk_level": "safe|low|medium|high|critical",
      "shell_specific": true/false
    }}
  ],
  "explanation": "overall explanation",
  "confidence": 0.0-1.0,
  "alternatives": ["alternative approaches"]
}}"#,
            query,
            env,
            constraint_str,
        )
    }

    /// Build a risk-assessment prompt.
    pub fn build_risk_prompt(command: &str, ctx: &SessionContext) -> String {
        let env = Self::build_environment_context(ctx);

        format!(
            r#"Assess the risk level of this command.

Command: `{}`

{}

Respond with JSON:
{{
  "risk_level": "safe|low|medium|high|critical",
  "reasons": ["reason1", "reason2"],
  "affected_scope": "none|current_directory|user_home|system|network|multi_host",
  "reversible": true/false,
  "confirmation_required": true/false,
  "safer_alternatives": ["alternative1"]
}}"#,
            command,
            env,
        )
    }
}

/// Filter for environment variables that are relevant for context.
fn is_relevant_env_var(key: &str) -> bool {
    let upper = key.to_uppercase();
    matches!(
        upper.as_str(),
        "PATH" | "SHELL" | "HOME" | "USER" | "LANG" | "LC_ALL"
        | "TERM" | "EDITOR" | "VISUAL" | "PAGER"
        | "VIRTUAL_ENV" | "CONDA_DEFAULT_ENV" | "GOPATH"
        | "JAVA_HOME" | "NODE_ENV" | "PYTHON_PATH"
        | "SSH_AUTH_SOCK" | "SSH_AGENT_PID"
        | "DISPLAY" | "WAYLAND_DISPLAY" | "XDG_SESSION_TYPE"
    )
}

/// Parse an incomplete command line to identify what kind of completion to provide.
pub fn parse_command_line(input: &str) -> CommandLineState {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return CommandLineState::Empty;
    }

    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    let last_part = parts.last().unwrap_or(&"");

    // Check if the cursor is right after a pipe or redirect
    if trimmed.ends_with('|') {
        return CommandLineState::AfterPipe;
    }
    if trimmed.ends_with('>') || trimmed.ends_with(">>") {
        return CommandLineState::AfterRedirect;
    }
    if trimmed.ends_with('&') && !trimmed.ends_with("&&") {
        return CommandLineState::Background;
    }
    if trimmed.ends_with("&&") || trimmed.ends_with("||") || trimmed.ends_with(';') {
        return CommandLineState::ChainedCommand;
    }

    // Check if we're typing the command itself
    if parts.len() == 1 && !trimmed.ends_with(' ') {
        return CommandLineState::PartialCommand(parts[0].to_string());
    }

    // If the command is complete and we're typing arguments
    let cmd = parts[0].to_string();

    if last_part.starts_with('-') && !trimmed.ends_with(' ') {
        return CommandLineState::PartialFlag {
            command: cmd,
            partial: last_part.to_string(),
        };
    }

    if last_part.starts_with('$') && !trimmed.ends_with(' ') {
        return CommandLineState::PartialVariable(last_part.to_string());
    }

    if last_part.contains('/') && !trimmed.ends_with(' ') {
        return CommandLineState::PartialPath(last_part.to_string());
    }

    if trimmed.ends_with(' ') {
        return CommandLineState::ExpectingArgument {
            command: cmd,
            args_so_far: parts[1..].iter().map(|s| s.to_string()).collect(),
        };
    }

    CommandLineState::PartialArgument {
        command: cmd,
        partial: last_part.to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum CommandLineState {
    Empty,
    PartialCommand(String),
    PartialFlag { command: String, partial: String },
    PartialArgument { command: String, partial: String },
    PartialPath(String),
    PartialVariable(String),
    ExpectingArgument { command: String, args_so_far: Vec<String> },
    AfterPipe,
    AfterRedirect,
    ChainedCommand,
    Background,
}
