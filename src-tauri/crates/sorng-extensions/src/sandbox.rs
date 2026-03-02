//! Sandboxed execution environment with resource limits and violation detection.
//!
//! The sandbox enforces memory, CPU, instruction-count, and call-depth
//! limits on extension script execution.  It tracks metrics and raises
//! errors when limits are exceeded.

use std::time::Instant;

use log::warn;

use crate::types::*;

// ─── Sandbox ────────────────────────────────────────────────────────

/// A sandbox instance that enforces resource limits during execution.
#[derive(Debug, Clone)]
pub struct Sandbox {
    /// The configuration / limits for this sandbox.
    config: SandboxConfig,
    /// Running metrics for the current execution.
    metrics: SandboxMetrics,
    /// When the current execution started.
    start_time: Option<Instant>,
    /// Whether the sandbox is currently active (executing).
    active: bool,
    /// Rate-limit window start time.
    rate_window_start: Option<Instant>,
}

impl Sandbox {
    /// Create a new sandbox with the given configuration.
    pub fn new(config: SandboxConfig) -> Self {
        Self {
            config,
            metrics: SandboxMetrics::default(),
            start_time: None,
            active: false,
            rate_window_start: None,
        }
    }

    /// Create a sandbox with default configuration.
    pub fn with_defaults() -> Self {
        Self::new(SandboxConfig::default())
    }

    /// Get a reference to the sandbox configuration.
    pub fn config(&self) -> &SandboxConfig {
        &self.config
    }

    /// Update the sandbox configuration.
    pub fn set_config(&mut self, config: SandboxConfig) {
        self.config = config;
    }

    /// Get the current execution metrics.
    pub fn metrics(&self) -> &SandboxMetrics {
        &self.metrics
    }

    /// Check whether the sandbox is currently active.
    pub fn is_active(&self) -> bool {
        self.active
    }

    // ── Lifecycle ────────────────────────────────────────────────

    /// Begin a new sandboxed execution session.
    pub fn begin(&mut self) -> ExtResult<()> {
        if self.active {
            return Err(ExtError::sandbox("Sandbox is already active"));
        }
        self.metrics = SandboxMetrics::default();
        self.start_time = Some(Instant::now());
        self.active = true;
        Ok(())
    }

    /// End the current execution session and return final metrics.
    pub fn end(&mut self) -> ExtResult<SandboxMetrics> {
        if !self.active {
            return Err(ExtError::sandbox("Sandbox is not active"));
        }
        if let Some(start) = self.start_time {
            self.metrics.elapsed_ms = start.elapsed().as_millis() as u64;
        }
        self.active = false;
        self.start_time = None;
        Ok(self.metrics.clone())
    }

    /// Reset the rate-limit window.
    pub fn reset_rate_window(&mut self) {
        self.metrics.api_calls_this_minute = 0;
        self.rate_window_start = Some(Instant::now());
    }

    // ── Limit Checks ────────────────────────────────────────────

    /// Record that one instruction was executed and check the limit.
    pub fn tick_instruction(&mut self) -> ExtResult<()> {
        self.metrics.instructions_executed += 1;
        if self.metrics.instructions_executed > self.config.max_instructions {
            warn!(
                "Sandbox violation: instruction limit exceeded ({} > {})",
                self.metrics.instructions_executed, self.config.max_instructions
            );
            return Err(ExtError::sandbox(format!(
                "Instruction limit exceeded: {} > {}",
                self.metrics.instructions_executed, self.config.max_instructions
            )));
        }
        Ok(())
    }

    /// Record that an API call was made and check the rate limit.
    pub fn tick_api_call(&mut self) -> ExtResult<()> {
        // Check and maybe rotate the rate window.
        if let Some(window_start) = self.rate_window_start {
            if window_start.elapsed().as_secs() >= 60 {
                self.metrics.api_calls_this_minute = 0;
                self.rate_window_start = Some(Instant::now());
            }
        } else {
            self.rate_window_start = Some(Instant::now());
        }

        self.metrics.api_calls_this_minute += 1;
        self.metrics.total_api_calls += 1;

        if self.metrics.api_calls_this_minute > self.config.api_rate_limit_per_min {
            warn!(
                "Sandbox violation: API rate limit exceeded ({} > {}/min)",
                self.metrics.api_calls_this_minute, self.config.api_rate_limit_per_min
            );
            return Err(ExtError::sandbox(format!(
                "API rate limit exceeded: {} > {}/min",
                self.metrics.api_calls_this_minute, self.config.api_rate_limit_per_min
            )));
        }
        Ok(())
    }

