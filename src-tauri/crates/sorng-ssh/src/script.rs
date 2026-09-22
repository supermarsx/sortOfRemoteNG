use crate::ssh::{
    service::connect_ssh_on_state, SshCompressionConfig, SshConnectionConfig, SshServiceState,
};
use rquickjs::prelude::Async;
use rquickjs::promise::MaybePromise;
use rquickjs::{
    AsyncContext, AsyncRuntime, CatchResultExt, Coerced, Ctx, FromJs, Function, Object, Value,
};
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
            Regex::new(r"\)\s*:\s*[\w<>\[\]|&\s,\.]+(\s*(?:\{|=>))").expect("valid regex literal");

        // Variable type annotation: let/const/var x: Type =
        static ref RE_VAR_TYPE: Regex =
            Regex::new(r"((?:let|const|var)\s+\w+)\s*:\s*[\w<>\[\]|&\s,\.]+(\s*=)").expect("valid regex literal");

        // Optional param: foo?: Type  →  foo
        static ref RE_OPTIONAL_PARAM: Regex =
            Regex::new(r"(\w+)\s*\?\s*:\s*[\w<>\[\]|&\s\.]+([,\)])").expect("valid regex literal");

        // Param type annotation: foo: Type  →  foo
        static ref RE_PARAM_TYPE: Regex =
            Regex::new(r"(\w+)\s*:\s*[\w<>\[\]|&\s\.]+([,\)])").expect("valid regex literal");

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
    r = RE_RETURN_TYPE.replace_all(&r, ")$1").to_string();
    r = RE_VAR_TYPE.replace_all(&r, "$1$2").to_string();
    r = RE_OPTIONAL_PARAM.replace_all(&r, "$1$2").to_string();
    r = RE_PARAM_TYPE.replace_all(&r, "$1$2").to_string();
    r = RE_AS_CAST.replace_all(&r, "").to_string();
    r = RE_MODIFIERS.replace_all(&r, "").to_string();
    r = RE_NON_NULL.replace_all(&r, "$1.$2").to_string();
    r = RE_VOID_RETURN.replace_all(&r, ");").to_string();
    r
}

/// Keep strings unquoted and primitives readable; use JSON for structured results.
/// JSON's normal semantics apply (including toJSON and omitted undefined properties).
/// Cycles, nested BigInts, and throwing conversion hooks remain script errors.
fn serialize_script_value<'js>(ctx: &Ctx<'js>, value: Value<'js>) -> rquickjs::Result<String> {
    if value.is_object() && !value.is_function() {
        return match ctx.json_stringify(value)? {
            Some(json) => json.to_string(),
            None => Ok("undefined".into()),
        };
    }
    // JS ToString rejects symbols, although their descriptive string is useful output.
    if let Some(symbol) = value.as_symbol() {
        let description = symbol.description()?;
        return Ok(format!(
            "Symbol({})",
            if description.is_undefined() {
                String::new()
            } else {
                String::from_js(ctx, description)?
            }
        ));
    }
    Coerced::<String>::from_js(ctx, value).map(|value| value.0)
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
                                                let result = ctx.async_with(async |ctx| {
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
                                                                    password: password.map(SecretString::from),
                                                                    private_key_path: None,
                                                                    private_key_content: None,
                                                                    totp_options: None,
                                                                    allow_agent_auth: true,
                                                                    private_key_passphrase: None,
                                                                    jump_hosts: vec![],
                                                                    proxy_config: None,
                                                                    proxy_chain: None,
                                                                    mixed_chain: None,
                                                                    openvpn_config: None,
                                                                    connect_timeout: Some(30),
                                                                    keep_alive_interval: Some(60),
                                                                    strict_host_key_checking: false,
                                                                    accept_new_host_keys: false,
                                                                    known_hosts_path: None,
                                                                    also_write_known_hosts: true,
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

                            connect_ssh_on_state(&ssh_service, config).await.map_err(|_e| rquickjs::Error::Exception)
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
                            crate::ssh::service::disconnect_ssh_on_state(&ssh_service, &session_id).await.map_err(|_e| rquickjs::Error::Exception)
                                                            }
                                                        })));

                                                        let _ = global.set("ssh", ssh_obj);
                                                    }

                                                    let promise = ctx.eval_promise(code).catch(&ctx)
                                                        .map_err(|e| format!("Script eval error: {e}"))?;
                                                    // QuickJS's async global eval wraps the completion in
                                                    // { value: ... }, even for strings and undefined. Unwrap
                                                    // this engine-owned object exactly once, never user data.
                                                    let completion = promise.into_future::<Object>().await.catch(&ctx)
                                                        .map_err(|e| format!("Script runtime error: {e}"))?;
                                                    let value: MaybePromise = completion.get("value").catch(&ctx)
                                                        .map_err(|e| format!("Script result error: {e}"))?;
                                                    // Preserve top-level await and also await a promise
                                                    // returned by the final expression before serialization.
                                                    let value = value.into_future::<Value>().await.catch(&ctx)
                                                        .map_err(|e| format!("Script runtime error: {e}"))?;
                                                    serialize_script_value(&ctx, value).catch(&ctx)
                                                        .map_err(|e| format!("Script result serialization error: {e}"))
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

#[cfg(test)]
mod tests {
    use super::{remove_ts_inline_syntax, ScriptContext, ScriptResult, ScriptService};
    use crate::ssh::SshService;

    async fn execute(code: &str) -> ScriptResult {
        let service = ScriptService::new(SshService::new());
        let result = service
            .lock()
            .await
            .execute_script(code.into(), "javascript".into(), ScriptContext::default())
            .await
            .unwrap_or_else(|error| panic!("Script execution failed: {error}"));
        result
    }

