//! Integration coverage for the virtual-channel registry (e1) that feeds the
//! lifecycle channel summary. These tests exercise the public
//! `VirtualChannelRegistry` surface end-to-end: registration, duplicate
//! rejection, disabled accounting, ready/fault transitions, message counters,
//! and the enabled/ready/failed `ChannelSummary` projection that the runner
//! merges into every lifecycle snapshot (including the CLIPRDR/AUDIN merge L1
//! added). Deterministic and host-independent — no live RDP server.

use sorng_rdp::rdp::session_state::ChannelSummary;
use sorng_rdp::rdp::virtual_channels::{
    VirtualChannelDescriptor, VirtualChannelKind, VirtualChannelPriority,
    VirtualChannelRegistry, VirtualChannelRegistryError, VirtualChannelState,
};

fn descriptor(name: &str, enabled: bool) -> VirtualChannelDescriptor {
    VirtualChannelDescriptor::new(
        name,
        VirtualChannelKind::Static,
        VirtualChannelPriority::Normal,
        enabled,
    )
}

/// A realistic RDP channel set (RDPDR/RDPSND/CLIPRDR/AUDIN) registered with the
/// states the runner observes; the summary it feeds the lifecycle snapshot must
/// count enabled, ready, and failed channels exactly.
#[test]
fn summary_accounts_enabled_ready_and_failed_channels() {
    let mut registry = VirtualChannelRegistry::new();
    registry
        .register(descriptor("rdpdr", true).ready())
        .unwrap();
    registry
        .register(descriptor("rdpsnd", true).ready())
        .unwrap();
    // CLIPRDR registered but not yet ready (handshake pending).
    registry.register(descriptor("cliprdr", true)).unwrap();
    // AUDIN faulted (channel-level fault, isolated from the session).
    registry
        .register(descriptor("audin", true).faulted("channel_fault"))
        .unwrap();
    // GFX disabled by settings — must not count as enabled.
    registry.register(descriptor("rdpgfx", false)).unwrap();

    let summary = registry.summary();

    assert_eq!(
        summary,
        ChannelSummary {
            enabled_count: 4,
            ready_count: 2,
            failed_count: 1,
        }
    );
}

/// An empty registry projects a zeroed summary — the lifecycle snapshot before
/// any channel negotiation begins.
#[test]
fn empty_registry_projects_zeroed_summary() {
    let registry = VirtualChannelRegistry::new();
    assert_eq!(registry.summary(), ChannelSummary::default());
    assert!(registry.diagnostics().is_empty());
}

/// Disabled channels are tracked but excluded from the enabled count, so a
/// settings-gated channel never inflates the lifecycle summary.
#[test]
fn disabled_channels_are_tracked_but_not_counted_as_enabled() {
    let mut registry = VirtualChannelRegistry::new();
    registry.register(descriptor("rdpdr", true).ready()).unwrap();
    registry.register(descriptor("cliprdr", false)).unwrap();
    registry.register(descriptor("audin", false)).unwrap();

    let summary = registry.summary();
    assert_eq!(summary.enabled_count, 1);
    assert_eq!(summary.ready_count, 1);
    assert_eq!(summary.failed_count, 0);

    // All three are still surfaced in diagnostics for the panel.
    assert_eq!(registry.diagnostics().len(), 3);
}

/// Duplicate registration is rejected case-insensitively (channel names arrive
/// from negotiation in inconsistent casing). The first registration wins.
#[test]
fn duplicate_registration_is_rejected_case_insensitively() {
    let mut registry = VirtualChannelRegistry::new();
    registry.register(descriptor("CLIPRDR", true).ready()).unwrap();

    let error = registry.register(descriptor("cliprdr", true)).unwrap_err();
    assert_eq!(
        error,
        VirtualChannelRegistryError::DuplicateChannel("cliprdr".to_string())
    );

    // The original ready channel is untouched.
    let summary = registry.summary();
    assert_eq!(summary.enabled_count, 1);
    assert_eq!(summary.ready_count, 1);
}

/// A registered channel can be driven Registered -> Negotiating -> Ready and the
/// summary reflects readiness only at the Ready terminal of that path.
#[test]
fn state_progression_drives_ready_accounting() {
    let mut registry = VirtualChannelRegistry::new();
    registry.register(descriptor("rdpdr", true)).unwrap();

    assert_eq!(registry.summary().ready_count, 0);

    registry
        .set_state("rdpdr", VirtualChannelState::Negotiating)
        .unwrap();
    assert_eq!(registry.summary().ready_count, 0);
    assert_eq!(registry.summary().enabled_count, 1);

    registry
        .set_state("rdpdr", VirtualChannelState::Ready)
        .unwrap();
    let summary = registry.summary();
    assert_eq!(summary.ready_count, 1);
    assert_eq!(summary.failed_count, 0);
}