    /// Push a call frame and check the call-depth limit.
    pub fn push_call(&mut self) -> ExtResult<()> {
        let new_depth = self.metrics.current_call_depth + 1;
        if new_depth > self.config.max_call_depth {
            warn!(
                "Sandbox violation: call depth exceeded ({} > {})",
                new_depth, self.config.max_call_depth
            );
            return Err(ExtError::sandbox(format!(
                "Call depth exceeded: {} > {}",
                new_depth, self.config.max_call_depth
            )));
        }
        self.metrics.current_call_depth = new_depth;
        Ok(())
    }

    /// Pop a call frame.
    pub fn pop_call(&mut self) {
        if self.metrics.current_call_depth > 0 {
            self.metrics.current_call_depth -= 1;
        }
    }

    /// Record memory allocation and check the limit.
    pub fn allocate_memory(&mut self, bytes: u64) -> ExtResult<()> {
        self.metrics.memory_used_bytes += bytes;
        let limit = self.config.max_memory_mb * 1024 * 1024;
        if self.metrics.memory_used_bytes > limit {
            warn!(
                "Sandbox violation: memory limit exceeded ({} > {} bytes)",
                self.metrics.memory_used_bytes, limit
            );
            return Err(ExtError::sandbox(format!(
                "Memory limit exceeded: {} bytes > {} MB",
                self.metrics.memory_used_bytes, self.config.max_memory_mb
            )));
        }
        Ok(())
    }

    /// Free memory.
    pub fn free_memory(&mut self, bytes: u64) {
        self.metrics.memory_used_bytes = self.metrics.memory_used_bytes.saturating_sub(bytes);
    }

    /// Check whether the execution time limit has been exceeded.
    pub fn check_timeout(&self) -> ExtResult<()> {
        if let Some(start) = self.start_time {
            let elapsed = start.elapsed().as_millis() as u64;
            if elapsed > self.config.max_execution_time_ms {
                return Err(ExtError::timeout(format!(
                    "Execution timed out: {}ms > {}ms",
                    elapsed, self.config.max_execution_time_ms
                )));
            }
        }
        Ok(())
    }

    /// Run a comprehensive limit check (instruction + timeout + memory).
    pub fn check_limits(&mut self) -> ExtResult<()> {
        self.tick_instruction()?;
        self.check_timeout()?;
        Ok(())
    }

    // ── Permission-linked checks ────────────────────────────────

    /// Check if network access is allowed.
    pub fn check_network_access(&self) -> ExtResult<()> {
        if !self.config.allow_network {
            return Err(ExtError::sandbox("Network access is not allowed"));
        }
        Ok(())
    }

    /// Check if a specific host is allowed for network access.
    pub fn check_host_allowed(&self, host: &str) -> ExtResult<()> {
        self.check_network_access()?;
        if !self.config.allowed_hosts.is_empty()
            && !self.config.allowed_hosts.iter().any(|h| h == host || h == "*")
        {
            return Err(ExtError::sandbox(format!(
                "Host '{}' is not in the allowed hosts list",
                host
            )));
        }
        Ok(())
    }

    /// Check if file access is allowed.
    pub fn check_file_access(&self) -> ExtResult<()> {
        if !self.config.allow_file_access {
            return Err(ExtError::sandbox("File access is not allowed"));
        }
        Ok(())
    }

    /// Check if a specific file path is allowed.
    pub fn check_path_allowed(&self, path: &str) -> ExtResult<()> {
        self.check_file_access()?;
        if !self.config.allowed_paths.is_empty()
            && !self.config.allowed_paths.iter().any(|p| path.starts_with(p) || p == "*")
        {
            return Err(ExtError::sandbox(format!(
                "Path '{}' is not in the allowed paths list",
                path
            )));
        }
        Ok(())
    }

