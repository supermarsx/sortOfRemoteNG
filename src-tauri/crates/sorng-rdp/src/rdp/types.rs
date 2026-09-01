use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use super::frame_channel::{DynFrameChannel, FrameDeliveryCredits};
use super::session_state::SessionStateSnapshot;
use super::wake_channel::WakeSender;
use crate::ironrdp::pdu::input::fast_path::FastPathInputEvent;
use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use super::cert_trust::ServerCertValidationMode;
use super::network::{build_credssp_http_client, build_tls_config};
use super::session_runtime::{RdpWorkerGeneration, RdpWorkerRuntime};
use super::stats::RdpSessionStats;

// ---- Events emitted to the frontend ----
// Frame pixel data is pushed via FrameChannel (binary ArrayBuffer) --
// no JSON event for frames.  Status/pointer/stats still use emit().

#[derive(Clone, Serialize)]
pub struct RdpStatusEvent {
    pub session_id: String,
    pub status: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desktop_width: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desktop_height: Option<u16>,
}

#[derive(Clone, Serialize)]
pub struct RdpPointerEvent {
    pub session_id: String,
    pub pointer_type: &'static str, // "default", "hidden", "position", "bitmap"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<u16>,
    /// Base64-encoded RGBA bitmap data (only for pointer_type="bitmap")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bitmap_rgba: Option<String>,
    /// Cursor bitmap width in pixels
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bitmap_width: Option<u16>,
    /// Cursor bitmap height in pixels
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bitmap_height: Option<u16>,
    /// Cursor hotspot X offset
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hotspot_x: Option<u16>,
    /// Cursor hotspot Y offset
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hotspot_y: Option<u16>,
}

#[derive(Clone, Serialize)]
pub struct RdpStatsEvent {
    pub session_id: String,
    pub uptime_secs: u64,
    pub bytes_received: u64,
    pub bytes_sent: u64,
    pub pdus_received: u64,
    pub pdus_sent: u64,
    pub frame_count: u64,
    pub fps: f64,
    pub input_events: u64,
    pub errors_recovered: u64,
    pub reactivations: u64,
    pub phase: String,
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifecycle: Option<SessionStateSnapshot>,
    /// RDPGFX Tier-B graphics-pipeline diagnostics (codec/cap/surfaces/frames/
    /// acks/errors). `None` when GFX is disabled. Serializes as a `gfx` object
    /// with camelCase keys for the panel's Graphics row.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gfx: Option<crate::gfx::processor::GfxDiagnostics>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpFrameTelemetryEvent {
    pub session_id: String,
    pub queued_frames: u16,
    pub dropped_frames: u64,
    pub coalesced_frames: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub average_render_ms: Option<f64>,
}

// ---- Input events from the frontend ----

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum RdpInputAction {
    MouseMove {
        x: u16,
        y: u16,
    },
    MouseButton {
        x: u16,
        y: u16,
        button: u8,
        pressed: bool,
    },
    KeyboardKey {
        scancode: u16,
        pressed: bool,
        extended: bool,
    },
    Wheel {
        x: u16,
        y: u16,
        delta: i16,
        horizontal: bool,
    },
    Unicode {
        code: u16,
        pressed: bool,
    },
}

// ---- Session and service types ----

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpSession {
    pub id: String,
    /// Stable frontend connection ID used for lifecycle management.
    /// Multiple `connect_rdp` invocations with the same `connection_id`
    /// automatically evict any previous session for that slot.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connected: bool,
    pub desktop_width: u16,
    pub desktop_height: u16,
    /// SHA-256 fingerprint of the server's TLS certificate (hex)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_cert_fingerprint: Option<String>,
    /// Whether a frontend viewer is currently attached (receiving frames).
    pub viewer_attached: bool,
    /// Number of automatic reconnections performed during this session's lifetime.
    #[serde(default)]
    pub reconnect_count: u32,
    /// Whether the session is currently attempting to reconnect.
    #[serde(default)]
    pub reconnecting: bool,
}

