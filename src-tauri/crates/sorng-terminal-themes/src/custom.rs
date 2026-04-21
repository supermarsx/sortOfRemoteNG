use crate::ansi;
use crate::types::*;

/// Validate all hex color fields in a theme.
pub fn validate_theme(theme: &TerminalTheme) -> Result<(), ThemeError> {
    let required_colors: Vec<(&str, &str)> = vec![
        ("foreground", &theme.foreground),
        ("background", &theme.background),
        ("cursor", &theme.cursor),
        ("selection_background", &theme.selection_background),
        ("black", &theme.black),
        ("red", &theme.red),
        ("green", &theme.green),
        ("yellow", &theme.yellow),
        ("blue", &theme.blue),
        ("magenta", &theme.magenta),
        ("cyan", &theme.cyan),
        ("white", &theme.white),
        ("bright_black", &theme.bright_black),
        ("bright_red", &theme.bright_red),
        ("bright_green", &theme.bright_green),
        ("bright_yellow", &theme.bright_yellow),
        ("bright_blue", &theme.bright_blue),
        ("bright_magenta", &theme.bright_magenta),
        ("bright_cyan", &theme.bright_cyan),
        ("bright_white", &theme.bright_white),
    ];

    for (name, value) in &required_colors {
        if value.is_empty() {
            return Err(ThemeError::invalid(&format!(
                "Color '{}' is required",
                name
            )));
        }
        if !ansi::is_valid_hex(value) {
            return Err(ThemeError::invalid(&format!(
                "Color '{}' has invalid hex value: {}",
                name, value
            )));
        }
    }

    // Validate optional colors
    let optional_colors: Vec<(&str, &Option<String>)> = vec![
        ("cursor_accent", &theme.cursor_accent),
        ("selection_foreground", &theme.selection_foreground),
        (
            "selection_inactive_background",
            &theme.selection_inactive_background,
        ),
        ("scrollbar_thumb", &theme.scrollbar_thumb),
        ("scrollbar_track", &theme.scrollbar_track),
        ("tab_active_background", &theme.tab_active_background),
        ("tab_active_foreground", &theme.tab_active_foreground),
        ("tab_inactive_background", &theme.tab_inactive_background),
        ("tab_inactive_foreground", &theme.tab_inactive_foreground),
        ("border_color", &theme.border_color),
        ("find_match_background", &theme.find_match_background),
        (
            "find_match_highlight_background",
            &theme.find_match_highlight_background,
        ),
    ];

    for (name, value) in &optional_colors {
        if let Some(v) = value {
            if !v.is_empty() && !ansi::is_valid_hex(v) {
                return Err(ThemeError::invalid(&format!(
                    "Optional color '{}' has invalid hex value: {}",
                    name, v
                )));
            }
        }
    }

    // Basic metadata validation
    if theme.id.is_empty() {
        return Err(ThemeError::invalid("Theme id cannot be empty"));
    }
    if theme.name.is_empty() {
        return Err(ThemeError::invalid("Theme name cannot be empty"));
    }

    // Validate font size if provided
    if let Some(size) = theme.font_size {
        if !(6.0..=72.0).contains(&size) {
            return Err(ThemeError::invalid("Font size must be between 6 and 72"));
        }
    }

    // Validate font weight if provided
    if let Some(ref weight_str) = theme.font_weight {
        if let Ok(weight) = weight_str.parse::<u32>() {
            if !(100..=900).contains(&weight) {
                return Err(ThemeError::invalid(
                    "Font weight must be between 100 and 900",
                ));
            }
        }
    }
    if let Some(ref weight_str) = theme.font_weight_bold {
        if let Ok(weight) = weight_str.parse::<u32>() {
            if !(100..=900).contains(&weight) {
                return Err(ThemeError::invalid(
                    "Bold font weight must be between 100 and 900",
                ));
            }
        }
    }

    // Validate contrast ratio
    if let Some(ratio) = theme.minimum_contrast_ratio {
        if !(1.0..=21.0).contains(&ratio) {
            return Err(ThemeError::invalid(
                "Minimum contrast ratio must be between 1.0 and 21.0",
            ));
        }
    }

    Ok(())
}

/// Create a new custom theme from a base set of parameters.
#[allow(clippy::too_many_arguments)]
pub fn create_custom_theme(
    id: String,
    name: String,
    author: String,
    description: String,
    is_dark: bool,
    foreground: String,
    background: String,
    cursor: String,
    selection_background: String,
    ansi_colors: [String; 16],
) -> Result<TerminalTheme, ThemeError> {
    let theme = TerminalTheme {
        id,
        name,
        author,
        description,
        category: ThemeCategory::Custom,
        is_dark,
        is_builtin: false,
        foreground,
        background,
        cursor,
        cursor_accent: None,
        selection_background,
        selection_foreground: None,
        selection_inactive_background: None,
        black: ansi_colors[0].clone(),
        red: ansi_colors[1].clone(),
        green: ansi_colors[2].clone(),
        yellow: ansi_colors[3].clone(),
        blue: ansi_colors[4].clone(),
        magenta: ansi_colors[5].clone(),
        cyan: ansi_colors[6].clone(),
        white: ansi_colors[7].clone(),
        bright_black: ansi_colors[8].clone(),
        bright_red: ansi_colors[9].clone(),
        bright_green: ansi_colors[10].clone(),
        bright_yellow: ansi_colors[11].clone(),
        bright_blue: ansi_colors[12].clone(),
        bright_magenta: ansi_colors[13].clone(),
        bright_cyan: ansi_colors[14].clone(),
        bright_white: ansi_colors[15].clone(),
        ansi_256: None,
        scrollbar_thumb: None,
        scrollbar_track: None,
        tab_active_background: None,
        tab_active_foreground: None,
        tab_inactive_background: None,
        tab_inactive_foreground: None,
        border_color: None,
        find_match_background: None,
        find_match_highlight_background: None,
        font_family: None,
        font_size: None,
        font_weight: None,
        font_weight_bold: None,
        line_height: None,
        letter_spacing: None,
        cursor_style: None,
        cursor_blink: None,
        scrollback: None,
        minimum_contrast_ratio: None,
        tags: vec!["custom".to_string()],
    };
    validate_theme(&theme)?;
    Ok(theme)
}