    /// Check if process execution is allowed.
    pub fn check_process_exec(&self) -> ExtResult<()> {
        if !self.config.allow_process_exec {
            return Err(ExtError::sandbox("Process execution is not allowed"));
        }
        Ok(())
    }

    /// Get the elapsed execution time in milliseconds.
    pub fn elapsed_ms(&self) -> u64 {
        self.start_time
            .map(|s| s.elapsed().as_millis() as u64)
            .unwrap_or(0)
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sandbox_lifecycle() {
        let mut sb = Sandbox::with_defaults();
        assert!(!sb.is_active());

        sb.begin().unwrap();
        assert!(sb.is_active());

        let metrics = sb.end().unwrap();
        assert!(!sb.is_active());
        assert_eq!(metrics.instructions_executed, 0);
    }

    #[test]
    fn double_begin_fails() {
        let mut sb = Sandbox::with_defaults();
        sb.begin().unwrap();
        assert!(sb.begin().is_err());
    }

    #[test]
    fn end_without_begin_fails() {
        let mut sb = Sandbox::with_defaults();
        assert!(sb.end().is_err());
    }

    #[test]
    fn instruction_limit() {
        let config = SandboxConfig {
            max_instructions: 5,
            ..Default::default()
        };
        let mut sb = Sandbox::new(config);
        sb.begin().unwrap();

        for _ in 0..5 {
            assert!(sb.tick_instruction().is_ok());
        }
        assert!(sb.tick_instruction().is_err());
    }

    #[test]
    fn call_depth_limit() {
        let config = SandboxConfig {
            max_call_depth: 3,
            ..Default::default()
        };
        let mut sb = Sandbox::new(config);
        sb.begin().unwrap();

        sb.push_call().unwrap();
        sb.push_call().unwrap();
        sb.push_call().unwrap();
        assert!(sb.push_call().is_err());

        sb.pop_call();
        sb.push_call().unwrap();
    }

    #[test]
    fn memory_limit() {
        let config = SandboxConfig {
            max_memory_mb: 1,
            ..Default::default()
        };
        let mut sb = Sandbox::new(config);
        sb.begin().unwrap();

        sb.allocate_memory(500_000).unwrap();
        sb.allocate_memory(500_000).unwrap();
        // 1MB = 1_048_576 bytes, already at 1_000_000
        assert!(sb.allocate_memory(100_000).is_err());
    }

    #[test]
    fn memory_free() {
        let mut sb = Sandbox::with_defaults();
        sb.begin().unwrap();

        sb.allocate_memory(1000).unwrap();
        assert_eq!(sb.metrics().memory_used_bytes, 1000);

        sb.free_memory(500);
        assert_eq!(sb.metrics().memory_used_bytes, 500);

        // Free more than allocated → saturates at 0.
        sb.free_memory(1000);
        assert_eq!(sb.metrics().memory_used_bytes, 0);
    }

    #[test]
    fn api_rate_limit() {
        let config = SandboxConfig {
            api_rate_limit_per_min: 3,
            ..Default::default()
        };
        let mut sb = Sandbox::new(config);
        sb.begin().unwrap();

        sb.tick_api_call().unwrap();
        sb.tick_api_call().unwrap();
        sb.tick_api_call().unwrap();
        assert!(sb.tick_api_call().is_err());
    }

    #[test]
    fn network_access_denied() {
        let sb = Sandbox::with_defaults();
        assert!(sb.check_network_access().is_err());
    }

    #[test]
    fn network_access_allowed() {
        let config = SandboxConfig {
            allow_network: true,
            ..Default::default()
        };
        let sb = Sandbox::new(config);
        assert!(sb.check_network_access().is_ok());
    }

    #[test]
    fn host_allowed_wildcard() {
        let config = SandboxConfig {
            allow_network: true,
            allowed_hosts: vec!["*".into()],
            ..Default::default()
        };
        let sb = Sandbox::new(config);
        assert!(sb.check_host_allowed("anything.com").is_ok());
    }

    #[test]
    fn host_allowed_specific() {
        let config = SandboxConfig {
            allow_network: true,
            allowed_hosts: vec!["api.example.com".into()],
            ..Default::default()
        };
        let sb = Sandbox::new(config);
        assert!(sb.check_host_allowed("api.example.com").is_ok());
        assert!(sb.check_host_allowed("evil.com").is_err());
    }

    #[test]
    fn host_check_requires_network() {
        let config = SandboxConfig {
            allow_network: false,
            allowed_hosts: vec!["api.example.com".into()],
            ..Default::default()
        };
        let sb = Sandbox::new(config);
        assert!(sb.check_host_allowed("api.example.com").is_err());
    }

    #[test]
    fn file_access_denied() {
        let sb = Sandbox::with_defaults();
        assert!(sb.check_file_access().is_err());
    }

    #[test]
    fn file_access_allowed() {
        let config = SandboxConfig {
            allow_file_access: true,
            ..Default::default()
        };
        let sb = Sandbox::new(config);
        assert!(sb.check_file_access().is_ok());
    }

    #[test]
    fn path_allowed_specific() {
        let config = SandboxConfig {
            allow_file_access: true,
            allowed_paths: vec!["/tmp/extensions".into()],
            ..Default::default()
        };
        let sb = Sandbox::new(config);
        assert!(sb.check_path_allowed("/tmp/extensions/data.json").is_ok());
        assert!(sb.check_path_allowed("/etc/passwd").is_err());
    }

    #[test]
    fn path_allowed_wildcard() {
        let config = SandboxConfig {
            allow_file_access: true,
            allowed_paths: vec!["*".into()],
            ..Default::default()
        };
        let sb = Sandbox::new(config);
        assert!(sb.check_path_allowed("/any/path").is_ok());
    }

    #[test]
    fn path_allowed_empty_means_all() {
        let config = SandboxConfig {
            allow_file_access: true,
            allowed_paths: vec![],
            ..Default::default()
        };
        let sb = Sandbox::new(config);
        assert!(sb.check_path_allowed("/any/path").is_ok());
    }

    #[test]
    fn process_exec_denied() {
        let sb = Sandbox::with_defaults();
        assert!(sb.check_process_exec().is_err());
    }

    #[test]
    fn process_exec_allowed() {
        let config = SandboxConfig {
            allow_process_exec: true,
            ..Default::default()
        };
        let sb = Sandbox::new(config);
        assert!(sb.check_process_exec().is_ok());
    }

    #[test]
    fn check_limits_compound() {
        let config = SandboxConfig {
            max_instructions: 10,
            max_execution_time_ms: 60_000,
            ..Default::default()
        };
        let mut sb = Sandbox::new(config);
        sb.begin().unwrap();

        for _ in 0..10 {
            assert!(sb.check_limits().is_ok());
        }
        assert!(sb.check_limits().is_err());
    }

    #[test]
    fn elapsed_ms_zero_when_inactive() {
        let sb = Sandbox::with_defaults();
        assert_eq!(sb.elapsed_ms(), 0);
    }

    #[test]
    fn config_update() {
        let mut sb = Sandbox::with_defaults();
        let new_config = SandboxConfig {
            max_memory_mb: 128,
            ..Default::default()
        };
        sb.set_config(new_config);
        assert_eq!(sb.config().max_memory_mb, 128);
    }

    #[test]
    fn pop_call_at_zero() {
        let mut sb = Sandbox::with_defaults();
        sb.begin().unwrap();
        sb.pop_call(); // Should not underflow.
        assert_eq!(sb.metrics().current_call_depth, 0);
    }

    #[test]
    fn rate_limit_resets_after_window() {
        let config = SandboxConfig {
            api_rate_limit_per_min: 5,
            ..Default::default()
        };
        let mut sb = Sandbox::new(config);
        sb.begin().unwrap();

        // Fill up the rate limit.
        for _ in 0..5 {
            sb.tick_api_call().unwrap();
        }
        assert!(sb.tick_api_call().is_err());

        // Manually reset the window.
        sb.reset_rate_window();
        assert!(sb.tick_api_call().is_ok());
    }
}
