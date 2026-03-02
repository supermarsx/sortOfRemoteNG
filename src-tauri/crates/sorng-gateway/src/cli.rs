//! # CLI
//!
//! Command-line argument parsing for headless gateway mode.
//! Supports configuration via CLI flags, environment variables, or config file.

use crate::config::GatewayConfig;
use std::env;

/// Parsed CLI arguments.
#[derive(Debug, Clone)]
pub struct CliArgs {
    /// Path to configuration file
    pub config_file: Option<String>,
    /// Override: listen host
    pub listen_host: Option<String>,
    /// Override: listen port
    pub listen_port: Option<u16>,
    /// Override: data directory
    pub data_dir: Option<String>,
    /// Override: log level
    pub log_level: Option<String>,
    /// Whether to print the sample config and exit
    pub print_sample_config: bool,
    /// Whether to validate config and exit
    pub validate_only: bool,
    /// Whether to run in foreground (no daemon)
    pub foreground: bool,
}

impl CliArgs {
    /// Parse CLI arguments from std::env::args.
    pub fn parse() -> Self {
        let args: Vec<String> = env::args().collect();
        Self::parse_from(&args)
    }

    /// Parse CLI arguments from a provided list (for testing).
    pub fn parse_from(args: &[String]) -> Self {
        let mut cli = CliArgs {
            config_file: None,
            listen_host: None,
            listen_port: None,
            data_dir: None,
            log_level: None,
            print_sample_config: false,
            validate_only: false,
            foreground: true,
        };

        let mut i = 1;
        while i < args.len() {
            match args[i].as_str() {
                "--config" | "-c" => {
                    if i + 1 < args.len() {
                        cli.config_file = Some(args[i + 1].clone());
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                "--host" | "-H" => {
                    if i + 1 < args.len() {
                        cli.listen_host = Some(args[i + 1].clone());
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                "--port" | "-p" => {
                    if i + 1 < args.len() {
                        cli.listen_port = args[i + 1].parse().ok();
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                "--data-dir" | "-d" => {
                    if i + 1 < args.len() {
                        cli.data_dir = Some(args[i + 1].clone());
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                "--log-level" | "-l" => {
                    if i + 1 < args.len() {
                        cli.log_level = Some(args[i + 1].clone());
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                "--sample-config" => {
                    cli.print_sample_config = true;
                    i += 1;
                }
                "--validate" => {
                    cli.validate_only = true;
                    i += 1;
                }
                "--foreground" | "-f" => {
                    cli.foreground = true;
                    i += 1;
                }
                "--help" | "-h" => {
                    Self::print_help();
                    std::process::exit(0);
                }
                "--version" | "-v" => {
                    println!(
                        "sorng-gateway-server {}",
                        env!("CARGO_PKG_VERSION")
                    );
                    std::process::exit(0);
                }
                _ => {
                    eprintln!("Unknown argument: {}", args[i]);
                    i += 1;
                }
            }
        }

        // Also check environment variables
        if cli.config_file.is_none() {
            cli.config_file = env::var("SORNG_GATEWAY_CONFIG").ok();
        }
        if cli.listen_host.is_none() {
            cli.listen_host = env::var("SORNG_GATEWAY_HOST").ok();
        }
        if cli.listen_port.is_none() {
            cli.listen_port = env::var("SORNG_GATEWAY_PORT")
                .ok()
                .and_then(|v| v.parse().ok());
        }
        if cli.data_dir.is_none() {
            cli.data_dir = env::var("SORNG_GATEWAY_DATA_DIR").ok();
        }
        if cli.log_level.is_none() {
            cli.log_level = env::var("SORNG_GATEWAY_LOG_LEVEL").ok();
        }

        cli
    }

    /// Build a GatewayConfig from CLI args + config file + defaults.
    pub fn build_config(&self) -> Result<GatewayConfig, String> {
        // Start with config file or defaults
        let mut config = if let Some(ref path) = self.config_file {
            GatewayConfig::from_file(path)?
        } else {
            GatewayConfig::default()
        };

        // Apply CLI overrides
        if let Some(ref host) = self.listen_host {
            config.listen_host = host.clone();
        }
        if let Some(port) = self.listen_port {
            config.listen_port = port;
        }
        if let Some(ref dir) = self.data_dir {
            config.data_dir = dir.clone();
        }
        if let Some(ref level) = self.log_level {
            config.log_level = level.clone();
        }

        // Headless mode is always true when running via CLI
        config.headless = true;

        Ok(config)
    }

    /// Print help text.
    fn print_help() {
        println!(
            r#"sorng-gateway-server - SortOfRemote NG Gateway (Headless Mode)

USAGE:
    sorng-gateway-server [OPTIONS]

OPTIONS:
    -c, --config <FILE>      Path to configuration file (JSON)
    -H, --host <HOST>        Listen host (default: 0.0.0.0)
    -p, --port <PORT>        Listen port (default: 9080)
    -d, --data-dir <DIR>     Data directory for persistence
    -l, --log-level <LEVEL>  Log level: debug, info, warn, error
    -f, --foreground         Run in foreground (default)
        --sample-config      Print sample configuration and exit
        --validate           Validate configuration and exit
    -v, --version            Print version
    -h, --help               Print help

ENVIRONMENT VARIABLES:
    SORNG_GATEWAY_CONFIG     Path to configuration file
    SORNG_GATEWAY_HOST       Listen host
    SORNG_GATEWAY_PORT       Listen port
    SORNG_GATEWAY_DATA_DIR   Data directory
    SORNG_GATEWAY_LOG_LEVEL  Log level

EXAMPLES:
    sorng-gateway-server --config /etc/sorng/gateway.json
    sorng-gateway-server --host 0.0.0.0 --port 9080
    sorng-gateway-server --sample-config > gateway.json
    SORNG_GATEWAY_PORT=8080 sorng-gateway-server
"#
        );
    }
}
