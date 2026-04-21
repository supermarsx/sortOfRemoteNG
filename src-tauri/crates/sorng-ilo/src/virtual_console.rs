//! Virtual/remote console — HTML5, Java IRC, .NET IRC info and launch URLs.

use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::types::*;

/// Virtual console operations.
pub struct VirtualConsoleManager<'a> {
    client: &'a IloClient,
}

impl<'a> VirtualConsoleManager<'a> {
    pub fn new(client: &'a IloClient) -> Self {
        Self { client }
    }

    /// Get available console types and launch info.
    pub async fn get_console_info(&self) -> IloResult<IloConsoleInfo> {
        let gen = self.client.generation;
        let host = &self.client.config.host;

        if let Ok(rf) = self.client.require_redfish() {
            if let Ok(info) = rf.get_console_info().await {
                return self.parse_console_info(&info, gen, host);
            }
        }

        // Construct info from generation capabilities
        let mut console_types = Vec::new();

        if gen.supports_html5_console() {
            console_types.push(ConsoleType::Html5);
        }
        if gen.supports_java_console() {
            console_types.push(ConsoleType::JavaIrc);
        }
        // iLO 3/4 also support .NET IRC
        if matches!(gen, IloGeneration::Ilo3 | IloGeneration::Ilo4) {
            console_types.push(ConsoleType::DotNetIrc);
        }
        // iLO 2 supports Java Applet
        if matches!(gen, IloGeneration::Ilo2) {
            console_types.push(ConsoleType::JavaApplet);
        }

        Ok(IloConsoleInfo {
            available_types: console_types,
            html5_url: if gen.supports_html5_console() {
                Some(format!("https://{}/html/irc.html", host))
            } else {
                None
            },
            java_url: if gen.supports_java_console() {
                Some(format!("https://{}/html/java_irc.html", host))
            } else {
                None
            },
            hotkeys: vec![HotkeyConfig {
                name: "Ctrl+Alt+Del".to_string(),
                key_sequence: "Ctrl+Alt+Del".to_string(),
            }],
        })
    }

    fn parse_console_info(
        &self,
        data: &serde_json::Value,
        gen: IloGeneration,
        host: &str,
    ) -> IloResult<IloConsoleInfo> {
        let mut console_types = Vec::new();

        // Check Oem data for console capabilities
        let oem = data
            .get("Oem")
            .and_then(|o| o.get("Hpe").or_else(|| o.get("Hp")));

        if gen.supports_html5_console() {
            console_types.push(ConsoleType::Html5);
        }

        if gen.supports_java_console() {
            console_types.push(ConsoleType::JavaIrc);
        }

        // Check for .NET IRC
        if let Some(features) = oem
            .and_then(|o| o.get("Features"))
            .and_then(|f| f.as_array())
        {
            for f in features {
                if let Some(name) = f.get("FeatureName").and_then(|v| v.as_str()) {
                    if name.contains(".NET") {
                        console_types.push(ConsoleType::DotNetIrc);
                    }
                }
            }
        }

        let html5_url = if gen.supports_html5_console() {
            oem.and_then(|o| o.pointer("/Links/HtmlConsole/@odata.id"))
                .and_then(|v| v.as_str())
                .map(|p| format!("https://{}{}", host, p))
                .or_else(|| Some(format!("https://{}/html/irc.html", host)))
        } else {
            None
        };

        let java_url = if gen.supports_java_console() {
            Some(format!("https://{}/html/java_irc.html", host))
        } else {
            None
        };

        let hotkeys = oem
            .and_then(|o| o.get("Hotkeys"))
            .and_then(|h| h.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|hk| {
                        let name = hk.get("Name").and_then(|v| v.as_str())?;
                        let keys = hk.get("KeySequence").and_then(|v| v.as_str())?;
                        Some(HotkeyConfig {
                            name: name.to_string(),
                            key_sequence: keys.to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_else(|| {
                vec![HotkeyConfig {
                    name: "Ctrl+Alt+Del".to_string(),
                    key_sequence: "Ctrl+Alt+Del".to_string(),
                }]
            });

        Ok(IloConsoleInfo {
            available_types: console_types,
            html5_url,
            java_url,
            hotkeys,
        })
    }

    /// Get an HTML5 console launch URL with session token.
    pub async fn get_html5_launch_url(&self) -> IloResult<String> {
        let gen = self.client.generation;
        if !gen.supports_html5_console() {
            return Err(IloError::console(format!(
                "HTML5 console not supported on {:?}",
                gen
            )));
        }

        let host = &self.client.config.host;

        // For Redfish-capable iLOs, we can get a session token for SSO
        if let Ok(rf) = self.client.require_redfish() {
            if let Some(token) = rf.inner.session().map(|s| s.token.clone()) {
                return Ok(format!(
                    "https://{}/html/irc.html?sessionKey={}",
                    host, token
                ));
            }
        }

        Ok(format!("https://{}/html/irc.html", host))
    }
}
