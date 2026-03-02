use crate::types::*;

/// Return all built-in terminal themes.
pub fn all_builtin_themes() -> Vec<TerminalTheme> {
    vec![
        dracula(),
        solarized_dark(),
        solarized_light(),
        monokai(),
        nord(),
        tokyo_night(),
        tokyo_night_storm(),
        one_dark(),
        one_light(),
        gruvbox_dark(),
        gruvbox_light(),
        catppuccin_mocha(),
        catppuccin_latte(),
        catppuccin_frappe(),
        catppuccin_macchiato(),
        github_dark(),
        github_light(),
        material_dark(),
        material_ocean(),
        rose_pine(),
        rose_pine_moon(),
        rose_pine_dawn(),
        night_owl(),
        synthwave_84(),
        cyberpunk(),
        kanagawa(),
        everforest_dark(),
        everforest_light(),
        tokyonight_day(),
        ayu_dark(),
        ayu_mirage(),
        ayu_light(),
        palenight(),
        horizon(),
        nova(),
        snazzy(),
        tomorrow_night(),
        tango_dark(),
        tango_light(),
        cobalt2(),
        ubuntu(),
        andromeda(),
        panda(),
    ]
}

fn base(id: &str, name: &str, author: &str, desc: &str, cat: ThemeCategory, dark: bool) -> TerminalTheme {
    TerminalTheme {
        id: id.to_string(),
        name: name.to_string(),
        author: author.to_string(),
        description: desc.to_string(),
        category: cat,
        is_dark: dark,
        is_builtin: true,
        foreground: String::new(),
        background: String::new(),
        cursor: String::new(),
        cursor_accent: None,
        selection_background: String::new(),
        selection_foreground: None,
        selection_inactive_background: None,
        black: String::new(),
        red: String::new(),
        green: String::new(),
        yellow: String::new(),
        blue: String::new(),
        magenta: String::new(),
        cyan: String::new(),
        white: String::new(),
        bright_black: String::new(),
        bright_red: String::new(),
        bright_green: String::new(),
        bright_yellow: String::new(),
        bright_blue: String::new(),
        bright_magenta: String::new(),
        bright_cyan: String::new(),
        bright_white: String::new(),
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
        tags: Vec::new(),
    }
}

pub fn dracula() -> TerminalTheme {
    let mut t = base("dracula", "Dracula", "Zeno Rocha", "A dark theme for code editors and terminals", ThemeCategory::Dark, true);
    t.foreground = "#f8f8f2".to_string();
    t.background = "#282a36".to_string();
    t.cursor = "#f8f8f2".to_string();
    t.cursor_accent = Some("#282a36".to_string());
    t.selection_background = "#44475a".to_string();
    t.selection_foreground = Some("#f8f8f2".to_string());
    t.black = "#21222c".to_string();
    t.red = "#ff5555".to_string();
    t.green = "#50fa7b".to_string();
    t.yellow = "#f1fa8c".to_string();
    t.blue = "#bd93f9".to_string();
    t.magenta = "#ff79c6".to_string();
    t.cyan = "#8be9fd".to_string();
    t.white = "#f8f8f2".to_string();
    t.bright_black = "#6272a4".to_string();
    t.bright_red = "#ff6e6e".to_string();
    t.bright_green = "#69ff94".to_string();
    t.bright_yellow = "#ffffa5".to_string();
    t.bright_blue = "#d6acff".to_string();
    t.bright_magenta = "#ff92df".to_string();
    t.bright_cyan = "#a4ffff".to_string();
    t.bright_white = "#ffffff".to_string();
    t.border_color = Some("#44475a".to_string());
    t.tags = vec!["popular".to_string(), "programmer".to_string()];
    t
}

pub fn solarized_dark() -> TerminalTheme {
    let mut t = base("solarized-dark", "Solarized Dark", "Ethan Schoonover", "Precision colors for the terminal", ThemeCategory::Dark, true);
    t.foreground = "#839496".to_string();
    t.background = "#002b36".to_string();
    t.cursor = "#839496".to_string();
    t.selection_background = "#073642".to_string();
    t.black = "#073642".to_string();
    t.red = "#dc322f".to_string();
    t.green = "#859900".to_string();
    t.yellow = "#b58900".to_string();
    t.blue = "#268bd2".to_string();
    t.magenta = "#d33682".to_string();
    t.cyan = "#2aa198".to_string();
    t.white = "#eee8d5".to_string();
    t.bright_black = "#002b36".to_string();
    t.bright_red = "#cb4b16".to_string();
    t.bright_green = "#586e75".to_string();
    t.bright_yellow = "#657b83".to_string();
    t.bright_blue = "#839496".to_string();
    t.bright_magenta = "#6c71c4".to_string();
    t.bright_cyan = "#93a1a1".to_string();
    t.bright_white = "#fdf6e3".to_string();
    t.tags = vec!["popular".to_string(), "classic".to_string(), "eye-care".to_string()];
    t
}

pub fn solarized_light() -> TerminalTheme {
    let mut t = base("solarized-light", "Solarized Light", "Ethan Schoonover", "Light variant of Solarized", ThemeCategory::Light, false);
    t.foreground = "#657b83".to_string();
    t.background = "#fdf6e3".to_string();
    t.cursor = "#657b83".to_string();
    t.selection_background = "#eee8d5".to_string();
    t.black = "#073642".to_string();
    t.red = "#dc322f".to_string();
    t.green = "#859900".to_string();
    t.yellow = "#b58900".to_string();
    t.blue = "#268bd2".to_string();
    t.magenta = "#d33682".to_string();
    t.cyan = "#2aa198".to_string();
    t.white = "#eee8d5".to_string();
    t.bright_black = "#002b36".to_string();
    t.bright_red = "#cb4b16".to_string();
    t.bright_green = "#586e75".to_string();
    t.bright_yellow = "#657b83".to_string();
    t.bright_blue = "#839496".to_string();
    t.bright_magenta = "#6c71c4".to_string();
    t.bright_cyan = "#93a1a1".to_string();
    t.bright_white = "#fdf6e3".to_string();
    t.tags = vec!["light".to_string(), "classic".to_string(), "eye-care".to_string()];
    t
}

pub fn monokai() -> TerminalTheme {
    let mut t = base("monokai", "Monokai", "Wimer Hazenberg", "Iconic warm dark theme", ThemeCategory::Dark, true);
    t.foreground = "#f8f8f2".to_string();
    t.background = "#272822".to_string();
    t.cursor = "#f8f8f0".to_string();
    t.selection_background = "#49483e".to_string();
    t.black = "#272822".to_string();
    t.red = "#f92672".to_string();
    t.green = "#a6e22e".to_string();
    t.yellow = "#f4bf75".to_string();
    t.blue = "#66d9ef".to_string();
    t.magenta = "#ae81ff".to_string();
    t.cyan = "#a1efe4".to_string();
    t.white = "#f8f8f2".to_string();
    t.bright_black = "#75715e".to_string();
    t.bright_red = "#f92672".to_string();
    t.bright_green = "#a6e22e".to_string();
    t.bright_yellow = "#f4bf75".to_string();
    t.bright_blue = "#66d9ef".to_string();
    t.bright_magenta = "#ae81ff".to_string();
    t.bright_cyan = "#a1efe4".to_string();
    t.bright_white = "#f9f8f5".to_string();
    t.tags = vec!["popular".to_string(), "warm".to_string()];
    t
}

