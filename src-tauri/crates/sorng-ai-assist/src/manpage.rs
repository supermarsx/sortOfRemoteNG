use crate::types::*;
use crate::completion::extract_json_from_response;
use crate::error::AiAssistError;

use sorng_llm::{
    ChatMessage, MessageRole, ChatCompletionRequest, LlmServiceState,
};

use std::collections::HashMap;

/// Man page / help lookup system with AI-powered summaries.
pub struct ManPageLookup {
    cache: HashMap<String, ManPageInfo>,
}

impl ManPageLookup {
    pub fn new() -> Self {
        let mut cache = HashMap::new();
        // Pre-populate with essential commands
        Self::populate_builtins(&mut cache);
        Self { cache }
    }

    /// Look up command documentation — first checks cache, then AI.
    pub async fn lookup(
        &mut self,
        command: &str,
        llm: Option<&LlmServiceState>,
    ) -> Result<ManPageInfo, AiAssistError> {
        // Check cache
        if let Some(cached) = self.cache.get(command) {
            return Ok(cached.clone());
        }

        // Try AI
        if let Some(llm_state) = llm {
            let info = Self::ai_lookup(command, llm_state).await?;
            self.cache.insert(command.to_string(), info.clone());
            return Ok(info);
        }

        Err(AiAssistError::not_found(&format!("man page for '{}'", command)))
    }

    /// Get flags for a specific command.
    pub fn get_flags(&self, command: &str) -> Vec<FlagInfo> {
        self.cache.get(command)
            .map(|info| info.common_flags.clone())
            .unwrap_or_default()
    }

    /// Search across cached man pages.
    pub fn search(&self, query: &str) -> Vec<&ManPageInfo> {
        let lower = query.to_lowercase();
        self.cache.values()
            .filter(|info| {
                info.command.to_lowercase().contains(&lower)
                    || info.description.to_lowercase().contains(&lower)
                    || info.synopsis.to_lowercase().contains(&lower)
            })
            .collect()
    }

