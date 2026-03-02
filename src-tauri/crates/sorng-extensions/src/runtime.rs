//! Script runtime engine for executing extension scripts.
//!
//! Extensions define their logic as JSON-serialised [`ExtensionScript`]
//! documents containing named handler functions built from
//! [`ScriptInstruction`] trees.  This module provides the interpreter
//! that executes those instructions inside a [`Sandbox`].

use std::collections::HashMap;
use std::time::Instant;

use chrono::Utc;
use log::{debug, error, info, warn};

use crate::sandbox::Sandbox;
use crate::types::*;

// ─── Script Parser ──────────────────────────────────────────────────

/// Parse a JSON string into an [`ExtensionScript`].
pub fn parse_script(json: &str) -> ExtResult<ExtensionScript> {
    serde_json::from_str(json)
        .map_err(|e| ExtError::script(format!("Failed to parse extension script: {}", e)))
}

/// Serialize an [`ExtensionScript`] to a JSON string.
pub fn serialize_script(script: &ExtensionScript) -> ExtResult<String> {
    serde_json::to_string_pretty(script)
        .map_err(|e| ExtError::script(format!("Failed to serialize script: {}", e)))
}

// ─── Runtime Environment ────────────────────────────────────────────

/// The runtime environment for script execution.
/// Holds variables, log output, and emitted events.
#[derive(Debug, Clone)]
pub struct RuntimeEnv {
    /// Variable bindings (name → value).
    variables: HashMap<String, ScriptValue>,
    /// Log output accumulated during execution.
    log_output: Vec<LogEntry>,
    /// Custom events emitted during execution.
    emitted_events: Vec<(String, ScriptValue)>,
    /// Whether a return statement has been hit.
    returned: bool,
    /// The return value (if any).
    return_value: ScriptValue,
    /// Whether a break statement has been hit (loop control).
    break_flag: bool,
    /// Whether a continue statement has been hit (loop control).
    continue_flag: bool,
    /// Error from a try-catch block.
    caught_error: Option<String>,
}

impl RuntimeEnv {
    pub fn new() -> Self {
        Self {
            variables: HashMap::new(),
            log_output: Vec::new(),
            emitted_events: Vec::new(),
            returned: false,
            return_value: ScriptValue::Null,
            break_flag: false,
            continue_flag: false,
            caught_error: None,
        }
    }

    /// Set a variable in the environment.
    pub fn set_var(&mut self, name: impl Into<String>, value: ScriptValue) {
        self.variables.insert(name.into(), value);
    }

    /// Get a variable value, returning Null if not set.
    pub fn get_var(&self, name: &str) -> ScriptValue {
        self.variables.get(name).cloned().unwrap_or(ScriptValue::Null)
    }

    /// Check whether a variable exists.
    pub fn has_var(&self, name: &str) -> bool {
        self.variables.contains_key(name)
    }

    /// Get all variable names.
    pub fn var_names(&self) -> Vec<String> {
        self.variables.keys().cloned().collect()
    }

    /// Append a log entry.
    pub fn log(&mut self, level: LogLevel, message: impl Into<String>) {
        self.log_output.push(LogEntry {
            level,
            message: message.into(),
            timestamp: Utc::now(),
        });
    }

    /// Get the accumulated log output.
    pub fn log_output(&self) -> &[LogEntry] {
        &self.log_output
    }

    /// Get emitted events.
    pub fn emitted_events(&self) -> &[(String, ScriptValue)] {
        &self.emitted_events
    }
}

impl Default for RuntimeEnv {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Interpreter ────────────────────────────────────────────────────

/// The script interpreter.  Executes instructions within a sandbox.
pub struct ScriptInterpreter {
    /// The loaded extension script.
    script: ExtensionScript,
    /// Built-in API function implementations.
    api_functions: HashMap<String, ApiFn>,
}

/// Type alias for an API function implementation.
/// Takes (args, env) and returns a result value.
type ApiFn = Box<dyn Fn(&[ScriptValue], &mut RuntimeEnv) -> ExtResult<ScriptValue> + Send + Sync>;

impl ScriptInterpreter {
    /// Create a new interpreter for the given script.
    pub fn new(script: ExtensionScript) -> Self {
        let mut interp = Self {
            script,
            api_functions: HashMap::new(),
        };
        interp.register_builtins();
        interp
    }

    /// Register a custom API function.
    pub fn register_api<F>(&mut self, name: impl Into<String>, func: F)
    where
        F: Fn(&[ScriptValue], &mut RuntimeEnv) -> ExtResult<ScriptValue> + Send + Sync + 'static,
    {
        self.api_functions.insert(name.into(), Box::new(func));
    }

    /// Get the list of available handler names.
    pub fn handler_names(&self) -> Vec<String> {
        self.script.handlers.keys().cloned().collect()
    }

    /// Check whether the script has a specific handler.
    pub fn has_handler(&self, name: &str) -> bool {
        self.script.handlers.contains_key(name)
    }

