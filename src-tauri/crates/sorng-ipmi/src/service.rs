//! IPMI service — multi-session connection management with an
//! `Arc<Mutex<IpmiService>>` state suitable for Tauri managed state.

use crate::channel::{self, ChannelAccess, ChannelAccessType, ChannelAuthCapabilities};
use crate::chassis;
use crate::error::{IpmiError, IpmiResult};
use crate::fru;
use crate::lan;
use crate::pef::{self, PefControlStatus};
use crate::raw;
use crate::sel;
use crate::sensors;
use crate::session::{self, IpmiSessionHandle, SessionManager};
use crate::sol;
use crate::types::*;
use crate::users::{self, UserPasswordOperation};
use crate::watchdog::{self, WatchdogTimerConfig};
use log::{debug, info};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

// ═══════════════════════════════════════════════════════════════════════
// State Type
// ═══════════════════════════════════════════════════════════════════════

pub type IpmiServiceState = Arc<Mutex<IpmiService>>;

pub fn new_state() -> IpmiServiceState {
    Arc::new(Mutex::new(IpmiService::new()))
}

// ═══════════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════════

/// Manages multiple IPMI BMC sessions.
pub struct IpmiService {
    manager: SessionManager,
}

impl IpmiService {
    pub fn new() -> Self {
        Self {
            manager: SessionManager::new(),
        }
    }

    // ── Connection lifecycle ────────────────────────────────────────

    pub async fn connect(&mut self, config: IpmiSessionConfig) -> IpmiResult<String> {
        self.manager.connect(config).await
    }

    pub async fn disconnect(&mut self, session_id: &str) -> IpmiResult<()> {
        self.manager.disconnect(session_id).await
    }

    pub async fn disconnect_all(&mut self) {
        self.manager.disconnect_all().await;
    }

    pub fn list_sessions(&self) -> Vec<IpmiSessionInfo> {
        self.manager.list_sessions()
    }

    pub fn get_session_info(&self, session_id: &str) -> IpmiResult<IpmiSessionInfo> {
        self.manager.get_session_info(session_id)
    }

    pub async fn ping(&self, host: &str, port: u16) -> IpmiResult<bool> {
        session::ping_bmc(host, port).await
    }

    // ── Private helper ──────────────────────────────────────────────

    fn session_mut(&mut self, id: &str) -> IpmiResult<&mut IpmiSessionHandle> {
        self.manager.get_session_mut(id)
    }

    // ── Chassis ─────────────────────────────────────────────────────

    pub fn get_chassis_status(&mut self, session_id: &str) -> IpmiResult<ChassisStatus> {
        let s = self.session_mut(session_id)?;
        chassis::get_chassis_status(s)
    }