pub fn nord() -> TerminalTheme {
    let mut t = base("nord", "Nord", "Arctic Ice Studio", "An arctic, north-bluish color palette", ThemeCategory::Dark, true);
    t.foreground = "#d8dee9".to_string();
    t.background = "#2e3440".to_string();
    t.cursor = "#d8dee9".to_string();
    t.selection_background = "#434c5e".to_string();
    t.black = "#3b4252".to_string();
    t.red = "#bf616a".to_string();
    t.green = "#a3be8c".to_string();
    t.yellow = "#ebcb8b".to_string();
    t.blue = "#81a1c1".to_string();
    t.magenta = "#b48ead".to_string();
    t.cyan = "#88c0d0".to_string();
    t.white = "#e5e9f0".to_string();
    t.bright_black = "#4c566a".to_string();
    t.bright_red = "#bf616a".to_string();
    t.bright_green = "#a3be8c".to_string();
    t.bright_yellow = "#ebcb8b".to_string();
    t.bright_blue = "#81a1c1".to_string();
    t.bright_magenta = "#b48ead".to_string();
    t.bright_cyan = "#8fbcbb".to_string();
    t.bright_white = "#eceff4".to_string();
    t.border_color = Some("#4c566a".to_string());
    t.tags = vec!["popular".to_string(), "calm".to_string(), "arctic".to_string()];
    t
}

pub fn tokyo_night() -> TerminalTheme {
    let mut t = base("tokyo-night", "Tokyo Night", "enkia", "A dark theme inspired by Tokyo city lights", ThemeCategory::Dark, true);
    t.foreground = "#a9b1d6".to_string();
    t.background = "#1a1b26".to_string();
    t.cursor = "#c0caf5".to_string();
    t.selection_background = "#33467c".to_string();
    t.black = "#15161e".to_string();
    t.red = "#f7768e".to_string();
    t.green = "#9ece6a".to_string();
    t.yellow = "#e0af68".to_string();
    t.blue = "#7aa2f7".to_string();
    t.magenta = "#bb9af7".to_string();
    t.cyan = "#7dcfff".to_string();
    t.white = "#a9b1d6".to_string();
    t.bright_black = "#414868".to_string();
    t.bright_red = "#f7768e".to_string();
    t.bright_green = "#9ece6a".to_string();
    t.bright_yellow = "#e0af68".to_string();
    t.bright_blue = "#7aa2f7".to_string();
    t.bright_magenta = "#bb9af7".to_string();
    t.bright_cyan = "#7dcfff".to_string();
    t.bright_white = "#c0caf5".to_string();
    t.tags = vec!["popular".to_string(), "neon".to_string(), "city".to_string()];
    t
}

pub fn tokyo_night_storm() -> TerminalTheme {
    let mut t = tokyo_night();
    t.id = "tokyo-night-storm".to_string();
    t.name = "Tokyo Night Storm".to_string();
    t.description = "Darker variant of Tokyo Night".to_string();
    t.background = "#24283b".to_string();
    t
}

pub fn one_dark() -> TerminalTheme {
    let mut t = base("one-dark", "One Dark", "Atom", "Dark theme from Atom editor", ThemeCategory::Dark, true);
    t.foreground = "#abb2bf".to_string();
    t.background = "#282c34".to_string();
    t.cursor = "#528bff".to_string();
    t.selection_background = "#3e4451".to_string();
    t.black = "#282c34".to_string();
    t.red = "#e06c75".to_string();
    t.green = "#98c379".to_string();
    t.yellow = "#e5c07b".to_string();
    t.blue = "#61afef".to_string();
    t.magenta = "#c678dd".to_string();
    t.cyan = "#56b6c2".to_string();
    t.white = "#abb2bf".to_string();
    t.bright_black = "#5c6370".to_string();
    t.bright_red = "#e06c75".to_string();
    t.bright_green = "#98c379".to_string();
    t.bright_yellow = "#e5c07b".to_string();
    t.bright_blue = "#61afef".to_string();
    t.bright_magenta = "#c678dd".to_string();
    t.bright_cyan = "#56b6c2".to_string();
    t.bright_white = "#ffffff".to_string();
    t.tags = vec!["popular".to_string(), "atom".to_string()];
    t
}

pub fn one_light() -> TerminalTheme {
    let mut t = base("one-light", "One Light", "Atom", "Light theme from Atom editor", ThemeCategory::Light, false);
    t.foreground = "#383a42".to_string();
    t.background = "#fafafa".to_string();
    t.cursor = "#526fff".to_string();
    t.selection_background = "#e5e5e6".to_string();
    t.black = "#383a42".to_string();
    t.red = "#e45649".to_string();
    t.green = "#50a14f".to_string();
    t.yellow = "#c18401".to_string();
    t.blue = "#4078f2".to_string();
    t.magenta = "#a626a4".to_string();
    t.cyan = "#0184bc".to_string();
    t.white = "#fafafa".to_string();
    t.bright_black = "#a0a1a7".to_string();
    t.bright_red = "#e45649".to_string();
    t.bright_green = "#50a14f".to_string();
    t.bright_yellow = "#c18401".to_string();
    t.bright_blue = "#4078f2".to_string();
    t.bright_magenta = "#a626a4".to_string();
    t.bright_cyan = "#0184bc".to_string();
    t.bright_white = "#ffffff".to_string();
    t.tags = vec!["light".to_string(), "atom".to_string()];
    t
}

pub fn gruvbox_dark() -> TerminalTheme {
    let mut t = base("gruvbox-dark", "Gruvbox Dark", "morhetz", "Retro groove color scheme", ThemeCategory::Dark, true);
    t.foreground = "#ebdbb2".to_string();
    t.background = "#282828".to_string();
    t.cursor = "#ebdbb2".to_string();
    t.selection_background = "#504945".to_string();
    t.black = "#282828".to_string();
    t.red = "#cc241d".to_string();
    t.green = "#98971a".to_string();
    t.yellow = "#d79921".to_string();
    t.blue = "#458588".to_string();
    t.magenta = "#b16286".to_string();
    t.cyan = "#689d6a".to_string();
    t.white = "#a89984".to_string();
    t.bright_black = "#928374".to_string();
    t.bright_red = "#fb4934".to_string();
    t.bright_green = "#b8bb26".to_string();
    t.bright_yellow = "#fabd2f".to_string();
    t.bright_blue = "#83a598".to_string();
    t.bright_magenta = "#d3869b".to_string();
    t.bright_cyan = "#8ec07c".to_string();
    t.bright_white = "#ebdbb2".to_string();
    t.tags = vec!["popular".to_string(), "retro".to_string(), "warm".to_string()];
    t
}

