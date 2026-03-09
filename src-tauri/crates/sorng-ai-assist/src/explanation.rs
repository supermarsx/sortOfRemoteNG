use crate::completion::extract_json_from_response;
use crate::context::ContextBuilder;
use crate::error::AiAssistError;
use crate::types::*;

use sorng_llm::{ChatCompletionRequest, ChatMessage, LlmServiceState, MessageRole};

/// AI-powered error explanation and fix suggestion engine.
pub struct ErrorExplainer;

impl ErrorExplainer {
    /// Explain an error using local pattern matching and optionally the LLM.
    pub async fn explain(
        error_output: &str,
        command: Option<&str>,
        ctx: &SessionContext,
        llm: Option<&LlmServiceState>,
    ) -> Result<ErrorExplanation, AiAssistError> {
        // Phase 1: Try local pattern matching
        if let Some(local) = Self::local_explain(error_output, command) {
            return Ok(local);
        }

        // Phase 2: Use LLM if available
        if let Some(llm_state) = llm {
            return Self::ai_explain(error_output, command, ctx, llm_state).await;
        }

        // Fallback: basic explanation
        Ok(ErrorExplanation {
            original_error: error_output.to_string(),
            summary: "Unknown error".to_string(),
            detailed_explanation: format!("The command produced an error: {}", error_output),
            probable_causes: vec!["Unknown cause".to_string()],
            suggested_fixes: Vec::new(),
            related_commands: Vec::new(),
            documentation_links: Vec::new(),
            confidence: 0.1,
        })
    }

