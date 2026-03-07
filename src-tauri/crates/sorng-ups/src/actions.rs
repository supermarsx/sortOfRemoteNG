//! UPS action commands – shutdown, reboot, beeper, bypass, tests, custom commands.

use crate::client::UpsClient;
use crate::error::UpsResult;
use crate::types::*;

pub struct ActionManager;

impl ActionManager {
    /// Initiate UPS shutdown (with optional return).
    pub async fn shutdown(client: &UpsClient, req: &ShutdownRequest) -> UpsResult<CommandResult> {
        let cmd = match req.type_ {
            ShutdownType::Normal => "shutdown.return",
            ShutdownType::LowBattery => "shutdown.stayoff",
            ShutdownType::Stayoff => "shutdown.stayoff",
            ShutdownType::Reboot => "shutdown.reboot",
            ShutdownType::RebootGraceful => "shutdown.reboot.graceful",
        };
        if let Some(delay) = req.delay_secs {
            client
                .upsrw(&req.device, "ups.delay.shutdown", &delay.to_string())
                .await
                .ok();
        }
        if let Some(ret_delay) = req.return_delay_secs {
            client
                .upsrw(&req.device, "ups.delay.start", &ret_delay.to_string())
                .await
                .ok();
        }
        client.upscmd(&req.device, cmd).await?;
        Ok(CommandResult {
            success: true,
            message: format!("Shutdown ({:?}) initiated on {}", req.type_, req.device),
        })
    }

    /// Shutdown and return (power cycle).
    pub async fn shutdown_return(client: &UpsClient, name: &str, delay_secs: Option<u64>) -> UpsResult<CommandResult> {
        if let Some(d) = delay_secs {
            client.upsrw(name, "ups.delay.shutdown", &d.to_string()).await.ok();
        }
        client.upscmd(name, "shutdown.return").await?;
        Ok(CommandResult {
            success: true,
            message: format!("Shutdown-return initiated on {}", name),
        })
    }

    /// Reboot the UPS.
    pub async fn reboot(client: &UpsClient, name: &str) -> UpsResult<CommandResult> {
        client.upscmd(name, "shutdown.reboot").await?;
        Ok(CommandResult {
            success: true,
            message: format!("Reboot initiated on {}", name),
        })
    }

    /// Turn off UPS load.
    pub async fn load_off(client: &UpsClient, name: &str) -> UpsResult<CommandResult> {
        client.upscmd(name, "load.off").await?;
        Ok(CommandResult {
            success: true,
            message: format!("Load off on {}", name),
        })
    }

    /// Turn on UPS load.
    pub async fn load_on(client: &UpsClient, name: &str) -> UpsResult<CommandResult> {
        client.upscmd(name, "load.on").await?;
        Ok(CommandResult {
            success: true,
            message: format!("Load on on {}", name),
        })
    }

    /// Run a battery test.
    pub async fn test_battery(client: &UpsClient, name: &str, test_type: &str) -> UpsResult<CommandResult> {
        let cmd = match test_type {
            "quick" => "test.battery.start.quick",
            "deep" => "test.battery.start.deep",
            _ => "test.battery.start",
        };
        client.upscmd(name, cmd).await?;
        Ok(CommandResult {
            success: true,
            message: format!("Battery test '{}' started on {}", test_type, name),
        })
    }

    /// Run a front panel test.
    pub async fn test_panel(client: &UpsClient, name: &str) -> UpsResult<CommandResult> {
        client.upscmd(name, "test.panel.start").await?;
        Ok(CommandResult {
            success: true,
            message: format!("Panel test started on {}", name),
        })
    }

    /// Start runtime calibration.
    pub async fn calibrate(client: &UpsClient, name: &str) -> UpsResult<CommandResult> {
        client.upscmd(name, "calibrate.start").await?;
        Ok(CommandResult {
            success: true,
            message: format!("Calibration started on {}", name),
        })
    }

    /// Enable the UPS beeper.
    pub async fn beeper_enable(client: &UpsClient, name: &str) -> UpsResult<CommandResult> {
        client.upscmd(name, "beeper.enable").await?;
        Ok(CommandResult {
            success: true,
            message: format!("Beeper enabled on {}", name),
        })
    }

    /// Disable the UPS beeper.
    pub async fn beeper_disable(client: &UpsClient, name: &str) -> UpsResult<CommandResult> {
        client.upscmd(name, "beeper.disable").await?;
        Ok(CommandResult {
            success: true,
            message: format!("Beeper disabled on {}", name),
        })
    }

    /// Mute the UPS beeper temporarily.
    pub async fn beeper_mute(client: &UpsClient, name: &str) -> UpsResult<CommandResult> {
        client.upscmd(name, "beeper.mute").await?;
        Ok(CommandResult {
            success: true,
            message: format!("Beeper muted on {}", name),
        })
    }

    /// Start bypass mode.
    pub async fn bypass_start(client: &UpsClient, name: &str) -> UpsResult<CommandResult> {
        client.upscmd(name, "bypass.start").await?;
        Ok(CommandResult {
            success: true,
            message: format!("Bypass started on {}", name),
        })
    }

    /// Stop bypass mode.
    pub async fn bypass_stop(client: &UpsClient, name: &str) -> UpsResult<CommandResult> {
        client.upscmd(name, "bypass.stop").await?;
        Ok(CommandResult {
            success: true,
            message: format!("Bypass stopped on {}", name),
        })
    }

    /// Reset min/max recorded values.
    pub async fn reset_min_max(client: &UpsClient, name: &str) -> UpsResult<CommandResult> {
        client.upscmd(name, "reset.input.minmax").await?;
        Ok(CommandResult {
            success: true,
            message: format!("Min/max values reset on {}", name),
        })
    }

    /// Run a custom instant command.
    pub async fn run_custom_command(client: &UpsClient, name: &str, command: &str) -> UpsResult<CommandResult> {
        let output = client.upscmd(name, command).await?;
        Ok(CommandResult {
            success: true,
            message: output,
        })
    }
}
