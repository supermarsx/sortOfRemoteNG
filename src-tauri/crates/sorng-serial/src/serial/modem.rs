//! Hayes AT modem command support.
//!
//! Provides builders, parsers, and high-level helpers for communicating
//! with Hayes-compatible modems over a serial transport.

use crate::serial::transport::SerialTransport;
use crate::serial::types::*;
use std::sync::Arc;
use std::time::Instant;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Standard AT commands
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Well-known AT commands.
pub struct AtCommands;

impl AtCommands {
    /// Attention / ping.
    pub const AT: &'static str = "AT";
    /// Reset to factory defaults.
    pub const RESET: &'static str = "ATZ";
    /// Hang up.
    pub const HANGUP: &'static str = "ATH0";
    /// Answer incoming call.
    pub const ANSWER: &'static str = "ATA";
    /// Enable echo.
    pub const ECHO_ON: &'static str = "ATE1";
    /// Disable echo.
    pub const ECHO_OFF: &'static str = "ATE0";
    /// Enable verbose result codes.
    pub const VERBOSE_ON: &'static str = "ATV1";
    /// Disable verbose (numeric codes).
    pub const VERBOSE_OFF: &'static str = "ATV0";
    /// Display product identification.
    pub const INFO: &'static str = "ATI";
    /// Manufacturer identification.
    pub const MANUFACTURER: &'static str = "AT+CGMI";
    /// Model identification.
    pub const MODEL: &'static str = "AT+CGMM";
    /// Revision identification.
    pub const REVISION: &'static str = "AT+CGMR";
    /// Serial number (IMEI).
    pub const SERIAL_NUMBER: &'static str = "AT+CGSN";
    /// Signal quality.
    pub const SIGNAL_QUALITY: &'static str = "AT+CSQ";
    /// Network registration status.
    pub const REGISTRATION: &'static str = "AT+CREG?";
    /// List available operators.
    pub const OPERATORS: &'static str = "AT+COPS=?";
    /// Current operator.
    pub const CURRENT_OPERATOR: &'static str = "AT+COPS?";
    /// Saved profiles.
    pub const SAVE_PROFILE: &'static str = "AT&W";
    /// Load profile.
    pub const LOAD_PROFILE: &'static str = "ATZ0";
    /// Escape sequence (return to command mode).
    pub const ESCAPE: &'static str = "+++";

    /// Tone dial a number.
    pub fn dial_tone(number: &str) -> String {
        format!("ATDT{}", number)
    }

    /// Pulse dial a number.
    pub fn dial_pulse(number: &str) -> String {
        format!("ATDP{}", number)
    }

    /// Set speaker volume (0-3).
    pub fn speaker_volume(level: u8) -> String {
        format!("ATL{}", level.min(3))
    }

    /// Set speaker mode (0=off, 1=on until connect, 2=always on).
    pub fn speaker_mode(mode: u8) -> String {
        format!("ATM{}", mode.min(2))
    }

    /// Set auto-answer ring count (0 = disable).
    pub fn auto_answer(rings: u8) -> String {
        format!("ATS0={}", rings)
    }

    /// Read S-register value.
    pub fn read_s_register(reg: u8) -> String {
        format!("ATS{}?", reg)
    }

    /// Write S-register value.
    pub fn write_s_register(reg: u8, value: u8) -> String {
        format!("ATS{}={}", reg, value)
    }