pub fn gruvbox_light() -> TerminalTheme {
    let mut t = base("gruvbox-light", "Gruvbox Light", "morhetz", "Light variant of Gruvbox", ThemeCategory::Light, false);
    t.foreground = "#3c3836".to_string();
    t.background = "#fbf1c7".to_string();
    t.cursor = "#3c3836".to_string();
    t.selection_background = "#d5c4a1".to_string();
    t.black = "#fbf1c7".to_string();
    t.red = "#cc241d".to_string();
    t.green = "#98971a".to_string();
    t.yellow = "#d79921".to_string();
    t.blue = "#458588".to_string();
    t.magenta = "#b16286".to_string();
    t.cyan = "#689d6a".to_string();
    t.white = "#7c6f64".to_string();
    t.bright_black = "#928374".to_string();
    t.bright_red = "#9d0006".to_string();
    t.bright_green = "#79740e".to_string();
    t.bright_yellow = "#b57614".to_string();
    t.bright_blue = "#076678".to_string();
    t.bright_magenta = "#8f3f71".to_string();
    t.bright_cyan = "#427b58".to_string();
    t.bright_white = "#3c3836".to_string();
    t.tags = vec!["light".to_string(), "retro".to_string(), "warm".to_string()];
    t
}

pub fn catppuccin_mocha() -> TerminalTheme {
    let mut t = base("catppuccin-mocha", "Catppuccin Mocha", "Catppuccin", "Soothing dark pastel theme", ThemeCategory::Pastel, true);
    t.foreground = "#cdd6f4".to_string();
    t.background = "#1e1e2e".to_string();
    t.cursor = "#f5e0dc".to_string();
    t.selection_background = "#45475a".to_string();
    t.black = "#45475a".to_string();
    t.red = "#f38ba8".to_string();
    t.green = "#a6e3a1".to_string();
    t.yellow = "#f9e2af".to_string();
    t.blue = "#89b4fa".to_string();
    t.magenta = "#f5c2e7".to_string();
    t.cyan = "#94e2d5".to_string();
    t.white = "#bac2de".to_string();
    t.bright_black = "#585b70".to_string();
    t.bright_red = "#f38ba8".to_string();
    t.bright_green = "#a6e3a1".to_string();
    t.bright_yellow = "#f9e2af".to_string();
    t.bright_blue = "#89b4fa".to_string();
    t.bright_magenta = "#f5c2e7".to_string();
    t.bright_cyan = "#94e2d5".to_string();
    t.bright_white = "#a6adc8".to_string();
    t.tags = vec!["popular".to_string(), "pastel".to_string(), "soothing".to_string()];
    t
}

pub fn catppuccin_latte() -> TerminalTheme {
    let mut t = base("catppuccin-latte", "Catppuccin Latte", "Catppuccin", "Light pastel theme", ThemeCategory::Pastel, false);
    t.foreground = "#4c4f69".to_string();
    t.background = "#eff1f5".to_string();
    t.cursor = "#dc8a78".to_string();
    t.selection_background = "#acb0be".to_string();
    t.black = "#5c5f77".to_string();
    t.red = "#d20f39".to_string();
    t.green = "#40a02b".to_string();
    t.yellow = "#df8e1d".to_string();
    t.blue = "#1e66f5".to_string();
    t.magenta = "#ea76cb".to_string();
    t.cyan = "#179299".to_string();
    t.white = "#acb0be".to_string();
    t.bright_black = "#6c6f85".to_string();
    t.bright_red = "#d20f39".to_string();
    t.bright_green = "#40a02b".to_string();
    t.bright_yellow = "#df8e1d".to_string();
    t.bright_blue = "#1e66f5".to_string();
    t.bright_magenta = "#ea76cb".to_string();
    t.bright_cyan = "#179299".to_string();
    t.bright_white = "#bcc0cc".to_string();
    t.tags = vec!["light".to_string(), "pastel".to_string()];
    t
}

pub fn catppuccin_frappe() -> TerminalTheme {
    let mut t = base("catppuccin-frappe", "Catppuccin Frappé", "Catppuccin", "Medium dark pastel theme", ThemeCategory::Pastel, true);
    t.foreground = "#c6d0f5".to_string();
    t.background = "#303446".to_string();
    t.cursor = "#f2d5cf".to_string();
    t.selection_background = "#51576d".to_string();
    t.black = "#51576d".to_string();
    t.red = "#e78284".to_string();
    t.green = "#a6d189".to_string();
    t.yellow = "#e5c890".to_string();
    t.blue = "#8caaee".to_string();
    t.magenta = "#f4b8e4".to_string();
    t.cyan = "#81c8be".to_string();
    t.white = "#b5bfe2".to_string();
    t.bright_black = "#626880".to_string();
    t.bright_red = "#e78284".to_string();
    t.bright_green = "#a6d189".to_string();
    t.bright_yellow = "#e5c890".to_string();
    t.bright_blue = "#8caaee".to_string();
    t.bright_magenta = "#f4b8e4".to_string();
    t.bright_cyan = "#81c8be".to_string();
    t.bright_white = "#a5adce".to_string();
    t.tags = vec!["pastel".to_string()];
    t
}

pub fn catppuccin_macchiato() -> TerminalTheme {
    let mut t = base("catppuccin-macchiato", "Catppuccin Macchiato", "Catppuccin", "Warm dark pastel theme", ThemeCategory::Pastel, true);
    t.foreground = "#cad3f5".to_string();
    t.background = "#24273a".to_string();
    t.cursor = "#f4dbd6".to_string();
    t.selection_background = "#494d64".to_string();
    t.black = "#494d64".to_string();
    t.red = "#ed8796".to_string();
    t.green = "#a6da95".to_string();
    t.yellow = "#eed49f".to_string();
    t.blue = "#8aadf4".to_string();
    t.magenta = "#f5bde6".to_string();
    t.cyan = "#8bd5ca".to_string();
    t.white = "#b8c0e0".to_string();
    t.bright_black = "#5b6078".to_string();
    t.bright_red = "#ed8796".to_string();
    t.bright_green = "#a6da95".to_string();
    t.bright_yellow = "#eed49f".to_string();
    t.bright_blue = "#8aadf4".to_string();
    t.bright_magenta = "#f5bde6".to_string();
    t.bright_cyan = "#8bd5ca".to_string();
    t.bright_white = "#a5adcb".to_string();
    t.tags = vec!["pastel".to_string()];
    t
}

