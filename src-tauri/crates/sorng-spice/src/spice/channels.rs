//! SPICE channel management: multiplexer, per-channel state, message routing.

use crate::spice::protocol::CapabilitySet;
use crate::spice::types::*;
use std::collections::HashMap;

// ── Message type ranges per channel ─────────────────────────────────────────

/// Main channel message types.
pub struct MainMsg;
impl MainMsg {
    pub const INIT: u16 = 101;
    pub const MIGRATE_BEGIN: u16 = 102;
    pub const MIGRATE_CANCEL: u16 = 103;
    pub const CHANNELS_LIST: u16 = 104;
    pub const MOUSE_MODE: u16 = 105;
    pub const MULTI_MEDIA_TIME: u16 = 106;
    pub const AGENT_CONNECTED: u16 = 107;
    pub const AGENT_DISCONNECTED: u16 = 108;
    pub const AGENT_DATA: u16 = 109;
    pub const AGENT_TOKEN: u16 = 110;
    pub const MIGRATE_SWITCH_HOST: u16 = 111;
    pub const MIGRATE_END: u16 = 112;
    pub const NAME: u16 = 113;
    pub const UUID: u16 = 114;
    pub const MIGRATE_DATA: u16 = 115;
    pub const MIGRATE_DST_SEAMLESS_ACK: u16 = 116;
    pub const MIGRATE_DST_SEAMLESS_NACK: u16 = 117;
}

/// Display channel message types.
pub struct DisplayMsg;
impl DisplayMsg {
    pub const MODE: u16 = 201;
    pub const MARK: u16 = 202;
    pub const RESET: u16 = 203;
    pub const COPY_BITS: u16 = 204;
    pub const INVAL_LIST: u16 = 205;
    pub const INVAL_ALL_PIXMAPS: u16 = 206;
    pub const INVAL_PALETTE: u16 = 207;
    pub const INVAL_ALL_PALETTES: u16 = 208;
    pub const SURFACE_CREATE: u16 = 209;
    pub const SURFACE_DESTROY: u16 = 210;
    pub const STREAM_CREATE: u16 = 211;
    pub const STREAM_DATA: u16 = 212;
    pub const STREAM_CLIP: u16 = 213;
    pub const STREAM_DESTROY: u16 = 214;
    pub const DRAW_FILL: u16 = 302;
    pub const DRAW_OPAQUE: u16 = 303;
    pub const DRAW_COPY: u16 = 304;
    pub const DRAW_BLEND: u16 = 305;
    pub const DRAW_BLACKNESS: u16 = 306;
    pub const DRAW_WHITENESS: u16 = 307;
    pub const DRAW_INVERS: u16 = 308;
    pub const DRAW_ROP3: u16 = 309;
    pub const DRAW_STROKE: u16 = 310;
    pub const DRAW_TEXT: u16 = 311;
    pub const DRAW_TRANSPARENT: u16 = 312;
    pub const DRAW_ALPHA_BLEND: u16 = 313;
    pub const DRAW_COMPOSITE: u16 = 314;
    pub const MONITORS_CONFIG: u16 = 315;
    pub const STREAM_ACTIVATE_REPORT: u16 = 316;
    pub const GL_SCANOUT_UNIX: u16 = 317;
    pub const GL_DRAW: u16 = 318;
}

/// Inputs channel message types.
pub struct InputsMsg;
impl InputsMsg {
    pub const INIT: u16 = 401;
    pub const KEY_MODIFIERS: u16 = 402;
    pub const MOUSE_MOTION_ACK: u16 = 403;
}

/// Cursor channel message types.
pub struct CursorMsg;
impl CursorMsg {
    pub const INIT: u16 = 501;
    pub const RESET: u16 = 502;
    pub const SET: u16 = 503;
    pub const MOVE: u16 = 504;
    pub const HIDE: u16 = 505;
    pub const TRAIL: u16 = 506;
    pub const INVAL_ONE: u16 = 507;
    pub const INVAL_ALL: u16 = 508;
}

// ── Channel handle ──────────────────────────────────────────────────────────

/// Represents one active SPICE channel connection.
pub struct SpiceChannel {
    pub channel_type: SpiceChannelType,
    pub channel_id: u8,
    pub state: ChannelState,
    pub common_caps: CapabilitySet,
    pub channel_caps: CapabilitySet,
    pub serial: u64,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub messages_sent: u64,
    pub messages_received: u64,
}