    /// Local pattern-matching for common errors.
    fn local_explain(error_output: &str, command: Option<&str>) -> Option<ErrorExplanation> {
        let lower = error_output.to_lowercase();

        // Permission denied
        if lower.contains("permission denied") {
            return Some(ErrorExplanation {
                original_error: error_output.to_string(),
                summary: "Permission denied".to_string(),
                detailed_explanation: "The current user does not have sufficient permissions to perform this operation.".to_string(),
                probable_causes: vec![
                    "File or directory ownership doesn't match current user".to_string(),
                    "File permissions are too restrictive".to_string(),
                    "Operation requires root/sudo privileges".to_string(),
                ],
                suggested_fixes: vec![
                    SuggestedFix {
                        description: "Run with sudo".to_string(),
                        command: command.map(|c| format!("sudo {}", c)),
                        risk_level: RiskLevel::Medium,
                        auto_applicable: false,
                        steps: vec!["Prefix the command with sudo".to_string()],
                    },
                    SuggestedFix {
                        description: "Check file permissions".to_string(),
                        command: command.and_then(|c| {
                            let parts: Vec<&str> = c.split_whitespace().collect();
                            parts.last().map(|f| format!("ls -la {}", f))
                        }),
                        risk_level: RiskLevel::Safe,
                        auto_applicable: true,
                        steps: vec![
                            "Check current permissions with ls -la".to_string(),
                            "Modify permissions with chmod if needed".to_string(),
                        ],
                    },
                ],
                related_commands: vec!["chmod".to_string(), "chown".to_string(), "sudo".to_string()],
                documentation_links: Vec::new(),
                confidence: 0.9,
            });
        }

        // Command not found
        if lower.contains("command not found") || lower.contains("not recognized") {
            let missing_cmd = Self::extract_missing_command(error_output);
            return Some(ErrorExplanation {
                original_error: error_output.to_string(),
                summary: format!("Command '{}' not found", missing_cmd.as_deref().unwrap_or("unknown")),
                detailed_explanation: "The shell cannot find the specified command. It may not be installed or not in PATH.".to_string(),
                probable_causes: vec![
                    "The command is not installed".to_string(),
                    "The command is not in the system PATH".to_string(),
                    "Typo in the command name".to_string(),
                    "The package providing the command needs to be installed".to_string(),
                ],
                suggested_fixes: vec![
                    SuggestedFix {
                        description: "Search for the package".to_string(),
                        command: missing_cmd.as_ref().map(|c| format!("apt search {} || yum search {}", c, c)),
                        risk_level: RiskLevel::Safe,
                        auto_applicable: true,
                        steps: vec!["Search your package manager for the command".to_string()],
                    },
                    SuggestedFix {
                        description: "Check if it's available via a different name".to_string(),
                        command: missing_cmd.as_ref().map(|c| format!("which {} || type {}", c, c)),
                        risk_level: RiskLevel::Safe,
                        auto_applicable: true,
                        steps: vec!["Use which or type to locate the command".to_string()],
                    },
                ],
                related_commands: vec!["which".to_string(), "type".to_string(), "apt".to_string(), "yum".to_string()],
                documentation_links: Vec::new(),
                confidence: 0.9,
            });
        }

        // No such file or directory
        if lower.contains("no such file or directory") {
            return Some(ErrorExplanation {
                original_error: error_output.to_string(),
                summary: "File or directory not found".to_string(),
                detailed_explanation:
                    "The specified file or directory does not exist at the given path.".to_string(),
                probable_causes: vec![
                    "Typo in the file path".to_string(),
                    "The file was moved or deleted".to_string(),
                    "Wrong working directory".to_string(),
                    "Case sensitivity issue".to_string(),
                ],
                suggested_fixes: vec![
                    SuggestedFix {
                        description: "List files in the current directory".to_string(),
                        command: Some("ls -la".to_string()),
                        risk_level: RiskLevel::Safe,
                        auto_applicable: true,
                        steps: vec!["Check what files exist in the current directory".to_string()],
                    },
                    SuggestedFix {
                        description: "Search for the file".to_string(),
                        command: Some(
                            "find . -name '*' -type f 2>/dev/null | head -20".to_string(),
                        ),
                        risk_level: RiskLevel::Safe,
                        auto_applicable: true,
                        steps: vec!["Search for files matching a pattern".to_string()],
                    },
                ],
                related_commands: vec!["ls".to_string(), "find".to_string(), "pwd".to_string()],
                documentation_links: Vec::new(),
                confidence: 0.85,
            });
        }

        // Connection refused
        if lower.contains("connection refused") {
            return Some(ErrorExplanation {
                original_error: error_output.to_string(),
                summary: "Connection refused".to_string(),
                detailed_explanation: "The target host actively refused the connection. The service may not be running or the port may be wrong.".to_string(),
                probable_causes: vec![
                    "The target service is not running".to_string(),
                    "Wrong port number".to_string(),
                    "Firewall blocking the connection".to_string(),
                    "Service is bound to a different interface (e.g., localhost only)".to_string(),
                ],
                suggested_fixes: vec![
                    SuggestedFix {
                        description: "Check if the service is running".to_string(),
                        command: Some("ss -tlnp || netstat -tlnp".to_string()),
                        risk_level: RiskLevel::Safe,
                        auto_applicable: true,
                        steps: vec!["List listening ports to verify the service".to_string()],
                    },
                    SuggestedFix {
                        description: "Test connectivity".to_string(),
                        command: Some("ping -c 3 <host>".to_string()),
                        risk_level: RiskLevel::Safe,
                        auto_applicable: false,
                        steps: vec!["Ping the host to verify network connectivity".to_string()],
                    },
                ],
                related_commands: vec!["ss".to_string(), "netstat".to_string(), "ping".to_string(), "telnet".to_string()],
                documentation_links: Vec::new(),
                confidence: 0.85,
            });
        }

        // Disk space
        if lower.contains("no space left on device") {
            return Some(ErrorExplanation {
                original_error: error_output.to_string(),
                summary: "Disk full".to_string(),
                detailed_explanation: "The filesystem has run out of available space.".to_string(),
                probable_causes: vec![
                    "Disk partition is full".to_string(),
                    "Large log files consuming space".to_string(),
                    "Too many temporary files".to_string(),
                    "Inode exhaustion".to_string(),
                ],
                suggested_fixes: vec![
                    SuggestedFix {
                        description: "Check disk usage".to_string(),
                        command: Some("df -h".to_string()),
                        risk_level: RiskLevel::Safe,
                        auto_applicable: true,
                        steps: vec!["View disk usage by filesystem".to_string()],
                    },
                    SuggestedFix {
                        description: "Find large files".to_string(),
                        command: Some("du -sh /* 2>/dev/null | sort -rh | head -20".to_string()),
                        risk_level: RiskLevel::Safe,
                        auto_applicable: true,
                        steps: vec!["Find the largest directories".to_string()],
                    },
                    SuggestedFix {
                        description: "Clean package cache".to_string(),
                        command: Some("sudo apt clean || sudo yum clean all".to_string()),
                        risk_level: RiskLevel::Low,
                        auto_applicable: false,
                        steps: vec!["Remove cached package files".to_string()],
                    },
                ],
                related_commands: vec!["df".to_string(), "du".to_string(), "ncdu".to_string()],
                documentation_links: Vec::new(),
                confidence: 0.95,
            });
        }

        // Host key verification
        if lower.contains("host key verification failed")
            || lower.contains("remote host identification has changed")
        {
            return Some(ErrorExplanation {
                original_error: error_output.to_string(),
                summary: "SSH host key mismatch".to_string(),
                detailed_explanation: "The SSH host key for the remote server has changed since your last connection. This could indicate a man-in-the-middle attack or a server reinstall.".to_string(),
                probable_causes: vec![
                    "Server was reinstalled or reconfigured".to_string(),
                    "IP address changed (new server at same address)".to_string(),
                    "Possible man-in-the-middle attack".to_string(),
                    "Load balancer routing to a different server".to_string(),
                ],
                suggested_fixes: vec![
                    SuggestedFix {
                        description: "Remove the old host key".to_string(),
                        command: Some("ssh-keygen -R <hostname>".to_string()),
                        risk_level: RiskLevel::Low,
                        auto_applicable: false,
                        steps: vec![
                            "Verify this is expected (server was reinstalled etc.)".to_string(),
                            "Remove the old key with ssh-keygen -R".to_string(),
                            "Connect again to accept the new key".to_string(),
                        ],
                    },
                ],
                related_commands: vec!["ssh-keygen".to_string(), "ssh-keyscan".to_string()],
                documentation_links: Vec::new(),
                confidence: 0.95,
            });
        }

        // Out of memory
        if lower.contains("out of memory")
            || lower.contains("cannot allocate memory")
            || lower.contains("oom")
        {
            return Some(ErrorExplanation {
                original_error: error_output.to_string(),
                summary: "Out of memory".to_string(),
                detailed_explanation: "The system ran out of available memory (RAM).".to_string(),
                probable_causes: vec![
                    "Process consumed too much memory".to_string(),
                    "Too many processes running".to_string(),
                    "Insufficient RAM for the workload".to_string(),
                    "Memory leak in an application".to_string(),
                ],
                suggested_fixes: vec![
                    SuggestedFix {
                        description: "Check memory usage".to_string(),
                        command: Some("free -h".to_string()),
                        risk_level: RiskLevel::Safe,
                        auto_applicable: true,
                        steps: vec!["View current memory usage".to_string()],
                    },
                    SuggestedFix {
                        description: "Find memory-hungry processes".to_string(),
                        command: Some("ps aux --sort=-%mem | head -20".to_string()),
                        risk_level: RiskLevel::Safe,
                        auto_applicable: true,
                        steps: vec!["List processes sorted by memory usage".to_string()],
                    },
                ],
                related_commands: vec![
                    "free".to_string(),
                    "top".to_string(),
                    "htop".to_string(),
                    "vmstat".to_string(),
                ],
                documentation_links: Vec::new(),
                confidence: 0.9,
            });
        }

        None
    }