    /// Execute the init block.
    pub fn run_init(&self, sandbox: &mut Sandbox, env: &mut RuntimeEnv) -> ExtResult<()> {
        sandbox.begin()?;
        let result = self.execute_block(&self.script.init.clone(), sandbox, env);
        let _metrics = sandbox.end()?;
        result
    }

    /// Execute the cleanup block.
    pub fn run_cleanup(&self, sandbox: &mut Sandbox, env: &mut RuntimeEnv) -> ExtResult<()> {
        sandbox.begin()?;
        let result = self.execute_block(&self.script.cleanup.clone(), sandbox, env);
        let _metrics = sandbox.end()?;
        result
    }

    /// Execute a named handler with optional arguments.
    pub fn run_handler(
        &self,
        handler_name: &str,
        args: HashMap<String, ScriptValue>,
        sandbox: &mut Sandbox,
        env: &mut RuntimeEnv,
    ) -> ExtResult<ExecutionResult> {
        let instructions = self
            .script
            .handlers
            .get(handler_name)
            .ok_or_else(|| ExtError::script(format!("Handler '{}' not found", handler_name)))?
            .clone();

        // Inject arguments as variables.
        for (key, val) in args {
            env.set_var(key, val);
        }

        let start = Instant::now();
        sandbox.begin()?;

        let exec_result = self.execute_block(&instructions, sandbox, env);

        let metrics = sandbox.end().unwrap_or_default();

        let duration_ms = start.elapsed().as_millis() as u64;

        match exec_result {
            Ok(()) => Ok(ExecutionResult {
                success: true,
                output: if env.returned {
                    Some(env.return_value.clone().into())
                } else {
                    None
                },
                error: None,
                duration_ms,
                instructions_executed: metrics.instructions_executed,
                memory_used_bytes: metrics.memory_used_bytes,
                log_output: env.log_output().to_vec(),
            }),
            Err(e) => Ok(ExecutionResult {
                success: false,
                output: None,
                error: Some(e.message.clone()),
                duration_ms,
                instructions_executed: metrics.instructions_executed,
                memory_used_bytes: metrics.memory_used_bytes,
                log_output: env.log_output().to_vec(),
            }),
        }
    }

    // ── Instruction Execution ───────────────────────────────────

    fn execute_block(
        &self,
        instructions: &[ScriptInstruction],
        sandbox: &mut Sandbox,
        env: &mut RuntimeEnv,
    ) -> ExtResult<()> {
        for instr in instructions {
            if env.returned || env.break_flag || env.continue_flag {
                break;
            }
            self.execute_instruction(instr, sandbox, env)?;
        }
        Ok(())
    }

    fn execute_instruction(
        &self,
        instr: &ScriptInstruction,
        sandbox: &mut Sandbox,
        env: &mut RuntimeEnv,
    ) -> ExtResult<()> {
        sandbox.check_limits()?;

        match instr {
            ScriptInstruction::Noop { .. } => Ok(()),

            ScriptInstruction::SetVar { name, value } => {
                let resolved = self.resolve_value(value, env);
                env.set_var(name, resolved);
                Ok(())
            }

            ScriptInstruction::CallApi {
                function,
                args,
                result_var,
            } => {
                sandbox.tick_api_call()?;
                sandbox.push_call()?;

                let resolved_args: Vec<ScriptValue> =
                    args.iter().map(|a| self.resolve_value(a, env)).collect();

                let result = if let Some(func) = self.api_functions.get(function.as_str()) {
                    func(&resolved_args, env)
                } else {
                    Err(ExtError::api_unavailable(format!(
                        "API function '{}' not found",
                        function
                    )))
                };

                sandbox.pop_call();

                match result {
                    Ok(val) => {
                        if let Some(var_name) = result_var {
                            env.set_var(var_name, val);
                        }
                        Ok(())
                    }
                    Err(e) => Err(e),
                }
            }

            ScriptInstruction::If {
                condition,
                then_block,
                else_block,
            } => {
                if self.evaluate_condition(condition, env) {
                    self.execute_block(then_block, sandbox, env)
                } else {
                    self.execute_block(else_block, sandbox, env)
                }
            }

            ScriptInstruction::Loop {
                count,
                iterator_var,
                body,
            } => {
                for i in 0..*count {
                    if env.returned || env.break_flag {
                        break;
                    }
                    env.continue_flag = false;
                    env.set_var(iterator_var, ScriptValue::Int(i as i64));
                    self.execute_block(body, sandbox, env)?;
                }
                env.break_flag = false;
                env.continue_flag = false;
                Ok(())
            }

            ScriptInstruction::While { condition, body } => {
                let max_iterations = 100_000u64;
                let mut iter_count = 0u64;
                while self.evaluate_condition(condition, env) {
                    if env.returned || env.break_flag {
                        break;
                    }
                    env.continue_flag = false;
                    self.execute_block(body, sandbox, env)?;
                    iter_count += 1;
                    if iter_count >= max_iterations {
                        return Err(ExtError::sandbox(
                            "While loop exceeded maximum iteration count",
                        ));
                    }
                }
                env.break_flag = false;
                env.continue_flag = false;
                Ok(())
            }

            ScriptInstruction::Return { value } => {
                env.return_value = self.resolve_value(value, env);
                env.returned = true;
                Ok(())
            }

            ScriptInstruction::Log { level, message } => {
                let msg = self.interpolate_string(message, env);
                match level {
                    LogLevel::Debug => debug!("[ext] {}", msg),
                    LogLevel::Info => info!("[ext] {}", msg),
                    LogLevel::Warn => warn!("[ext] {}", msg),
                    LogLevel::Error => error!("[ext] {}", msg),
                }
                env.log(level.clone(), msg);
                Ok(())
            }

            ScriptInstruction::EmitEvent { event_name, data } => {
                let resolved = self.resolve_value(data, env);
                env.emitted_events.push((event_name.clone(), resolved));
                Ok(())
            }

            ScriptInstruction::Sleep { ms } => {
                // In the sandboxed context, sleep just records the intent.
                // Actual async sleeping is handled by the service layer.
                env.log(LogLevel::Debug, format!("Sleep requested: {}ms", ms));
                Ok(())
            }

            ScriptInstruction::TryCatch {
                try_block,
                catch_var,
                catch_block,
            } => {
                match self.execute_block(try_block, sandbox, env) {
                    Ok(()) => Ok(()),
                    Err(e) => {
                        env.set_var(catch_var, ScriptValue::String(e.message.clone()));
                        env.caught_error = Some(e.message);
                        self.execute_block(catch_block, sandbox, env)
                    }
                }
            }

            ScriptInstruction::Break => {
                env.break_flag = true;
                Ok(())
            }

            ScriptInstruction::Continue => {
                env.continue_flag = true;
                Ok(())
            }
        }
    }