impl SpiceChannel {
    pub fn new(channel_type: SpiceChannelType, channel_id: u8) -> Self {
        Self {
            channel_type,
            channel_id,
            state: ChannelState::Disconnected,
            common_caps: CapabilitySet::new(),
            channel_caps: CapabilitySet::new(),
            serial: 1,
            bytes_sent: 0,
            bytes_received: 0,
            messages_sent: 0,
            messages_received: 0,
        }
    }

    pub fn next_serial(&mut self) -> u64 {
        let s = self.serial;
        self.serial += 1;
        s
    }

    pub fn status(&self) -> ChannelStatus {
        ChannelStatus {
            channel_type: self.channel_type,
            channel_id: self.channel_id,
            state: self.state,
            capabilities: self.common_caps.encode(),
            bytes_sent: self.bytes_sent,
            bytes_received: self.bytes_received,
        }
    }
}

// ── Channel multiplexer ─────────────────────────────────────────────────────

/// Manages all channels for a single SPICE session.
pub struct ChannelMux {
    channels: HashMap<(SpiceChannelType, u8), SpiceChannel>,
    connection_id: u32,
}

impl ChannelMux {
    pub fn new(connection_id: u32) -> Self {
        Self {
            channels: HashMap::new(),
            connection_id,
        }
    }

    pub fn connection_id(&self) -> u32 {
        self.connection_id
    }

    /// Open a channel.
    pub fn open(&mut self, channel_type: SpiceChannelType, channel_id: u8) -> &mut SpiceChannel {
        self.channels
            .entry((channel_type, channel_id))
            .or_insert_with(|| SpiceChannel::new(channel_type, channel_id))
    }

    /// Get a channel reference.
    pub fn get(&self, channel_type: SpiceChannelType, channel_id: u8) -> Option<&SpiceChannel> {
        self.channels.get(&(channel_type, channel_id))
    }

    /// Get a channel mutable reference.
    pub fn get_mut(
        &mut self,
        channel_type: SpiceChannelType,
        channel_id: u8,
    ) -> Option<&mut SpiceChannel> {
        self.channels.get_mut(&(channel_type, channel_id))
    }

    /// Close a channel.
    pub fn close(&mut self, channel_type: SpiceChannelType, channel_id: u8) -> bool {
        self.channels.remove(&(channel_type, channel_id)).is_some()
    }

    /// Close all channels.
    pub fn close_all(&mut self) {
        self.channels.clear();
    }

    /// List all open channels.
    pub fn list(&self) -> Vec<ChannelStatus> {
        self.channels.values().map(|c| c.status()).collect()
    }

    /// Open the default set of channels for a typical SPICE session.
    pub fn open_defaults(&mut self) {
        self.open(SpiceChannelType::Main, 0);
        self.open(SpiceChannelType::Display, 0);
        self.open(SpiceChannelType::Inputs, 0);
        self.open(SpiceChannelType::Cursor, 0);
    }

    /// Open optional channels based on config.
    pub fn open_from_config(&mut self, config: &SpiceConfig) {
        self.open_defaults();
        if config.audio_playback {
            self.open(SpiceChannelType::Playback, 0);
        }
        if config.audio_record {
            self.open(SpiceChannelType::Record, 0);
        }
        if config.usb_redirection {
            self.open(SpiceChannelType::UsbRedir, 0);
        }
        if config.file_sharing {
            self.open(SpiceChannelType::WebDav, 0);
        }
        // Open any explicitly requested channels.
        for ct in &config.channels {
            self.open(*ct, 0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_mux_defaults() {
        let mut mux = ChannelMux::new(1);
        mux.open_defaults();
        let list = mux.list();
        assert_eq!(list.len(), 4);
        assert!(mux.get(SpiceChannelType::Main, 0).is_some());
        assert!(mux.get(SpiceChannelType::Display, 0).is_some());
        assert!(mux.get(SpiceChannelType::Inputs, 0).is_some());
        assert!(mux.get(SpiceChannelType::Cursor, 0).is_some());
    }

    #[test]
    fn channel_mux_config() {
        let config = SpiceConfig {
            audio_playback: true,
            audio_record: true,
            usb_redirection: true,
            file_sharing: true,
            ..SpiceConfig::default()
        };
        let mut mux = ChannelMux::new(42);
        mux.open_from_config(&config);
        assert_eq!(mux.list().len(), 8); // 4 default + playback + record + usbredir + webdav
    }

    #[test]
    fn channel_serial_increment() {
        let mut ch = SpiceChannel::new(SpiceChannelType::Main, 0);
        assert_eq!(ch.next_serial(), 1);
        assert_eq!(ch.next_serial(), 2);
        assert_eq!(ch.next_serial(), 3);
    }
}