    /// Set baud rate (ATB command, modem-specific).
    pub fn set_baud_rate(rate: u32) -> String {
        format!("AT+IPR={}", rate)
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Response parser
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Parse an AT command response buffer into structured form.
pub fn parse_at_response(command: &str, raw: &str, elapsed_ms: u64) -> AtCommandResult {
    let lines: Vec<String> = raw
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .filter(|l| {
            // Filter out echo of the command
            !l.eq_ignore_ascii_case(command.trim())
        })
        .collect();

    // The last non-empty line is typically the result code
    let result_code = lines
        .last()
        .map(|l| ModemResponseCode::parse(l))
        .unwrap_or(ModemResponseCode::Unknown(String::new()));

    // Response lines exclude the final result code line
    let response_lines = if !lines.is_empty() && (result_code.is_ok() || result_code.is_error()) {
        lines[..lines.len() - 1].to_vec()
    } else {
        lines.clone()
    };

    AtCommandResult {
        command: command.to_string(),
        raw_response: raw.to_string(),
        response_lines,
        result_code,
        elapsed_ms,
    }
}

/// Parse a +CSQ signal quality response.
/// Format: +CSQ: <rssi>,<ber>
pub fn parse_signal_quality(response: &str) -> Option<(i32, i32)> {
    let re = regex::Regex::new(r"\+CSQ:\s*(\d+),\s*(\d+)").ok()?;
    let caps = re.captures(response)?;
    let rssi = caps.get(1)?.as_str().parse::<i32>().ok()?;
    let ber = caps.get(2)?.as_str().parse::<i32>().ok()?;
    Some((rssi, ber))
}

/// Convert CSQ RSSI value to dBm.
pub fn rssi_to_dbm(rssi: i32) -> Option<i32> {
    match rssi {
        0 => Some(-113),
        1 => Some(-111),
        v @ 2..=30 => Some(-109 + (v - 2) * 2),
        31 => Some(-51),
        99 => None, // not known
        _ => None,
    }
}

/// Signal quality description based on RSSI value.
pub fn rssi_description(rssi: i32) -> &'static str {
    match rssi {
        0..=9 => "Marginal",
        10..=14 => "OK",
        15..=19 => "Good",
        20..=30 => "Excellent",
        31 => "Maximum",
        _ => "Unknown",
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  AT command executor
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Execute an AT command and wait for a response.
pub async fn execute_at_command(
    transport: &dyn SerialTransport,
    command: &str,
    timeout_ms: u64,
) -> Result<AtCommandResult, String> {
    let start = Instant::now();

    // Send the command with CR
    let mut cmd_bytes = command.as_bytes().to_vec();
    cmd_bytes.push(b'\r');
    transport.write(&cmd_bytes).await?;

    // Read response with timeout
    let timeout = tokio::time::Duration::from_millis(timeout_ms);
    let mut response = Vec::new();
    let mut buf = [0u8; 256];

    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if tokio::time::Instant::now() >= deadline {
            break;
        }

        tokio::select! {
            result = transport.read(&mut buf) => {
                match result {
                    Ok(n) if n > 0 => {
                        response.extend_from_slice(&buf[..n]);
                        // Check if we have a complete response (ends with a result code)
                        let text = String::from_utf8_lossy(&response);
                        if has_result_code(&text) {
                            break;
                        }
                    }
                    Ok(_) => {
                        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
                    }
                    Err(e) => return Err(e),
                }
            }
            _ = tokio::time::sleep_until(deadline) => {
                break;
            }
        }
    }

    let elapsed = start.elapsed().as_millis() as u64;
    let raw_text = String::from_utf8_lossy(&response).to_string();
    Ok(parse_at_response(command, &raw_text, elapsed))
}

/// Check if the response buffer contains a final result code.
fn has_result_code(text: &str) -> bool {
    let trimmed = text.trim();
    let last_line = trimmed.lines().last().unwrap_or("").trim().to_uppercase();
    matches!(
        last_line.as_str(),
        "OK" | "ERROR"
            | "NO CARRIER"
            | "BUSY"
            | "NO DIALTONE"
            | "NO ANSWER"
            | "CONNECT"
            | "RING"
            | "0"
            | "1"
            | "2"
            | "3"
            | "4"
            | "6"
            | "7"
            | "8"
    ) || last_line.starts_with("CONNECT ")
        || last_line.starts_with("+CME ERROR:")
        || last_line.starts_with("+CMS ERROR:")
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  High-level modem operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Modem controller for high-level operations.
pub struct ModemController {
    transport: Arc<dyn SerialTransport>,
    profile: ModemProfile,
    timeout_ms: u64,
}

impl ModemController {
    pub fn new(
        transport: Arc<dyn SerialTransport>,
        profile: ModemProfile,
        timeout_ms: u64,
    ) -> Self {
        Self {
            transport,
            profile,
            timeout_ms,
        }
    }

    /// Send any AT command and get the result.
    pub async fn send_command(&self, command: &str) -> Result<AtCommandResult, String> {
        execute_at_command(self.transport.as_ref(), command, self.timeout_ms).await
    }

    /// Initialize the modem with the profile init string.
    pub async fn initialize(&self) -> Result<AtCommandResult, String> {
        self.send_command(&self.profile.init_string).await
    }

    /// Reset the modem.
    pub async fn reset(&self) -> Result<AtCommandResult, String> {
        self.send_command(&self.profile.reset_string).await
    }

    /// Ping the modem (AT command).
    pub async fn ping(&self) -> Result<bool, String> {
        let result = self.send_command(AtCommands::AT).await?;
        Ok(result.result_code.is_ok())
    }

    /// Dial a number.
    pub async fn dial(&self, number: &str) -> Result<AtCommandResult, String> {
        let cmd = format!("{}{}", self.profile.dial_prefix, number);
        // Use longer timeout for dialing
        execute_at_command(self.transport.as_ref(), &cmd, 60000).await
    }

    /// Hang up the call.
    pub async fn hangup(&self) -> Result<AtCommandResult, String> {
        // Send escape sequence first (wait 1s guard time)
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        let _ = self.transport.write(b"+++").await;
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        self.send_command(AtCommands::HANGUP).await
    }

    /// Answer an incoming call.
    pub async fn answer(&self) -> Result<AtCommandResult, String> {
        self.send_command(AtCommands::ANSWER).await
    }

    /// Get modem identification info.
    pub async fn get_info(&self) -> Result<ModemInfo, String> {
        let ati = self.send_command(AtCommands::INFO).await?;
        let manufacturer = self.send_command(AtCommands::MANUFACTURER).await.ok();
        let model = self.send_command(AtCommands::MODEL).await.ok();
        let revision = self.send_command(AtCommands::REVISION).await.ok();
        let serial = self.send_command(AtCommands::SERIAL_NUMBER).await.ok();

        Ok(ModemInfo {
            identification: ati.response_lines.join(" "),
            manufacturer: manufacturer.and_then(|r| r.response_lines.first().cloned()),
            model: model.and_then(|r| r.response_lines.first().cloned()),
            revision: revision.and_then(|r| r.response_lines.first().cloned()),
            serial_number: serial.and_then(|r| r.response_lines.first().cloned()),
        })
    }

    /// Get signal quality.
    pub async fn get_signal_quality(&self) -> Result<SignalQuality, String> {
        let result = self.send_command(AtCommands::SIGNAL_QUALITY).await?;
        let raw = result.response_lines.join("\n");
        if let Some((rssi, ber)) = parse_signal_quality(&raw) {
            Ok(SignalQuality {
                rssi,
                ber,
                dbm: rssi_to_dbm(rssi),
                description: rssi_description(rssi).to_string(),
            })
        } else {
            Err("Failed to parse signal quality".to_string())
        }
    }

    /// Enable or disable echo.
    pub async fn set_echo(&self, enabled: bool) -> Result<AtCommandResult, String> {
        if enabled {
            self.send_command(AtCommands::ECHO_ON).await
        } else {
            self.send_command(AtCommands::ECHO_OFF).await
        }
    }

    /// Enable or disable verbose mode.
    pub async fn set_verbose(&self, enabled: bool) -> Result<AtCommandResult, String> {
        if enabled {
            self.send_command(AtCommands::VERBOSE_ON).await
        } else {
            self.send_command(AtCommands::VERBOSE_OFF).await
        }
    }

    /// Read an S-register.
    pub async fn read_s_register(&self, reg: u8) -> Result<String, String> {
        let result = self.send_command(&AtCommands::read_s_register(reg)).await?;
        result
            .response_lines
            .first()
            .cloned()
            .ok_or_else(|| format!("No value returned for S{}", reg))
    }

    /// Write an S-register.
    pub async fn write_s_register(&self, reg: u8, value: u8) -> Result<AtCommandResult, String> {
        self.send_command(&AtCommands::write_s_register(reg, value))
            .await
    }

    /// Set auto-answer ring count.
    pub async fn set_auto_answer(&self, rings: u8) -> Result<AtCommandResult, String> {
        self.send_command(&AtCommands::auto_answer(rings)).await
    }

    /// Get the modem profile.
    pub fn profile(&self) -> &ModemProfile {
        &self.profile
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Info types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Modem identification information.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModemInfo {
    pub identification: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub revision: Option<String>,
    pub serial_number: Option<String>,
}

/// Signal quality information.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalQuality {
    pub rssi: i32,
    pub ber: i32,
    pub dbm: Option<i32>,
    pub description: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Init string builder
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Builder for modem initialization strings.
pub struct InitStringBuilder {
    commands: Vec<String>,
}

impl InitStringBuilder {
    pub fn new() -> Self {
        Self {
            commands: Vec::new(),
        }
    }

    /// Add the reset command.
    pub fn reset(mut self) -> Self {
        self.commands.push("Z".to_string());
        self
    }

    /// Disable echo.
    pub fn echo_off(mut self) -> Self {
        self.commands.push("E0".to_string());
        self
    }

    /// Enable verbose result codes.
    pub fn verbose(mut self) -> Self {
        self.commands.push("V1".to_string());
        self
    }

    /// Set speaker volume.
    pub fn speaker_volume(mut self, level: u8) -> Self {
        self.commands.push(format!("L{}", level.min(3)));
        self
    }

    /// Set speaker mode.
    pub fn speaker_mode(mut self, mode: u8) -> Self {
        self.commands.push(format!("M{}", mode.min(2)));
        self
    }

    /// Set auto-answer.
    pub fn auto_answer(mut self, rings: u8) -> Self {
        self.commands.push(format!("S0={}", rings));
        self
    }

    /// Set DTR behavior.
    pub fn dtr_behavior(mut self, mode: u8) -> Self {
        self.commands.push(format!("&D{}", mode.min(3)));
        self
    }

    /// Set RTS/CTS flow control.
    pub fn hardware_flow_control(mut self) -> Self {
        self.commands.push("&K3".to_string());
        self
    }

    /// Set XON/XOFF flow control.
    pub fn software_flow_control(mut self) -> Self {
        self.commands.push("&K4".to_string());
        self
    }

    /// Disable flow control.
    pub fn no_flow_control(mut self) -> Self {
        self.commands.push("&K0".to_string());
        self
    }

    /// Add a custom command fragment.
    pub fn custom(mut self, cmd: &str) -> Self {
        self.commands.push(cmd.to_string());
        self
    }

    /// Build the final init string.
    pub fn build(self) -> String {
        if self.commands.is_empty() {
            return "AT".to_string();
        }
        format!("AT{}", self.commands.join(""))
    }
}

impl Default for InitStringBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Predefined modem profiles for common modems.
pub fn preset_profiles() -> Vec<ModemProfile> {
    vec![
        ModemProfile::default(),
        ModemProfile {
            name: "USRobotics".to_string(),
            init_string: "ATZ\r\nAT&F1E0V1S0=0&K3".to_string(),
            dial_prefix: "ATDT".to_string(),
            hangup_string: "+++ATH0".to_string(),
            reset_string: "ATZ".to_string(),
            description: Some("US Robotics / 3Com modems".to_string()),
        },
        ModemProfile {
            name: "Multitech".to_string(),
            init_string: "ATZ\r\nATE0V1Q0X4&C1&D2".to_string(),
            dial_prefix: "ATDT".to_string(),
            hangup_string: "+++ATH0".to_string(),
            reset_string: "ATZ".to_string(),
            description: Some("Multitech modems".to_string()),
        },
        ModemProfile {
            name: "GSM Module".to_string(),
            init_string: "ATZ\r\nATE0\r\nAT+CMEE=1".to_string(),
            dial_prefix: "ATD".to_string(),
            hangup_string: "ATH".to_string(),
            reset_string: "ATZ".to_string(),
            description: Some("Generic GSM/GPRS module (SIM800, SIM900, etc.)".to_string()),
        },
        ModemProfile {
            name: "Null Modem".to_string(),
            init_string: "".to_string(),
            dial_prefix: "".to_string(),
            hangup_string: "".to_string(),
            reset_string: "".to_string(),
            description: Some("Null modem / direct serial connection".to_string()),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_at_commands_dial() {
        assert_eq!(AtCommands::dial_tone("5551234"), "ATDT5551234");
        assert_eq!(AtCommands::dial_pulse("5551234"), "ATDP5551234");
    }

    #[test]
    fn test_at_commands_s_registers() {
        assert_eq!(AtCommands::read_s_register(0), "ATS0?");
        assert_eq!(AtCommands::write_s_register(0, 3), "ATS0=3");
    }

    #[test]
    fn test_at_commands_speaker() {
        assert_eq!(AtCommands::speaker_volume(2), "ATL2");
        assert_eq!(AtCommands::speaker_mode(1), "ATM1");
    }

    #[test]
    fn test_parse_at_response_ok() {
        let raw = "AT\r\nOK\r\n";
        let result = parse_at_response("AT", raw, 50);
        assert!(result.result_code.is_ok());
        assert_eq!(result.elapsed_ms, 50);
        assert!(result.response_lines.is_empty());
    }

    #[test]
    fn test_parse_at_response_with_data() {
        let raw = "AT+CGMI\r\nHuawei\r\nOK\r\n";
        let result = parse_at_response("AT+CGMI", raw, 100);
        assert!(result.result_code.is_ok());
        assert_eq!(result.response_lines, vec!["Huawei"]);
    }

    #[test]
    fn test_parse_at_response_error() {
        let raw = "AT+XYZ\r\nERROR\r\n";
        let result = parse_at_response("AT+XYZ", raw, 30);
        assert!(result.result_code.is_error());
    }

    #[test]
    fn test_parse_at_response_connect() {
        let raw = "ATDT5551234\r\nCONNECT 57600\r\n";
        let result = parse_at_response("ATDT5551234", raw, 5000);
        assert!(result.result_code.is_connect());
        assert_eq!(
            result.result_code,
            ModemResponseCode::ConnectWithSpeed(57600)
        );
    }

    #[test]
    fn test_parse_signal_quality() {
        let response = "+CSQ: 15,0";
        let (rssi, ber) = parse_signal_quality(response).unwrap();
        assert_eq!(rssi, 15);
        assert_eq!(ber, 0);
    }

    #[test]
    fn test_rssi_to_dbm() {
        assert_eq!(rssi_to_dbm(0), Some(-113));
        assert_eq!(rssi_to_dbm(1), Some(-111));
        assert_eq!(rssi_to_dbm(31), Some(-51));
        assert_eq!(rssi_to_dbm(99), None);
    }

    #[test]
    fn test_rssi_description() {
        assert_eq!(rssi_description(5), "Marginal");
        assert_eq!(rssi_description(12), "OK");
        assert_eq!(rssi_description(17), "Good");
        assert_eq!(rssi_description(25), "Excellent");
        assert_eq!(rssi_description(31), "Maximum");
    }

    #[test]
    fn test_init_string_builder() {
        let init = InitStringBuilder::new()
            .reset()
            .echo_off()
            .verbose()
            .hardware_flow_control()
            .build();
        assert_eq!(init, "ATZE0V1&K3");
    }

    #[test]
    fn test_init_string_builder_empty() {
        let init = InitStringBuilder::new().build();
        assert_eq!(init, "AT");
    }

    #[test]
    fn test_init_string_builder_custom() {
        let init = InitStringBuilder::new()
            .reset()
            .custom("X4")
            .custom("&C1")
            .build();
        assert_eq!(init, "ATZX4&C1");
    }

    #[test]
    fn test_has_result_code() {
        assert!(has_result_code("stuff\r\nOK\r\n"));
        assert!(has_result_code("stuff\r\nERROR\r\n"));
        assert!(has_result_code("stuff\r\nCONNECT 9600\r\n"));
        assert!(has_result_code("stuff\r\n+CME ERROR: 10\r\n"));
        assert!(!has_result_code("partial data"));
    }

    #[test]
    fn test_preset_profiles() {
        let profiles = preset_profiles();
        assert!(!profiles.is_empty());
        assert!(profiles.iter().any(|p| p.name == "Generic Hayes"));
        assert!(profiles.iter().any(|p| p.name == "GSM Module"));
    }

    #[test]
    fn test_modem_profile_default() {
        let profile = ModemProfile::default();
        assert_eq!(profile.name, "Generic Hayes");
        assert_eq!(profile.init_string, "ATZ");
        assert_eq!(profile.dial_prefix, "ATDT");
    }

    #[tokio::test]
    async fn test_modem_controller_ping() {
        use crate::serial::transport::SimulatedTransport;

        let transport = SimulatedTransport::new("COM1");
        transport.open(&SerialConfig::default()).await.unwrap();
        // Inject a response
        transport.inject_rx(b"AT\r\nOK\r\n").await;

        let controller = ModemController::new(
            transport.clone(),
            ModemProfile::default(),
            2000,
        );
        let result = controller.ping().await.unwrap();
        assert!(result);
    }

    #[tokio::test]
    async fn test_execute_at_command() {
        use crate::serial::transport::SimulatedTransport;

        let transport = SimulatedTransport::new("COM1");
        transport.open(&SerialConfig::default()).await.unwrap();
        transport.inject_rx(b"AT+CGMI\r\nTestManufacturer\r\nOK\r\n").await;

        let result = execute_at_command(transport.as_ref(), "AT+CGMI", 2000)
            .await
            .unwrap();
        assert!(result.result_code.is_ok());
    }
}