    // ── Value Resolution ────────────────────────────────────────

    fn resolve_value(&self, value: &ScriptValue, env: &RuntimeEnv) -> ScriptValue {
        match value {
            // If it's a string starting with "$", treat it as a variable reference.
            ScriptValue::String(s) if s.starts_with('$') => {
                let var_name = &s[1..];
                env.get_var(var_name)
            }
            other => other.clone(),
        }
    }

    fn interpolate_string(&self, template: &str, env: &RuntimeEnv) -> String {
        let mut result = template.to_string();
        for name in env.var_names() {
            let placeholder = format!("${{{}}}", name);
            if result.contains(&placeholder) {
                let value = env.get_var(&name).to_display_string();
                result = result.replace(&placeholder, &value);
            }
        }
        result
    }

    // ── Condition Evaluation ────────────────────────────────────

    fn evaluate_condition(&self, cond: &ScriptCondition, env: &RuntimeEnv) -> bool {
        match cond {
            ScriptCondition::Always => true,

            ScriptCondition::VarTruthy(name) => env.get_var(name).is_truthy(),

            ScriptCondition::Compare { left, op, right } => {
                let l = self.resolve_value(left, env);
                let r = self.resolve_value(right, env);
                self.compare_values(&l, op, &r)
            }

            ScriptCondition::And(a, b) => {
                self.evaluate_condition(a, env) && self.evaluate_condition(b, env)
            }

            ScriptCondition::Or(a, b) => {
                self.evaluate_condition(a, env) || self.evaluate_condition(b, env)
            }

            ScriptCondition::Not(inner) => !self.evaluate_condition(inner, env),
        }
    }

    fn compare_values(&self, left: &ScriptValue, op: &CompareOp, right: &ScriptValue) -> bool {
        match op {
            CompareOp::Equal => left == right,
            CompareOp::NotEqual => left != right,
            CompareOp::LessThan => {
                left.as_float().zip(right.as_float()).map_or(false, |(a, b)| a < b)
            }
            CompareOp::LessEqual => {
                left.as_float().zip(right.as_float()).map_or(false, |(a, b)| a <= b)
            }
            CompareOp::GreaterThan => {
                left.as_float().zip(right.as_float()).map_or(false, |(a, b)| a > b)
            }
            CompareOp::GreaterEqual => {
                left.as_float().zip(right.as_float()).map_or(false, |(a, b)| a >= b)
            }
            CompareOp::Contains => {
                let ls = left.to_display_string();
                let rs = right.to_display_string();
                ls.contains(&rs)
            }
            CompareOp::StartsWith => {
                let ls = left.to_display_string();
                let rs = right.to_display_string();
                ls.starts_with(&rs)
            }
            CompareOp::EndsWith => {
                let ls = left.to_display_string();
                let rs = right.to_display_string();
                ls.ends_with(&rs)
            }
            CompareOp::Matches => {
                if let Some(pattern) = right.as_str() {
                    let text = left.to_display_string();
                    regex::Regex::new(pattern).map_or(false, |re| re.is_match(&text))
                } else {
                    false
                }
            }
        }
    }

    // ── Built-in API Functions ──────────────────────────────────