/// Authoritative result for one generation-aware frontend activity update.
///
/// A replacement viewer may start its local counter below `applied_generation`.
/// When `stale` is true, the frontend should adopt this result and, when its
/// desired state differs from `active`, retry exactly once using
/// `applied_generation + 1`. An unmounted viewer must stop producing updates;
/// any already queued lower/equal generations are ignored by the native loop.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RdpSessionActivityResult {
    pub session_id: String,
    pub requested_generation: u64,
    pub applied_generation: u64,
    /// Authoritative desired output state used for stale-viewer correction.
    /// The internal delivery gate may remain closed while the transport
    /// applies this state; protocol action flags report that separately.
    pub active: bool,
    pub applied: bool,
    pub stale: bool,
    pub suppress_output_supported: bool,
    pub refresh_rectangle_supported: bool,
    pub suppress_output_sent: bool,
    pub allow_display_updates_sent: bool,
    pub refresh_rectangle_sent: bool,
}

/// Largest integer that can make a lossless round trip through a JavaScript
/// `number`. Activity generations are part of the Tauri JSON boundary, so the
/// native authority must never advance beyond this value.
pub const RDP_ACTIVITY_MAX_SAFE_GENERATION: u64 = 9_007_199_254_740_991;

/// Each viewer owns one explicit JS-safe generation epoch. A replacement
/// attach advances to the next boundary, making every generation that the
/// prior viewer was allowed to issue lower than the native watermark. One
/// epoch permits over one million activity transitions before reconnect is
/// required.
pub const RDP_ACTIVITY_GENERATION_EPOCH_STRIDE: u64 = 1 << 20;

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub struct RdpSessionActivitySnapshot {
    pub applied_generation: u64,
    pub desired_active: bool,
    pub output_active: bool,
    pub suppress_output_supported: bool,
    pub refresh_rectangle_supported: bool,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
struct RdpSessionActivityAuthority {
    applied_generation: u64,
    generation_epoch_ceiling: u64,
    desired_active: bool,
    suppress_output_supported: bool,
    refresh_rectangle_supported: bool,
    suppress_output_sent: bool,
    allow_display_updates_sent: bool,
    refresh_rectangle_sent: bool,
}

impl Default for RdpSessionActivityAuthority {
    fn default() -> Self {
        Self {
            applied_generation: 0,
            generation_epoch_ceiling: RDP_ACTIVITY_GENERATION_EPOCH_STRIDE - 1,
            desired_active: true,
            suppress_output_supported: false,
            refresh_rectangle_supported: false,
            suppress_output_sent: false,
            allow_display_updates_sent: false,
            refresh_rectangle_sent: false,
        }
    }
}

/// Per-native-session activity authority shared by the async Tauri command
/// surface and the blocking transport worker. Requests are acknowledged here
/// immediately; the worker observes the snapshot and applies it to each new
/// transport before it permits frame delivery.
#[derive(Debug)]
pub struct RdpSessionActivityControl {
    inner: Mutex<RdpSessionActivityAuthority>,
    // Read on every output-delivery path. Inactive requests close this gate
    // synchronously; active requests leave it closed until the session thread
    // successfully sends AllowDisplayUpdates/RefreshRectangle as negotiated.
    output_active: AtomicBool,
}

pub type SharedRdpSessionActivityControl = Arc<RdpSessionActivityControl>;

impl Default for RdpSessionActivityControl {
    fn default() -> Self {
        Self {
            inner: Mutex::new(RdpSessionActivityAuthority::default()),
            output_active: AtomicBool::new(true),
        }
    }
}

impl RdpSessionActivityControl {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, RdpSessionActivityAuthority>, String> {
        self.inner
            .lock()
            .map_err(|_| "RDP activity authority lock is poisoned".to_string())
    }

    pub fn snapshot(&self) -> Result<RdpSessionActivitySnapshot, String> {
        let state = self.lock()?;
        Ok(RdpSessionActivitySnapshot {
            applied_generation: state.applied_generation,
            desired_active: state.desired_active,
            output_active: self.output_active.load(Ordering::Acquire),
            suppress_output_supported: state.suppress_output_supported,
            refresh_rectangle_supported: state.refresh_rectangle_supported,
        })
    }

    pub fn request(
        &self,
        session_id: &str,
        generation: u64,
        active: bool,
    ) -> Result<RdpSessionActivityResult, String> {
        if generation == 0 || generation > RDP_ACTIVITY_MAX_SAFE_GENERATION {
            return Err(format!(
                "RDP activity generation must be between 1 and {RDP_ACTIVITY_MAX_SAFE_GENERATION}"
            ));
        }

        let mut state = self.lock()?;
        if generation > state.generation_epoch_ceiling {
            return Err(format!(
                "RDP activity generation {generation} exceeds the current viewer epoch ceiling {}",
                state.generation_epoch_ceiling
            ));
        }
        let applied = generation > state.applied_generation;
        if applied {
            state.applied_generation = generation;
            state.desired_active = active;
            state.suppress_output_sent = false;
            state.allow_display_updates_sent = false;
            state.refresh_rectangle_sent = false;
            self.output_active.store(false, Ordering::Release);
        }
        Ok(RdpSessionActivityResult {
            session_id: session_id.to_string(),
            requested_generation: generation,
            applied_generation: state.applied_generation,
            active: state.desired_active,
            applied,
            stale: !applied,
            suppress_output_supported: state.suppress_output_supported,
            refresh_rectangle_supported: state.refresh_rectangle_supported,
            suppress_output_sent: state.suppress_output_sent,
            allow_display_updates_sent: state.allow_display_updates_sent,
            refresh_rectangle_sent: state.refresh_rectangle_sent,
        })
    }

    /// Fence every generation in the previous viewer epoch without changing
    /// desired or effective activity. The new epoch always reserves enough
    /// JS-safe values for the replacement viewer's stale correction.
    pub fn fence_for_viewer_attach(&self) -> Result<u64, String> {
        let mut state = self.lock()?;
        let current_epoch = state.applied_generation / RDP_ACTIVITY_GENERATION_EPOCH_STRIDE;
        let next_epoch = current_epoch.checked_add(1).ok_or_else(|| {
            "RDP activity generation epoch overflow; reconnect the native session".to_string()
        })?;
        let next_floor = next_epoch
            .checked_mul(RDP_ACTIVITY_GENERATION_EPOCH_STRIDE)
            .ok_or_else(|| {
                "RDP activity generation epoch overflow; reconnect the native session".to_string()
            })?;
        let next_ceiling = next_floor
            .checked_add(RDP_ACTIVITY_GENERATION_EPOCH_STRIDE - 1)
            .filter(|ceiling| *ceiling <= RDP_ACTIVITY_MAX_SAFE_GENERATION)
            .ok_or_else(|| {
                "RDP activity generation space exhausted; reconnect the native session".to_string()
            })?;

        state.applied_generation = next_floor;
        state.generation_epoch_ceiling = next_ceiling;
        state.suppress_output_sent = false;
        state.allow_display_updates_sent = false;
        state.refresh_rectangle_sent = false;
        // The fence is a new authority revision. Delivery remains closed until
        // the session worker has reconciled that revision on the transport.
        self.output_active.store(false, Ordering::Release);
        Ok(state.applied_generation)
    }

    pub fn output_enabled(&self) -> bool {
        self.output_active.load(Ordering::Acquire)
    }

    /// Close delivery before a new transport/reactivation is synchronized.
    pub fn begin_transport_reconcile(&self) {
        self.output_active.store(false, Ordering::Release);
    }

    /// Publish protocol completion only if no newer activity revision arrived
    /// while the session thread was writing the negotiated PDUs.
    pub fn complete_transport_apply(
        &self,
        applied_generation: u64,
        desired_active: bool,
        suppress_output_sent: bool,
        allow_display_updates_sent: bool,
        refresh_rectangle_sent: bool,
    ) -> Result<bool, String> {
        let mut state = self.lock()?;
        if state.applied_generation != applied_generation || state.desired_active != desired_active
        {
            return Ok(false);
        }
        state.suppress_output_sent = suppress_output_sent;
        state.allow_display_updates_sent = allow_display_updates_sent;
        state.refresh_rectangle_sent = refresh_rectangle_sent;
        self.output_active.store(desired_active, Ordering::Release);
        Ok(true)
    }

    pub fn update_capabilities(
        &self,
        suppress_output_supported: bool,
        refresh_rectangle_supported: bool,
    ) -> Result<(), String> {
        let mut state = self.lock()?;
        state.suppress_output_supported = suppress_output_supported;
        state.refresh_rectangle_supported = refresh_rectangle_supported;
        Ok(())
    }
}

#[cfg(test)]
mod activity_control_tests {
    use super::*;

    #[test]
    fn activity_authority_acknowledges_desired_state_before_protocol_completion() {
        let control = RdpSessionActivityControl::default();
        control
            .update_capabilities(true, true)
            .expect("capabilities");

        let inactive = control.request("session", 1, false).expect("inactive");
        assert!(inactive.applied);
        assert!(!inactive.active);
        assert!(!inactive.suppress_output_sent);
        assert!(!inactive.allow_display_updates_sent);
        assert!(!inactive.refresh_rectangle_sent);
        assert!(!control.output_enabled());

        assert!(control
            .complete_transport_apply(1, false, true, false, false)
            .expect("publish inactive"));
        let inactive_duplicate = control.request("session", 1, true).expect("duplicate");
        assert!(inactive_duplicate.stale);
        assert!(!inactive_duplicate.active);
        assert!(inactive_duplicate.suppress_output_sent);

        let active = control.request("session", 2, true).expect("active");
        assert!(active.applied);
        assert!(active.active);
        assert!(!active.allow_display_updates_sent);
        assert!(!active.refresh_rectangle_sent);
        assert!(!control.output_enabled());

        assert!(control
            .complete_transport_apply(2, true, false, true, true)
            .expect("publish active"));
        assert!(control.output_enabled());
        let stale = control.request("session", 1, false).expect("stale request");
        assert!(stale.stale);
        assert!(stale.active);
        assert!(stale.allow_display_updates_sent);
        assert!(stale.refresh_rectangle_sent);
    }

    #[test]
    fn attach_epoch_fences_old_updates_before_and_after_replacement_correction() {
        let control = RdpSessionActivityControl::default();
        control.request("session", 10, false).expect("old inactive");

        let first_floor = control.fence_for_viewer_attach().expect("first fence");
        assert_eq!(first_floor, RDP_ACTIVITY_GENERATION_EPOCH_STRIDE);
        assert!(!control.output_enabled());

        // In-flight and final updates from the old epoch can arrive before the
        // replacement's first/corrective requests without changing authority.
        for old_generation in [11, 12, 12] {
            let old = control
                .request("session", old_generation, false)
                .expect("old request is within its historical epoch");
            assert!(old.stale);
            assert!(!old.active);
            assert_eq!(old.applied_generation, first_floor);
        }

        let replacement_initial = control
            .request("session", 1, true)
            .expect("initial request");
        assert!(replacement_initial.stale);
        assert!(!replacement_initial.active);
        let replacement_generation = replacement_initial.applied_generation + 1;
        let replacement = control
            .request("session", replacement_generation, true)
            .expect("replacement correction");
        assert!(replacement.applied);
        assert!(replacement.active);

        // The reverse ordering is safe too: delayed old updates after the new
        // correction remain stale, including equal/duplicate generations.
        for old_generation in [13, 13, 14] {
            let old = control
                .request("session", old_generation, false)
                .expect("delayed old request");
            assert!(old.stale);
            assert!(old.active);
            assert_eq!(old.applied_generation, replacement_generation);
        }

        let second_floor = control.fence_for_viewer_attach().expect("second fence");
        assert_eq!(second_floor, 2 * RDP_ACTIVITY_GENERATION_EPOCH_STRIDE);
        assert!(second_floor <= RDP_ACTIVITY_MAX_SAFE_GENERATION);
    }

    #[test]
    fn requests_above_current_viewer_epoch_fail_closed() {
        let control = RdpSessionActivityControl::default();
        let error = control
            .request("session", RDP_ACTIVITY_GENERATION_EPOCH_STRIDE, false)
            .expect_err("epoch escape must fail");
        assert!(error.contains("epoch ceiling"));
        let snapshot = control.snapshot().expect("snapshot");
        assert_eq!(snapshot.applied_generation, 0);
        assert!(snapshot.desired_active);
        assert!(snapshot.output_active);
    }

    #[test]
    fn epoch_exhaustion_does_not_mutate_authority_or_gate() {
        let control = RdpSessionActivityControl::default();
        let last_epoch_floor =
            RDP_ACTIVITY_MAX_SAFE_GENERATION - (RDP_ACTIVITY_GENERATION_EPOCH_STRIDE - 1);
        {
            let mut state = control.inner.lock().expect("authority lock");
            state.applied_generation = last_epoch_floor;
            state.generation_epoch_ceiling = RDP_ACTIVITY_MAX_SAFE_GENERATION;
            state.desired_active = false;
            state.suppress_output_sent = true;
        }
        control.output_active.store(false, Ordering::Release);
        let before = *control.inner.lock().expect("authority before");
        let error = control
            .fence_for_viewer_attach()
            .expect_err("generation space must be exhausted");
        assert!(error.contains("generation space exhausted"));
        assert_eq!(*control.inner.lock().expect("authority after"), before);
        assert!(!control.output_enabled());
    }
}

pub enum RdpCommand {
    Input(Vec<FastPathInputEvent>),
    Shutdown,
    /// Attach a new frame channel viewer (for session persistence).
    AttachViewer(DynFrameChannel),
    /// Detach the current viewer without killing the session.
    DetachViewer,
    /// Wake the blocking worker after the shared activity authority changes.
    /// The desired state and generation live outside this bounded command queue
    /// so they remain authoritative through handshake and reconnect backoff.
    ActivityChanged,
    /// Send a graceful sign-out / logoff to the remote session.
    SignOut,
    /// Force reboot the remote machine.
    ForceReboot,
    /// Trigger a manual reconnect — drops the current TCP connection and
    /// re-establishes TCP + TLS + CredSSP from scratch.
    Reconnect,
    /// Advertise local clipboard text to the remote server (CF_UNICODETEXT).
    ClipboardCopy(String),
    /// Request clipboard text from the remote server.
    ClipboardPaste,
    /// Stage local files for CLIPRDR file transfer and advertise FileGroupDescriptorW.
    ClipboardCopyFiles(Vec<ClipboardFileEntry>),
    /// Toggle a session feature on/off at runtime.
    ToggleFeature {
        feature: String,
        enabled: bool,
    },
    /// Request a dynamic desktop resize via the Display Control DVC.
    SetDesktopSize {
        width: u16,
        height: u16,
    },
}

/// File entry for clipboard file transfer.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ClipboardFileEntry {
    pub name: String,
    pub size: u64,
    pub path: String,
    #[serde(default)]
    pub is_directory: bool,
}

