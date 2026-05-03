use crate::ssh::{SshCompressionConfig, SshConnectionConfig, SshServiceState};
use rquickjs::prelude::Async;
use rquickjs::{async_with, AsyncContext, AsyncRuntime, Function, Object};
use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

pub type ScriptServiceState = Arc<Mutex<ScriptService>>;

#[derive(Clone, Serialize, Deserialize)]
pub struct ScriptContext {
    pub connection_id: Option<String>,
    pub session_id: Option<String>,
    pub trigger: String,
}

impl Default for ScriptContext {
    fn default() -> Self {
        ScriptContext {
            connection_id: None,
            session_id: None,
            trigger: "test".to_string(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ScriptResult {
    pub success: bool,
    pub result: Option<String>,
    pub error: Option<String>,
}

pub struct ScriptService {
    ssh_service: SshServiceState,
}

/// Strips TypeScript-specific syntax to produce runnable JavaScript.
/// Handles common patterns: type annotations, interfaces, enums, generics,
/// access modifiers, type assertions, and declaration keywords.
fn strip_typescript_syntax(code: &str) -> String {
    let mut result = remove_ts_block_declarations(code);
    result = remove_ts_inline_syntax(&result);
    result
}

/// Removes block-level TypeScript declarations: interface, enum, declare, and type aliases.
fn remove_ts_block_declarations(code: &str) -> String {
    let mut output_lines: Vec<&str> = Vec::new();
    let lines: Vec<&str> = code.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let trimmed = lines[i].trim();
        let stripped = trimmed
            .strip_prefix("export ")
            .map(|s| s.trim_start())
            .unwrap_or(trimmed);

        // type Alias = ...; on a single line
        if (stripped.starts_with("type ") && stripped.contains('=') && stripped.ends_with(';'))
            || stripped.starts_with("declare ")
        {
            // If a declare block has an opening brace, skip until matched
            if stripped.contains('{') {
                let mut depth = brace_delta(trimmed);
                while depth > 0 && i + 1 < lines.len() {
                    i += 1;
                    depth += brace_delta(lines[i]);
                }
            }
            i += 1;
            continue;
        }

        // interface / enum blocks
        if stripped.starts_with("interface ")
            || stripped.starts_with("enum ")
            || stripped.starts_with("const enum ")
        {
            if trimmed.contains('{') {
                let mut depth = brace_delta(trimmed);
                while depth > 0 && i + 1 < lines.len() {
                    i += 1;
                    depth += brace_delta(lines[i]);
                }
            }
            i += 1;
            continue;
        }

        output_lines.push(lines[i]);
        i += 1;
    }

    output_lines.join("\n")
}

/// Counts net brace depth change in a line, respecting string literals.
fn brace_delta(line: &str) -> i32 {
    let mut depth = 0i32;
    let mut in_string = false;
    let mut quote_char = ' ';
    let mut escaped = false;

    for ch in line.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        if ch == '\\' && in_string {
            escaped = true;
            continue;
        }
        if in_string {
            if ch == quote_char {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' | '\'' | '`' => {
                in_string = true;
                quote_char = ch;
            }
            '{' => depth += 1,
            '}' => depth -= 1,
            '/' => { /* TODO: skip comments for robustness */ }
            _ => {}
        }
    }
    depth
}

/// Removes inline TypeScript syntax using regex replacements.
fn remove_ts_inline_syntax(code: &str) -> String {
    use regex::Regex;
    lazy_static::lazy_static! {
        // Generic type params after function/class name: function foo<T>( → function foo(
        static ref RE_FUNC_GENERIC: Regex =
            Regex::new(r"(function\s+\w+)\s*<[^>]+>").expect("valid regex literal");
        static ref RE_CLASS_GENERIC: Regex =
            Regex::new(r"(class\s+\w+)\s*<[^>]+>").expect("valid regex literal");

        // Return type annotation: ): SomeType { or ): SomeType =>
        static ref RE_RETURN_TYPE: Regex =
            Regex::new(r"\)\s*:\s*[\w<>\[\]|&\s,\.]+(?=\s*(?:\{|=>))").expect("valid regex literal");

        // Variable type annotation: let/const/var x: Type =
        static ref RE_VAR_TYPE: Regex =
            Regex::new(r"((?:let|const|var)\s+\w+)\s*:\s*[\w<>\[\]|&\s,\.]+(\s*=)").expect("valid regex literal");

        // Optional param: foo?: Type  →  foo
        static ref RE_OPTIONAL_PARAM: Regex =
            Regex::new(r"(\w+)\s*\?\s*:\s*[\w<>\[\]|&\s\.]+(?=[,\)])").expect("valid regex literal");

        // Param type annotation: foo: Type  →  foo
        static ref RE_PARAM_TYPE: Regex =
            Regex::new(r"(\w+)\s*:\s*[\w<>\[\]|&\s\.]+(?=[,\)])").expect("valid regex literal");

        // 'as Type' assertions
        static ref RE_AS_CAST: Regex =
            Regex::new(r"\s+as\s+[\w<>\[\]|&]+").expect("valid regex literal");

        // Access modifiers & readonly
        static ref RE_MODIFIERS: Regex =
            Regex::new(r"\b(?:public|private|protected|readonly)\s+").expect("valid regex literal");

        // Non-null assertion operator:  expr!.member  →  expr.member
        static ref RE_NON_NULL: Regex =
            Regex::new(r"(\w)!\.([\w(])").expect("valid regex literal");

        // Standalone `: void` return annotation at end of line (no body)
        static ref RE_VOID_RETURN: Regex =
            Regex::new(r"\)\s*:\s*void\s*;").expect("valid regex literal");
    }

    let mut r = code.to_string();
    r = RE_FUNC_GENERIC.replace_all(&r, "$1").to_string();
    r = RE_CLASS_GENERIC.replace_all(&r, "$1").to_string();
    r = RE_RETURN_TYPE.replace_all(&r, ")").to_string();
    r = RE_VAR_TYPE.replace_all(&r, "$1$2").to_string();
    r = RE_OPTIONAL_PARAM.replace_all(&r, "$1").to_string();
    r = RE_PARAM_TYPE.replace_all(&r, "$1").to_string();
    r = RE_AS_CAST.replace_all(&r, "").to_string();
    r = RE_MODIFIERS.replace_all(&r, "").to_string();
    r = RE_NON_NULL.replace_all(&r, "$1.$2").to_string();
    r = RE_VOID_RETURN.replace_all(&r, ");").to_string();
    r
}

impl ScriptService {
    pub fn new(ssh_service: SshServiceState) -> ScriptServiceState {
        Arc::new(Mutex::new(ScriptService { ssh_service }))
    }

    pub async fn execute_script(
        &mut self,
        code: String,
        script_type: String,
        _context: ScriptContext,
    ) -> Result<ScriptResult, String> {
        let (code, script_type) = if script_type == "typescript" {
            (strip_typescript_syntax(&code), "javascript".to_string())
        } else {
            (code, script_type)
        };

        match script_type.as_str() {
            "javascript" => {
                // Security: reject scripts containing dangerous JavaScript patterns.
                // NOTE: String-based filtering is NOT a complete sandbox. These checks catch
                // obvious abuse but determined attackers can bypass them. For production use,
                // configure QuickJS with eval disabled at the engine level.
                let dangerous_patterns = [
                    "eval(",
                    "eval (",
                    "Function(",
                    "Function (",
                    "require(",
                    "require (",
                    "import(",
                    "import (",
                    "globalThis",
                    "constructor",
                    "\\x",
                    "\\u00",
                    "\\u{",
                    "__proto__",
                    "prototype",
                    "Reflect.",
                    "Proxy(",
                    "process.",
                    "child_process",
                ];
                for pattern in &dangerous_patterns {
                    if code.contains(pattern) {
                        return Err(format!(
                            "Potentially unsafe code detected: contains '{}'",
                            pattern
                        ));
                    }
                }

                let ssh_service = self.ssh_service.clone();
                let (tx, rx) = tokio::sync::oneshot::channel();

                // Spawn a dedicated thread for the JS runtime to avoid Send issues
                std::thread::spawn(move || {
                    let rt = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build();

                    match rt {
                        Ok(rt) => {
                            rt.block_on(async move {
                                let js_rt_res = AsyncRuntime::new();
                                match js_rt_res {
                                    Ok(js_rt) => {
                                        let js_ctx_res = AsyncContext::full(&js_rt).await;
                                        match js_ctx_res {
                                            Ok(ctx) => {
                                                let result = async_with!(ctx => |ctx| {
                                                    // Add basic globals
                                                    let global = ctx.globals();

                                                    // Console mock - provide no-op methods so scripts can call
                                                    // console.log/warn/error without throwing exceptions
                                                    let _ = ctx.eval::<(), _>(
                                                        "var console = { log: function(){}, warn: function(){}, error: function(){}, info: function(){}, debug: function(){} };"
                                                    );

                                                    // SSH Module Binding
                                                    if let Ok(ssh_obj) = Object::new(ctx.clone()) {
                                                        // ssh.connect(host, port, username, password)
                                                        let ssh_service_clone = ssh_service.clone();
                                                        let _ = ssh_obj.set("connect", Function::new(ctx.clone(), Async(move |host: String, port: u16, username: String, password: Option<String>| {
                                                            let ssh_service = ssh_service_clone.clone();
                                                            async move {
                                                                let config = SshConnectionConfig {
                                                                    host,
                                                                    port,
                                                                    username,
                                                                    password: password.map(SecretString::new),
                                                                    private_key_path: None,
                                                                    private_key_passphrase: None,
                                                                    jump_hosts: vec![],
                                                                    proxy_config: None,
                                                                    proxy_chain: None,
                                                                    mixed_chain: None,
                                                                    openvpn_config: None,
                                                                    connect_timeout: Some(30),
                                                                    keep_alive_interval: Some(60),
                                                                    strict_host_key_checking: false,
                                                                    known_hosts_path: None,
                                                                    totp_secret: None,
                                                                    keyboard_interactive_responses: vec![],
                                                                    agent_forwarding: false,
                                                                    tcp_no_delay: true,
                                                                    tcp_keepalive: true,
                                                                    keepalive_probes: 3,
                                                                    ip_protocol: "auto".to_string(),
                                                                    compression: false,
                                                                    compression_level: 6,
                                                                    compression_config: SshCompressionConfig::default(),
                                                                    ssh_version: "auto".to_string(),
                                                                    preferred_ciphers: vec![],
                                                                    preferred_macs: vec![],
                                                                    preferred_kex: vec![],
                                                                    preferred_host_key_algorithms: vec![],
                                                                    x11_forwarding: None,
                                                                    proxy_command: None,
                                                                    pty_type: None,
                                                                    environment: std::collections::HashMap::new(),
                                                                    sk_auth: false,
                                                                    sk_device_path: None,
                                                                    sk_pin: None,
                                                                    sk_application: None,
                                                                };

                                                                let mut service = ssh_service.lock().await;
                            service.connect_ssh(config).await.map_err(|_e| rquickjs::Error::Exception)
                                                            }
                                                        })));

                                                        // ssh.exec(session_id, command)
                                                        let ssh_service_clone = ssh_service.clone();
                                                        let _ = ssh_obj.set("exec", Function::new(ctx.clone(), Async(move |session_id: String, command: String| {
                                                            let ssh_service = ssh_service_clone.clone();
                                                            async move {
                                                                let mut service = ssh_service.lock().await;
                            service.execute_command(&session_id, command, None).await.map_err(|_e| rquickjs::Error::Exception)
                                                            }
                                                        })));

                                                        // ssh.disconnect(session_id)
                                                        let ssh_service_clone = ssh_service.clone();
                                                        let _ = ssh_obj.set("disconnect", Function::new(ctx.clone(), Async(move |session_id: String| {
                                                            let ssh_service = ssh_service_clone.clone();
                                                            async move {
                                                                let mut service = ssh_service.lock().await;
                            service.disconnect_ssh(&session_id).await.map_err(|_e| rquickjs::Error::Exception)
                                                            }
                                                        })));

                                                        let _ = global.set("ssh", ssh_obj);
                                                    }

                                                    // Execute the script and await the promise
                                                    let promise = ctx.eval_promise::<String>(code);
                                                    match promise {
                                                        Ok(p) => {
                                                            match p.into_future().await {
                                                                Ok(res) => Ok::<String, String>(res),
                                                                Err(e) => Err(format!("Script runtime error: {}", e))
                                                            }
                                                        },
                                                        Err(e) => Err(format!("Script eval error: {}", e))
                                                    }
                                                }).await;

                                                let _ = tx.send(result);
                                            },
                                            Err(e) => {
                                                let _ = tx.send(Err(format!("Failed to create JS context: {}", e)));
                                            }
                                        }
                                    },
                                    Err(e) => {
                                        let _ = tx.send(Err(format!("Failed to create JS runtime: {}", e)));
                                    }
                                }
                            });
                        }
                        Err(e) => {
                            let _ = tx.send(Err(format!("Failed to create tokio runtime: {}", e)));
                        }
                    }
                });

                // Await the result from the thread
                match rx.await {
                    Ok(res) => match res {
                        Ok(output) => Ok(ScriptResult {
                            success: true,
                            result: Some(output),
                            error: None,
                        }),
                        Err(e) => Ok(ScriptResult {
                            success: false,
                            result: None,
                            error: Some(e),
                        }),
                    },
                    Err(e) => Err(format!("Script thread panicked or cancelled: {}", e)),
                }
            }
            _ => Err(format!("Unsupported script type: {}", script_type)),
        }
    }
}
