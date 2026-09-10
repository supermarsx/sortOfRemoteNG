//! Receipt-bound, read-only section discovery. API presence is not permission:
//! only an authenticated successful read makes a section available.
use crate::{
    error::{SynologyError, SynologyErrorKind, SynologyResult},
    file_transfer::FileTransferContext,
    service::SynologyService,
};
use serde::Serialize;
use std::{sync::atomic::Ordering, time::Duration};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SectionAccessStatus {
    Available,
    Denied,
    Unavailable,
    Unknown,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionAccessSnapshot {
    pub section: String,
    pub status: SectionAccessStatus,
    pub reason: String,
}

pub struct SectionAccessContext {
    lease: FileTransferContext,
}
impl SynologyService {
    /// Capture under the instance mutex, then release it before awaiting probe.
    pub fn section_access_context(&self, expected: &str) -> SynologyResult<SectionAccessContext> {
        Ok(SectionAccessContext {
            lease: self.fs_transfer_context(expected)?,
        })
    }
}

#[derive(Clone, Copy)]
struct ReadProbe {
    api: &'static str,
    max_version: u32,
    method: &'static str,
    params: &'static [(&'static str, &'static str)],
}
const fn read(api: &'static str, max_version: u32, method: &'static str) -> ReadProbe {
    ReadProbe {
        api,
        max_version,
        method,
        params: &[],
    }
}
const fn page(api: &'static str, max_version: u32, method: &'static str) -> ReadProbe {
    ReadProbe {
        api,
        max_version,
        method,
        params: &[("offset", "0"), ("limit", "1")],
    }
}

// Exact read methods already used by the corresponding crate managers. No
// request method, API name, path or parameters are accepted from the renderer.
fn probes(section: &str) -> Option<Vec<ReadProbe>> {
    Some(match section {
        "dashboard" | "system" => vec![
            read("SYNO.DSM.Info", 2, "getinfo"),
            read("SYNO.Core.System.Utilization", 1, "get"),
        ],
        "storage" => vec![read("SYNO.Storage.CGI.Storage", 1, "load_info")],
        "fileStation" => vec![read("SYNO.FileStation.Info", 2, "get")],
        "shares" => vec![page("SYNO.Core.Share", 1, "list")],
        "network" => vec![
            read("SYNO.Core.Network", 1, "get"),
            read("SYNO.Core.Network.Interface", 1, "list"),
            read("SYNO.Core.Security.Firewall.Rules", 1, "list_all"),
        ],
        "users" => vec![
            page("SYNO.Core.User", 1, "list"),
            page("SYNO.Core.Group", 1, "list"),
        ],
        "packages" => vec![read("SYNO.Core.Package", 1, "list")],
        "services" => vec![
            read("SYNO.Core.Service", 1, "get"),
            read("SYNO.Core.FileServ.SMB", 3, "get"),
            read("SYNO.Core.FileServ.NFS", 2, "get"),
            read("SYNO.Core.Terminal", 3, "get"),
        ],
        "docker" => vec![
            page("SYNO.Docker.Container", 1, "list"),
            read("SYNO.Docker.Image", 1, "list"),
            read("SYNO.Docker.Network", 1, "list"),
            read("SYNO.ContainerManager.Project", 1, "list"),
            read("SYNO.Docker.Project", 1, "list"),
        ],
        "vms" => vec![read("SYNO.Virtualization.API.Guest", 1, "list")],
        "downloads" => vec![
            read("SYNO.DownloadStation.Statistic", 1, "getinfo"),
            page("SYNO.DownloadStation.Task", 3, "list"),
        ],
        "surveillance" => vec![read("SYNO.SurveillanceStation.Camera", 9, "List")],
        "backup" => vec![
            read("SYNO.Backup.Task", 1, "list"),
            read("SYNO.ActiveBackup.Overview", 1, "list_device"),
        ],
        "security" => vec![
            read("SYNO.Core.SecurityScan.Status", 1, "system_get"),
            read("SYNO.Core.Security.AutoBlock", 1, "get"),
            read("SYNO.Core.Security.AutoBlock.Rules", 1, "list"),
            read("SYNO.Core.Certificate.CRT", 1, "list"),
        ],
        "hardware" => vec![
            read("SYNO.Core.Hardware.Info", 1, "get"),
            read("SYNO.DSM.Info", 2, "getinfo"),
            read("SYNO.Core.ExternalDevice.UPS", 1, "get"),
            read("SYNO.Core.Hardware.PowerSchedule", 1, "load"),
        ],
        "logs" => vec![
            page("SYNO.Core.SyslogClient.Log", 1, "list"),
            page("SYNO.Core.CurrentConnection", 2, "list"),
        ],
        "notifications" => vec![read("SYNO.Core.Notification.Setting", 1, "get")],
        _ => return None,
    })
}

fn snapshot(section: &str, status: SectionAccessStatus) -> SectionAccessSnapshot {
    let reason = match status {
        SectionAccessStatus::Available => "At least one read is available. Other reads and changes may require additional permissions.",
        SectionAccessStatus::Denied => "This API session was denied access to the available section reads. Review the account's DSM application permissions.",
        SectionAccessStatus::Unavailable => "This NAS does not provide a supported read API for this section. Its package or firmware may not support it.",
        SectionAccessStatus::Unknown => "Access could not be confirmed. A network, timeout, or compatibility issue is not a permission denial; retry explicitly.",
    };
    SectionAccessSnapshot {
        section: section.to_owned(),
        status,
        reason: reason.to_owned(),
    }
}

impl SectionAccessContext {
    fn assert_active(&self) -> SynologyResult<()> {
        if self.lease.active.load(Ordering::Acquire) {
            Ok(())
        } else {
            Err(SynologyError::session_expired(
                "NAS session ended during section access discovery; reconnect before continuing",
            ))
        }
    }
    fn expire(&self) -> SynologyError {
        self.lease.active.store(false, Ordering::Release);
        self.lease.cancelled.notify_waiters();
        SynologyError::session_expired("NAS rejected this API session during section access discovery; reconnect before continuing")
    }
    pub async fn probe(&self, section: &str) -> SynologyResult<SectionAccessSnapshot> {
        self.probe_bounded(section, Duration::from_secs(5), Duration::from_secs(3))
            .await
    }
    async fn probe_bounded(
        &self,
        section: &str,
        total: Duration,
        per_read: Duration,
    ) -> SynologyResult<SectionAccessSnapshot> {
        self.assert_active()?;
        let probes =
            probes(section).ok_or_else(|| SynologyError::parse("Unknown Synology section"))?;
        let deadline = tokio::time::Instant::now() + total;
        let mut denied = false;
        let mut unknown = false;
        for probe in probes {
            self.assert_active()?;
            let Some(version) = self.lease.client.best_version(probe.api, probe.max_version) else {
                continue;
            };
            let Some(remaining) = deadline.checked_duration_since(tokio::time::Instant::now())
            else {
                unknown = true;
                break;
            };
            let cancelled = self.lease.cancelled.notified();
            tokio::pin!(cancelled);
            cancelled.as_mut().enable();
            self.assert_active()?;
            let request = async {
                if probe.api == "SYNO.FileStation.Info" {
                    self.lease
                        .client
                        .file_call(probe.api, probe.max_version, probe.method, &[])
                        .await
                } else {
                    self.lease
                        .client
                        .post_value(probe.api, version, probe.method, probe.params)
                        .await
                }
            };
            let result = tokio::select! {
                biased;
                _ = &mut cancelled => return Err(self.expire()),
                result = tokio::time::timeout(per_read.min(remaining), request) => result,
            };
            self.assert_active()?;
            match result {
                Ok(Ok(value)) if value.is_object() || value.is_array() => {
                    return Ok(snapshot(section, SectionAccessStatus::Available))
                }
                Ok(Err(error)) => match error.kind {
                    SynologyErrorKind::SessionExpired
                    | SynologyErrorKind::ApiError(106 | 107 | 119 | 150) => {
                        return Err(self.expire())
                    }
                    SynologyErrorKind::PermissionDenied | SynologyErrorKind::ApiError(105) => {
                        denied = true
                    }
                    SynologyErrorKind::ApiNotFound
                    | SynologyErrorKind::VersionNotSupported
                    | SynologyErrorKind::ApiError(102..=104) => {}
                    _ => unknown = true,
                },
                _ => unknown = true,
            }
        }
        self.assert_active()?;
        Ok(snapshot(
            section,
            if unknown {
                SectionAccessStatus::Unknown
            } else if denied {
                SectionAccessStatus::Denied
            } else {
                SectionAccessStatus::Unavailable
            },
        ))
    }
}

#[cfg(test)]
#[path = "section_access_tests.rs"]
mod tests;
