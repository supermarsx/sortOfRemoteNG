//! Virtual console (KVM) for Lenovo servers.

use crate::client::LenovoClient;
use crate::error::LenovoResult;
use crate::types::*;

pub struct VirtualConsoleManager<'a> {
    client: &'a LenovoClient,
}

impl<'a> VirtualConsoleManager<'a> {
    pub fn new(client: &'a LenovoClient) -> Self {
        Self { client }
    }

    pub async fn get_console_info(&self) -> LenovoResult<XccConsoleInfo> {
        if let Ok(rf) = self.client.require_redfish() {
            return rf.get_console_info().await;
        }
        // IMM/IMM2 — report Java applet console
        Ok(XccConsoleInfo {
            console_types: vec![ConsoleType::JavaApplet],
            max_sessions: 2,
            active_sessions: 0,
            html5_url: None,
            requires_license: true,
        })
    }

    pub async fn get_html5_launch_url(&self) -> LenovoResult<String> {
        let rf = self.client.require_redfish()?;
        rf.get_html5_console_url().await
    }
}