pub struct RdpActiveConnection {
    pub session: RdpSession,
    pub cmd_tx: WakeSender,
    /// Currently authoritative viewer channel. The process-global delivery
    /// ledger remains independent so acknowledgements from replaced viewers
    /// can still release their exact retained bodies.
    pub frame_channel: DynFrameChannel,
    pub activity_control: SharedRdpSessionActivityControl,
    pub stats: Arc<RdpSessionStats>,
    pub worker: RdpWorkerRuntime,
    /// Cached password for automatic reconnection (CredSSP re-auth).
    #[allow(dead_code)]
    pub cached_password: SecretString,
    /// Cached domain for automatic reconnection.
    #[allow(dead_code)]
    pub cached_domain: Option<String>,
}

/// A single RDP log entry stored in the ring buffer.
#[derive(Clone, Serialize)]
pub struct RdpLogEntry {
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub level: String,
    pub message: String,
}

pub struct RdpService {
    pub connections: HashMap<String, RdpActiveConnection>,
    /// One process-global ledger bounds retained raw IPC bodies across every
    /// RDP session and across viewer replacements.
    pub frame_delivery_credits: Arc<FrameDeliveryCredits>,
    /// Counts both active sessions and connect calls that have passed
    /// admission but have not yet been inserted into `connections`.
    pub session_slots: Arc<Semaphore>,
    next_worker_generation: RdpWorkerGeneration,
    /// Cached TLS connector -- built once, reused for every connection.
    /// Building a TLS connector loads the system root certificate store which
    /// is very expensive on Windows (200-500 ms).  Caching it avoids paying that
    /// cost on every connection.
    pub cached_tls_connector: Option<super::RdpTlsConfig>,
    /// Cached reqwest blocking client for CredSSP/Kerberos HTTP requests.
    /// Has a short connect + request timeout so it doesn't hang waiting for an
    /// unreachable KDC.
    pub cached_http_client: Option<Arc<reqwest::blocking::Client>>,
    /// Ring buffer of the last 1000 RDP log entries (VecDeque for O(1) pop_front).
    pub log_buffer: VecDeque<RdpLogEntry>,
}

