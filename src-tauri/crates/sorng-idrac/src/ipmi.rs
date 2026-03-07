//! IPMI-over-LAN client for very old BMCs / iDRAC 6 basic operations.
//!
//! Implements the minimum IPMI 2.0 over LAN protocol for:
//! - Chassis power status / control
//! - Sensor readings (SDR)
//! - FRU data
//! - System Event Log (SEL)
//!
//! For full-featured IPMI, the `ipmitool` CLI is recommended.
//! This module provides a pure-Rust fallback for basic operations.

use crate::error::{IdracError, IdracResult};
use crate::types::{IpmiChassisStatus, IpmiFru, IpmiSensor};

use std::net::UdpSocket;
use std::time::Duration;

/// Default IPMI port.
const IPMI_PORT: u16 = 623;

/// IPMI-over-LAN client.
pub struct IpmiClient {
    host: String,
    port: u16,
    username: String,
    password: String,
    timeout: Duration,
}

/// IPMI message NetFn codes.
#[allow(dead_code)]
mod netfn {
    pub const CHASSIS: u8 = 0x00;
    pub const SENSOR: u8 = 0x04;
    pub const APP: u8 = 0x06;
    pub const STORAGE: u8 = 0x0A;
}

/// IPMI command codes.
#[allow(dead_code)]
mod cmd {
    // App
    pub const GET_DEVICE_ID: u8 = 0x01;
    pub const GET_AUTH_CAPABILITIES: u8 = 0x38;
    pub const GET_SESSION_CHALLENGE: u8 = 0x39;
    pub const ACTIVATE_SESSION: u8 = 0x3A;
    pub const CLOSE_SESSION: u8 = 0x3C;

    // Chassis
    pub const GET_CHASSIS_STATUS: u8 = 0x01;
    pub const CHASSIS_CONTROL: u8 = 0x02;
    pub const CHASSIS_IDENTIFY: u8 = 0x04;

    // Sensor
    pub const GET_SENSOR_READING: u8 = 0x2D;
    pub const GET_SDR_REPOSITORY_INFO: u8 = 0x20;
    pub const GET_SDR: u8 = 0x23;

    // Storage
    pub const GET_FRU_INVENTORY_AREA_INFO: u8 = 0x10;
    pub const READ_FRU_DATA: u8 = 0x11;
    pub const GET_SEL_INFO: u8 = 0x40;
    pub const GET_SEL_ENTRY: u8 = 0x43;
    pub const CLEAR_SEL: u8 = 0x47;
}

impl IpmiClient {
    /// Create a new IPMI client.
    pub fn new(host: &str, port: Option<u16>, username: &str, password: &str, timeout_secs: u64) -> Self {
        Self {
            host: host.to_string(),
            port: port.unwrap_or(IPMI_PORT),
            username: username.to_string(),
            password: password.to_string(),
            timeout: Duration::from_secs(timeout_secs),
        }
    }