    async fn assert_output(code: &str, expected: &str) {
        let result = execute(code).await;
        assert!(result.success, "ScriptResult.error: {:?}", result.error);
        assert_eq!(result.result.as_deref(), Some(expected));
        assert!(result.error.is_none());
    }

    // Keep the five application coverage regressions exercised directly by this crate,
    // with value assertions and useful error diagnostics.
    #[tokio::test]
    async fn test_execute_javascript_simple() {
        assert_output("2 + 2", "4").await;
    }

    #[tokio::test]
    async fn test_execute_javascript_console_log() {
        assert_output(r#""console.log test""#, "console.log test").await;
    }

    #[tokio::test]
    async fn test_execute_javascript_variables() {
        assert_output("let x = 10; let y = 20; x + y", "30").await;
    }

    #[tokio::test]
    async fn test_execute_javascript_function() {
        assert_output("function add(a, b) { return a + b; } add(5, 3)", "8").await;
    }

    #[tokio::test]
    async fn test_execute_script_with_connection_context() {
        let service = ScriptService::new(SshService::new());
        let result = service
            .lock()
            .await
            .execute_script(
                r#""Connection context test executed""#.into(),
                "javascript".into(),
                ScriptContext {
                    connection_id: Some("conn_123".into()),
                    session_id: Some("session_456".into()),
                    trigger: "connection_event".into(),
                },
            )
            .await
            .unwrap_or_else(|error| panic!("Script execution failed: {error}"));
        assert!(result.success, "ScriptResult.error: {:?}", result.error);
        assert_eq!(
            result.result.as_deref(),
            Some("Connection context test executed")
        );
    }

    #[tokio::test]
    async fn serializes_script_values_without_unwrapping_user_objects() {
        for (code, expected) in [
            ("undefined", "undefined"),
            ("null", "null"),
            ("true", "true"),
            ("1.5", "1.5"),
            ("NaN", "NaN"),
            ("Infinity", "Infinity"),
            ("12345678901234567890n", "12345678901234567890"),
            ("Symbol('result')", "Symbol(result)"),
            ("Symbol()", "Symbol()"),
            ("''", ""),
            ("console.log('test')", "undefined"),
            ("let x = 1;", "undefined"),
            ("[1, 'two', null]", r#"[1,"two",null]"#),
            ("({value: {value: 42}})", r#"{"value":{"value":42}}"#),
            ("Object.create(null)", "{}"),
            ("({toJSON() { return undefined; }})", "undefined"),
            (
                "String = () => 'wrong'; JSON.stringify = () => 'wrong'; ({ok:true})",
                r#"{"ok":true}"#,
            ),
        ] {
            assert_output(code, expected).await;
        }
        let result = execute("(function answer() { return 42; })").await;
        assert!(result.success, "ScriptResult.error: {:?}", result.error);
        assert!(result.result.unwrap().contains("function answer()"));
    }

    #[tokio::test]
    async fn awaits_top_level_and_final_expression_promises() {
        for (code, expected) in [
            ("const x = await Promise.resolve(20); x + 22", "42"),
            ("Promise.resolve(42).then(x => x + 1)", "43"),
            (
                "(async () => { await Promise.resolve(); return {value:42}; })()",
                r#"{"value":42}"#,
            ),
        ] {
            tokio::time::timeout(
                std::time::Duration::from_secs(5),
                assert_output(code, expected),
            )
            .await
            .expect("script promise did not settle");
        }
    }

    #[tokio::test]
    async fn preserves_evaluation_rejection_and_serialization_errors() {
        for (code, expected) in [
            ("function broken { return 1; }", "Script eval error:"),
            ("throw new Error('runtime sentinel')", "runtime sentinel"),
            (
                "await Promise.reject(new Error('await sentinel'))",
                "await sentinel",
            ),
            (
                "Promise.reject(new Error('promise sentinel'))",
                "promise sentinel",
            ),
            (
                "Promise.reject('string rejection sentinel')",
                "string rejection sentinel",
            ),
            (
                "let x = {}; x.self = x; x",
                "Script result serialization error:",
            ),
            ("({value: 1n})", "Script result serialization error:"),
            (
                "({toJSON() { throw new Error('serialization sentinel'); }})",
                "serialization sentinel",
            ),
        ] {
            let result = execute(code).await;
            assert!(!result.success, "Unexpected success for {code}");
            assert!(result.result.is_none());
            assert!(
                result
                    .error
                    .as_deref()
                    .is_some_and(|error| error.contains(expected)),
                "Expected {expected:?}, ScriptResult.error: {:?}",
                result.error
            );
        }
    }

    #[tokio::test]
    async fn keeps_unsafe_script_rejection_before_evaluation() {
        let service = ScriptService::new(SshService::new());
        for code in [
            "eval('2+2')",
            "require('fs')",
            "new Function('return 1')()",
            "import('fs')",
            "globalThis",
        ] {
            let result = service
                .lock()
                .await
                .execute_script(code.into(), "javascript".into(), ScriptContext::default())
                .await;
            assert!(
                matches!(result, Err(error) if error.starts_with("Potentially unsafe code detected:"))
            );
        }
    }

    #[test]
    fn strips_return_types_without_dropping_javascript_delimiters() {
        assert_eq!(
            remove_ts_inline_syntax("function render(value: string): string { return value; }"),
            "function render(value){ return value; }"
        );
        assert_eq!(
            remove_ts_inline_syntax("const double = (value: number): number => value * 2;"),
            "const double = (value)=> value * 2;"
        );
    }

    #[test]
    fn strips_parameter_types_without_dropping_parameter_delimiters() {
        assert_eq!(
            remove_ts_inline_syntax("function greet(name?: string, count: number) {}"),
            "function greet(name, count) {}"
        );
    }
}
