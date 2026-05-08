use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::session_state::ChannelSummary;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VirtualChannelKind {
    Static,
    Dynamic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VirtualChannelPriority {
    Critical,
    High,
    Normal,
    Low,
    Optional,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VirtualChannelState {
    Disabled,
    Registered,
    Negotiating,
    Ready,
    Suspended,
    Faulted,
}

impl VirtualChannelState {
    pub fn is_enabled(self) -> bool {
        !matches!(self, Self::Disabled)
    }

    pub fn is_ready(self) -> bool {
        matches!(self, Self::Ready)
    }

    pub fn is_failed(self) -> bool {
        matches!(self, Self::Faulted)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualChannelDescriptor {
    pub name: String,
    pub kind: VirtualChannelKind,
    pub priority: VirtualChannelPriority,
    pub state: VirtualChannelState,
    pub messages_received: u64,
    pub messages_sent: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error_class: Option<String>,
}

impl VirtualChannelDescriptor {
    pub fn new(
        name: impl Into<String>,
        kind: VirtualChannelKind,
        priority: VirtualChannelPriority,
        enabled: bool,
    ) -> Self {
        Self {
            name: name.into(),
            kind,
            priority,
            state: if enabled {
                VirtualChannelState::Registered
            } else {
                VirtualChannelState::Disabled
            },
            messages_received: 0,
            messages_sent: 0,
            last_error_class: None,
        }
    }

    pub fn ready(mut self) -> Self {
        self.state = VirtualChannelState::Ready;
        self
    }

    pub fn faulted(mut self, class: impl Into<String>) -> Self {
        self.state = VirtualChannelState::Faulted;
        self.last_error_class = Some(class.into());
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VirtualChannelRegistryError {
    DuplicateChannel(String),
    UnknownChannel(String),
}

#[derive(Debug, Clone, Default)]
pub struct VirtualChannelRegistry {
    channels: BTreeMap<String, VirtualChannelDescriptor>,
}

impl VirtualChannelRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(
        &mut self,
        descriptor: VirtualChannelDescriptor,
    ) -> Result<(), VirtualChannelRegistryError> {
        let key = descriptor.name.to_ascii_lowercase();
        if self.channels.contains_key(&key) {
            return Err(VirtualChannelRegistryError::DuplicateChannel(
                descriptor.name,
            ));
        }
        self.channels.insert(key, descriptor);
        Ok(())
    }

    pub fn set_state(
        &mut self,
        name: &str,
        state: VirtualChannelState,
    ) -> Result<(), VirtualChannelRegistryError> {
        let channel = self.channel_mut(name)?;
        channel.state = state;
        if !state.is_failed() {
            channel.last_error_class = None;
        }
        Ok(())
    }

    pub fn mark_faulted(
        &mut self,
        name: &str,
        class: impl Into<String>,
    ) -> Result<(), VirtualChannelRegistryError> {
        let channel = self.channel_mut(name)?;
        channel.state = VirtualChannelState::Faulted;
        channel.last_error_class = Some(class.into());
        Ok(())
    }

    pub fn record_received(&mut self, name: &str) -> Result<(), VirtualChannelRegistryError> {
        let channel = self.channel_mut(name)?;
        channel.messages_received = channel.messages_received.saturating_add(1);
        Ok(())
    }

    pub fn record_sent(&mut self, name: &str) -> Result<(), VirtualChannelRegistryError> {
        let channel = self.channel_mut(name)?;
        channel.messages_sent = channel.messages_sent.saturating_add(1);
        Ok(())
    }

    pub fn summary(&self) -> ChannelSummary {
        self.channels
            .values()
            .fold(ChannelSummary::default(), |mut summary, channel| {
                if channel.state.is_enabled() {
                    summary.enabled_count = summary.enabled_count.saturating_add(1);
                }
                if channel.state.is_ready() {
                    summary.ready_count = summary.ready_count.saturating_add(1);
                }
                if channel.state.is_failed() {
                    summary.failed_count = summary.failed_count.saturating_add(1);
                }
                summary
            })
    }

    pub fn diagnostics(&self) -> Vec<VirtualChannelDescriptor> {
        self.channels.values().cloned().collect()
    }

    fn channel_mut(
        &mut self,
        name: &str,
    ) -> Result<&mut VirtualChannelDescriptor, VirtualChannelRegistryError> {
        self.channels
            .get_mut(&name.to_ascii_lowercase())
            .ok_or_else(|| VirtualChannelRegistryError::UnknownChannel(name.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn descriptor(name: &str, enabled: bool) -> VirtualChannelDescriptor {
        VirtualChannelDescriptor::new(
            name,
            VirtualChannelKind::Static,
            VirtualChannelPriority::Normal,
            enabled,
        )
    }

    #[test]
    fn summary_counts_enabled_ready_and_failed_channels() {
        let mut registry = VirtualChannelRegistry::new();
        registry
            .register(descriptor("rdpdr", true).ready())
            .unwrap();
        registry.register(descriptor("cliprdr", true)).unwrap();
        registry
            .register(descriptor("audin", true).faulted("channel_fault"))
            .unwrap();
        registry.register(descriptor("rdpsnd", false)).unwrap();

        let summary = registry.summary();

        assert_eq!(summary.enabled_count, 3);
        assert_eq!(summary.ready_count, 1);
        assert_eq!(summary.failed_count, 1);
    }

    #[test]
    fn duplicate_names_are_rejected_case_insensitively() {
        let mut registry = VirtualChannelRegistry::new();
        registry.register(descriptor("RDPDR", true)).unwrap();

        let error = registry.register(descriptor("rdpdr", true)).unwrap_err();

        assert_eq!(
            error,
            VirtualChannelRegistryError::DuplicateChannel("rdpdr".to_string())
        );
    }

    #[test]
    fn counters_saturate_and_diagnostics_are_stable() {
        let mut registry = VirtualChannelRegistry::new();
        registry.register(descriptor("cliprdr", true)).unwrap();

        registry.record_received("CLIPRDR").unwrap();
        registry.record_sent("cliprdr").unwrap();
        registry
            .mark_faulted("cliprdr", "protocol_violation")
            .unwrap();

        let diagnostics = registry.diagnostics();
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].messages_received, 1);
        assert_eq!(diagnostics[0].messages_sent, 1);
        assert_eq!(diagnostics[0].state, VirtualChannelState::Faulted);
        assert_eq!(
            diagnostics[0].last_error_class.as_deref(),
            Some("protocol_violation")
        );
    }

    #[test]
    fn unknown_channel_updates_are_rejected() {
        let mut registry = VirtualChannelRegistry::new();

        let error = registry
            .set_state("missing", VirtualChannelState::Ready)
            .unwrap_err();

        assert_eq!(
            error,
            VirtualChannelRegistryError::UnknownChannel("missing".to_string())
        );
    }
}
