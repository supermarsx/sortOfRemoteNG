use crate::types::*;

/// Supported export formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Json,
    Iterm2,
    WindowsTerminal,
    Alacritty,
    Xterm,
}

/// Export a theme to JSON.
pub fn export_json(theme: &TerminalTheme) -> Result<String, ThemeError> {
    serde_json::to_string_pretty(theme)
        .map_err(|e| ThemeError::invalid(&format!("JSON serialization failed: {}", e)))
}

/// Import a theme from JSON.
pub fn import_json(json: &str) -> Result<TerminalTheme, ThemeError> {
    serde_json::from_str(json)
        .map_err(|e| ThemeError::invalid(&format!("JSON parse failed: {}", e)))
}

/// Export a theme to iTerm2 .itermcolors XML format.
pub fn export_iterm2(theme: &TerminalTheme) -> Result<String, ThemeError> {
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str("<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n");
    xml.push_str("<plist version=\"1.0\">\n<dict>\n");

    let color_entries: Vec<(&str, &str)> = vec![
        ("Ansi 0 Color", &theme.black),
        ("Ansi 1 Color", &theme.red),
        ("Ansi 2 Color", &theme.green),
        ("Ansi 3 Color", &theme.yellow),
        ("Ansi 4 Color", &theme.blue),
        ("Ansi 5 Color", &theme.magenta),
        ("Ansi 6 Color", &theme.cyan),
        ("Ansi 7 Color", &theme.white),
        ("Ansi 8 Color", &theme.bright_black),
        ("Ansi 9 Color", &theme.bright_red),
        ("Ansi 10 Color", &theme.bright_green),
        ("Ansi 11 Color", &theme.bright_yellow),
        ("Ansi 12 Color", &theme.bright_blue),
        ("Ansi 13 Color", &theme.bright_magenta),
        ("Ansi 14 Color", &theme.bright_cyan),
        ("Ansi 15 Color", &theme.bright_white),
        ("Foreground Color", &theme.foreground),
        ("Background Color", &theme.background),
        ("Cursor Color", &theme.cursor),
        ("Selection Color", &theme.selection_background),
    ];

    for (name, hex) in color_entries {
        if let Some(rgb) = crate::ansi::parse_hex(hex) {
            xml.push_str(&format!("\t<key>{}</key>\n", name));
            xml.push_str("\t<dict>\n");
            xml.push_str("\t\t<key>Color Space</key>\n\t\t<string>sRGB</string>\n");
            xml.push_str(&format!(
                "\t\t<key>Red Component</key>\n\t\t<real>{:.6}</real>\n",
                rgb.r as f64 / 255.0
            ));
            xml.push_str(&format!(
                "\t\t<key>Green Component</key>\n\t\t<real>{:.6}</real>\n",
                rgb.g as f64 / 255.0
            ));
            xml.push_str(&format!(
                "\t\t<key>Blue Component</key>\n\t\t<real>{:.6}</real>\n",
                rgb.b as f64 / 255.0
            ));
            xml.push_str("\t\t<key>Alpha Component</key>\n\t\t<real>1.000000</real>\n");
            xml.push_str("\t</dict>\n");
        }
    }

    xml.push_str("</dict>\n</plist>\n");
    Ok(xml)
}

/// Export a theme to Windows Terminal JSON scheme fragment.
pub fn export_windows_terminal(theme: &TerminalTheme) -> Result<String, ThemeError> {
    let scheme = serde_json::json!({
        "name": theme.name,
        "foreground": theme.foreground,
        "background": theme.background,
        "cursorColor": theme.cursor,
        "selectionBackground": theme.selection_background,
        "black": theme.black,
        "red": theme.red,
        "green": theme.green,
        "yellow": theme.yellow,
        "blue": theme.blue,
        "purple": theme.magenta,
        "cyan": theme.cyan,
        "white": theme.white,
        "brightBlack": theme.bright_black,
        "brightRed": theme.bright_red,
        "brightGreen": theme.bright_green,
        "brightYellow": theme.bright_yellow,
        "brightBlue": theme.bright_blue,
        "brightPurple": theme.bright_magenta,
        "brightCyan": theme.bright_cyan,
        "brightWhite": theme.bright_white,
    });
    serde_json::to_string_pretty(&scheme)
        .map_err(|e| ThemeError::invalid(&format!("Serialization failed: {}", e)))
}