    async fn ai_lookup(
        command: &str,
        llm_state: &LlmServiceState,
    ) -> Result<ManPageInfo, AiAssistError> {
        let prompt = format!(
            r#"Provide a concise man page summary for the command `{}`.

Respond with JSON:
{{
  "synopsis": "brief usage",
  "description": "one-paragraph description",
  "common_flags": [
    {{
      "flag": "-x",
      "long_flag": "--example",
      "description": "what it does",
      "takes_value": false,
      "required": false,
      "common": true
    }}
  ],
  "examples": [
    {{
      "description": "what the example does",
      "command": "the actual command",
      "explanation": "optional deeper explanation"
    }}
  ],
  "see_also": ["related-command1", "related-command2"]
}}"#,
            command
        );

        let system_msg = ChatMessage {
            role: MessageRole::System,
            content: sorng_llm::MessageContent::Text(
                "You are a Unix man page expert. Only return valid JSON.".to_string()
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
            temperature: Some(0.1),
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
        Self::parse_man_response(command, &content)
    }

    fn parse_man_response(command: &str, content: &str) -> Result<ManPageInfo, AiAssistError> {
        let json_str = extract_json_from_response(content);
        let val: serde_json::Value = serde_json::from_str(&json_str)
            .map_err(|e| AiAssistError::parse_error(&e.to_string()))?;

        let synopsis = val.get("synopsis").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let description = val.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();

        let flags: Vec<FlagInfo> = val.get("common_flags")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| {
                let flag = v.get("flag")?.as_str()?.to_string();
                let long = v.get("long_flag").and_then(|l| l.as_str()).map(|s| s.to_string());
                let desc = v.get("description")?.as_str()?.to_string();
                let takes_val = v.get("takes_value").and_then(|b| b.as_bool()).unwrap_or(false);
                let required = v.get("required").and_then(|b| b.as_bool()).unwrap_or(false);
                let common = v.get("common").and_then(|b| b.as_bool()).unwrap_or(true);
                Some(FlagInfo { flag, long_flag: long, description: desc, takes_value: takes_val, required, common })
            }).collect())
            .unwrap_or_default();

        let examples: Vec<CommandExample> = val.get("examples")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| {
                let desc = v.get("description")?.as_str()?.to_string();
                let cmd = v.get("command")?.as_str()?.to_string();
                let expl = v.get("explanation").and_then(|e| e.as_str()).map(|s| s.to_string());
                Some(CommandExample { description: desc, command: cmd, explanation: expl })
            }).collect())
            .unwrap_or_default();

        let see_also: Vec<String> = val.get("see_also")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        Ok(ManPageInfo {
            command: command.to_string(),
            synopsis,
            description,
            common_flags: flags,
            examples,
            see_also,
            source: ManPageSource::AiGenerated,
        })
    }

    fn populate_builtins(cache: &mut HashMap<String, ManPageInfo>) {
        // ls
        cache.insert("ls".to_string(), ManPageInfo {
            command: "ls".to_string(),
            synopsis: "ls [OPTION]... [FILE]...".to_string(),
            description: "List information about the FILEs (the current directory by default).".to_string(),
            common_flags: vec![
                FlagInfo { flag: "-l".to_string(), long_flag: Some("--long".to_string()), description: "Use a long listing format".to_string(), takes_value: false, required: false, common: true },
                FlagInfo { flag: "-a".to_string(), long_flag: Some("--all".to_string()), description: "Do not ignore entries starting with .".to_string(), takes_value: false, required: false, common: true },
                FlagInfo { flag: "-h".to_string(), long_flag: Some("--human-readable".to_string()), description: "Print sizes in human readable format".to_string(), takes_value: false, required: false, common: true },
                FlagInfo { flag: "-R".to_string(), long_flag: Some("--recursive".to_string()), description: "List subdirectories recursively".to_string(), takes_value: false, required: false, common: true },
                FlagInfo { flag: "-t".to_string(), long_flag: None, description: "Sort by modification time".to_string(), takes_value: false, required: false, common: true },
            ],
            examples: vec![
                CommandExample { description: "Long listing with hidden files".to_string(), command: "ls -la".to_string(), explanation: None },
                CommandExample { description: "Human-readable sizes, sorted by size".to_string(), command: "ls -lhS".to_string(), explanation: None },
            ],
            see_also: vec!["dir".to_string(), "find".to_string(), "stat".to_string()],
            source: ManPageSource::Builtin,
        });

        // grep
        cache.insert("grep".to_string(), ManPageInfo {
            command: "grep".to_string(),
            synopsis: "grep [OPTION...] PATTERN [FILE...]".to_string(),
            description: "Search for PATTERN in each FILE or standard input.".to_string(),
            common_flags: vec![
                FlagInfo { flag: "-i".to_string(), long_flag: Some("--ignore-case".to_string()), description: "Ignore case distinctions".to_string(), takes_value: false, required: false, common: true },
                FlagInfo { flag: "-r".to_string(), long_flag: Some("--recursive".to_string()), description: "Read all files under each directory recursively".to_string(), takes_value: false, required: false, common: true },
                FlagInfo { flag: "-n".to_string(), long_flag: Some("--line-number".to_string()), description: "Prefix each line with its line number".to_string(), takes_value: false, required: false, common: true },
                FlagInfo { flag: "-v".to_string(), long_flag: Some("--invert-match".to_string()), description: "Invert the sense of matching".to_string(), takes_value: false, required: false, common: true },
                FlagInfo { flag: "-E".to_string(), long_flag: Some("--extended-regexp".to_string()), description: "Use extended regular expressions".to_string(), takes_value: false, required: false, common: true },
            ],
            examples: vec![
                CommandExample { description: "Case-insensitive recursive search".to_string(), command: "grep -ri 'pattern' /path".to_string(), explanation: None },
                CommandExample { description: "Show line numbers".to_string(), command: "grep -n 'TODO' *.py".to_string(), explanation: None },
            ],
            see_also: vec!["awk".to_string(), "sed".to_string(), "find".to_string(), "ripgrep".to_string()],
            source: ManPageSource::Builtin,
        });

        // ssh
        cache.insert("ssh".to_string(), ManPageInfo {
            command: "ssh".to_string(),
            synopsis: "ssh [options] [user@]hostname [command]".to_string(),
            description: "OpenSSH remote login client. Connects to a remote host and executes commands.".to_string(),
            common_flags: vec![
                FlagInfo { flag: "-p".to_string(), long_flag: None, description: "Port to connect to on the remote host".to_string(), takes_value: true, required: false, common: true },
                FlagInfo { flag: "-i".to_string(), long_flag: None, description: "Identity file (private key)".to_string(), takes_value: true, required: false, common: true },
                FlagInfo { flag: "-L".to_string(), long_flag: None, description: "Local port forwarding".to_string(), takes_value: true, required: false, common: true },
                FlagInfo { flag: "-R".to_string(), long_flag: None, description: "Remote port forwarding".to_string(), takes_value: true, required: false, common: true },
                FlagInfo { flag: "-D".to_string(), long_flag: None, description: "Dynamic port forwarding (SOCKS proxy)".to_string(), takes_value: true, required: false, common: true },
                FlagInfo { flag: "-N".to_string(), long_flag: None, description: "Do not execute a remote command".to_string(), takes_value: false, required: false, common: true },
                FlagInfo { flag: "-v".to_string(), long_flag: None, description: "Verbose mode".to_string(), takes_value: false, required: false, common: true },
                FlagInfo { flag: "-J".to_string(), long_flag: None, description: "Connect through a jump host".to_string(), takes_value: true, required: false, common: true },
            ],
            examples: vec![
                CommandExample { description: "Connect on a different port".to_string(), command: "ssh -p 2222 user@host".to_string(), explanation: None },
                CommandExample { description: "Port forwarding".to_string(), command: "ssh -L 8080:localhost:80 user@host".to_string(), explanation: Some("Forward local port 8080 to remote port 80".to_string()) },
                CommandExample { description: "SOCKS proxy".to_string(), command: "ssh -D 1080 user@host".to_string(), explanation: Some("Create a SOCKS proxy on local port 1080".to_string()) },
                CommandExample { description: "Jump host".to_string(), command: "ssh -J jumpuser@jump target-user@target".to_string(), explanation: None },
            ],
            see_also: vec!["scp".to_string(), "sftp".to_string(), "ssh-keygen".to_string(), "ssh-agent".to_string()],
            source: ManPageSource::Builtin,
        });

        // docker
        cache.insert("docker".to_string(), ManPageInfo {
            command: "docker".to_string(),
            synopsis: "docker [OPTIONS] COMMAND [ARG...]".to_string(),
            description: "A self-sufficient runtime for containers.".to_string(),
            common_flags: vec![
                FlagInfo { flag: "-v".to_string(), long_flag: Some("--version".to_string()), description: "Print version information".to_string(), takes_value: false, required: false, common: true },
                FlagInfo { flag: "-H".to_string(), long_flag: Some("--host".to_string()), description: "Daemon socket(s) to connect to".to_string(), takes_value: true, required: false, common: false },
            ],
            examples: vec![
                CommandExample { description: "Run a container interactively".to_string(), command: "docker run -it ubuntu bash".to_string(), explanation: None },
                CommandExample { description: "List running containers".to_string(), command: "docker ps".to_string(), explanation: None },
                CommandExample { description: "Build an image".to_string(), command: "docker build -t myapp .".to_string(), explanation: None },
            ],
            see_also: vec!["docker-compose".to_string(), "podman".to_string()],
            source: ManPageSource::Builtin,
        });

        // git
        cache.insert("git".to_string(), ManPageInfo {
            command: "git".to_string(),
            synopsis: "git [--version] [--help] [-C <path>] <command> [<args>]".to_string(),
            description: "The fast distributed version control system.".to_string(),
            common_flags: vec![
                FlagInfo { flag: "-C".to_string(), long_flag: None, description: "Run as if git was started in <path>".to_string(), takes_value: true, required: false, common: false },
                FlagInfo { flag: "--version".to_string(), long_flag: None, description: "Print the git version".to_string(), takes_value: false, required: false, common: true },
            ],
            examples: vec![
                CommandExample { description: "Clone a repository".to_string(), command: "git clone https://github.com/user/repo.git".to_string(), explanation: None },
                CommandExample { description: "Stage and commit".to_string(), command: "git add . && git commit -m 'message'".to_string(), explanation: None },
                CommandExample { description: "Interactive rebase".to_string(), command: "git rebase -i HEAD~3".to_string(), explanation: Some("Rewrite the last 3 commits".to_string()) },
            ],
            see_also: vec!["git-log".to_string(), "git-branch".to_string(), "git-stash".to_string()],
            source: ManPageSource::Builtin,
        });

        // find
        cache.insert("find".to_string(), ManPageInfo {
            command: "find".to_string(),
            synopsis: "find [path...] [expression]".to_string(),
            description: "Search for files in a directory hierarchy.".to_string(),
            common_flags: vec![
                FlagInfo { flag: "-name".to_string(), long_flag: None, description: "Match filename pattern".to_string(), takes_value: true, required: false, common: true },
                FlagInfo { flag: "-type".to_string(), long_flag: None, description: "File type (f=file, d=directory, l=symlink)".to_string(), takes_value: true, required: false, common: true },
                FlagInfo { flag: "-size".to_string(), long_flag: None, description: "File size (+n=greater, -n=less)".to_string(), takes_value: true, required: false, common: true },
                FlagInfo { flag: "-mtime".to_string(), long_flag: None, description: "Modified within n days".to_string(), takes_value: true, required: false, common: true },
                FlagInfo { flag: "-exec".to_string(), long_flag: None, description: "Execute command on each result".to_string(), takes_value: true, required: false, common: true },
                FlagInfo { flag: "-maxdepth".to_string(), long_flag: None, description: "Maximum directory depth".to_string(), takes_value: true, required: false, common: true },
            ],
            examples: vec![
                CommandExample { description: "Find all .log files".to_string(), command: "find /var/log -name '*.log' -type f".to_string(), explanation: None },
                CommandExample { description: "Find large files".to_string(), command: "find / -size +100M -type f 2>/dev/null".to_string(), explanation: None },
                CommandExample { description: "Find and delete old files".to_string(), command: "find /tmp -mtime +30 -delete".to_string(), explanation: Some("Delete files in /tmp older than 30 days".to_string()) },
            ],
            see_also: vec!["locate".to_string(), "ls".to_string(), "fd".to_string()],
            source: ManPageSource::Builtin,
        });

        // tar
        cache.insert("tar".to_string(), ManPageInfo {
            command: "tar".to_string(),
            synopsis: "tar [OPTION...] [FILE]...".to_string(),
            description: "GNU tar saves many files together into a single tape or disk archive.".to_string(),
            common_flags: vec![
                FlagInfo { flag: "-c".to_string(), long_flag: Some("--create".to_string()), description: "Create a new archive".to_string(), takes_value: false, required: false, common: true },
                FlagInfo { flag: "-x".to_string(), long_flag: Some("--extract".to_string()), description: "Extract files from an archive".to_string(), takes_value: false, required: false, common: true },
                FlagInfo { flag: "-z".to_string(), long_flag: Some("--gzip".to_string()), description: "Filter through gzip".to_string(), takes_value: false, required: false, common: true },
                FlagInfo { flag: "-v".to_string(), long_flag: Some("--verbose".to_string()), description: "Verbosely list files processed".to_string(), takes_value: false, required: false, common: true },
                FlagInfo { flag: "-f".to_string(), long_flag: Some("--file".to_string()), description: "Use archive file".to_string(), takes_value: true, required: true, common: true },
            ],
            examples: vec![
                CommandExample { description: "Create a gzipped archive".to_string(), command: "tar -czf archive.tar.gz /path/to/dir".to_string(), explanation: None },
                CommandExample { description: "Extract an archive".to_string(), command: "tar -xzf archive.tar.gz".to_string(), explanation: None },
                CommandExample { description: "List archive contents".to_string(), command: "tar -tzf archive.tar.gz".to_string(), explanation: None },
            ],
            see_also: vec!["gzip".to_string(), "bzip2".to_string(), "zip".to_string()],
            source: ManPageSource::Builtin,
        });
    }
}
