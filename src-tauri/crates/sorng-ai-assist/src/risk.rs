use crate::completion::extract_json_from_response;
use crate::context::ContextBuilder;
use crate::error::AiAssistError;
use crate::types::*;

use sorng_llm::LlmServiceState;

/// Analyzes commands for potential risk before execution.
pub struct RiskAnalyzer;

impl RiskAnalyzer {
    /// Assess risk of a command using local rules and optionally LLM.
    pub async fn assess(
        command: &str,
        ctx: &SessionContext,
        llm: Option<&LlmServiceState>,
    ) -> Result<RiskAssessment, AiAssistError> {
        // Phase 1: Local rule-based analysis (fast)
        let local = Self::local_assess(command, ctx);

        // If high risk or if LLM not available, return local assessment
        if local.risk_level == RiskLevel::Critical || llm.is_none() {
            return Ok(local);
        }

        // Phase 2: LLM-based analysis for uncertain cases
        if local.risk_level == RiskLevel::Medium || local.risk_level == RiskLevel::High {
            if let Some(llm_state) = llm {
                match Self::ai_assess(command, ctx, llm_state).await {
                    Ok(ai_result) => return Ok(ai_result),
                    Err(_) => return Ok(local),
                }
            }
        }

        Ok(local)
    }

    /// Fast, local rule-based risk assessment.
    pub fn local_assess(command: &str, _ctx: &SessionContext) -> RiskAssessment {
        let trimmed = command.trim();
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        let base_cmd = parts.first().copied().unwrap_or("");

        let mut risk = RiskLevel::Safe;
        let mut reasons: Vec<String> = Vec::new();
        let mut scope = AffectedScope::None;
        let mut reversible = true;
        let mut confirmation = false;
        let mut safer: Vec<String> = Vec::new();

        // ── Critical patterns ──────────────────────────────────

        // rm -rf /
        if (trimmed.contains("rm ") || trimmed.starts_with("rm"))
            && (trimmed.contains(" -rf ") || trimmed.contains(" -fr "))
            && (trimmed.contains(" /") || trimmed.ends_with(" /"))
        {
            risk = RiskLevel::Critical;
            reasons.push("Recursive force delete of root filesystem".to_string());
            scope = AffectedScope::System;
            reversible = false;
            confirmation = true;
        }

        // dd writing to disk devices
        if base_cmd == "dd"
            && (trimmed.contains("of=/dev/sd")
                || trimmed.contains("of=/dev/nvme")
                || trimmed.contains("of=/dev/hd"))
        {
            risk = RiskLevel::Critical;
            reasons.push("Writing directly to a block device".to_string());
            scope = AffectedScope::System;
            reversible = false;
            confirmation = true;
        }

        // mkfs (formatting)
        if base_cmd.starts_with("mkfs") {
            risk = RiskLevel::Critical;
            reasons.push("Formatting a filesystem destroys all data".to_string());
            scope = AffectedScope::System;
            reversible = false;
            confirmation = true;
        }

        // fork bomb
        if trimmed.contains(":(){ :|:& };:") || trimmed.contains(":(){") {
            risk = RiskLevel::Critical;
            reasons.push("Fork bomb detected".to_string());
            scope = AffectedScope::System;
            reversible = false;
            confirmation = true;
        }

        // ── High risk patterns ─────────────────────────────────

        if risk < RiskLevel::High {
            // rm -rf anything
            if base_cmd == "rm" && (trimmed.contains("-rf") || trimmed.contains("-fr")) {
                risk = RiskLevel::High;
                reasons.push("Recursive force delete".to_string());
                scope = AffectedScope::CurrentDirectory;
                reversible = false;
                confirmation = true;
                safer.push("Use rm -ri for interactive mode".to_string());
            }

            // chmod 777
            if base_cmd == "chmod" && trimmed.contains("777") {
                risk = RiskLevel::High;
                reasons.push("Setting world-writable permissions".to_string());
                scope = AffectedScope::CurrentDirectory;
                if trimmed.contains("-R") {
                    scope = AffectedScope::CurrentDirectory;
                    reasons.push("Applied recursively".to_string());
                }
            }

            // chown root or recursive chown
            if base_cmd == "chown" && trimmed.contains("-R") {
                risk = RiskLevel::High;
                reasons.push("Recursive ownership change".to_string());
                scope = AffectedScope::CurrentDirectory;
            }

            // iptables / firewall modification
            if base_cmd == "iptables"
                || base_cmd == "ip6tables"
                || base_cmd == "nft"
                || base_cmd == "ufw"
            {
                risk = RiskLevel::High;
                reasons.push("Modifying firewall rules".to_string());
                scope = AffectedScope::Network;
                confirmation = true;
            }

            // shutdown / reboot
            if base_cmd == "shutdown"
                || base_cmd == "reboot"
                || base_cmd == "poweroff"
                || base_cmd == "halt"
            {
                risk = RiskLevel::High;
                reasons.push("System will be shut down or rebooted".to_string());
                scope = AffectedScope::System;
                confirmation = true;
            }

            // /etc modifications
            if trimmed.contains("/etc/")
                && (base_cmd == "vim"
                    || base_cmd == "nano"
                    || base_cmd == "sed"
                    || base_cmd == "tee"
                    || base_cmd == "mv"
                    || base_cmd == "cp")
            {
                risk = RiskLevel::High;
                reasons.push("Modifying system configuration files".to_string());
                scope = AffectedScope::System;
            }
        }

        // ── Medium risk patterns ───────────────────────────────

        if risk < RiskLevel::Medium {
            // rm without -i
            if base_cmd == "rm" {
                risk = RiskLevel::Medium;
                reasons.push("Deleting files".to_string());
                scope = AffectedScope::CurrentDirectory;
                reversible = false;
                safer.push("Use rm -i for interactive confirmation".to_string());
            }

            // sudo anything
            if base_cmd == "sudo" {
                risk = RiskLevel::Medium;
                reasons.push("Running with elevated privileges".to_string());
                scope = AffectedScope::System;
            }

            // wget/curl piped to shell
            if (base_cmd == "curl" || base_cmd == "wget")
                && (trimmed.contains("| sh")
                    || trimmed.contains("| bash")
                    || trimmed.contains("|sh")
                    || trimmed.contains("|bash"))
            {
                risk = RiskLevel::High;
                reasons.push("Downloading and executing remote code".to_string());
                scope = AffectedScope::System;
                confirmation = true;
                safer.push("Download first, review, then execute".to_string());
            }

            // kill -9
            if base_cmd == "kill" && trimmed.contains("-9") {
                risk = RiskLevel::Medium;
                reasons.push("Force killing a process (no cleanup)".to_string());
                safer.push("Try kill (SIGTERM) first before kill -9".to_string());
            }

            // Package install/remove
            if (base_cmd == "apt" || base_cmd == "yum" || base_cmd == "dnf" || base_cmd == "pacman")
                && (trimmed.contains("install")
                    || trimmed.contains("remove")
                    || trimmed.contains("purge"))
            {
                risk = RiskLevel::Medium;
                reasons.push("Installing or removing system packages".to_string());
                scope = AffectedScope::System;
            }

            // Service management
            if base_cmd == "systemctl"
                && (trimmed.contains("stop")
                    || trimmed.contains("restart")
                    || trimmed.contains("disable"))
            {
                risk = RiskLevel::Medium;
                reasons.push("Managing system services".to_string());
                scope = AffectedScope::System;
            }
        }

        // ── Low risk patterns ──────────────────────────────────

        if risk < RiskLevel::Low {
            // Writing files
            if trimmed.contains('>') && !trimmed.contains(">>") {
                risk = RiskLevel::Low;
                reasons.push("Overwriting a file with redirection".to_string());
                safer.push("Use >> to append instead of >".to_string());
            }

            if base_cmd == "mv" {
                risk = RiskLevel::Low;
                reasons.push("Moving/renaming files (original lost)".to_string());
                reversible = false;
            }

            if base_cmd == "cp" && trimmed.contains("-r") {
                risk = RiskLevel::Low;
                reasons.push("Copying recursively".to_string());
            }
        }

        if reasons.is_empty() {
            reasons.push("No known risks identified".to_string());
        }

        RiskAssessment {
            command: command.to_string(),
            risk_level: risk,
            reasons,
            affected_scope: scope,
            reversible,
            confirmation_required: confirmation,
            safer_alternatives: safer,
        }
    }