    fn register_builtins(&mut self) {
        // string.length
        self.register_api("string.length", |args, _env| {
            let s = args.first().and_then(|v| v.as_str()).unwrap_or("");
            Ok(ScriptValue::Int(s.len() as i64))
        });

        // string.upper
        self.register_api("string.upper", |args, _env| {
            let s = args.first().map(|v| v.to_display_string()).unwrap_or_default();
            Ok(ScriptValue::String(s.to_uppercase()))
        });

        // string.lower
        self.register_api("string.lower", |args, _env| {
            let s = args.first().map(|v| v.to_display_string()).unwrap_or_default();
            Ok(ScriptValue::String(s.to_lowercase()))
        });

        // string.trim
        self.register_api("string.trim", |args, _env| {
            let s = args.first().map(|v| v.to_display_string()).unwrap_or_default();
            Ok(ScriptValue::String(s.trim().to_string()))
        });

        // string.concat
        self.register_api("string.concat", |args, _env| {
            let result: String = args.iter().map(|v| v.to_display_string()).collect();
            Ok(ScriptValue::String(result))
        });

        // string.split
        self.register_api("string.split", |args, _env| {
            let s = args.first().map(|v| v.to_display_string()).unwrap_or_default();
            let sep = args.get(1).and_then(|v| v.as_str()).unwrap_or(",");
            let parts: Vec<ScriptValue> = s.split(sep).map(|p| ScriptValue::String(p.to_string())).collect();
            Ok(ScriptValue::Array(parts))
        });

        // string.replace
        self.register_api("string.replace", |args, _env| {
            let s = args.first().map(|v| v.to_display_string()).unwrap_or_default();
            let from = args.get(1).map(|v| v.to_display_string()).unwrap_or_default();
            let to = args.get(2).map(|v| v.to_display_string()).unwrap_or_default();
            Ok(ScriptValue::String(s.replace(&from, &to)))
        });

        // string.contains
        self.register_api("string.contains", |args, _env| {
            let s = args.first().map(|v| v.to_display_string()).unwrap_or_default();
            let needle = args.get(1).map(|v| v.to_display_string()).unwrap_or_default();
            Ok(ScriptValue::Bool(s.contains(&needle)))
        });

        // string.substring
        self.register_api("string.substring", |args, _env| {
            let s = args.first().map(|v| v.to_display_string()).unwrap_or_default();
            let start = args.get(1).and_then(|v| v.as_int()).unwrap_or(0) as usize;
            let len = args.get(2).and_then(|v| v.as_int()).map(|v| v as usize);
            let result = if let Some(l) = len {
                s.chars().skip(start).take(l).collect()
            } else {
                s.chars().skip(start).collect()
            };
            Ok(ScriptValue::String(result))
        });

        // math.add
        self.register_api("math.add", |args, _env| {
            let a = args.first().and_then(|v| v.as_float()).unwrap_or(0.0);
            let b = args.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
            Ok(ScriptValue::Float(a + b))
        });

        // math.sub
        self.register_api("math.sub", |args, _env| {
            let a = args.first().and_then(|v| v.as_float()).unwrap_or(0.0);
            let b = args.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
            Ok(ScriptValue::Float(a - b))
        });

        // math.mul
        self.register_api("math.mul", |args, _env| {
            let a = args.first().and_then(|v| v.as_float()).unwrap_or(0.0);
            let b = args.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
            Ok(ScriptValue::Float(a * b))
        });

        // math.div
        self.register_api("math.div", |args, _env| {
            let a = args.first().and_then(|v| v.as_float()).unwrap_or(0.0);
            let b = args.get(1).and_then(|v| v.as_float()).unwrap_or(1.0);
            if b == 0.0 {
                Err(ExtError::script("Division by zero"))
            } else {
                Ok(ScriptValue::Float(a / b))
            }
        });

        // math.mod
        self.register_api("math.mod", |args, _env| {
            let a = args.first().and_then(|v| v.as_int()).unwrap_or(0);
            let b = args.get(1).and_then(|v| v.as_int()).unwrap_or(1);
            if b == 0 {
                Err(ExtError::script("Division by zero"))
            } else {
                Ok(ScriptValue::Int(a % b))
            }
        });

        // math.abs
        self.register_api("math.abs", |args, _env| {
            let v = args.first().and_then(|v| v.as_float()).unwrap_or(0.0);
            Ok(ScriptValue::Float(v.abs()))
        });

        // math.min
        self.register_api("math.min", |args, _env| {
            let a = args.first().and_then(|v| v.as_float()).unwrap_or(0.0);
            let b = args.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
            Ok(ScriptValue::Float(a.min(b)))
        });

        // math.max
        self.register_api("math.max", |args, _env| {
            let a = args.first().and_then(|v| v.as_float()).unwrap_or(0.0);
            let b = args.get(1).and_then(|v| v.as_float()).unwrap_or(0.0);
            Ok(ScriptValue::Float(a.max(b)))
        });

        // math.floor
        self.register_api("math.floor", |args, _env| {
            let v = args.first().and_then(|v| v.as_float()).unwrap_or(0.0);
            Ok(ScriptValue::Int(v.floor() as i64))
        });

        // math.ceil
        self.register_api("math.ceil", |args, _env| {
            let v = args.first().and_then(|v| v.as_float()).unwrap_or(0.0);
            Ok(ScriptValue::Int(v.ceil() as i64))
        });

        // array.length
        self.register_api("array.length", |args, _env| {
            match args.first() {
                Some(ScriptValue::Array(arr)) => Ok(ScriptValue::Int(arr.len() as i64)),
                _ => Ok(ScriptValue::Int(0)),
            }
        });

        // array.push
        self.register_api("array.push", |args, env| {
            let var_name = args.first().and_then(|v| v.as_str()).unwrap_or("");
            let item = args.get(1).cloned().unwrap_or(ScriptValue::Null);
            let mut arr = match env.get_var(var_name) {
                ScriptValue::Array(a) => a,
                _ => Vec::new(),
            };
            arr.push(item);
            env.set_var(var_name, ScriptValue::Array(arr.clone()));
            Ok(ScriptValue::Int(arr.len() as i64))
        });

        // array.join
        self.register_api("array.join", |args, _env| {
            match args.first() {
                Some(ScriptValue::Array(arr)) => {
                    let sep = args.get(1).and_then(|v| v.as_str()).unwrap_or(",");
                    let parts: Vec<String> = arr.iter().map(|v| v.to_display_string()).collect();
                    Ok(ScriptValue::String(parts.join(sep)))
                }
                _ => Ok(ScriptValue::String(String::new())),
            }
        });

        // json.parse
        self.register_api("json.parse", |args, _env| {
            let s = args.first().and_then(|v| v.as_str()).unwrap_or("null");
            let json: serde_json::Value = serde_json::from_str(s)
                .map_err(|e| ExtError::script(format!("JSON parse error: {}", e)))?;
            Ok(ScriptValue::from(json))
        });

        // json.stringify
        self.register_api("json.stringify", |args, _env| {
            let val = args.first().cloned().unwrap_or(ScriptValue::Null);
            let json: serde_json::Value = val.into();
            let s = serde_json::to_string(&json)
                .map_err(|e| ExtError::script(format!("JSON stringify error: {}", e)))?;
            Ok(ScriptValue::String(s))
        });

        // time.now
        self.register_api("time.now", |_args, _env| {
            Ok(ScriptValue::String(Utc::now().to_rfc3339()))
        });

        // time.unix
        self.register_api("time.unix", |_args, _env| {
            Ok(ScriptValue::Int(Utc::now().timestamp()))
        });

        // type.of
        self.register_api("type.of", |args, _env| {
            let type_name = match args.first() {
                Some(ScriptValue::Null) => "null",
                Some(ScriptValue::Bool(_)) => "bool",
                Some(ScriptValue::Int(_)) => "int",
                Some(ScriptValue::Float(_)) => "float",
                Some(ScriptValue::String(_)) => "string",
                Some(ScriptValue::Array(_)) => "array",
                Some(ScriptValue::Object(_)) => "object",
                None => "null",
            };
            Ok(ScriptValue::String(type_name.to_string()))
        });

        // env.get — get a variable from the environment
        self.register_api("env.get", |args, env| {
            let name = args.first().and_then(|v| v.as_str()).unwrap_or("");
            Ok(env.get_var(name))
        });

        // env.set — set a variable in the environment
        self.register_api("env.set", |args, env| {
            let name = args.first().and_then(|v| v.as_str()).unwrap_or("").to_string();
            let value = args.get(1).cloned().unwrap_or(ScriptValue::Null);
            if !name.is_empty() {
                env.set_var(name, value);
            }
            Ok(ScriptValue::Null)
        });

        // env.has — check if a variable exists
        self.register_api("env.has", |args, env| {
            let name = args.first().and_then(|v| v.as_str()).unwrap_or("");
            Ok(ScriptValue::Bool(env.has_var(name)))
        });
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_sandbox() -> Sandbox {
        Sandbox::new(SandboxConfig {
            max_instructions: 10_000,
            max_execution_time_ms: 5_000,
            max_call_depth: 32,
            api_rate_limit_per_min: 100,
            ..Default::default()
        })
    }

    fn make_empty_script() -> ExtensionScript {
        ExtensionScript::default()
    }

    #[test]
    fn set_var_and_return() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "main".into(),
            vec![
                ScriptInstruction::SetVar {
                    name: "x".into(),
                    value: ScriptValue::Int(42),
                },
                ScriptInstruction::Return {
                    value: ScriptValue::String("$x".into()),
                },
            ],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp
            .run_handler("main", HashMap::new(), &mut sandbox, &mut env)
            .unwrap();
        assert!(result.success);
        assert_eq!(result.output, Some(serde_json::json!(42)));
    }

