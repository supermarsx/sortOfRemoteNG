use serde::{Deserialize, Serialize};

/// RGB color representation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl Rgb {
    pub fn new(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b }
    }

    /// Convert to hex string `#rrggbb`.
    pub fn to_hex(&self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }

    /// Relative luminance per WCAG 2.0.
    pub fn luminance(&self) -> f64 {
        fn channel(c: u8) -> f64 {
            let s = c as f64 / 255.0;
            if s <= 0.03928 {
                s / 12.92
            } else {
                ((s + 0.055) / 1.055).powf(2.4)
            }
        }
        0.2126 * channel(self.r) + 0.7152 * channel(self.g) + 0.0722 * channel(self.b)
    }
}

/// Parse a hex color string to RGB. Accepts `#rgb`, `#rrggbb`, `#rrggbbaa`.
pub fn parse_hex(hex: &str) -> Option<Rgb> {
    let hex = hex.trim().trim_start_matches('#');
    match hex.len() {
        3 => {
            let r = u8::from_str_radix(&hex[0..1], 16).ok()? * 17;
            let g = u8::from_str_radix(&hex[1..2], 16).ok()? * 17;
            let b = u8::from_str_radix(&hex[2..3], 16).ok()? * 17;
            Some(Rgb::new(r, g, b))
        }
        6 | 8 => {
            let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
            let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
            let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
            Some(Rgb::new(r, g, b))
        }
        _ => None,
    }
}

/// Validate a hex color string.
pub fn is_valid_hex(hex: &str) -> bool {
    parse_hex(hex).is_some()
}

/// Calculate WCAG 2.0 contrast ratio between two colors (1.0 - 21.0).
pub fn contrast_ratio(c1: &Rgb, c2: &Rgb) -> f64 {
    let l1 = c1.luminance();
    let l2 = c2.luminance();
    let lighter = if l1 > l2 { l1 } else { l2 };
    let darker = if l1 > l2 { l2 } else { l1 };
    (lighter + 0.05) / (darker + 0.05)
}

/// Check if foreground/background pair meets WCAG AA for normal text (>= 4.5).
pub fn meets_wcag_aa(foreground: &str, background: &str) -> bool {
    if let (Some(fg), Some(bg)) = (parse_hex(foreground), parse_hex(background)) {
        contrast_ratio(&fg, &bg) >= 4.5
    } else {
        false
    }
}

/// Check if foreground/background pair meets WCAG AAA for normal text (>= 7.0).
pub fn meets_wcag_aaa(foreground: &str, background: &str) -> bool {
    if let (Some(fg), Some(bg)) = (parse_hex(foreground), parse_hex(background)) {
        contrast_ratio(&fg, &bg) >= 7.0
    } else {
        false
    }
}

/// Blend two hex colors. `factor` 0.0 = all c1, 1.0 = all c2.
pub fn blend(c1: &str, c2: &str, factor: f64) -> Option<String> {
    let rgb1 = parse_hex(c1)?;
    let rgb2 = parse_hex(c2)?;
    let f = factor.clamp(0.0, 1.0);
    let r = (rgb1.r as f64 * (1.0 - f) + rgb2.r as f64 * f).round() as u8;
    let g = (rgb1.g as f64 * (1.0 - f) + rgb2.g as f64 * f).round() as u8;
    let b = (rgb1.b as f64 * (1.0 - f) + rgb2.b as f64 * f).round() as u8;
    Some(Rgb::new(r, g, b).to_hex())
}

/// Lighten a hex color by a percentage (0.0 - 1.0).
pub fn lighten(hex: &str, amount: f64) -> Option<String> {
    blend(hex, "#ffffff", amount)
}

/// Darken a hex color by a percentage (0.0 - 1.0).
pub fn darken(hex: &str, amount: f64) -> Option<String> {
    blend(hex, "#000000", amount)
}

/// Add transparency to a hex color, returning `#rrggbbaa`.
pub fn with_alpha(hex: &str, alpha: f64) -> Option<String> {
    let rgb = parse_hex(hex)?;
    let a = (alpha.clamp(0.0, 1.0) * 255.0).round() as u8;
    Some(format!("#{:02x}{:02x}{:02x}{:02x}", rgb.r, rgb.g, rgb.b, a))
}