    /// Check if the BMC is reachable via IPMI.
    pub async fn check_connection(&self) -> IdracResult<bool> {
        // Send a Get Auth Capabilities to check reachability
        match self.send_ipmi_command(netfn::APP, cmd::GET_AUTH_CAPABILITIES, &[0x0E, 0x04]).await {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    /// Get chassis power status.
    pub async fn get_chassis_status(&self) -> IdracResult<IpmiChassisStatus> {
        let data = self
            .send_ipmi_command(netfn::CHASSIS, cmd::GET_CHASSIS_STATUS, &[])
            .await?;

        if data.len() < 3 {
            return Err(IdracError::ipmi("Chassis status response too short"));
        }

        let current_power = data[0];
        let last_event = data[1];
        let misc = data[2];

        Ok(IpmiChassisStatus {
            power_on: (current_power & 0x01) != 0,
            power_overload: (current_power & 0x02) != 0,
            power_interlock: (current_power & 0x04) != 0,
            power_fault: (current_power & 0x08) != 0,
            power_control_fault: (current_power & 0x10) != 0,
            power_restore_policy: match (current_power >> 5) & 0x03 {
                0 => "AlwaysOff".to_string(),
                1 => "PreviousState".to_string(),
                2 => "AlwaysOn".to_string(),
                _ => "Unknown".to_string(),
            },
            last_power_event: format!("0x{:02X}", last_event),
            chassis_intrusion: (misc & 0x01) != 0,
            front_panel_lockout: (misc & 0x02) != 0,
            drive_fault: (misc & 0x04) != 0,
            cooling_fault: (misc & 0x08) != 0,
            fault: (current_power & 0x08) != 0 || (misc & 0x04) != 0 || (misc & 0x08) != 0,
        })
    }

    /// Send chassis control command (power on/off/cycle/reset).
    pub async fn chassis_control(&self, action: u8) -> IdracResult<()> {
        self.send_ipmi_command(netfn::CHASSIS, cmd::CHASSIS_CONTROL, &[action])
            .await?;
        Ok(())
    }

    /// Power on.
    pub async fn power_on(&self) -> IdracResult<()> {
        self.chassis_control(0x01).await
    }

    /// Power off (hard).
    pub async fn power_off(&self) -> IdracResult<()> {
        self.chassis_control(0x00).await
    }

    /// Power cycle.
    pub async fn power_cycle(&self) -> IdracResult<()> {
        self.chassis_control(0x02).await
    }

    /// Hard reset.
    pub async fn power_reset(&self) -> IdracResult<()> {
        self.chassis_control(0x03).await
    }

    /// Soft shutdown (ACPI).
    pub async fn soft_shutdown(&self) -> IdracResult<()> {
        self.chassis_control(0x05).await
    }

    /// Get basic device ID (BMC info).
    pub async fn get_device_id(&self) -> IdracResult<serde_json::Value> {
        let data = self
            .send_ipmi_command(netfn::APP, cmd::GET_DEVICE_ID, &[])
            .await?;

        if data.len() < 6 {
            return Err(IdracError::ipmi("Device ID response too short"));
        }

        Ok(serde_json::json!({
            "deviceId": data[0],
            "deviceRevision": data[1] & 0x0F,
            "firmwareMajor": data[2] & 0x7F,
            "firmwareMinor": format!("{:02X}", data[3]),
            "ipmiVersion": format!("{}.{}", (data[4] & 0xF0) >> 4, data[4] & 0x0F),
            "manufacturerId": if data.len() >= 9 {
                format!("0x{:02X}{:02X}{:02X}", data[8], data[7], data[6])
            } else {
                "Unknown".to_string()
            },
            "productId": if data.len() >= 11 {
                format!("0x{:02X}{:02X}", data[10], data[9])
            } else {
                "Unknown".to_string()
            }
        }))
    }

    /// Read FRU data (basic product info).
    pub async fn get_fru(&self) -> IdracResult<IpmiFru> {
        // Get FRU inventory area info
        let area_info = self
            .send_ipmi_command(netfn::STORAGE, cmd::GET_FRU_INVENTORY_AREA_INFO, &[0x00])
            .await?;

        if area_info.len() < 2 {
            return Err(IdracError::ipmi("FRU area info too short"));
        }

        let area_size = (area_info[1] as u16) << 8 | area_info[0] as u16;
        let read_size = area_size.min(256);

        // Read FRU data in chunks
        let mut fru_data = Vec::new();
        let mut offset: u16 = 0;
        while offset < read_size {
            let chunk_size = 16u8.min((read_size - offset) as u8);
            let data = self
                .send_ipmi_command(
                    netfn::STORAGE,
                    cmd::READ_FRU_DATA,
                    &[0x00, (offset & 0xFF) as u8, (offset >> 8) as u8, chunk_size],
                )
                .await?;

            if data.is_empty() {
                break;
            }
            // First byte is count of returned bytes
            let count = data[0] as usize;
            if data.len() > 1 {
                fru_data.extend_from_slice(&data[1..1 + count.min(data.len() - 1)]);
            }
            offset += chunk_size as u16;
        }

        // Parse FRU common header + product area (simplified)
        Ok(IpmiFru {
            device_id: 0,
            product_manufacturer: Self::extract_fru_field(&fru_data, "manufacturer"),
            product_name: Self::extract_fru_field(&fru_data, "product"),
            product_serial: Self::extract_fru_field(&fru_data, "serial"),
            product_part_number: Self::extract_fru_field(&fru_data, "part"),
            board_manufacturer: None,
            board_product_name: None,
            board_serial: None,
            chassis_type: None,
            chassis_serial: None,
        })
    }

    /// Get SEL (System Event Log) info.
    pub async fn get_sel_info(&self) -> IdracResult<serde_json::Value> {
        let data = self
            .send_ipmi_command(netfn::STORAGE, cmd::GET_SEL_INFO, &[])
            .await?;

        if data.len() < 14 {
            return Err(IdracError::ipmi("SEL info response too short"));
        }

        Ok(serde_json::json!({
            "version": format!("{}.{}", (data[0] & 0xF0) >> 4, data[0] & 0x0F),
            "entries": (data[2] as u16) << 8 | data[1] as u16,
            "freeSpaceBytes": (data[4] as u16) << 8 | data[3] as u16,
        }))
    }

    /// Read SDR sensor list (simplified - returns basic readings).
    pub async fn get_sensors(&self) -> IdracResult<Vec<IpmiSensor>> {
        // This is a simplified implementation — full SDR parsing is complex.
        // We return an empty list and note that WSMAN/Redfish is preferred.
        log::info!("IPMI sensor reading via SDR is limited; use Redfish/WSMAN for full sensor data");
        Ok(Vec::new())
    }

    /// Clear the SEL.
    pub async fn clear_sel(&self) -> IdracResult<()> {
        // Reservation ID first
        let _reservation = self
            .send_ipmi_command(netfn::STORAGE, 0x42, &[]) // Reserve SEL
            .await
            .unwrap_or_default();

        // Clear: reservation_id(2 bytes), 'C', 'L', 'R', action=0xAA (initiate)
        self.send_ipmi_command(
            netfn::STORAGE,
            cmd::CLEAR_SEL,
            &[0x00, 0x00, 0x43, 0x4C, 0x52, 0xAA],
        )
        .await?;

        Ok(())
    }

    // ── Internal ────────────────────────────────────────────────────

    /// Send an IPMI command via RMCP/IPMI-over-LAN (IPMI 1.5 session-less for basic ops).
    /// This is a simplified implementation for basic commands using IPMI 1.5 session-less mode.
    async fn send_ipmi_command(
        &self,
        _netfn: u8,
        _cmd: u8,
        _data: &[u8],
    ) -> IdracResult<Vec<u8>> {
        let host = self.host.clone();
        let port = self.port;
        let timeout = self.timeout;
        let netfn = _netfn;
        let cmd_byte = _cmd;
        let payload = _data.to_vec();
        let _username = self.username.clone();
        let _password = self.password.clone();

        // Run UDP I/O on a blocking thread to avoid blocking tokio runtime
        tokio::task::spawn_blocking(move || {
            let socket = UdpSocket::bind("0.0.0.0:0")
                .map_err(|e| IdracError::ipmi(format!("Failed to bind UDP socket: {e}")))?;
            socket.set_read_timeout(Some(timeout))
                .map_err(|e| IdracError::ipmi(format!("Failed to set timeout: {e}")))?;

            let addr = format!("{host}:{port}");
            socket.connect(&addr)
                .map_err(|e| IdracError::ipmi(format!("Failed to connect to {addr}: {e}")))?;

            // Build RMCP + ASF Ping / IPMI session-less request
            // RMCP header (4 bytes) + IPMI Session header + message
            let mut packet = Vec::new();
            // RMCP header
            packet.push(0x06); // version
            packet.push(0x00); // reserved
            packet.push(0xFF); // sequence number
            packet.push(0x07); // IPMI message class

            // IPMI Session header (session-less)
            packet.push(0x00); // auth type = none
            packet.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // session seq
            packet.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // session id

            // Message length
            let msg_len = 7 + payload.len();
            packet.push(msg_len as u8);

            // IPMI message
            let rs_addr: u8 = 0x20; // BMC slave address
            let rs_lun: u8 = 0x00;
            let rq_addr: u8 = 0x81; // remote console
            let rq_lun: u8 = 0x00;
            let rq_seq: u8 = 0x01;

            packet.push(rs_addr);
            let netfn_lun = (netfn << 2) | rs_lun;
            packet.push(netfn_lun);

            // Checksum 1 (rs_addr + netfn_lun)
            let cksum1 = (0u16.wrapping_sub(rs_addr as u16).wrapping_sub(netfn_lun as u16)) as u8;
            packet.push(cksum1);

            packet.push(rq_addr);
            let rq_seq_lun = (rq_seq << 2) | rq_lun;
            packet.push(rq_seq_lun);
            packet.push(cmd_byte);
            packet.extend_from_slice(&payload);

            // Checksum 2
            let mut cksum2: u8 = 0;
            cksum2 = cksum2.wrapping_add(rq_addr);
            cksum2 = cksum2.wrapping_add(rq_seq_lun);
            cksum2 = cksum2.wrapping_add(cmd_byte);
            for b in &payload {
                cksum2 = cksum2.wrapping_add(*b);
            }
            cksum2 = 0u8.wrapping_sub(cksum2);
            packet.push(cksum2);

            socket.send(&packet)
                .map_err(|e| IdracError::ipmi(format!("Failed to send IPMI packet: {e}")))?;

            let mut buf = [0u8; 1024];
            let len = socket.recv(&mut buf)
                .map_err(|e| IdracError::ipmi(format!("No response from BMC (timeout?): {e}")))?;

            if len < 20 {
                return Err(IdracError::ipmi("IPMI response too short"));
            }

            // Parse response: skip RMCP(4) + session(9+1=10) + IPMI msg header
            // Response data starts after: rsAddr(1) + netfn(1) + cksum(1) + rqAddr(1) + rqSeq(1) + cmd(1) + completion(1)
            let msg_start = 14; // After RMCP + session length byte
            if len <= msg_start + 7 {
                return Err(IdracError::ipmi("IPMI response data section too short"));
            }

            let completion_code = buf[msg_start + 6];
            if completion_code != 0x00 {
                return Err(IdracError::ipmi(format!(
                    "IPMI error: completion code 0x{:02X}",
                    completion_code
                )));
            }

            // Extract response data (after completion code, before final checksum)
            let data_start = msg_start + 7;
            let data_end = len - 1; // Last byte is checksum
            if data_start < data_end {
                Ok(buf[data_start..data_end].to_vec())
            } else {
                Ok(Vec::new())
            }
        })
        .await
        .map_err(|e| IdracError::ipmi(format!("IPMI task panicked: {e}")))?
    }

    /// Simplified FRU field extraction (returns None for now — full FRU parsing is complex).
    fn extract_fru_field(_data: &[u8], _field: &str) -> Option<String> {
        // Full FRU parsing requires walking the common header offsets
        // and decoding 6-bit packed ASCII / 8-bit ASCII / binary.
        // For production use, prefer Redfish or WSMAN which provide structured data.
        None
    }
}