pub fn github_dark() -> TerminalTheme {
    let mut t = base("github-dark", "GitHub Dark", "GitHub", "GitHub's dark theme", ThemeCategory::Dark, true);
    t.foreground = "#c9d1d9".to_string();
    t.background = "#0d1117".to_string();
    t.cursor = "#c9d1d9".to_string();
    t.selection_background = "#264f78".to_string();
    t.black = "#484f58".to_string();
    t.red = "#ff7b72".to_string();
    t.green = "#3fb950".to_string();
    t.yellow = "#d29922".to_string();
    t.blue = "#58a6ff".to_string();
    t.magenta = "#bc8cff".to_string();
    t.cyan = "#39c5cf".to_string();
    t.white = "#b1bac4".to_string();
    t.bright_black = "#6e7681".to_string();
    t.bright_red = "#ffa198".to_string();
    t.bright_green = "#56d364".to_string();
    t.bright_yellow = "#e3b341".to_string();
    t.bright_blue = "#79c0ff".to_string();
    t.bright_magenta = "#d2a8ff".to_string();
    t.bright_cyan = "#56d4dd".to_string();
    t.bright_white = "#f0f6fc".to_string();
    t.tags = vec!["github".to_string(), "modern".to_string()];
    t
}

pub fn github_light() -> TerminalTheme {
    let mut t = base("github-light", "GitHub Light", "GitHub", "GitHub's light theme", ThemeCategory::Light, false);
    t.foreground = "#24292f".to_string();
    t.background = "#ffffff".to_string();
    t.cursor = "#044289".to_string();
    t.selection_background = "#0969da33".to_string();
    t.black = "#24292f".to_string();
    t.red = "#cf222e".to_string();
    t.green = "#116329".to_string();
    t.yellow = "#4d2d00".to_string();
    t.blue = "#0550ae".to_string();
    t.magenta = "#8250df".to_string();
    t.cyan = "#1b7c83".to_string();
    t.white = "#6e7781".to_string();
    t.bright_black = "#57606a".to_string();
    t.bright_red = "#a40e26".to_string();
    t.bright_green = "#1a7f37".to_string();
    t.bright_yellow = "#633c01".to_string();
    t.bright_blue = "#0969da".to_string();
    t.bright_magenta = "#8250df".to_string();
    t.bright_cyan = "#3192aa".to_string();
    t.bright_white = "#8c959f".to_string();
    t.tags = vec!["light".to_string(), "github".to_string()];
    t
}

pub fn material_dark() -> TerminalTheme {
    let mut t = base("material-dark", "Material Dark", "Material Theme", "Material Design dark theme", ThemeCategory::Dark, true);
    t.foreground = "#eeffff".to_string();
    t.background = "#212121".to_string();
    t.cursor = "#ffcc00".to_string();
    t.selection_background = "#404040".to_string();
    t.black = "#000000".to_string();
    t.red = "#f07178".to_string();
    t.green = "#c3e88d".to_string();
    t.yellow = "#ffcb6b".to_string();
    t.blue = "#82aaff".to_string();
    t.magenta = "#c792ea".to_string();
    t.cyan = "#89ddff".to_string();
    t.white = "#eeffff".to_string();
    t.bright_black = "#545454".to_string();
    t.bright_red = "#f07178".to_string();
    t.bright_green = "#c3e88d".to_string();
    t.bright_yellow = "#ffcb6b".to_string();
    t.bright_blue = "#82aaff".to_string();
    t.bright_magenta = "#c792ea".to_string();
    t.bright_cyan = "#89ddff".to_string();
    t.bright_white = "#ffffff".to_string();
    t.tags = vec!["material".to_string()];
    t
}

pub fn material_ocean() -> TerminalTheme {
    let mut t = base("material-ocean", "Material Ocean", "Material Theme", "Deep ocean Material variant", ThemeCategory::Dark, true);
    t.foreground = "#8f93a2".to_string();
    t.background = "#0f111a".to_string();
    t.cursor = "#ffcc00".to_string();
    t.selection_background = "#1f2233".to_string();
    t.black = "#000000".to_string();
    t.red = "#f07178".to_string();
    t.green = "#c3e88d".to_string();
    t.yellow = "#ffcb6b".to_string();
    t.blue = "#82aaff".to_string();
    t.magenta = "#c792ea".to_string();
    t.cyan = "#89ddff".to_string();
    t.white = "#eeffff".to_string();
    t.bright_black = "#545454".to_string();
    t.bright_red = "#f07178".to_string();
    t.bright_green = "#c3e88d".to_string();
    t.bright_yellow = "#ffcb6b".to_string();
    t.bright_blue = "#82aaff".to_string();
    t.bright_magenta = "#c792ea".to_string();
    t.bright_cyan = "#89ddff".to_string();
    t.bright_white = "#ffffff".to_string();
    t.tags = vec!["material".to_string(), "deep".to_string()];
    t
}

pub fn rose_pine() -> TerminalTheme {
    let mut t = base("rose-pine", "Rosé Pine", "Rosé Pine", "All natural pine, faux fur and a bit of soho vibes", ThemeCategory::Dark, true);
    t.foreground = "#e0def4".to_string();
    t.background = "#191724".to_string();
    t.cursor = "#524f67".to_string();
    t.selection_background = "#2a283e".to_string();
    t.black = "#26233a".to_string();
    t.red = "#eb6f92".to_string();
    t.green = "#31748f".to_string();
    t.yellow = "#f6c177".to_string();
    t.blue = "#9ccfd8".to_string();
    t.magenta = "#c4a7e7".to_string();
    t.cyan = "#ebbcba".to_string();
    t.white = "#e0def4".to_string();
    t.bright_black = "#6e6a86".to_string();
    t.bright_red = "#eb6f92".to_string();
    t.bright_green = "#31748f".to_string();
    t.bright_yellow = "#f6c177".to_string();
    t.bright_blue = "#9ccfd8".to_string();
    t.bright_magenta = "#c4a7e7".to_string();
    t.bright_cyan = "#ebbcba".to_string();
    t.bright_white = "#e0def4".to_string();
    t.tags = vec!["elegant".to_string(), "cozy".to_string()];
    t
}

pub fn rose_pine_moon() -> TerminalTheme {
    let mut t = base("rose-pine-moon", "Rosé Pine Moon", "Rosé Pine", "Moon variant of Rosé Pine", ThemeCategory::Dark, true);
    t.foreground = "#e0def4".to_string();
    t.background = "#232136".to_string();
    t.cursor = "#56526e".to_string();
    t.selection_background = "#2a283e".to_string();
    t.black = "#393552".to_string();
    t.red = "#eb6f92".to_string();
    t.green = "#3e8fb0".to_string();
    t.yellow = "#f6c177".to_string();
    t.blue = "#9ccfd8".to_string();
    t.magenta = "#c4a7e7".to_string();
    t.cyan = "#ea9a97".to_string();
    t.white = "#e0def4".to_string();
    t.bright_black = "#6e6a86".to_string();
    t.bright_red = "#eb6f92".to_string();
    t.bright_green = "#3e8fb0".to_string();
    t.bright_yellow = "#f6c177".to_string();
    t.bright_blue = "#9ccfd8".to_string();
    t.bright_magenta = "#c4a7e7".to_string();
    t.bright_cyan = "#ea9a97".to_string();
    t.bright_white = "#e0def4".to_string();
    t.tags = vec!["elegant".to_string()];
    t
}