/// Derive a new theme by shifting hue of all colors.
pub fn derive_hue_shifted(
    source: &TerminalTheme,
    new_id: &str,
    new_name: &str,
    hue_shift: f64,
) -> Result<TerminalTheme, ThemeError> {
    let shift = |hex: &str| -> String {
        ansi::adjust_hue(hex, hue_shift).unwrap_or_else(|| hex.to_string())
    };
    let shift_opt = |hex: &Option<String>| -> Option<String> { hex.as_ref().map(|h| shift(h)) };

    let mut t = source.clone();
    t.id = new_id.to_string();
    t.name = new_name.to_string();
    t.is_builtin = false;
    t.category = ThemeCategory::Custom;
    t.foreground = shift(&t.foreground);
    t.background = shift(&t.background);
    t.cursor = shift(&t.cursor);
    t.cursor_accent = shift_opt(&t.cursor_accent);
    t.selection_background = shift(&t.selection_background);
    t.selection_foreground = shift_opt(&t.selection_foreground);
    t.black = shift(&t.black);
    t.red = shift(&t.red);
    t.green = shift(&t.green);
    t.yellow = shift(&t.yellow);
    t.blue = shift(&t.blue);
    t.magenta = shift(&t.magenta);
    t.cyan = shift(&t.cyan);
    t.white = shift(&t.white);
    t.bright_black = shift(&t.bright_black);
    t.bright_red = shift(&t.bright_red);
    t.bright_green = shift(&t.bright_green);
    t.bright_yellow = shift(&t.bright_yellow);
    t.bright_blue = shift(&t.bright_blue);
    t.bright_magenta = shift(&t.bright_magenta);
    t.bright_cyan = shift(&t.bright_cyan);
    t.bright_white = shift(&t.bright_white);
    t.tags = vec!["custom".to_string(), "derived".to_string()];
    validate_theme(&t)?;
    Ok(t)
}

/// Generate a theme from two accent colors automatically.
pub fn generate_from_accent(
    id: &str,
    name: &str,
    accent_primary: &str,
    accent_secondary: &str,
    dark: bool,
) -> Result<TerminalTheme, ThemeError> {
    if !ansi::is_valid_hex(accent_primary) || !ansi::is_valid_hex(accent_secondary) {
        return Err(ThemeError::invalid("Invalid accent color hex"));
    }

    let (fg, bg) = if dark {
        ("#e0e0e0".to_string(), "#1a1a2e".to_string())
    } else {
        ("#2d2d2d".to_string(), "#fafafa".to_string())
    };

    let cursor = accent_primary.to_string();
    let selection = ansi::with_alpha(accent_primary, 0.3).unwrap_or_else(|| "#444444".to_string());

    // Derive 16 ANSI colors from the two accents
    let comp1 = ansi::complementary(accent_primary).unwrap_or_else(|| "#ff0000".to_string());
    let comp2 = ansi::complementary(accent_secondary).unwrap_or_else(|| "#00ff00".to_string());
    let adj1 = ansi::adjust_hue(accent_primary, 60.0).unwrap_or_else(|| "#ffff00".to_string());
    let adj2 = ansi::adjust_hue(accent_primary, -60.0).unwrap_or_else(|| "#0000ff".to_string());

    let black = if dark {
        "#1a1a2e".to_string()
    } else {
        "#2d2d2d".to_string()
    };
    let white_c = if dark {
        "#e0e0e0".to_string()
    } else {
        "#fafafa".to_string()
    };
    let bright_black = if dark {
        "#555555".to_string()
    } else {
        "#888888".to_string()
    };
    let bright_white = "#ffffff".to_string();

    let ansi_colors: [String; 16] = [
        black.clone(),
        comp1.clone(),
        accent_secondary.to_string(),
        adj1.clone(),
        accent_primary.to_string(),
        adj2.clone(),
        comp2.clone(),
        white_c.clone(),
        bright_black,
        ansi::lighten(&comp1, 0.2).unwrap_or(comp1),
        ansi::lighten(accent_secondary, 0.2).unwrap_or_else(|| accent_secondary.to_string()),
        ansi::lighten(&adj1, 0.2).unwrap_or(adj1),
        ansi::lighten(accent_primary, 0.2).unwrap_or_else(|| accent_primary.to_string()),
        ansi::lighten(&adj2, 0.2).unwrap_or(adj2),
        ansi::lighten(&comp2, 0.2).unwrap_or(comp2),
        bright_white,
    ];

    create_custom_theme(
        id.to_string(),
        name.to_string(),
        "Auto-generated".to_string(),
        format!(
            "Generated from accents {} and {}",
            accent_primary, accent_secondary
        ),
        dark,
        fg,
        bg,
        cursor,
        selection,
        ansi_colors,
    )
}