    #[test]
    fn if_then_else() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "test".into(),
            vec![
                ScriptInstruction::SetVar {
                    name: "flag".into(),
                    value: ScriptValue::Bool(true),
                },
                ScriptInstruction::If {
                    condition: ScriptCondition::VarTruthy("flag".into()),
                    then_block: vec![ScriptInstruction::Return {
                        value: ScriptValue::String("yes".into()),
                    }],
                    else_block: vec![ScriptInstruction::Return {
                        value: ScriptValue::String("no".into()),
                    }],
                },
            ],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp
            .run_handler("test", HashMap::new(), &mut sandbox, &mut env)
            .unwrap();
        assert!(result.success);
        assert_eq!(result.output, Some(serde_json::json!("yes")));
    }

    #[test]
    fn loop_iteration() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "loop_test".into(),
            vec![
                ScriptInstruction::SetVar {
                    name: "sum".into(),
                    value: ScriptValue::Int(0),
                },
                ScriptInstruction::Loop {
                    count: 5,
                    iterator_var: "i".into(),
                    body: vec![ScriptInstruction::CallApi {
                        function: "math.add".into(),
                        args: vec![
                            ScriptValue::String("$sum".into()),
                            ScriptValue::String("$i".into()),
                        ],
                        result_var: Some("sum".into()),
                    }],
                },
                ScriptInstruction::Return {
                    value: ScriptValue::String("$sum".into()),
                },
            ],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp
            .run_handler("loop_test", HashMap::new(), &mut sandbox, &mut env)
            .unwrap();
        assert!(result.success);
        // 0 + 1 + 2 + 3 + 4 = 10.0
        assert_eq!(result.output, Some(serde_json::json!(10.0)));
    }

    #[test]
    fn break_in_loop() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "break_test".into(),
            vec![
                ScriptInstruction::SetVar {
                    name: "count".into(),
                    value: ScriptValue::Int(0),
                },
                ScriptInstruction::Loop {
                    count: 100,
                    iterator_var: "i".into(),
                    body: vec![
                        ScriptInstruction::If {
                            condition: ScriptCondition::Compare {
                                left: ScriptValue::String("$i".into()),
                                op: CompareOp::GreaterEqual,
                                right: ScriptValue::Int(3),
                            },
                            then_block: vec![ScriptInstruction::Break],
                            else_block: vec![],
                        },
                        ScriptInstruction::CallApi {
                            function: "math.add".into(),
                            args: vec![
                                ScriptValue::String("$count".into()),
                                ScriptValue::Int(1),
                            ],
                            result_var: Some("count".into()),
                        },
                    ],
                },
                ScriptInstruction::Return {
                    value: ScriptValue::String("$count".into()),
                },
            ],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp
            .run_handler("break_test", HashMap::new(), &mut sandbox, &mut env)
            .unwrap();
        assert!(result.success);
        // Only iterations 0, 1, 2 execute the add.
        assert_eq!(result.output, Some(serde_json::json!(3.0)));
    }

    #[test]
    fn try_catch_catches_error() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "try_test".into(),
            vec![ScriptInstruction::TryCatch {
                try_block: vec![ScriptInstruction::CallApi {
                    function: "math.div".into(),
                    args: vec![ScriptValue::Int(1), ScriptValue::Int(0)],
                    result_var: None,
                }],
                catch_var: "err".into(),
                catch_block: vec![ScriptInstruction::Return {
                    value: ScriptValue::String("$err".into()),
                }],
            }],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp
            .run_handler("try_test", HashMap::new(), &mut sandbox, &mut env)
            .unwrap();
        assert!(result.success);
        let output = result.output.unwrap();
        assert!(output.as_str().unwrap().contains("Division by zero"));
    }

    #[test]
    fn log_output() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "log_test".into(),
            vec![ScriptInstruction::Log {
                level: LogLevel::Info,
                message: "Hello, world!".into(),
            }],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp
            .run_handler("log_test", HashMap::new(), &mut sandbox, &mut env)
            .unwrap();
        assert!(result.success);
        assert_eq!(result.log_output.len(), 1);
        assert_eq!(result.log_output[0].message, "Hello, world!");
    }

    #[test]
    fn string_builtins() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "string_test".into(),
            vec![
                ScriptInstruction::CallApi {
                    function: "string.upper".into(),
                    args: vec![ScriptValue::String("hello".into())],
                    result_var: Some("result".into()),
                },
                ScriptInstruction::Return {
                    value: ScriptValue::String("$result".into()),
                },
            ],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp
            .run_handler("string_test", HashMap::new(), &mut sandbox, &mut env)
            .unwrap();
        assert!(result.success);
        assert_eq!(result.output, Some(serde_json::json!("HELLO")));
    }

    #[test]
    fn handler_not_found() {
        let script = make_empty_script();
        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp.run_handler("nonexistent", HashMap::new(), &mut sandbox, &mut env);
        assert!(result.is_err());
    }

    #[test]
    fn api_function_not_found() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "bad_api".into(),
            vec![ScriptInstruction::CallApi {
                function: "nonexistent.func".into(),
                args: vec![],
                result_var: None,
            }],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp
            .run_handler("bad_api", HashMap::new(), &mut sandbox, &mut env)
            .unwrap();
        assert!(!result.success);
        assert!(result.error.unwrap().contains("not found"));
    }

    #[test]
    fn emit_event() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "event_test".into(),
            vec![ScriptInstruction::EmitEvent {
                event_name: "my_event".into(),
                data: ScriptValue::String("payload".into()),
            }],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        interp
            .run_handler("event_test", HashMap::new(), &mut sandbox, &mut env)
            .unwrap();

        let events = env.emitted_events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "my_event");
    }

    #[test]
    fn handler_with_args() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "greet".into(),
            vec![ScriptInstruction::Return {
                value: ScriptValue::String("$name".into()),
            }],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let mut args = HashMap::new();
        args.insert("name".into(), ScriptValue::String("Alice".into()));

        let result = interp
            .run_handler("greet", args, &mut sandbox, &mut env)
            .unwrap();
        assert!(result.success);
        assert_eq!(result.output, Some(serde_json::json!("Alice")));
    }

    #[test]
    fn noop_executes() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "noop_test".into(),
            vec![
                ScriptInstruction::Noop {
                    comment: Some("This is a comment".into()),
                },
                ScriptInstruction::Return {
                    value: ScriptValue::Bool(true),
                },
            ],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp
            .run_handler("noop_test", HashMap::new(), &mut sandbox, &mut env)
            .unwrap();
        assert!(result.success);
    }

    #[test]
    fn json_parse_stringify() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "json_test".into(),
            vec![
                ScriptInstruction::CallApi {
                    function: "json.parse".into(),
                    args: vec![ScriptValue::String(r#"{"key":"value"}"#.into())],
                    result_var: Some("parsed".into()),
                },
                ScriptInstruction::CallApi {
                    function: "json.stringify".into(),
                    args: vec![ScriptValue::String("$parsed".into())],
                    result_var: Some("stringified".into()),
                },
                ScriptInstruction::Return {
                    value: ScriptValue::String("$stringified".into()),
                },
            ],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp
            .run_handler("json_test", HashMap::new(), &mut sandbox, &mut env)
            .unwrap();
        assert!(result.success);
        let output = result.output.unwrap();
        assert!(output.as_str().unwrap().contains("key"));
    }

    #[test]
    fn math_builtins() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "math_test".into(),
            vec![
                ScriptInstruction::CallApi {
                    function: "math.mul".into(),
                    args: vec![ScriptValue::Int(3), ScriptValue::Int(4)],
                    result_var: Some("result".into()),
                },
                ScriptInstruction::Return {
                    value: ScriptValue::String("$result".into()),
                },
            ],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp
            .run_handler("math_test", HashMap::new(), &mut sandbox, &mut env)
            .unwrap();
        assert!(result.success);
        assert_eq!(result.output, Some(serde_json::json!(12.0)));
    }

    #[test]
    fn type_of_builtin() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "type_test".into(),
            vec![
                ScriptInstruction::CallApi {
                    function: "type.of".into(),
                    args: vec![ScriptValue::String("hello".into())],
                    result_var: Some("result".into()),
                },
                ScriptInstruction::Return {
                    value: ScriptValue::String("$result".into()),
                },
            ],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp
            .run_handler("type_test", HashMap::new(), &mut sandbox, &mut env)
            .unwrap();
        assert!(result.success);
        assert_eq!(result.output, Some(serde_json::json!("string")));
    }

    #[test]
    fn compare_operations() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "cmp_test".into(),
            vec![ScriptInstruction::If {
                condition: ScriptCondition::Compare {
                    left: ScriptValue::Int(5),
                    op: CompareOp::GreaterThan,
                    right: ScriptValue::Int(3),
                },
                then_block: vec![ScriptInstruction::Return {
                    value: ScriptValue::Bool(true),
                }],
                else_block: vec![ScriptInstruction::Return {
                    value: ScriptValue::Bool(false),
                }],
            }],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp
            .run_handler("cmp_test", HashMap::new(), &mut sandbox, &mut env)
            .unwrap();
        assert!(result.success);
        assert_eq!(result.output, Some(serde_json::json!(true)));
    }

    #[test]
    fn string_interpolation() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "interp_test".into(),
            vec![
                ScriptInstruction::SetVar {
                    name: "name".into(),
                    value: ScriptValue::String("World".into()),
                },
                ScriptInstruction::Log {
                    level: LogLevel::Info,
                    message: "Hello, ${name}!".into(),
                },
            ],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp
            .run_handler("interp_test", HashMap::new(), &mut sandbox, &mut env)
            .unwrap();
        assert!(result.success);
        assert_eq!(result.log_output[0].message, "Hello, World!");
    }

    #[test]
    fn handler_names_list() {
        let mut script = make_empty_script();
        script.handlers.insert("on_startup".into(), vec![]);
        script.handlers.insert("on_connect".into(), vec![]);

        let interp = ScriptInterpreter::new(script);
        let names = interp.handler_names();
        assert_eq!(names.len(), 2);
        assert!(interp.has_handler("on_startup"));
        assert!(!interp.has_handler("nonexistent"));
    }

    #[test]
    fn parse_and_serialize_script() {
        let script = make_empty_script();
        let json = serialize_script(&script).unwrap();
        let parsed = parse_script(&json).unwrap();
        assert!(parsed.handlers.is_empty());
    }

    #[test]
    fn runtime_env_basics() {
        let mut env = RuntimeEnv::new();
        assert!(!env.has_var("x"));

        env.set_var("x", ScriptValue::Int(10));
        assert!(env.has_var("x"));
        assert_eq!(env.get_var("x"), ScriptValue::Int(10));
        assert_eq!(env.get_var("missing"), ScriptValue::Null);
    }

    #[test]
    fn while_loop_execution() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "while_test".into(),
            vec![
                ScriptInstruction::SetVar {
                    name: "i".into(),
                    value: ScriptValue::Int(0),
                },
                ScriptInstruction::While {
                    condition: ScriptCondition::Compare {
                        left: ScriptValue::String("$i".into()),
                        op: CompareOp::LessThan,
                        right: ScriptValue::Int(5),
                    },
                    body: vec![ScriptInstruction::CallApi {
                        function: "math.add".into(),
                        args: vec![
                            ScriptValue::String("$i".into()),
                            ScriptValue::Int(1),
                        ],
                        result_var: Some("i".into()),
                    }],
                },
                ScriptInstruction::Return {
                    value: ScriptValue::String("$i".into()),
                },
            ],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp
            .run_handler("while_test", HashMap::new(), &mut sandbox, &mut env)
            .unwrap();
        assert!(result.success);
        assert_eq!(result.output, Some(serde_json::json!(5.0)));
    }

    #[test]
    fn condition_and_or_not() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "logic_test".into(),
            vec![
                ScriptInstruction::SetVar { name: "a".into(), value: ScriptValue::Bool(true) },
                ScriptInstruction::SetVar { name: "b".into(), value: ScriptValue::Bool(false) },
                ScriptInstruction::If {
                    condition: ScriptCondition::And(
                        Box::new(ScriptCondition::VarTruthy("a".into())),
                        Box::new(ScriptCondition::Not(
                            Box::new(ScriptCondition::VarTruthy("b".into())),
                        )),
                    ),
                    then_block: vec![ScriptInstruction::Return { value: ScriptValue::String("pass".into()) }],
                    else_block: vec![ScriptInstruction::Return { value: ScriptValue::String("fail".into()) }],
                },
            ],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp
            .run_handler("logic_test", HashMap::new(), &mut sandbox, &mut env)
            .unwrap();
        assert!(result.success);
        assert_eq!(result.output, Some(serde_json::json!("pass")));
    }

    #[test]
    fn init_and_cleanup() {
        let mut script = make_empty_script();
        script.init = vec![ScriptInstruction::SetVar {
            name: "initialized".into(),
            value: ScriptValue::Bool(true),
        }];
        script.cleanup = vec![ScriptInstruction::Log {
            level: LogLevel::Info,
            message: "cleaned up".into(),
        }];

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        interp.run_init(&mut sandbox, &mut env).unwrap();
        assert_eq!(env.get_var("initialized"), ScriptValue::Bool(true));

        interp.run_cleanup(&mut sandbox, &mut env).unwrap();
        assert_eq!(env.log_output().len(), 1);
    }

    #[test]
    fn string_contains_builtin() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "contains_test".into(),
            vec![
                ScriptInstruction::CallApi {
                    function: "string.contains".into(),
                    args: vec![
                        ScriptValue::String("hello world".into()),
                        ScriptValue::String("world".into()),
                    ],
                    result_var: Some("result".into()),
                },
                ScriptInstruction::Return {
                    value: ScriptValue::String("$result".into()),
                },
            ],
        );

        let interp = ScriptInterpreter::new(script);
        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp.run_handler("contains_test", HashMap::new(), &mut sandbox, &mut env).unwrap();
        assert!(result.success);
        assert_eq!(result.output, Some(serde_json::json!(true)));
    }

    #[test]
    fn custom_api_function() {
        let mut script = make_empty_script();
        script.handlers.insert(
            "custom_api".into(),
            vec![
                ScriptInstruction::CallApi {
                    function: "my.custom".into(),
                    args: vec![ScriptValue::Int(7)],
                    result_var: Some("result".into()),
                },
                ScriptInstruction::Return {
                    value: ScriptValue::String("$result".into()),
                },
            ],
        );

        let mut interp = ScriptInterpreter::new(script);
        interp.register_api("my.custom", |args, _env| {
            let n = args.first().and_then(|v| v.as_int()).unwrap_or(0);
            Ok(ScriptValue::Int(n * 2))
        });

        let mut sandbox = make_sandbox();
        let mut env = RuntimeEnv::new();

        let result = interp.run_handler("custom_api", HashMap::new(), &mut sandbox, &mut env).unwrap();
        assert!(result.success);
        assert_eq!(result.output, Some(serde_json::json!(14)));
    }
}