pub fn rose_pine_dawn() -> TerminalTheme {
    let mut t = base("rose-pine-dawn", "Rosé Pine Dawn", "Rosé Pine", "Light variant of Rosé Pine", ThemeCategory::Light, false);
    t.foreground = "#575279".to_string();
    t.background = "#faf4ed".to_string();
    t.cursor = "#9893a5".to_string();
    t.selection_background = "#f2e9e1".to_string();
    t.black = "#f2e9e1".to_string();
    t.red = "#b4637a".to_string();
    t.green = "#286983".to_string();
    t.yellow = "#ea9d34".to_string();
    t.blue = "#56949f".to_string();
    t.magenta = "#907aa9".to_string();
    t.cyan = "#d7827e".to_string();
    t.white = "#575279".to_string();
    t.bright_black = "#9893a5".to_string();
    t.bright_red = "#b4637a".to_string();
    t.bright_green = "#286983".to_string();
    t.bright_yellow = "#ea9d34".to_string();
    t.bright_blue = "#56949f".to_string();
    t.bright_magenta = "#907aa9".to_string();
    t.bright_cyan = "#d7827e".to_string();
    t.bright_white = "#575279".to_string();
    t.tags = vec!["light".to_string(), "elegant".to_string()];
    t
}

pub fn night_owl() -> TerminalTheme {
    let mut t = base("night-owl", "Night Owl", "Sarah Drasner", "A theme for night owls", ThemeCategory::Dark, true);
    t.foreground = "#d6deeb".to_string();
    t.background = "#011627".to_string();
    t.cursor = "#80a4c2".to_string();
    t.selection_background = "#1d3b53".to_string();
    t.black = "#011627".to_string();
    t.red = "#ef5350".to_string();
    t.green = "#22da6e".to_string();
    t.yellow = "#addb67".to_string();
    t.blue = "#82aaff".to_string();
    t.magenta = "#c792ea".to_string();
    t.cyan = "#21c7a8".to_string();
    t.white = "#d6deeb".to_string();
    t.bright_black = "#575656".to_string();
    t.bright_red = "#ef5350".to_string();
    t.bright_green = "#22da6e".to_string();
    t.bright_yellow = "#ffeb95".to_string();
    t.bright_blue = "#82aaff".to_string();
    t.bright_magenta = "#c792ea".to_string();
    t.bright_cyan = "#7fdbca".to_string();
    t.bright_white = "#ffffff".to_string();
    t.tags = vec!["deep".to_string()];
    t
}

pub fn synthwave_84() -> TerminalTheme {
    let mut t = base("synthwave-84", "SynthWave '84", "Robb Owen", "Retro synthwave-inspired neon theme", ThemeCategory::Synthwave, true);
    t.foreground = "#f0eff1".to_string();
    t.background = "#262335".to_string();
    t.cursor = "#ff7edb".to_string();
    t.selection_background = "#463465".to_string();
    t.black = "#1b1720".to_string();
    t.red = "#fe4450".to_string();
    t.green = "#72f1b8".to_string();
    t.yellow = "#fede5d".to_string();
    t.blue = "#36f9f6".to_string();
    t.magenta = "#ff7edb".to_string();
    t.cyan = "#36f9f6".to_string();
    t.white = "#f0eff1".to_string();
    t.bright_black = "#614d85".to_string();
    t.bright_red = "#fe4450".to_string();
    t.bright_green = "#72f1b8".to_string();
    t.bright_yellow = "#fede5d".to_string();
    t.bright_blue = "#36f9f6".to_string();
    t.bright_magenta = "#ff7edb".to_string();
    t.bright_cyan = "#36f9f6".to_string();
    t.bright_white = "#ffffff".to_string();
    t.tags = vec!["neon".to_string(), "retro".to_string(), "synthwave".to_string(), "80s".to_string()];
    t
}

pub fn cyberpunk() -> TerminalTheme {
    let mut t = base("cyberpunk", "Cyberpunk", "Community", "Neon-futuristic cyberpunk aesthetic", ThemeCategory::Synthwave, true);
    t.foreground = "#00ff9c".to_string();
    t.background = "#000b1e".to_string();
    t.cursor = "#ff0055".to_string();
    t.selection_background = "#003333".to_string();
    t.black = "#000000".to_string();
    t.red = "#ff003c".to_string();
    t.green = "#00ff9c".to_string();
    t.yellow = "#ffd700".to_string();
    t.blue = "#00bfff".to_string();
    t.magenta = "#ff00ff".to_string();
    t.cyan = "#00ffff".to_string();
    t.white = "#f0f0f0".to_string();
    t.bright_black = "#555555".to_string();
    t.bright_red = "#ff5577".to_string();
    t.bright_green = "#55ffbb".to_string();
    t.bright_yellow = "#ffff55".to_string();
    t.bright_blue = "#55bbff".to_string();
    t.bright_magenta = "#ff55ff".to_string();
    t.bright_cyan = "#55ffff".to_string();
    t.bright_white = "#ffffff".to_string();
    t.tags = vec!["neon".to_string(), "futuristic".to_string(), "hacker".to_string()];
    t
}

pub fn kanagawa() -> TerminalTheme {
    let mut t = base("kanagawa", "Kanagawa", "rebelot", "Dark theme inspired by Katsushika Hokusai", ThemeCategory::Dark, true);
    t.foreground = "#dcd7ba".to_string();
    t.background = "#1f1f28".to_string();
    t.cursor = "#c8c093".to_string();
    t.selection_background = "#2d4f67".to_string();
    t.black = "#090618".to_string();
    t.red = "#c34043".to_string();
    t.green = "#76946a".to_string();
    t.yellow = "#c0a36e".to_string();
    t.blue = "#7e9cd8".to_string();
    t.magenta = "#957fb8".to_string();
    t.cyan = "#6a9589".to_string();
    t.white = "#c8c093".to_string();
    t.bright_black = "#727169".to_string();
    t.bright_red = "#e82424".to_string();
    t.bright_green = "#98bb6c".to_string();
    t.bright_yellow = "#e6c384".to_string();
    t.bright_blue = "#7fb4ca".to_string();
    t.bright_magenta = "#938aa9".to_string();
    t.bright_cyan = "#7aa89f".to_string();
    t.bright_white = "#dcd7ba".to_string();
    t.tags = vec!["japanese".to_string(), "elegant".to_string()];
    t
}