    async fn ai_assess(
        command: &str,
        ctx: &SessionContext,
        llm_state: &LlmServiceState,
    ) -> Result<RiskAssessment, AiAssistError> {
        let prompt = ContextBuilder::build_risk_prompt(command, ctx);

        let system_msg = sorng_llm::ChatMessage {
            role: sorng_llm::MessageRole::System,
            content: sorng_llm::MessageContent::Text(
                "You are a security-focused command analyst. Return only valid JSON.".to_string(),
            ),
            name: None,
            tool_calls: None,
            tool_call_id: None,
        };

        let user_msg = sorng_llm::ChatMessage {
            role: sorng_llm::MessageRole::User,
            content: sorng_llm::MessageContent::Text(prompt),
            name: None,
            tool_calls: None,
            tool_call_id: None,
        };

        let request = sorng_llm::ChatCompletionRequest {
            model: "default".to_string(),
            messages: vec![system_msg, user_msg],
            temperature: Some(0.1),
            max_tokens: Some(1000),
            top_p: None,
            frequency_penalty: None,
            presence_penalty: None,
            stop: None,
            tools: None,
            tool_choice: None,
            stream: false,
            response_format: None,
            seed: None,
            logprobs: None,
            top_logprobs: None,
            provider_id: None,
            extra: None,
        };

        let mut service = llm_state.0.write().await;
        let response = service.chat_completion(request).await?;
        let content = crate::extract_response_text(&response);

        let json_str = extract_json_from_response(&content);
        let val: serde_json::Value = serde_json::from_str(&json_str)
            .map_err(|e| AiAssistError::parse_error(&e.to_string()))?;

        let risk_str = val
            .get("risk_level")
            .and_then(|v| v.as_str())
            .unwrap_or("low");
        let risk = match risk_str {
            "safe" => RiskLevel::Safe,
            "low" => RiskLevel::Low,
            "medium" => RiskLevel::Medium,
            "high" => RiskLevel::High,
            "critical" => RiskLevel::Critical,
            _ => RiskLevel::Low,
        };

        let reasons: Vec<String> = val
            .get("reasons")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let scope_str = val
            .get("affected_scope")
            .and_then(|v| v.as_str())
            .unwrap_or("none");
        let scope = match scope_str {
            "none" => AffectedScope::None,
            "current_directory" => AffectedScope::CurrentDirectory,
            "user_home" => AffectedScope::UserHome,
            "system" => AffectedScope::System,
            "network" => AffectedScope::Network,
            "multi_host" => AffectedScope::MultiHost,
            _ => AffectedScope::Unknown,
        };

        let reversible = val
            .get("reversible")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let confirmation = val
            .get("confirmation_required")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let safer: Vec<String> = val
            .get("safer_alternatives")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        Ok(RiskAssessment {
            command: command.to_string(),
            risk_level: risk,
            reasons,
            affected_scope: scope,
            reversible,
            confirmation_required: confirmation,
            safer_alternatives: safer,
        })
    }
}