/// Export a theme to Alacritty YAML color scheme.
pub fn export_alacritty(theme: &TerminalTheme) -> Result<String, ThemeError> {
    let mut yaml = format!("# {} - {}\n", theme.name, theme.description);
    yaml.push_str("colors:\n");
    yaml.push_str("  primary:\n");
    yaml.push_str(&format!("    foreground: '{}'\n", theme.foreground));
    yaml.push_str(&format!("    background: '{}'\n", theme.background));
    yaml.push_str("  cursor:\n");
    yaml.push_str(&format!("    text: '{}'\n", theme.background));
    yaml.push_str(&format!("    cursor: '{}'\n", theme.cursor));
    yaml.push_str("  selection:\n");
    yaml.push_str("    text: CellForeground\n");
    yaml.push_str(&format!(
        "    background: '{}'\n",
        theme.selection_background
    ));
    yaml.push_str("  normal:\n");
    yaml.push_str(&format!("    black:   '{}'\n", theme.black));
    yaml.push_str(&format!("    red:     '{}'\n", theme.red));
    yaml.push_str(&format!("    green:   '{}'\n", theme.green));
    yaml.push_str(&format!("    yellow:  '{}'\n", theme.yellow));
    yaml.push_str(&format!("    blue:    '{}'\n", theme.blue));
    yaml.push_str(&format!("    magenta: '{}'\n", theme.magenta));
    yaml.push_str(&format!("    cyan:    '{}'\n", theme.cyan));
    yaml.push_str(&format!("    white:   '{}'\n", theme.white));
    yaml.push_str("  bright:\n");
    yaml.push_str(&format!("    black:   '{}'\n", theme.bright_black));
    yaml.push_str(&format!("    red:     '{}'\n", theme.bright_red));
    yaml.push_str(&format!("    green:   '{}'\n", theme.bright_green));
    yaml.push_str(&format!("    yellow:  '{}'\n", theme.bright_yellow));
    yaml.push_str(&format!("    blue:    '{}'\n", theme.bright_blue));
    yaml.push_str(&format!("    magenta: '{}'\n", theme.bright_magenta));
    yaml.push_str(&format!("    cyan:    '{}'\n", theme.bright_cyan));
    yaml.push_str(&format!("    white:   '{}'\n", theme.bright_white));
    Ok(yaml)
}

/// Export a theme to an xterm.js-compatible JSON theme object.
pub fn export_xterm(theme: &TerminalTheme) -> Result<String, ThemeError> {
    serde_json::to_string_pretty(&theme.to_xterm_theme())
        .map_err(|e| ThemeError::invalid(&format!("Serialization failed: {}", e)))
}

/// Export a theme in the given format.
pub fn export_theme(theme: &TerminalTheme, format: ExportFormat) -> Result<String, ThemeError> {
    match format {
        ExportFormat::Json => export_json(theme),
        ExportFormat::Iterm2 => export_iterm2(theme),
        ExportFormat::WindowsTerminal => export_windows_terminal(theme),
        ExportFormat::Alacritty => export_alacritty(theme),
        ExportFormat::Xterm => export_xterm(theme),
    }
}