pub fn everforest_dark() -> TerminalTheme {
    let mut t = base("everforest-dark", "Everforest Dark", "sainnhe", "Comfortable green-based dark theme", ThemeCategory::Nature, true);
    t.foreground = "#d3c6aa".to_string();
    t.background = "#2d353b".to_string();
    t.cursor = "#d3c6aa".to_string();
    t.selection_background = "#475258".to_string();
    t.black = "#475258".to_string();
    t.red = "#e67e80".to_string();
    t.green = "#a7c080".to_string();
    t.yellow = "#dbbc7f".to_string();
    t.blue = "#7fbbb3".to_string();
    t.magenta = "#d699b6".to_string();
    t.cyan = "#83c092".to_string();
    t.white = "#d3c6aa".to_string();
    t.bright_black = "#5d6b66".to_string();
    t.bright_red = "#e67e80".to_string();
    t.bright_green = "#a7c080".to_string();
    t.bright_yellow = "#dbbc7f".to_string();
    t.bright_blue = "#7fbbb3".to_string();
    t.bright_magenta = "#d699b6".to_string();
    t.bright_cyan = "#83c092".to_string();
    t.bright_white = "#d3c6aa".to_string();
    t.tags = vec!["nature".to_string(), "green".to_string(), "eye-care".to_string()];
    t
}

pub fn everforest_light() -> TerminalTheme {
    let mut t = base("everforest-light", "Everforest Light", "sainnhe", "Comfortable green-based light theme", ThemeCategory::Nature, false);
    t.foreground = "#5c6a72".to_string();
    t.background = "#fdf6e3".to_string();
    t.cursor = "#5c6a72".to_string();
    t.selection_background = "#e6e2cc".to_string();
    t.black = "#5c6a72".to_string();
    t.red = "#f85552".to_string();
    t.green = "#8da101".to_string();
    t.yellow = "#dfa000".to_string();
    t.blue = "#3a94c5".to_string();
    t.magenta = "#df69ba".to_string();
    t.cyan = "#35a77c".to_string();
    t.white = "#dfddc8".to_string();
    t.bright_black = "#829181".to_string();
    t.bright_red = "#f85552".to_string();
    t.bright_green = "#8da101".to_string();
    t.bright_yellow = "#dfa000".to_string();
    t.bright_blue = "#3a94c5".to_string();
    t.bright_magenta = "#df69ba".to_string();
    t.bright_cyan = "#35a77c".to_string();
    t.bright_white = "#5c6a72".to_string();
    t.tags = vec!["light".to_string(), "nature".to_string(), "green".to_string()];
    t
}

pub fn tokyonight_day() -> TerminalTheme {
    let mut t = base("tokyonight-day", "Tokyo Night Day", "enkia", "Light variant of Tokyo Night", ThemeCategory::Light, false);
    t.foreground = "#3760bf".to_string();
    t.background = "#e1e2e7".to_string();
    t.cursor = "#3760bf".to_string();
    t.selection_background = "#b6bfe2".to_string();
    t.black = "#e9e9ed".to_string();
    t.red = "#f52a65".to_string();
    t.green = "#587539".to_string();
    t.yellow = "#8c6c3e".to_string();
    t.blue = "#2e7de9".to_string();
    t.magenta = "#9854f1".to_string();
    t.cyan = "#007197".to_string();
    t.white = "#6172b0".to_string();
    t.bright_black = "#a1a6c5".to_string();
    t.bright_red = "#f52a65".to_string();
    t.bright_green = "#587539".to_string();
    t.bright_yellow = "#8c6c3e".to_string();
    t.bright_blue = "#2e7de9".to_string();
    t.bright_magenta = "#9854f1".to_string();
    t.bright_cyan = "#007197".to_string();
    t.bright_white = "#3760bf".to_string();
    t.tags = vec!["light".to_string(), "neon".to_string()];
    t
}

pub fn ayu_dark() -> TerminalTheme {
    let mut t = base("ayu-dark", "Ayu Dark", "dempfi", "Simple dark theme with bright colors", ThemeCategory::Dark, true);
    t.foreground = "#bfbdb6".to_string();
    t.background = "#0d1017".to_string();
    t.cursor = "#e6b450".to_string();
    t.selection_background = "#273747".to_string();
    t.black = "#01060e".to_string();
    t.red = "#ea6c73".to_string();
    t.green = "#91b362".to_string();
    t.yellow = "#f9af4f".to_string();
    t.blue = "#53bdfa".to_string();
    t.magenta = "#fae994".to_string();
    t.cyan = "#90e1c6".to_string();
    t.white = "#c7c7c7".to_string();
    t.bright_black = "#686868".to_string();
    t.bright_red = "#f07178".to_string();
    t.bright_green = "#c2d94c".to_string();
    t.bright_yellow = "#ffb454".to_string();
    t.bright_blue = "#59c2ff".to_string();
    t.bright_magenta = "#ffee99".to_string();
    t.bright_cyan = "#95e6cb".to_string();
    t.bright_white = "#ffffff".to_string();
    t.tags = vec!["vibrant".to_string()];
    t
}

pub fn ayu_mirage() -> TerminalTheme {
    let mut t = base("ayu-mirage", "Ayu Mirage", "dempfi", "Medium-dark warm Ayu variant", ThemeCategory::Dark, true);
    t.foreground = "#cbccc6".to_string();
    t.background = "#1f2430".to_string();
    t.cursor = "#ffcc66".to_string();
    t.selection_background = "#34455a".to_string();
    t.black = "#191e2a".to_string();
    t.red = "#ff3333".to_string();
    t.green = "#bae67e".to_string();
    t.yellow = "#ffd580".to_string();
    t.blue = "#73d0ff".to_string();
    t.magenta = "#d4bfff".to_string();
    t.cyan = "#95e6cb".to_string();
    t.white = "#c7c7c7".to_string();
    t.bright_black = "#686868".to_string();
    t.bright_red = "#ff3333".to_string();
    t.bright_green = "#bae67e".to_string();
    t.bright_yellow = "#ffd580".to_string();
    t.bright_blue = "#73d0ff".to_string();
    t.bright_magenta = "#d4bfff".to_string();
    t.bright_cyan = "#95e6cb".to_string();
    t.bright_white = "#ffffff".to_string();
    t.tags = vec!["warm".to_string()];
    t
}

pub fn ayu_light() -> TerminalTheme {
    let mut t = base("ayu-light", "Ayu Light", "dempfi", "Clean light Ayu variant", ThemeCategory::Light, false);
    t.foreground = "#5c6166".to_string();
    t.background = "#fafafa".to_string();
    t.cursor = "#ff6a00".to_string();
    t.selection_background = "#d1e4f4".to_string();
    t.black = "#000000".to_string();
    t.red = "#f44747".to_string();
    t.green = "#86b300".to_string();
    t.yellow = "#f2ae49".to_string();
    t.blue = "#399ee6".to_string();
    t.magenta = "#a37acc".to_string();
    t.cyan = "#4cbf99".to_string();
    t.white = "#c7c7c7".to_string();
    t.bright_black = "#686868".to_string();
    t.bright_red = "#f51818".to_string();
    t.bright_green = "#86b300".to_string();
    t.bright_yellow = "#f2ae49".to_string();
    t.bright_blue = "#399ee6".to_string();
    t.bright_magenta = "#a37acc".to_string();
    t.bright_cyan = "#4cbf99".to_string();
    t.bright_white = "#ffffff".to_string();
    t.tags = vec!["light".to_string(), "clean".to_string()];
    t
}