/// A conservative process-wide ceiling for resource-heavy RDP session
/// workers. Each admitted worker owns one permit before it is spawned and
/// until its blocking closure has actually exited.
pub const MAX_RDP_ACTIVE_OR_PENDING_SESSIONS: usize = 16;

impl RdpService {
    pub fn new() -> super::RdpServiceState {
        // Pre-build the TLS connector and HTTP client eagerly so the first
        // connection doesn't pay the initialisation cost.
        let tls_connector = build_tls_config(true).ok();

        let http_client = build_credssp_http_client(ServerCertValidationMode::Validate)
            .ok()
            .map(Arc::new);

        Arc::new(tokio::sync::Mutex::new(RdpService {
            connections: HashMap::new(),
            frame_delivery_credits: Arc::new(FrameDeliveryCredits::new()),
            session_slots: Arc::new(Semaphore::new(MAX_RDP_ACTIVE_OR_PENDING_SESSIONS)),
            next_worker_generation: 1,
            cached_tls_connector: tls_connector,
            cached_http_client: http_client,
            log_buffer: VecDeque::with_capacity(1024),
        }))
    }

    /// Reserve one active-or-pending session slot without waiting. The owned
    /// permit automatically returns to the pool on every startup error.
    pub fn try_reserve_session_slot(&self) -> Result<OwnedSemaphorePermit, String> {
        Arc::clone(&self.session_slots)
            .try_acquire_owned()
            .map_err(|_| {
                format!(
                    "RDP session limit reached (maximum {} active or starting sessions)",
                    MAX_RDP_ACTIVE_OR_PENDING_SESSIONS
                )
            })
    }

    pub fn allocate_worker_generation(&mut self) -> RdpWorkerGeneration {
        let generation = self.next_worker_generation;
        self.next_worker_generation = self.next_worker_generation.wrapping_add(1);
        if self.next_worker_generation == 0 {
            self.next_worker_generation = 1;
        }
        generation
    }

    #[cfg(test)]
    pub(crate) fn new_test_state(capacity: usize) -> super::RdpServiceState {
        Arc::new(tokio::sync::Mutex::new(RdpService {
            connections: HashMap::new(),
            frame_delivery_credits: Arc::new(FrameDeliveryCredits::new()),
            session_slots: Arc::new(Semaphore::new(capacity)),
            next_worker_generation: 1,
            cached_tls_connector: None,
            cached_http_client: None,
            log_buffer: VecDeque::with_capacity(16),
        }))
    }

    /// Push a log entry into the ring buffer (capped at 1000).
    pub fn push_log(&mut self, level: &str, message: String, session_id: Option<String>) {
        let entry = RdpLogEntry {
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            session_id,
            level: level.to_string(),
            message,
        };
        self.log_buffer.push_back(entry);
        while self.log_buffer.len() > 1000 {
            self.log_buffer.pop_front();
        }
    }
}