/// Invert a hex color.
pub fn invert(hex: &str) -> Option<String> {
    let rgb = parse_hex(hex)?;
    Some(Rgb::new(255 - rgb.r, 255 - rgb.g, 255 - rgb.b).to_hex())
}

/// Convert hex to HSL. Returns (h: 0-360, s: 0-100, l: 0-100).
pub fn hex_to_hsl(hex: &str) -> Option<(f64, f64, f64)> {
    let rgb = parse_hex(hex)?;
    let r = rgb.r as f64 / 255.0;
    let g = rgb.g as f64 / 255.0;
    let b = rgb.b as f64 / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if (max - min).abs() < f64::EPSILON {
        return Some((0.0, 0.0, l * 100.0));
    }
    let d = max - min;
    let s = if l > 0.5 {
        d / (2.0 - max - min)
    } else {
        d / (max + min)
    };
    let h = if (max - r).abs() < f64::EPSILON {
        let mut h = (g - b) / d;
        if g < b {
            h += 6.0;
        }
        h
    } else if (max - g).abs() < f64::EPSILON {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    Some((h * 60.0, s * 100.0, l * 100.0))
}

/// Convert HSL to hex. h: 0-360, s: 0-100, l: 0-100.
pub fn hsl_to_hex(h: f64, s: f64, l: f64) -> String {
    let s = s / 100.0;
    let l = l / 100.0;
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let h2 = h / 60.0;
    let x = c * (1.0 - (h2 % 2.0 - 1.0).abs());
    let (r1, g1, b1) = if h2 < 1.0 {
        (c, x, 0.0)
    } else if h2 < 2.0 {
        (x, c, 0.0)
    } else if h2 < 3.0 {
        (0.0, c, x)
    } else if h2 < 4.0 {
        (0.0, x, c)
    } else if h2 < 5.0 {
        (x, 0.0, c)
    } else {
        (c, 0.0, x)
    };
    let m = l - c / 2.0;
    let r = ((r1 + m) * 255.0).round() as u8;
    let g = ((g1 + m) * 255.0).round() as u8;
    let b = ((b1 + m) * 255.0).round() as u8;
    Rgb::new(r, g, b).to_hex()
}

/// Desaturate a hex color by a given amount (0.0 - 1.0).
pub fn desaturate(hex: &str, amount: f64) -> Option<String> {
    let (h, s, l) = hex_to_hsl(hex)?;
    let new_s = (s * (1.0 - amount.clamp(0.0, 1.0))).max(0.0);
    Some(hsl_to_hex(h, new_s, l))
}

/// Saturate a hex color by a given amount (0.0 - 1.0).
pub fn saturate(hex: &str, amount: f64) -> Option<String> {
    let (h, s, l) = hex_to_hsl(hex)?;
    let new_s = (s + (100.0 - s) * amount.clamp(0.0, 1.0)).min(100.0);
    Some(hsl_to_hex(h, new_s, l))
}

/// Adjust hue by degrees.
pub fn adjust_hue(hex: &str, degrees: f64) -> Option<String> {
    let (h, s, l) = hex_to_hsl(hex)?;
    let new_h = ((h + degrees) % 360.0 + 360.0) % 360.0;
    Some(hsl_to_hex(new_h, s, l))
}

/// Generate a complementary color (180 degrees on color wheel).
pub fn complementary(hex: &str) -> Option<String> {
    adjust_hue(hex, 180.0)
}

/// Generate an ANSI 256-color palette from a theme's 16 colors.
pub fn generate_ansi_256(colors_16: &[String; 16]) -> Vec<String> {
    let mut palette = Vec::with_capacity(256);

    // 0-15: Standard colors (from the theme)
    for c in colors_16 {
        palette.push(c.clone());
    }

    // 16-231: 6x6x6 color cube
    let levels: [u8; 6] = [0, 95, 135, 175, 215, 255];
    for r in 0..6u8 {
        for g in 0..6u8 {
            for b in 0..6u8 {
                palette.push(
                    Rgb::new(levels[r as usize], levels[g as usize], levels[b as usize]).to_hex(),
                );
            }
        }
    }

    // 232-255: Grayscale ramp
    for i in 0..24u8 {
        let v = 8 + i * 10;
        palette.push(Rgb::new(v, v, v).to_hex());
    }

    palette
}
