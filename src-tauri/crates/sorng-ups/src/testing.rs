// ── sorng-ups – Battery / UPS testing ─────────────────────────────────────────
//! Run and monitor UPS self-tests via `upscmd` instant commands.

use crate::client::UpsClient;
use crate::devices::parse_upsc_output;
use crate::error::UpsResult;
use crate::types::*;

pub struct TestManager;

impl TestManager {
    /// Run a quick battery test (`test.battery.start.quick`).
    pub async fn quick_test(client: &UpsClient, device: &str) -> UpsResult<UpsTestResult> {
        client
            .exec_upscmd(device, "test.battery.start.quick")
            .await?;
        Self::get_last_result(client, device).await
    }

    /// Run a deep battery test (`test.battery.start.deep`).
    pub async fn deep_test(client: &UpsClient, device: &str) -> UpsResult<UpsTestResult> {
        client
            .exec_upscmd(device, "test.battery.start.deep")
            .await?;
        Self::get_last_result(client, device).await
    }

    /// Abort a running test (`test.battery.stop`).
    pub async fn abort_test(client: &UpsClient, device: &str) -> UpsResult<()> {
        client.exec_upscmd(device, "test.battery.stop").await?;
        Ok(())
    }

    /// Get the last test result from `ups.test.result` and `ups.test.date`.
    pub async fn get_last_result(
        client: &UpsClient,
        device: &str,
    ) -> UpsResult<UpsTestResult> {
        let raw = client.exec_upsc(device, None).await?;
        let vars = parse_upsc_output(&raw);
        let result_str = vars.get("ups.test.result").cloned();
        let test_date = vars.get("ups.test.date").cloned();

        let test_type = match result_str.as_deref() {
            Some(r) if r.to_lowercase().contains("quick") => UpsTestType::QuickTest,
            Some(r) if r.to_lowercase().contains("deep") => UpsTestType::DeepTest,
            Some(r) if r.to_lowercase().contains("calibrat") => UpsTestType::BatteryCalibration,
            Some(r) if r.to_lowercase().contains("panel") => UpsTestType::PanelTest,
            _ => UpsTestType::GeneralTest,
        };

        Ok(UpsTestResult {
            test_type,
            result: result_str,
            timestamp: test_date,
            details: None,
            duration_secs: None,
        })
    }

    /// Run a battery calibration (`calibrate.start`).
    pub async fn calibrate_battery(
        client: &UpsClient,
        device: &str,
    ) -> UpsResult<UpsTestResult> {
        client.exec_upscmd(device, "calibrate.start").await?;
        Ok(UpsTestResult {
            test_type: UpsTestType::BatteryCalibration,
            result: Some("Calibration started".to_string()),
            timestamp: Some(chrono::Utc::now().to_rfc3339()),
            details: None,
            duration_secs: None,
        })
    }

    /// Run a front-panel test (`test.panel.start`).
    pub async fn panel_test(
        client: &UpsClient,
        device: &str,
    ) -> UpsResult<UpsTestResult> {
        client.exec_upscmd(device, "test.panel.start").await?;
        Ok(UpsTestResult {
            test_type: UpsTestType::PanelTest,
            result: Some("Panel test started".to_string()),
            timestamp: Some(chrono::Utc::now().to_rfc3339()),
            details: None,
            duration_secs: None,
        })
    }

    /// Retrieve test history from syslog.
    pub async fn get_test_history(
        client: &UpsClient,
        device: &str,
    ) -> UpsResult<Vec<UpsTestResult>> {
        let cmd = format!(
            "grep -i 'test.*{}' /var/log/syslog 2>/dev/null | tail -n 50",
            device
        );
        let out = client.exec_ssh(&cmd).await?;
        let mut results = Vec::new();
        for line in out.stdout.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let test_type = if line.to_lowercase().contains("quick") {
                UpsTestType::QuickTest
            } else if line.to_lowercase().contains("deep") {
                UpsTestType::DeepTest
            } else if line.to_lowercase().contains("calibrat") {
                UpsTestType::BatteryCalibration
            } else {
                UpsTestType::GeneralTest
            };
            results.push(UpsTestResult {
                test_type,
                result: Some(line.to_string()),
                timestamp: None,
                details: None,
                duration_secs: None,
            });
        }
        Ok(results)
    }
}