    pub fn chassis_control(
        &mut self,
        session_id: &str,
        action: ChassisControl,
    ) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        chassis::chassis_control(s, action)
    }

    pub fn power_on(&mut self, session_id: &str) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        chassis::power_on(s)
    }

    pub fn power_off(&mut self, session_id: &str) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        chassis::power_off(s)
    }

    pub fn power_cycle(&mut self, session_id: &str) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        chassis::power_cycle(s)
    }

    pub fn hard_reset(&mut self, session_id: &str) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        chassis::hard_reset(s)
    }

    pub fn soft_shutdown(&mut self, session_id: &str) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        chassis::soft_shutdown(s)
    }

    pub fn chassis_identify(
        &mut self,
        session_id: &str,
        duration: Option<u8>,
        force: bool,
    ) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        chassis::chassis_identify(s, duration, force)
    }

    pub fn set_boot_device(
        &mut self,
        session_id: &str,
        device: BootDevice,
        persistent: bool,
        efi: bool,
    ) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        chassis::set_boot_device(s, device, persistent, efi)
    }

    pub fn get_device_id(&mut self, session_id: &str) -> IpmiResult<IpmiDeviceId> {
        let s = self.session_mut(session_id)?;
        chassis::get_device_id(s)
    }

    // ── Sensors / SDR ───────────────────────────────────────────────

    pub fn get_all_sdr_records(&mut self, session_id: &str) -> IpmiResult<Vec<SdrRecord>> {
        let s = self.session_mut(session_id)?;
        sensors::get_all_sdr_records(s)
    }

    pub fn read_sensor(
        &mut self,
        session_id: &str,
        sensor: &SdrFullSensor,
    ) -> IpmiResult<SensorReading> {
        let s = self.session_mut(session_id)?;
        sensors::read_sensor(s, sensor)
    }

    pub fn get_sensor_thresholds(
        &mut self,
        session_id: &str,
        sensor_number: u8,
    ) -> IpmiResult<SensorThresholds> {
        let s = self.session_mut(session_id)?;
        sensors::get_sensor_thresholds(s, sensor_number)
    }

    // ── SEL ─────────────────────────────────────────────────────────

    pub fn get_sel_info(&mut self, session_id: &str) -> IpmiResult<SelInfo> {
        let s = self.session_mut(session_id)?;
        sel::get_sel_info(s)
    }

    pub fn get_all_sel_entries(&mut self, session_id: &str) -> IpmiResult<Vec<SelEntry>> {
        let s = self.session_mut(session_id)?;
        sel::get_all_sel_entries(s)
    }

    pub fn clear_sel(&mut self, session_id: &str) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        sel::clear_sel(s)
    }

    pub fn delete_sel_entry(
        &mut self,
        session_id: &str,
        record_id: u16,
    ) -> IpmiResult<u16> {
        let s = self.session_mut(session_id)?;
        sel::delete_sel_entry(s, record_id)
    }

    // ── FRU ─────────────────────────────────────────────────────────

    pub fn get_fru_info(
        &mut self,
        session_id: &str,
        device_id: u8,
    ) -> IpmiResult<FruDeviceInfo> {
        let s = self.session_mut(session_id)?;
        fru::get_fru_info(s, device_id)
    }

    // ── SOL ─────────────────────────────────────────────────────────

    pub fn get_sol_config(
        &mut self,
        session_id: &str,
        channel: u8,
    ) -> IpmiResult<SolConfig> {
        let s = self.session_mut(session_id)?;
        sol::get_sol_config(s, channel)
    }

    pub fn activate_sol(
        &mut self,
        session_id: &str,
        instance: u8,
        encrypt: bool,
        auth: bool,
    ) -> IpmiResult<SolSession> {
        let s = self.session_mut(session_id)?;
        sol::activate_sol(s, instance, encrypt, auth)
    }

    pub fn deactivate_sol(
        &mut self,
        session_id: &str,
        instance: u8,
    ) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        sol::deactivate_sol(s, instance)
    }

    // ── Watchdog ────────────────────────────────────────────────────

    pub fn get_watchdog_timer(
        &mut self,
        session_id: &str,
    ) -> IpmiResult<WatchdogTimer> {
        let s = self.session_mut(session_id)?;
        watchdog::get_watchdog_timer(s)
    }

    pub fn set_watchdog_timer(
        &mut self,
        session_id: &str,
        config: &WatchdogTimerConfig,
    ) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        watchdog::set_watchdog_timer(s, config)
    }

    pub fn reset_watchdog_timer(&mut self, session_id: &str) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        watchdog::reset_watchdog_timer(s)
    }

    // ── LAN ─────────────────────────────────────────────────────────

    pub fn get_lan_config(
        &mut self,
        session_id: &str,
        channel: u8,
    ) -> IpmiResult<LanConfig> {
        let s = self.session_mut(session_id)?;
        lan::get_lan_config(s, channel)
    }

    pub fn set_ip_address(
        &mut self,
        session_id: &str,
        channel: u8,
        ip: [u8; 4],
    ) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        lan::set_ip_address(s, channel, ip)
    }

    pub fn set_subnet_mask(
        &mut self,
        session_id: &str,
        channel: u8,
        mask: [u8; 4],
    ) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        lan::set_subnet_mask(s, channel, mask)
    }

    pub fn set_default_gateway(
        &mut self,
        session_id: &str,
        channel: u8,
        gateway: [u8; 4],
    ) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        lan::set_default_gateway(s, channel, gateway)
    }

    // ── Users ───────────────────────────────────────────────────────

    pub fn list_users(
        &mut self,
        session_id: &str,
        channel: u8,
    ) -> IpmiResult<Vec<IpmiUser>> {
        let s = self.session_mut(session_id)?;
        users::list_users(s, channel)
    }

    pub fn set_user_name(
        &mut self,
        session_id: &str,
        user_id: u8,
        name: &str,
    ) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        users::set_user_name(s, user_id, name)
    }

    pub fn set_user_password(
        &mut self,
        session_id: &str,
        user_id: u8,
        password: &str,
    ) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        users::set_user_password(s, user_id, password, UserPasswordOperation::SetPassword)
    }

    pub fn enable_user(
        &mut self,
        session_id: &str,
        user_id: u8,
    ) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        users::enable_user(s, user_id)
    }

    pub fn disable_user(
        &mut self,
        session_id: &str,
        user_id: u8,
    ) -> IpmiResult<()> {
        let s = self.session_mut(session_id)?;
        users::disable_user(s, user_id)
    }

    // ── Raw ─────────────────────────────────────────────────────────

    pub fn raw_command(
        &mut self,
        session_id: &str,
        netfn: u8,
        cmd: u8,
        data: &[u8],
    ) -> IpmiResult<RawIpmiResponse> {
        let s = self.session_mut(session_id)?;
        raw::raw_command(s, netfn, cmd, data)
    }

    pub fn bridged_command(
        &mut self,
        session_id: &str,
        target_channel: u8,
        target_address: u8,
        netfn: u8,
        cmd: u8,
        data: &[u8],
    ) -> IpmiResult<RawIpmiResponse> {
        let s = self.session_mut(session_id)?;
        raw::bridged_command(s, target_channel, target_address, netfn, cmd, data)
    }

    // ── PEF ─────────────────────────────────────────────────────────

    pub fn get_pef_capabilities(
        &mut self,
        session_id: &str,
    ) -> IpmiResult<PefCapabilities> {
        let s = self.session_mut(session_id)?;
        pef::get_pef_capabilities(s)
    }

    pub fn get_pef_config(&mut self, session_id: &str) -> IpmiResult<pef::PefControlStatus> {
        let s = self.session_mut(session_id)?;
        pef::get_pef_control(s)
    }

    // ── Channel ─────────────────────────────────────────────────────

    pub fn get_channel_info(
        &mut self,
        session_id: &str,
        channel: u8,
    ) -> IpmiResult<ChannelInfo> {
        let s = self.session_mut(session_id)?;
        channel::get_channel_info(s, channel)
    }

    pub fn list_channels(
        &mut self,
        session_id: &str,
    ) -> IpmiResult<Vec<ChannelInfo>> {
        let s = self.session_mut(session_id)?;
        channel::list_channels(s)
    }

    pub fn get_channel_auth_capabilities(
        &mut self,
        session_id: &str,
        channel: u8,
        privilege: PrivilegeLevel,
    ) -> IpmiResult<ChannelAuthCapabilities> {
        let s = self.session_mut(session_id)?;
        channel::get_channel_auth_capabilities(s, channel, privilege)
    }

    pub fn get_channel_cipher_suites(
        &mut self,
        session_id: &str,
        channel: u8,
    ) -> IpmiResult<Vec<CipherSuite>> {
        let s = self.session_mut(session_id)?;
        channel::get_channel_cipher_suites(s, channel)
    }
}