/// Import a theme from iTerm2 .itermcolors XML (basic parser).
pub fn import_iterm2(xml: &str) -> Result<TerminalTheme, ThemeError> {
    // Simple XML parser for iTerm2 plist colors
    fn extract_color(xml: &str, key_name: &str) -> Option<String> {
        let key_pattern = format!("<key>{}</key>", key_name);
        let key_pos = xml.find(&key_pattern)?;
        let after_key = &xml[key_pos..];
        let dict_start = after_key.find("<dict>")?;
        let dict_end = after_key.find("</dict>")?;
        let dict_content = &after_key[dict_start..dict_end];

        let extract_real = |component: &str| -> Option<f64> {
            let pattern = format!("<key>{}</key>", component);
            let pos = dict_content.find(&pattern)?;
            let after = &dict_content[pos..];
            let real_start = after.find("<real>")? + 6;
            let real_end = after.find("</real>")?;
            after[real_start..real_end].parse::<f64>().ok()
        };

        let r = extract_real("Red Component")?;
        let g = extract_real("Green Component")?;
        let b = extract_real("Blue Component")?;
        let r = (r * 255.0).round() as u8;
        let g = (g * 255.0).round() as u8;
        let b = (b * 255.0).round() as u8;
        Some(crate::ansi::Rgb::new(r, g, b).to_hex())
    }

    let get =
        |key: &str| -> String { extract_color(xml, key).unwrap_or_else(|| "#000000".to_string()) };

    let id = format!("imported-iterm-{}", uuid::Uuid::new_v4());
    let theme = TerminalTheme {
        id: id.clone(),
        name: "Imported iTerm2 Theme".to_string(),
        author: "Imported".to_string(),
        description: "Theme imported from iTerm2 .itermcolors".to_string(),
        category: ThemeCategory::Custom,
        is_dark: true,
        is_builtin: false,
        foreground: get("Foreground Color"),
        background: get("Background Color"),
        cursor: get("Cursor Color"),
        cursor_accent: None,
        selection_background: get("Selection Color"),
        selection_foreground: None,
        selection_inactive_background: None,
        black: get("Ansi 0 Color"),
        red: get("Ansi 1 Color"),
        green: get("Ansi 2 Color"),
        yellow: get("Ansi 3 Color"),
        blue: get("Ansi 4 Color"),
        magenta: get("Ansi 5 Color"),
        cyan: get("Ansi 6 Color"),
        white: get("Ansi 7 Color"),
        bright_black: get("Ansi 8 Color"),
        bright_red: get("Ansi 9 Color"),
        bright_green: get("Ansi 10 Color"),
        bright_yellow: get("Ansi 11 Color"),
        bright_blue: get("Ansi 12 Color"),
        bright_magenta: get("Ansi 13 Color"),
        bright_cyan: get("Ansi 14 Color"),
        bright_white: get("Ansi 15 Color"),
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
        tags: vec!["imported".to_string(), "iterm2".to_string()],
    };
    Ok(theme)
}

/// Import a theme from Windows Terminal JSON scheme.
pub fn import_windows_terminal(json: &str) -> Result<TerminalTheme, ThemeError> {
    let v: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| ThemeError::invalid(&format!("Invalid JSON: {}", e)))?;

    let get = |key: &str| -> String {
        v.get(key)
            .and_then(|v| v.as_str())
            .unwrap_or("#000000")
            .to_string()
    };

    let name = v
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Imported Windows Terminal Theme");
    let id = format!("imported-wt-{}", uuid::Uuid::new_v4());

    let theme = TerminalTheme {
        id,
        name: name.to_string(),
        author: "Imported".to_string(),
        description: "Theme imported from Windows Terminal".to_string(),
        category: ThemeCategory::Custom,
        is_dark: true,
        is_builtin: false,
        foreground: get("foreground"),
        background: get("background"),
        cursor: get("cursorColor"),
        cursor_accent: None,
        selection_background: get("selectionBackground"),
        selection_foreground: None,
        selection_inactive_background: None,
        black: get("black"),
        red: get("red"),
        green: get("green"),
        yellow: get("yellow"),
        blue: get("blue"),
        magenta: get("purple"),
        cyan: get("cyan"),
        white: get("white"),
        bright_black: get("brightBlack"),
        bright_red: get("brightRed"),
        bright_green: get("brightGreen"),
        bright_yellow: get("brightYellow"),
        bright_blue: get("brightBlue"),
        bright_magenta: get("brightPurple"),
        bright_cyan: get("brightCyan"),
        bright_white: get("brightWhite"),
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
        tags: vec!["imported".to_string(), "windows-terminal".to_string()],
    };
    Ok(theme)
}

/// Import a theme - auto-detect format.
pub fn import_theme(content: &str) -> Result<TerminalTheme, ThemeError> {
    let trimmed = content.trim();
    if trimmed.starts_with("<?xml")
        || trimmed.starts_with("<!DOCTYPE plist")
        || trimmed.contains("<plist")
    {
        import_iterm2(content)
    } else if trimmed.starts_with('{') {
        // Try our JSON format first, then Windows Terminal
        if let Ok(theme) = import_json(content) {
            Ok(theme)
        } else {
            import_windows_terminal(content)
        }
    } else {
        Err(ThemeError::invalid(
            "Unrecognized theme format. Supported: JSON, iTerm2 XML, Windows Terminal JSON",
        ))
    }
}
