//! NX display configuration and geometry management.

use serde::{Deserialize, Serialize};

/// Display geometry specification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayGeometry {
    pub width: u32,
    pub height: u32,
    pub fullscreen: bool,
}

impl Default for DisplayGeometry {
    fn default() -> Self {
        Self {
            width: 1024,
            height: 768,
            fullscreen: false,
        }
    }
}

impl DisplayGeometry {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            fullscreen: false,
        }
    }

    pub fn fullscreen(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            fullscreen: true,
        }
    }

    /// Format as NX geometry string (e.g. "1920x1080+fullscreen").
    pub fn to_nx_string(&self) -> String {
        if self.fullscreen {
            format!("{}x{}+fullscreen", self.width, self.height)
        } else {
            format!("{}x{}", self.width, self.height)
        }
    }

    /// Parse from NX geometry string.
    pub fn from_nx_string(s: &str) -> Option<Self> {
        let (dims, fs) = if let Some(d) = s.strip_suffix("+fullscreen") {
            (d, true)
        } else {
            (s, false)
        };

        let parts: Vec<&str> = dims.split('x').collect();
        if parts.len() != 2 {
            return None;
        }

        let width: u32 = parts[0].parse().ok()?;
        let height: u32 = parts[1].parse().ok()?;

        Some(Self {
            width,
            height,
            fullscreen: fs,
        })
    }

    /// Aspect ratio as a float.
    pub fn aspect_ratio(&self) -> f64 {
        self.width as f64 / self.height as f64
    }
}

/// Multi-monitor configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiMonitorConfig {
    pub displays: Vec<DisplayGeometry>,
    pub layout: MonitorLayout,
}

/// How multiple monitors are arranged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MonitorLayout {
    /// Single display only.
    Single,
    /// Displays side by side.
    Horizontal,
    /// Displays stacked vertically.
    Vertical,
    /// Custom arrangement.
    Custom,
}

impl Default for MultiMonitorConfig {
    fn default() -> Self {
        Self {
            displays: vec![DisplayGeometry::default()],
            layout: MonitorLayout::Single,
        }
    }
}

impl MultiMonitorConfig {
    /// Total virtual desktop width.
    pub fn total_width(&self) -> u32 {
        match self.layout {
            MonitorLayout::Single => self.displays.first().map(|d| d.width).unwrap_or(0),
            MonitorLayout::Horizontal => self.displays.iter().map(|d| d.width).sum(),
            MonitorLayout::Vertical => self.displays.iter().map(|d| d.width).max().unwrap_or(0),
            MonitorLayout::Custom => self.displays.iter().map(|d| d.width).max().unwrap_or(0),
        }
    }

    /// Total virtual desktop height.
    pub fn total_height(&self) -> u32 {
        match self.layout {
            MonitorLayout::Single => self.displays.first().map(|d| d.height).unwrap_or(0),
            MonitorLayout::Horizontal => self.displays.iter().map(|d| d.height).max().unwrap_or(0),
            MonitorLayout::Vertical => self.displays.iter().map(|d| d.height).sum(),
            MonitorLayout::Custom => self.displays.iter().map(|d| d.height).max().unwrap_or(0),
        }
    }
}

/// Color depth configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ColorDepth {
    Depth8,
    Depth16,
    Depth24,
    Depth32,
}

impl ColorDepth {
    pub fn bits(&self) -> u8 {
        match self {
            ColorDepth::Depth8 => 8,
            ColorDepth::Depth16 => 16,
            ColorDepth::Depth24 => 24,
            ColorDepth::Depth32 => 32,
        }
    }

    pub fn from_bits(b: u8) -> Option<Self> {
        match b {
            8 => Some(Self::Depth8),
            16 => Some(Self::Depth16),
            24 => Some(Self::Depth24),
            32 => Some(Self::Depth32),
            _ => None,
        }
    }
}

/// DPI configuration.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct DpiConfig {
    pub dpi: u32,
    pub scale_factor: f64,
}

impl Default for DpiConfig {
    fn default() -> Self {
        Self {
            dpi: 96,
            scale_factor: 1.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn geometry_string_roundtrip() {
        let g = DisplayGeometry::new(1920, 1080);
        assert_eq!(g.to_nx_string(), "1920x1080");
        let parsed = DisplayGeometry::from_nx_string("1920x1080").unwrap();
        assert_eq!(parsed.width, 1920);
        assert!(!parsed.fullscreen);
    }

    #[test]
    fn geometry_fullscreen() {
        let g = DisplayGeometry::fullscreen(2560, 1440);
        assert_eq!(g.to_nx_string(), "2560x1440+fullscreen");
        let parsed = DisplayGeometry::from_nx_string("2560x1440+fullscreen").unwrap();
        assert!(parsed.fullscreen);
    }

    #[test]
    fn multi_monitor_horizontal() {
        let config = MultiMonitorConfig {
            displays: vec![
                DisplayGeometry::new(1920, 1080),
                DisplayGeometry::new(1920, 1080),
            ],
            layout: MonitorLayout::Horizontal,
        };
        assert_eq!(config.total_width(), 3840);
        assert_eq!(config.total_height(), 1080);
    }

    #[test]
    fn color_depth_roundtrip() {
        for bits in [8, 16, 24, 32] {
            let cd = ColorDepth::from_bits(bits).unwrap();
            assert_eq!(cd.bits(), bits);
        }
        assert!(ColorDepth::from_bits(15).is_none());
    }

    #[test]
    fn aspect_ratio() {
        let g = DisplayGeometry::new(1920, 1080);
        let ratio = g.aspect_ratio();
        assert!((ratio - 16.0 / 9.0).abs() < 0.01);
    }
}