pub fn palenight() -> TerminalTheme {
    let mut t = base("palenight", "Palenight", "Material Theme", "Elegant purple-tinted dark theme", ThemeCategory::Dark, true);
    t.foreground = "#a6accd".to_string();
    t.background = "#292d3e".to_string();
    t.cursor = "#ffcc00".to_string();
    t.selection_background = "#343a50".to_string();
    t.black = "#292d3e".to_string();
    t.red = "#f07178".to_string();
    t.green = "#c3e88d".to_string();
    t.yellow = "#ffcb6b".to_string();
    t.blue = "#82aaff".to_string();
    t.magenta = "#c792ea".to_string();
    t.cyan = "#89ddff".to_string();
    t.white = "#d0d0d0".to_string();
    t.bright_black = "#434758".to_string();
    t.bright_red = "#ff8b92".to_string();
    t.bright_green = "#ddffa7".to_string();
    t.bright_yellow = "#ffe585".to_string();
    t.bright_blue = "#9cc4ff".to_string();
    t.bright_magenta = "#e1acff".to_string();
    t.bright_cyan = "#a3f7ff".to_string();
    t.bright_white = "#ffffff".to_string();
    t.tags = vec!["purple".to_string(), "material".to_string()];
    t
}

pub fn horizon() -> TerminalTheme {
    let mut t = base("horizon", "Horizon", "jolaleye", "Warm dark theme with vivid colors", ThemeCategory::Dark, true);
    t.foreground = "#e0e0e0".to_string();
    t.background = "#1c1e26".to_string();
    t.cursor = "#e95678".to_string();
    t.selection_background = "#2e303e".to_string();
    t.black = "#16161c".to_string();
    t.red = "#e95678".to_string();
    t.green = "#29d398".to_string();
    t.yellow = "#fab795".to_string();
    t.blue = "#26bbd9".to_string();
    t.magenta = "#ee64ac".to_string();
    t.cyan = "#59e3e3".to_string();
    t.white = "#d5d8da".to_string();
    t.bright_black = "#6c6f93".to_string();
    t.bright_red = "#ec6a88".to_string();
    t.bright_green = "#3fdaa4".to_string();
    t.bright_yellow = "#fbc3a7".to_string();
    t.bright_blue = "#3fc6de".to_string();
    t.bright_magenta = "#f075b7".to_string();
    t.bright_cyan = "#6be6e6".to_string();
    t.bright_white = "#e0e0e0".to_string();
    t.tags = vec!["warm".to_string(), "vivid".to_string()];
    t
}

pub fn nova() -> TerminalTheme {
    let mut t = base("nova", "Nova", "George Mandis", "Modern flat terminal theme", ThemeCategory::Dark, true);
    t.foreground = "#c5d4dd".to_string();
    t.background = "#3c4c55".to_string();
    t.cursor = "#7fc1ca".to_string();
    t.selection_background = "#556873".to_string();
    t.black = "#3c4c55".to_string();
    t.red = "#df8c8c".to_string();
    t.green = "#a8ce93".to_string();
    t.yellow = "#dada93".to_string();
    t.blue = "#83afe5".to_string();
    t.magenta = "#9a93e1".to_string();
    t.cyan = "#7fc1ca".to_string();
    t.white = "#c5d4dd".to_string();
    t.bright_black = "#899ba6".to_string();
    t.bright_red = "#f2c38f".to_string();
    t.bright_green = "#a8ce93".to_string();
    t.bright_yellow = "#dada93".to_string();
    t.bright_blue = "#83afe5".to_string();
    t.bright_magenta = "#d18ec2".to_string();
    t.bright_cyan = "#7fc1ca".to_string();
    t.bright_white = "#e6eef3".to_string();
    t.tags = vec!["flat".to_string(), "modern".to_string()];
    t
}

pub fn snazzy() -> TerminalTheme {
    let mut t = base("snazzy", "Snazzy", "sindresorhus", "Elegant dark theme with vivid colors", ThemeCategory::Dark, true);
    t.foreground = "#eff0eb".to_string();
    t.background = "#282a36".to_string();
    t.cursor = "#97979b".to_string();
    t.selection_background = "#3e404a".to_string();
    t.black = "#282a36".to_string();
    t.red = "#ff5c57".to_string();
    t.green = "#5af78e".to_string();
    t.yellow = "#f3f99d".to_string();
    t.blue = "#57c7ff".to_string();
    t.magenta = "#ff6ac1".to_string();
    t.cyan = "#9aedfe".to_string();
    t.white = "#f1f1f0".to_string();
    t.bright_black = "#686868".to_string();
    t.bright_red = "#ff5c57".to_string();
    t.bright_green = "#5af78e".to_string();
    t.bright_yellow = "#f3f99d".to_string();
    t.bright_blue = "#57c7ff".to_string();
    t.bright_magenta = "#ff6ac1".to_string();
    t.bright_cyan = "#9aedfe".to_string();
    t.bright_white = "#f1f1f0".to_string();
    t.tags = vec!["vivid".to_string()];
    t
}

pub fn tomorrow_night() -> TerminalTheme {
    let mut t = base("tomorrow-night", "Tomorrow Night", "Chris Kempson", "Classic dark theme with muted colors", ThemeCategory::Dark, true);
    t.foreground = "#c5c8c6".to_string();
    t.background = "#1d1f21".to_string();
    t.cursor = "#c5c8c6".to_string();
    t.selection_background = "#373b41".to_string();
    t.black = "#1d1f21".to_string();
    t.red = "#cc6666".to_string();
    t.green = "#b5bd68".to_string();
    t.yellow = "#f0c674".to_string();
    t.blue = "#81a2be".to_string();
    t.magenta = "#b294bb".to_string();
    t.cyan = "#8abeb7".to_string();
    t.white = "#c5c8c6".to_string();
    t.bright_black = "#969896".to_string();
    t.bright_red = "#cc6666".to_string();
    t.bright_green = "#b5bd68".to_string();
    t.bright_yellow = "#f0c674".to_string();
    t.bright_blue = "#81a2be".to_string();
    t.bright_magenta = "#b294bb".to_string();
    t.bright_cyan = "#8abeb7".to_string();
    t.bright_white = "#ffffff".to_string();
    t.tags = vec!["classic".to_string(), "muted".to_string()];
    t
}