    fn extract_missing_command(error: &str) -> Option<String> {
        // "bash: foo: command not found" → "foo"
        let parts: Vec<&str> = error.split(':').collect();
        if parts.len() >= 2 {
            let candidate = parts[1].trim();
            if !candidate.is_empty() && !candidate.contains(' ') {
                return Some(candidate.to_string());
            }
        }
        None
    }

    /// Use the LLM to explain an error.
    async fn ai_explain(
        error_output: &str,
        command: Option<&str>,
        ctx: &SessionContext,
        llm_state: &LlmServiceState,
    ) -> Result<ErrorExplanation, AiAssistError> {
        let prompt = ContextBuilder::build_error_prompt(error_output, command, ctx);

        let system_msg = ChatMessage {
            role: MessageRole::System,
            content: sorng_llm::MessageContent::Text(
                "You are an expert Linux/Unix troubleshooter. Respond only with valid JSON."
                    .to_string(),
            ),
            name: None,
            tool_calls: None,
            tool_call_id: None,
        };

        let user_msg = ChatMessage {
            role: MessageRole::User,
            content: sorng_llm::MessageContent::Text(prompt),
            name: None,
            tool_calls: None,
            tool_call_id: None,
        };

        let request = ChatCompletionRequest {
            model: "default".to_string(),
            messages: vec![system_msg, user_msg],
            temperature: Some(0.2),
            max_tokens: Some(2000),
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

        Self::parse_explanation_response(error_output, &content)
    }

    fn parse_explanation_response(
        original_error: &str,
        content: &str,
    ) -> Result<ErrorExplanation, AiAssistError> {
        let json_str = extract_json_from_response(content);
        let val: serde_json::Value = serde_json::from_str(&json_str).map_err(|e| {
            AiAssistError::parse_error(&format!("Failed to parse error explanation: {}", e))
        })?;

        let summary = val
            .get("summary")
            .and_then(|v| v.as_str())
            .unwrap_or("Error")
            .to_string();
        let detailed = val
            .get("detailed_explanation")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let causes: Vec<String> = val
            .get("probable_causes")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let fixes: Vec<SuggestedFix> = val
            .get("suggested_fixes")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| {
                        let desc = v.get("description")?.as_str()?.to_string();
                        let cmd = v
                            .get("command")
                            .and_then(|c| c.as_str())
                            .map(|s| s.to_string());
                        let risk_str = v
                            .get("risk_level")
                            .and_then(|r| r.as_str())
                            .unwrap_or("low");
                        let risk = match risk_str {
                            "safe" => RiskLevel::Safe,
                            "low" => RiskLevel::Low,
                            "medium" => RiskLevel::Medium,
                            "high" => RiskLevel::High,
                            "critical" => RiskLevel::Critical,
                            _ => RiskLevel::Low,
                        };
                        let auto = v
                            .get("auto_applicable")
                            .and_then(|a| a.as_bool())
                            .unwrap_or(false);
                        let steps: Vec<String> = v
                            .get("steps")
                            .and_then(|s| s.as_array())
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|s| s.as_str().map(|x| x.to_string()))
                                    .collect()
                            })
                            .unwrap_or_default();

                        Some(SuggestedFix {
                            description: desc,
                            command: cmd,
                            risk_level: risk,
                            auto_applicable: auto,
                            steps,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let related: Vec<String> = val
            .get("related_commands")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let links: Vec<String> = val
            .get("documentation_links")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        Ok(ErrorExplanation {
            original_error: original_error.to_string(),
            summary,
            detailed_explanation: detailed,
            probable_causes: causes,
            suggested_fixes: fixes,
            related_commands: related,
            documentation_links: links,
            confidence: 0.7,
        })
    }
}
