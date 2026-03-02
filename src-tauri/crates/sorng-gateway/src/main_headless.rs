//! # Headless Gateway Server Entry Point
//!
//! Standalone binary for running the gateway in headless mode (no GUI).
//! This binary is built with `cargo build --features headless -p sorng-gateway`.

fn main() {
    let cli_args = sorng_gateway::cli::CliArgs::parse();

    // Handle --sample-config
    if cli_args.print_sample_config {
        println!("{}", sorng_gateway::config::GatewayConfig::sample_json());
        return;
    }

    // Build configuration
    let config = match cli_args.build_config() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Configuration error: {}", e);
            std::process::exit(1);
        }
    };

    // Handle --validate
    if cli_args.validate_only {
        match config.validate() {
            Ok(()) => {
                println!("Configuration is valid.");
                std::process::exit(0);
            }
            Err(errors) => {
                eprintln!("Configuration errors:");
                for err in errors {
                    eprintln!("  - {}", err);
                }
                std::process::exit(1);
            }
        }
    }

    // Validate config
    if let Err(errors) = config.validate() {
        eprintln!("Configuration errors:");
        for err in errors {
            eprintln!("  - {}", err);
        }
        std::process::exit(1);
    }

    println!("╔══════════════════════════════════════════════╗");
    println!("║   SortOfRemote NG Gateway — Headless Mode   ║");
    println!("╠══════════════════════════════════════════════╣");
    println!("║  Name:    {:<35}║", config.name);
    println!("║  Listen:  {:<35}║", format!("{}:{}", config.listen_host, config.listen_port));
    println!("║  Data:    {:<35}║", config.data_dir);
    println!("╚══════════════════════════════════════════════╝");

    // Create the tokio runtime and run the gateway
    let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
    rt.block_on(async {
        let gateway = sorng_gateway::service::GatewayService::new(config);
        let mut gw = gateway.lock().await;

        if let Err(e) = gw.start().await {
            eprintln!("Failed to start gateway: {}", e);
            std::process::exit(1);
        }

        println!("Gateway started. Press Ctrl+C to stop.");

        // Wait for shutdown signal
        drop(gw);
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to listen for ctrl+c");

        println!("\nShutting down gateway...");
        let mut gw = gateway.lock().await;
        let _ = gw.stop().await;
        println!("Gateway stopped.");
    });
}