pub fn tango_dark() -> TerminalTheme {
    let mut t = base("tango-dark", "Tango Dark", "GNOME", "GNOME Terminal default dark", ThemeCategory::Dark, true);
    t.foreground = "#d3d7cf".to_string();
    t.background = "#2e3436".to_string();
    t.cursor = "#d3d7cf".to_string();
    t.selection_background = "#555753".to_string();
    t.black = "#2e3436".to_string();
    t.red = "#cc0000".to_string();
    t.green = "#4e9a06".to_string();
    t.yellow = "#c4a000".to_string();
    t.blue = "#3465a4".to_string();
    t.magenta = "#75507b".to_string();
    t.cyan = "#06989a".to_string();
    t.white = "#d3d7cf".to_string();
    t.bright_black = "#555753".to_string();
    t.bright_red = "#ef2929".to_string();
    t.bright_green = "#8ae234".to_string();
    t.bright_yellow = "#fce94f".to_string();
    t.bright_blue = "#729fcf".to_string();
    t.bright_magenta = "#ad7fa8".to_string();
    t.bright_cyan = "#34e2e2".to_string();
    t.bright_white = "#eeeeec".to_string();
    t.tags = vec!["gnome".to_string(), "classic".to_string()];
    t
}

pub fn tango_light() -> TerminalTheme {
    let mut t = base("tango-light", "Tango Light", "GNOME", "GNOME Terminal default light", ThemeCategory::Light, false);
    t.foreground = "#2e3436".to_string();
    t.background = "#eeeeec".to_string();
    t.cursor = "#2e3436".to_string();
    t.selection_background = "#babdb6".to_string();
    t.black = "#2e3436".to_string();
    t.red = "#cc0000".to_string();
    t.green = "#4e9a06".to_string();
    t.yellow = "#c4a000".to_string();
    t.blue = "#3465a4".to_string();
    t.magenta = "#75507b".to_string();
    t.cyan = "#06989a".to_string();
    t.white = "#d3d7cf".to_string();
    t.bright_black = "#555753".to_string();
    t.bright_red = "#ef2929".to_string();
    t.bright_green = "#8ae234".to_string();
    t.bright_yellow = "#fce94f".to_string();
    t.bright_blue = "#729fcf".to_string();
    t.bright_magenta = "#ad7fa8".to_string();
    t.bright_cyan = "#34e2e2".to_string();
    t.bright_white = "#eeeeec".to_string();
    t.tags = vec!["light".to_string(), "gnome".to_string(), "classic".to_string()];
    t
}

pub fn cobalt2() -> TerminalTheme {
    let mut t = base("cobalt2", "Cobalt2", "Wes Bos", "Vibrant blue-based dark theme", ThemeCategory::Dark, true);
    t.foreground = "#ffffff".to_string();
    t.background = "#193549".to_string();
    t.cursor = "#ffc600".to_string();
    t.selection_background = "#0050a4".to_string();
    t.black = "#000000".to_string();
    t.red = "#ff0000".to_string();
    t.green = "#38de21".to_string();
    t.yellow = "#ffe50a".to_string();
    t.blue = "#1460d2".to_string();
    t.magenta = "#ff005d".to_string();
    t.cyan = "#00bbbb".to_string();
    t.white = "#bbbbbb".to_string();
    t.bright_black = "#555555".to_string();
    t.bright_red = "#f40e17".to_string();
    t.bright_green = "#3bd01d".to_string();
    t.bright_yellow = "#edc809".to_string();
    t.bright_blue = "#5555ff".to_string();
    t.bright_magenta = "#ff55ff".to_string();
    t.bright_cyan = "#6ae3fa".to_string();
    t.bright_white = "#ffffff".to_string();
    t.tags = vec!["vibrant".to_string(), "blue".to_string()];
    t
}

pub fn ubuntu() -> TerminalTheme {
    let mut t = base("ubuntu", "Ubuntu", "Canonical", "Default Ubuntu terminal theme", ThemeCategory::Dark, true);
    t.foreground = "#eeeeec".to_string();
    t.background = "#300a24".to_string();
    t.cursor = "#bbbbbb".to_string();
    t.selection_background = "#b5d5ff".to_string();
    t.black = "#2e3436".to_string();
    t.red = "#cc0000".to_string();
    t.green = "#4e9a06".to_string();
    t.yellow = "#c4a000".to_string();
    t.blue = "#3465a4".to_string();
    t.magenta = "#75507b".to_string();
    t.cyan = "#06989a".to_string();
    t.white = "#d3d7cf".to_string();
    t.bright_black = "#555753".to_string();
    t.bright_red = "#ef2929".to_string();
    t.bright_green = "#8ae234".to_string();
    t.bright_yellow = "#fce94f".to_string();
    t.bright_blue = "#729fcf".to_string();
    t.bright_magenta = "#ad7fa8".to_string();
    t.bright_cyan = "#34e2e2".to_string();
    t.bright_white = "#eeeeec".to_string();
    t.tags = vec!["ubuntu".to_string(), "linux".to_string()];
    t
}

pub fn andromeda() -> TerminalTheme {
    let mut t = base("andromeda", "Andromeda", "EliverLara", "Dark theme with vivid colors", ThemeCategory::Dark, true);
    t.foreground = "#e5e5e5".to_string();
    t.background = "#23262e".to_string();
    t.cursor = "#f8f8f0".to_string();
    t.selection_background = "#363a45".to_string();
    t.black = "#000000".to_string();
    t.red = "#ee5d43".to_string();
    t.green = "#96e072".to_string();
    t.yellow = "#ffe66d".to_string();
    t.blue = "#7cb7ff".to_string();
    t.magenta = "#c74ded".to_string();
    t.cyan = "#00e8c6".to_string();
    t.white = "#c1c0c0".to_string();
    t.bright_black = "#5c5c5c".to_string();
    t.bright_red = "#ee5d43".to_string();
    t.bright_green = "#96e072".to_string();
    t.bright_yellow = "#ffe66d".to_string();
    t.bright_blue = "#7cb7ff".to_string();
    t.bright_magenta = "#c74ded".to_string();
    t.bright_cyan = "#00e8c6".to_string();
    t.bright_white = "#f8f8f0".to_string();
    t.tags = vec!["vivid".to_string(), "space".to_string()];
    t
}

pub fn panda() -> TerminalTheme {
    let mut t = base("panda", "Panda", "Siamak Mokhtari", "A minimal dark syntax theme", ThemeCategory::Dark, true);
    t.foreground = "#e6e6e6".to_string();
    t.background = "#292a2b".to_string();
    t.cursor = "#f0c674".to_string();
    t.selection_background = "#45454d".to_string();
    t.black = "#292a2b".to_string();
    t.red = "#ff2c6d".to_string();
    t.green = "#19f9d8".to_string();
    t.yellow = "#ffb86c".to_string();
    t.blue = "#45a9f9".to_string();
    t.magenta = "#ff75b5".to_string();
    t.cyan = "#67d3c2".to_string();
    t.white = "#e6e6e6".to_string();
    t.bright_black = "#7e7e7e".to_string();
    t.bright_red = "#ff4b82".to_string();
    t.bright_green = "#19f9d8".to_string();
    t.bright_yellow = "#ffcc95".to_string();
    t.bright_blue = "#6fc1ff".to_string();
    t.bright_magenta = "#ff8cc8".to_string();
    t.bright_cyan = "#89e5cf".to_string();
    t.bright_white = "#ffffff".to_string();
    t.tags = vec!["minimal".to_string()];
    t
}