/// A fault on one channel isolates to that channel's failed count and records the
/// error class; sibling channels keep their ready/enabled accounting. This is the
/// channel-level fault isolation the lifecycle "channels_recovering" substate
/// relies on.
#[test]
fn fault_isolation_only_affects_the_faulted_channel() {
    let mut registry = VirtualChannelRegistry::new();
    registry.register(descriptor("rdpdr", true).ready()).unwrap();
    registry.register(descriptor("cliprdr", true).ready()).unwrap();
    registry.register(descriptor("audin", true).ready()).unwrap();

    registry
        .mark_faulted("cliprdr", "protocol_violation")
        .unwrap();

    let summary = registry.summary();
    // 3 enabled, 2 still ready (rdpdr + audin), 1 failed (cliprdr).
    assert_eq!(summary.enabled_count, 3);
    assert_eq!(summary.ready_count, 2);
    assert_eq!(summary.failed_count, 1);

    let cliprdr = registry
        .diagnostics()
        .into_iter()
        .find(|d| d.name == "cliprdr")
        .expect("cliprdr present");
    assert_eq!(cliprdr.state, VirtualChannelState::Faulted);
    assert_eq!(cliprdr.last_error_class.as_deref(), Some("protocol_violation"));
}

/// Recovering a faulted channel (set back to Ready) clears the error class and
/// removes it from the failed count — mirrors the ChannelRecovered lifecycle path.
#[test]
fn recovering_a_faulted_channel_clears_failed_accounting() {
    let mut registry = VirtualChannelRegistry::new();
    registry.register(descriptor("rdpdr", true).ready()).unwrap();
    registry.mark_faulted("rdpdr", "channel_fault").unwrap();
    assert_eq!(registry.summary().failed_count, 1);

    registry
        .set_state("rdpdr", VirtualChannelState::Ready)
        .unwrap();

    let summary = registry.summary();
    assert_eq!(summary.failed_count, 0);
    assert_eq!(summary.ready_count, 1);

    let rdpdr = registry
        .diagnostics()
        .into_iter()
        .find(|d| d.name == "rdpdr")
        .unwrap();
    assert_eq!(rdpdr.last_error_class, None);
}

/// Message counters accumulate per channel and saturate without panicking; they
/// are independent of the channel state accounting.
#[test]
fn message_counters_accumulate_independently_of_state() {
    let mut registry = VirtualChannelRegistry::new();
    registry.register(descriptor("rdpdr", true).ready()).unwrap();

    for _ in 0..5 {
        registry.record_received("RDPDR").unwrap();
    }
    registry.record_sent("rdpdr").unwrap();
    registry.record_sent("rdpdr").unwrap();

    let rdpdr = registry.diagnostics().into_iter().next().unwrap();
    assert_eq!(rdpdr.messages_received, 5);
    assert_eq!(rdpdr.messages_sent, 2);

    // Counters do not affect the ready/enabled summary.
    let summary = registry.summary();
    assert_eq!(summary.ready_count, 1);
    assert_eq!(summary.enabled_count, 1);
}

/// Updates to an unregistered channel are rejected rather than silently
/// creating phantom channels — the registry is the single source of truth.
#[test]
fn updates_to_unknown_channels_are_rejected() {
    let mut registry = VirtualChannelRegistry::new();

    assert_eq!(
        registry
            .set_state("missing", VirtualChannelState::Ready)
            .unwrap_err(),
        VirtualChannelRegistryError::UnknownChannel("missing".to_string())
    );
    assert_eq!(
        registry.record_received("missing").unwrap_err(),
        VirtualChannelRegistryError::UnknownChannel("missing".to_string())
    );
    assert_eq!(
        registry.mark_faulted("missing", "x").unwrap_err(),
        VirtualChannelRegistryError::UnknownChannel("missing".to_string())
    );
}

/// Diagnostics are emitted in a stable (name-sorted) order regardless of
/// registration order, so the panel/snapshot rendering is deterministic.
#[test]
fn diagnostics_order_is_deterministic() {
    let mut registry = VirtualChannelRegistry::new();
    registry.register(descriptor("rdpsnd", true)).unwrap();
    registry.register(descriptor("audin", true)).unwrap();
    registry.register(descriptor("cliprdr", true)).unwrap();
    registry.register(descriptor("rdpdr", true)).unwrap();

    let names: Vec<String> = registry
        .diagnostics()
        .into_iter()
        .map(|d| d.name)
        .collect();

    assert_eq!(names, vec!["audin", "cliprdr", "rdpdr", "rdpsnd"]);
}

/// The summary projects into JSON with the camelCase wire keys the frontend
/// lifecycle snapshot consumes, and carries no channel names/payloads.
#[test]
fn channel_summary_serializes_with_wire_keys_and_no_payload() {
    let mut registry = VirtualChannelRegistry::new();
    registry
        .register(descriptor("rdpdr", true).ready())
        .unwrap();
    registry
        .register(descriptor("cliprdr", true).faulted("protocol_violation"))
        .unwrap();

    let encoded = serde_json::to_string(&registry.summary()).unwrap();

    assert!(encoded.contains("enabledCount"));
    assert!(encoded.contains("readyCount"));
    assert!(encoded.contains("failedCount"));
    // The aggregate summary must not leak channel names or error classes.
    assert!(!encoded.contains("cliprdr"));
    assert!(!encoded.contains("protocol_violation"));
}
