use crate::types::*;

/// The built-in font registry containing metadata for 50+ curated fonts.
pub struct FontRegistry {
    fonts: Vec<FontMetadata>,
}

impl Default for FontRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl FontRegistry {
    pub fn new() -> Self {
        Self {
            fonts: build_registry(),
        }
    }

    /// All fonts in the registry.
    pub fn all(&self) -> &[FontMetadata] {
        &self.fonts
    }

    /// Get font by ID.
    pub fn get(&self, id: &str) -> Option<&FontMetadata> {
        self.fonts.iter().find(|f| f.id == id)
    }

    /// Get font by exact CSS family name.
    pub fn by_css_family(&self, css: &str) -> Option<&FontMetadata> {
        self.fonts
            .iter()
            .find(|f| f.css_family == css || f.name == css)
    }

    /// All fonts in a category.
    pub fn by_category(&self, cat: FontCategory) -> Vec<&FontMetadata> {
        self.fonts.iter().filter(|f| f.category == cat).collect()
    }

    /// All fonts in a sub-category.
    pub fn by_subcategory(&self, sub: FontSubcategory) -> Vec<&FontMetadata> {
        self.fonts
            .iter()
            .filter(|f| f.subcategory == Some(sub))
            .collect()
    }

    /// All monospace fonts (the SSH-relevant set).
    pub fn monospace(&self) -> Vec<&FontMetadata> {
        self.by_category(FontCategory::Monospace)
    }

    /// Fonts with ligature support.
    pub fn with_ligatures(&self) -> Vec<&FontMetadata> {
        self.fonts.iter().filter(|f| f.ligatures).collect()
    }

    /// Fonts with Nerd Font variants.
    pub fn with_nerd_font(&self) -> Vec<&FontMetadata> {
        self.fonts
            .iter()
            .filter(|f| f.nerd_font_available)
            .collect()
    }

    /// Fonts pre-installed on the current OS.
    pub fn preinstalled(&self) -> Vec<&FontMetadata> {
        self.fonts
            .iter()
            .filter(|f| {
                #[cfg(target_os = "windows")]
                {
                    return f.platforms.windows;
                }
                #[cfg(target_os = "macos")]
                {
                    return f.platforms.macos;
                }
                #[cfg(target_os = "linux")]
                {
                    return f.platforms.linux;
                }
                #[allow(unreachable_code)]
                f.preinstalled
            })
            .collect()
    }

    /// Search fonts by query string (matches name, tags, description).
    pub fn search(&self, query: &FontSearchQuery) -> Vec<&FontMetadata> {
        let q_lower = query.query.to_lowercase();
        let mut results: Vec<&FontMetadata> = self
            .fonts
            .iter()
            .filter(|f| {
                // Category filter.
                if let Some(cat) = query.category {
                    if f.category != cat {
                        return false;
                    }
                }
                // Sub-category filter.
                if let Some(sub) = query.subcategory {
                    if f.subcategory != Some(sub) {
                        return false;
                    }
                }
                // Ligatures filter.
                if query.ligatures_only && !f.ligatures {
                    return false;
                }
                // Nerd Font filter.
                if query.nerd_font_only && !f.nerd_font_available {
                    return false;
                }
                // Free filter.
                if query.free_only && !f.is_free {
                    return false;
                }
                // Preinstalled filter.
                if query.preinstalled_only && !f.preinstalled {
                    return false;
                }
                // Text search.
                if !q_lower.is_empty() {
                    let haystack = format!(
                        "{} {} {} {}",
                        f.name.to_lowercase(),
                        f.css_family.to_lowercase(),
                        f.tags.join(" ").to_lowercase(),
                        f.description.as_deref().unwrap_or("").to_lowercase(),
                    );
                    if !haystack.contains(&q_lower) {
                        return false;
                    }
                }
                true
            })
            .collect();

        // Sort by popularity rank, then name.
        results.sort_by(|a, b| {
            let pa = a.popularity_rank.unwrap_or(999);
            let pb = b.popularity_rank.unwrap_or(999);
            pa.cmp(&pb).then(a.name.cmp(&b.name))
        });

        results.truncate(query.max_results);
        results
    }

    /// Stats about the registry.
    pub fn stats(&self) -> FontStats {
        FontStats {
            total_fonts: self.fonts.len(),
            monospace_fonts: self
                .fonts
                .iter()
                .filter(|f| f.category == FontCategory::Monospace)
                .count(),
            sans_serif_fonts: self
                .fonts
                .iter()
                .filter(|f| f.category == FontCategory::SansSerif)
                .count(),
            serif_fonts: self
                .fonts
                .iter()
                .filter(|f| f.category == FontCategory::Serif)
                .count(),
            display_fonts: self
                .fonts
                .iter()
                .filter(|f| f.category == FontCategory::Display)
                .count(),
            system_fonts: self
                .fonts
                .iter()
                .filter(|f| f.category == FontCategory::System)
                .count(),
            ligature_fonts: self.fonts.iter().filter(|f| f.ligatures).count(),
            nerd_fonts: self.fonts.iter().filter(|f| f.nerd_font_available).count(),
            free_fonts: self.fonts.iter().filter(|f| f.is_free).count(),
            preinstalled_fonts: self.fonts.iter().filter(|f| f.preinstalled).count(),
            custom_stacks: 0,
            favourites: 0,
            connection_overrides: 0,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Build the full registry
// ═══════════════════════════════════════════════════════════════════════

#[allow(clippy::vec_init_then_push)]
fn build_registry() -> Vec<FontMetadata> {
    let mut fonts = Vec::with_capacity(55);

    // ─── MONOSPACE: Terminal classics (preinstalled) ─────────────

    fonts.push(mono(
        "cascadia-code",
        "Cascadia Code",
        "Cascadia Code",
        Some(FontSubcategory::CodingLigatures),
        true,
        true,
        Some("CaskaydiaCove Nerd Font"),
        Some("CaskaydiaCove"),
        14.0,
        1.2,
        0.0,
        vec![200, 300, 400, 600, 700],
        true,
        true,
        plat(true, false, false, true),
        true,
        "OFL-1.1",
        Some("https://github.com/microsoft/cascadia-code"),
        "Microsoft's modern coding font with ligatures and cursive italic",
        vec!["microsoft", "modern", "coding", "ligatures", "cursive"],
        2019,
        1,
    ));

    fonts.push(mono(
        "consolas",
        "Consolas",
        "Consolas",
        Some(FontSubcategory::Terminal),
        false,
        true,
        Some("Caskaydia Cove Nerd Font"),
        None,
        14.0,
        1.2,
        0.0,
        vec![400, 700],
        true,
        false,
        plat(true, false, false, false),
        true,
        "Proprietary",
        None,
        "Classic Windows monospace font, clear and compact",
        vec!["windows", "classic", "microsoft", "terminal"],
        2004,
        2,
    ));

    fonts.push(mono(
        "courier-new",
        "Courier New",
        "Courier New",
        Some(FontSubcategory::Terminal),
        false,
        false,
        None,
        None,
        14.0,
        1.2,
        0.0,
        vec![400, 700],
        true,
        false,
        plat(true, true, true, false),
        true,
        "Proprietary",
        None,
        "Universal courier-style monospace, available everywhere",
        vec!["universal", "classic", "courier", "wide"],
        1990,
        15,
    ));

    fonts.push(mono(
        "menlo",
        "Menlo",
        "Menlo",
        Some(FontSubcategory::Terminal),
        false,
        true,
        Some("Menlo Nerd Font"),
        None,
        13.0,
        1.2,
        0.0,
        vec![400, 700],
        true,
        false,
        plat(false, true, false, false),
        true,
        "Proprietary",
        None,
        "macOS default terminal font, based on Bitstream Vera Sans Mono",
        vec!["macos", "apple", "terminal", "vera"],
        2009,
        5,
    ));

    fonts.push(mono(
        "sf-mono",
        "SF Mono",
        "SF Mono",
        Some(FontSubcategory::Terminal),
        false,
        true,
        None,
        None,
        13.0,
        1.2,
        0.0,
        vec![300, 400, 500, 600, 700, 800, 900],
        true,
        false,
        plat(false, true, false, false),
        true,
        "Proprietary",
        Some("https://developer.apple.com/fonts/"),
        "Apple's San Francisco Mono, Xcode default",
        vec!["apple", "macos", "xcode", "san-francisco"],
        2016,
        6,
    ));

    fonts.push(mono(
        "lucida-console",
        "Lucida Console",
        "Lucida Console",
        Some(FontSubcategory::Terminal),
        false,
        false,
        None,
        None,
        13.0,
        1.2,
        0.0,
        vec![400],
        false,
        false,
        plat(true, false, false, false),
        true,
        "Proprietary",
        None,
        "Classic Windows terminal font",
        vec!["windows", "classic", "terminal"],
        1993,
        20,
    ));

    // ─── MONOSPACE: Modern coding fonts (free, downloadable) ────

    fonts.push(mono(
        "fira-code",
        "Fira Code",
        "Fira Code",
        Some(FontSubcategory::CodingLigatures),
        true,
        true,
        Some("FiraCode Nerd Font"),
        Some("FiraCode"),
        14.0,
        1.2,
        0.0,
        vec![300, 400, 500, 600, 700],
        true,
        true,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://github.com/tonsky/FiraCode"),
        "Hugely popular coding font with extensive ligature set",
        vec!["popular", "ligatures", "coding", "mozilla", "modern"],
        2014,
        3,
    ));

    fonts.push(mono(
        "jetbrains-mono",
        "JetBrains Mono",
        "JetBrains Mono",
        Some(FontSubcategory::CodingLigatures),
        true,
        true,
        Some("JetBrainsMono Nerd Font"),
        Some("JetBrainsMono"),
        14.0,
        1.2,
        0.0,
        vec![100, 200, 300, 400, 500, 600, 700, 800],
        true,
        true,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://www.jetbrains.com/lp/mono/"),
        "JetBrains' purpose-built coding font with 138 ligatures",
        vec!["jetbrains", "ide", "ligatures", "coding", "modern"],
        2020,
        4,
    ));

    fonts.push(mono(
        "source-code-pro",
        "Source Code Pro",
        "Source Code Pro",
        Some(FontSubcategory::CodingPlain),
        false,
        true,
        Some("SauceCodePro Nerd Font"),
        Some("SauceCodePro"),
        14.0,
        1.2,
        0.0,
        vec![200, 300, 400, 500, 600, 700, 900],
        true,
        true,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://github.com/adobe-fonts/source-code-pro"),
        "Adobe's open-source coding font, excellent readability",
        vec!["adobe", "clean", "readable", "coding"],
        2012,
        7,
    ));

    fonts.push(mono(
        "ubuntu-mono",
        "Ubuntu Mono",
        "Ubuntu Mono",
        Some(FontSubcategory::Terminal),
        false,
        true,
        Some("UbuntuMono Nerd Font"),
        Some("UbuntuMono"),
        15.0,
        1.2,
        0.0,
        vec![400, 700],
        true,
        false,
        plat(false, false, true, true),
        true,
        "UFL-1.0",
        Some("https://design.ubuntu.com/font"),
        "Ubuntu's monospace font, wide and readable",
        vec!["ubuntu", "linux", "canonical", "wide"],
        2010,
        10,
    ));

    fonts.push(mono(
        "deja-vu-sans-mono",
        "DejaVu Sans Mono",
        "DejaVu Sans Mono",
        Some(FontSubcategory::Terminal),
        false,
        true,
        Some("DejaVuSansMono Nerd Font"),
        Some("DejaVuSansM"),
        14.0,
        1.2,
        0.0,
        vec![400, 700],
        true,
        false,
        plat(false, false, true, false),
        true,
        "Bitstream Vera + Public Domain",
        Some("https://dejavu-fonts.github.io/"),
        "Extended Vera Sans Mono with massive Unicode coverage",
        vec!["dejavu", "unicode", "linux", "vera"],
        2004,
        12,
    ));

    fonts.push(mono(
        "hack",
        "Hack",
        "Hack",
        Some(FontSubcategory::CodingPlain),
        false,
        true,
        Some("Hack Nerd Font"),
        Some("Hack"),
        14.0,
        1.2,
        0.0,
        vec![400, 700],
        true,
        false,
        plat(false, false, false, true),
        false,
        "MIT + Bitstream Vera",
        Some("https://sourcefoundry.org/hack/"),
        "Purpose-built for source code, based on DejaVu Sans Mono",
        vec!["coding", "readable", "dejavu", "derivative"],
        2015,
        8,
    ));

    fonts.push(mono(
        "inconsolata",
        "Inconsolata",
        "Inconsolata",
        Some(FontSubcategory::CodingPlain),
        false,
        true,
        Some("Inconsolata Nerd Font"),
        Some("Inconsolata"),
        14.0,
        1.2,
        0.0,
        vec![200, 300, 400, 500, 600, 700, 800, 900],
        true,
        true,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://levien.com/type/myfonts/inconsolata.html"),
        "Elegant monospace inspired by Consolas, excellent for terminals",
        vec!["elegant", "consolas-like", "coding", "variable"],
        2006,
        9,
    ));

    fonts.push(mono(
        "roboto-mono",
        "Roboto Mono",
        "Roboto Mono",
        Some(FontSubcategory::CodingPlain),
        false,
        true,
        Some("RobotoMono Nerd Font"),
        Some("RobotoMono"),
        14.0,
        1.2,
        0.0,
        vec![100, 200, 300, 400, 500, 600, 700],
        true,
        true,
        plat(false, false, false, true),
        false,
        "Apache-2.0",
        Some("https://fonts.google.com/specimen/Roboto+Mono"),
        "Google's monospace companion to Roboto, clean and modern",
        vec!["google", "roboto", "android", "clean", "modern"],
        2015,
        11,
    ));

    fonts.push(mono(
        "ibm-plex-mono",
        "IBM Plex Mono",
        "IBM Plex Mono",
        Some(FontSubcategory::CodingPlain),
        false,
        true,
        Some("BlexMono Nerd Font"),
        Some("BlexMono"),
        14.0,
        1.2,
        0.0,
        vec![100, 200, 300, 400, 500, 600, 700],
        true,
        true,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://www.ibm.com/plex/"),
        "IBM's corporate-grade monospace, excellent x-height",
        vec!["ibm", "corporate", "professional", "plex"],
        2017,
        13,
    ));

    fonts.push(mono(
        "victor-mono",
        "Victor Mono",
        "Victor Mono",
        Some(FontSubcategory::CodingLigatures),
        true,
        true,
        Some("VictorMono Nerd Font"),
        Some("VictorMono"),
        14.0,
        1.2,
        0.0,
        vec![100, 200, 300, 400, 500, 600, 700],
        true,
        true,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://rubjo.github.io/victor-mono/"),
        "Distinctive cursive italic with ligatures, semi-narrow",
        vec!["cursive", "italic", "ligatures", "distinctive", "narrow"],
        2019,
        16,
    ));

    fonts.push(mono(
        "anonymous-pro",
        "Anonymous Pro",
        "Anonymous Pro",
        Some(FontSubcategory::CodingPlain),
        false,
        true,
        Some("AnonymousPro Nerd Font"),
        Some("AnonymousPro"),
        14.0,
        1.2,
        0.0,
        vec![400, 700],
        true,
        false,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://www.marksimonson.com/fonts/view/anonymous-pro"),
        "Distinguished 0/O and 1/l/I, great for code readability",
        vec!["readable", "distinguishable", "accessibility"],
        2009,
        21,
    ));

    fonts.push(mono(
        "fira-mono",
        "Fira Mono",
        "Fira Mono",
        Some(FontSubcategory::CodingPlain),
        false,
        true,
        Some("FiraMono Nerd Font"),
        Some("FiraMono"),
        14.0,
        1.2,
        0.0,
        vec![400, 500, 700],
        true,
        false,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://mozilla.github.io/Fira/"),
        "Mozilla's Fira family monospace (no ligatures, see Fira Code)",
        vec!["mozilla", "fira", "clean"],
        2013,
        17,
    ));

    fonts.push(mono(
        "iosevka",
        "Iosevka",
        "Iosevka",
        Some(FontSubcategory::CodingLigatures),
        true,
        true,
        Some("Iosevka Nerd Font"),
        Some("Iosevka"),
        14.0,
        1.2,
        0.0,
        vec![100, 200, 300, 400, 500, 600, 700, 800, 900],
        true,
        true,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://typeof.net/Iosevka/"),
        "Extremely customizable, narrow monospace with many variants",
        vec!["narrow", "customizable", "ligatures", "variants", "dense"],
        2015,
        14,
    ));

    fonts.push(mono(
        "cascadia-mono",
        "Cascadia Mono",
        "Cascadia Mono",
        Some(FontSubcategory::CodingPlain),
        false,
        true,
        Some("CaskaydiaMono Nerd Font"),
        Some("CaskaydiaMono"),
        14.0,
        1.2,
        0.0,
        vec![200, 300, 400, 600, 700],
        true,
        true,
        plat(true, false, false, true),
        true,
        "OFL-1.1",
        Some("https://github.com/microsoft/cascadia-code"),
        "Cascadia Code without ligatures",
        vec!["microsoft", "modern", "no-ligatures"],
        2019,
        18,
    ));

    fonts.push(mono(
        "space-mono",
        "Space Mono",
        "Space Mono",
        Some(FontSubcategory::CodingPlain),
        false,
        false,
        None,
        None,
        14.0,
        1.2,
        0.0,
        vec![400, 700],
        true,
        false,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://fonts.google.com/specimen/Space+Mono"),
        "Geometric monospace by Colophon Foundry, retro-futuristic",
        vec!["geometric", "retro", "futuristic", "space"],
        2016,
        22,
    ));

    fonts.push(mono(
        "overpass-mono",
        "Overpass Mono",
        "Overpass Mono",
        Some(FontSubcategory::CodingPlain),
        false,
        false,
        None,
        None,
        14.0,
        1.2,
        0.0,
        vec![300, 400, 500, 600, 700],
        true,
        true,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://overpassfont.org/"),
        "Red Hat's open-source monospace companion to Overpass",
        vec!["redhat", "open-source", "overpass"],
        2016,
        25,
    ));

    fonts.push(mono(
        "pt-mono",
        "PT Mono",
        "PT Mono",
        Some(FontSubcategory::CodingPlain),
        false,
        false,
        None,
        None,
        14.0,
        1.2,
        0.0,
        vec![400, 700],
        true,
        false,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://fonts.google.com/specimen/PT+Mono"),
        "ParaType monospace, excellent Cyrillic support",
        vec!["cyrillic", "paratype", "international"],
        2012,
        26,
    ));

    fonts.push(mono(
        "droid-sans-mono",
        "Droid Sans Mono",
        "Droid Sans Mono",
        Some(FontSubcategory::Terminal),
        false,
        true,
        Some("DroidSansMono Nerd Font"),
        Some("DroidSansM"),
        14.0,
        1.2,
        0.0,
        vec![400],
        false,
        false,
        plat(false, false, false, true),
        false,
        "Apache-2.0",
        Some("https://fonts.google.com/specimen/Droid+Sans+Mono"),
        "Google's Android-era monospace, clean and readable",
        vec!["google", "android", "droid", "clean"],
        2007,
        23,
    ));

    fonts.push(mono(
        "liberation-mono",
        "Liberation Mono",
        "Liberation Mono",
        Some(FontSubcategory::Terminal),
        false,
        true,
        Some("LiterationMono Nerd Font"),
        Some("LiterationMono"),
        14.0,
        1.2,
        0.0,
        vec![400, 700],
        true,
        false,
        plat(false, false, true, false),
        true,
        "OFL-1.1",
        Some("https://github.com/liberationfonts"),
        "Metrically compatible with Courier New, default on many Linux distros",
        vec!["linux", "liberation", "courier-compatible", "redhat"],
        2007,
        19,
    ));

    fonts.push(mono(
        "monaco",
        "Monaco",
        "Monaco",
        Some(FontSubcategory::Terminal),
        false,
        false,
        None,
        None,
        12.0,
        1.2,
        0.0,
        vec![400],
        false,
        false,
        plat(false, true, false, false),
        true,
        "Proprietary",
        None,
        "Classic macOS monospace, predecessor to Menlo",
        vec!["macos", "apple", "classic", "terminal"],
        1984,
        24,
    ));

    fonts.push(mono(
        "oxygen-mono",
        "Oxygen Mono",
        "Oxygen Mono",
        Some(FontSubcategory::CodingPlain),
        false,
        false,
        None,
        None,
        14.0,
        1.2,
        0.0,
        vec![400],
        false,
        false,
        plat(false, false, true, true),
        false,
        "OFL-1.1",
        Some("https://fonts.google.com/specimen/Oxygen+Mono"),
        "KDE's monospace font, rounded and friendly",
        vec!["kde", "linux", "rounded", "friendly"],
        2012,
        30,
    ));

    fonts.push(mono(
        "share-tech-mono",
        "Share Tech Mono",
        "Share Tech Mono",
        Some(FontSubcategory::Terminal),
        false,
        false,
        None,
        None,
        14.0,
        1.2,
        0.0,
        vec![400],
        false,
        false,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://fonts.google.com/specimen/Share+Tech+Mono"),
        "Technical monospace with a slightly futuristic feel",
        vec!["technical", "futuristic", "display"],
        2012,
        32,
    ));

    fonts.push(mono(
        "courier-prime",
        "Courier Prime",
        "Courier Prime",
        Some(FontSubcategory::Terminal),
        false,
        false,
        None,
        None,
        14.0,
        1.3,
        0.0,
        vec![400, 700],
        true,
        false,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://quoteunquoteapps.com/courierprime/"),
        "Improved Courier for screenwriting and terminals",
        vec!["courier", "screenwriting", "classic", "improved"],
        2013,
        33,
    ));

    // ─── MONOSPACE: Nerd Font / powerline-first ─────────────────

    fonts.push(mono(
        "meslo-lg",
        "Meslo LG",
        "Meslo LG",
        Some(FontSubcategory::NerdFont),
        false,
        true,
        Some("MesloLGS Nerd Font"),
        Some("MesloLGS"),
        14.0,
        1.2,
        0.0,
        vec![400, 700],
        true,
        false,
        plat(false, false, false, false),
        false,
        "Apache-2.0",
        Some("https://github.com/andreberg/Meslo-Font"),
        "Customized Apple Menlo with adjusted line spacing, popular Nerd Font base",
        vec!["menlo", "nerd-font", "powerline", "oh-my-zsh"],
        2010,
        27,
    ));

    fonts.push(mono(
        "noto-sans-mono",
        "Noto Sans Mono",
        "Noto Sans Mono",
        Some(FontSubcategory::CodingPlain),
        false,
        true,
        Some("NotoSansMono Nerd Font"),
        Some("NotoSansM"),
        14.0,
        1.2,
        0.0,
        vec![100, 200, 300, 400, 500, 600, 700, 800, 900],
        true,
        true,
        plat(false, false, true, true),
        false,
        "OFL-1.1",
        Some("https://fonts.google.com/noto"),
        "Google Noto monospace — massive Unicode/CJK/emoji coverage",
        vec![
            "google",
            "noto",
            "unicode",
            "cjk",
            "international",
            "variable",
        ],
        2014,
        28,
    ));

    fonts.push(mono(
        "comic-shanns",
        "Comic Shanns",
        "Comic Shanns",
        Some(FontSubcategory::Retro),
        false,
        false,
        None,
        None,
        14.0,
        1.2,
        0.0,
        vec![400, 700],
        false,
        false,
        plat(false, false, false, false),
        false,
        "MIT",
        Some("https://github.com/shannpersand/comic-shanns"),
        "Monospace Comic Sans — a fun, readable terminal font",
        vec!["fun", "comic-sans", "casual", "readable"],
        2018,
        35,
    ));

    fonts.push(mono(
        "fantasque-sans-mono",
        "Fantasque Sans Mono",
        "Fantasque Sans Mono",
        Some(FontSubcategory::CodingLigatures),
        true,
        true,
        Some("FantasqueSansMono Nerd Font"),
        Some("FantasqueSansM"),
        14.0,
        1.2,
        0.0,
        vec![400, 700],
        true,
        false,
        plat(false, false, false, false),
        false,
        "OFL-1.1",
        Some("https://github.com/belluzj/fantasque-sans"),
        "Handwriting-inspired coding font with ligatures",
        vec!["handwriting", "playful", "ligatures", "casual"],
        2013,
        29,
    ));

    fonts.push(mono(
        "monaspace-neon",
        "Monaspace Neon",
        "Monaspace Neon",
        Some(FontSubcategory::CodingLigatures),
        true,
        true,
        Some("Monaspace Neon Nerd Font"),
        None,
        14.0,
        1.2,
        0.0,
        vec![200, 300, 400, 500, 600, 700, 800],
        true,
        true,
        plat(false, false, false, false),
        false,
        "OFL-1.1",
        Some("https://monaspace.githubnext.com/"),
        "GitHub Next's texture-healing monospace superfamily — Neon variant",
        vec![
            "github",
            "texture-healing",
            "modern",
            "ligatures",
            "variable",
        ],
        2023,
        31,
    ));

    fonts.push(mono(
        "monaspace-argon",
        "Monaspace Argon",
        "Monaspace Argon",
        Some(FontSubcategory::CodingLigatures),
        true,
        false,
        None,
        None,
        14.0,
        1.2,
        0.0,
        vec![200, 300, 400, 500, 600, 700, 800],
        true,
        true,
        plat(false, false, false, false),
        false,
        "OFL-1.1",
        Some("https://monaspace.githubnext.com/"),
        "Monaspace superfamily — Argon variant (humanist feel)",
        vec!["github", "texture-healing", "humanist", "variable"],
        2023,
        34,
    ));

    fonts.push(mono(
        "geist-mono",
        "Geist Mono",
        "Geist Mono",
        Some(FontSubcategory::CodingPlain),
        false,
        true,
        Some("GeistMono Nerd Font"),
        Some("GeistMono"),
        14.0,
        1.2,
        0.0,
        vec![100, 200, 300, 400, 500, 600, 700, 800, 900],
        true,
        true,
        plat(false, false, false, false),
        false,
        "OFL-1.1",
        Some("https://vercel.com/font"),
        "Vercel's monospace companion to Geist, clean and modern",
        vec!["vercel", "modern", "clean", "next.js", "variable"],
        2023,
        36,
    ));

    fonts.push(mono(
        "rec-mono",
        "Recursive Mono",
        "Recursive Mono",
        Some(FontSubcategory::CodingLigatures),
        true,
        false,
        None,
        None,
        14.0,
        1.2,
        0.0,
        vec![300, 400, 500, 600, 700, 800, 900, 1000],
        true,
        true,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://www.recursive.design/"),
        "Variable font with casual↔linear and mono↔sans axes",
        vec!["variable", "casual", "axes", "customizable"],
        2020,
        37,
    ));

    fonts.push(mono(
        "commit-mono",
        "Commit Mono",
        "Commit Mono",
        Some(FontSubcategory::CodingPlain),
        false,
        false,
        None,
        None,
        14.0,
        1.2,
        0.0,
        vec![400, 700],
        true,
        false,
        plat(false, false, false, false),
        false,
        "OFL-1.1",
        Some("https://commitmono.com/"),
        "Neutral coding font with smart kerning",
        vec!["neutral", "kerning", "modern", "coding"],
        2023,
        38,
    ));

    fonts.push(mono(
        "intel-one-mono",
        "Intel One Mono",
        "Intel One Mono",
        Some(FontSubcategory::CodingPlain),
        false,
        false,
        None,
        None,
        14.0,
        1.2,
        0.0,
        vec![300, 400, 500, 600, 700],
        true,
        true,
        plat(false, false, false, false),
        false,
        "OFL-1.1",
        Some("https://github.com/intel/intel-one-mono"),
        "Intel's expressive, low-fatigue coding font",
        vec!["intel", "accessible", "low-fatigue", "clear"],
        2023,
        39,
    ));

    fonts.push(mono(
        "maple-mono",
        "Maple Mono",
        "Maple Mono",
        Some(FontSubcategory::CodingLigatures),
        true,
        true,
        Some("Maple Mono NF"),
        None,
        14.0,
        1.2,
        0.0,
        vec![100, 200, 300, 400, 500, 600, 700],
        true,
        true,
        plat(false, false, false, false),
        false,
        "OFL-1.1",
        Some("https://github.com/subframe7536/maple-font"),
        "Rounded, smooth coding font with ligatures and cursive italics",
        vec!["rounded", "smooth", "ligatures", "cursive", "chinese"],
        2022,
        40,
    ));

    // ─── MONOSPACE: Retro / bitmap-style ────────────────────────

    fonts.push(mono(
        "terminus",
        "Terminus",
        "Terminus",
        Some(FontSubcategory::Retro),
        false,
        true,
        Some("Terminess Nerd Font"),
        Some("Terminess"),
        14.0,
        1.0,
        0.0,
        vec![400, 700],
        false,
        false,
        plat(false, false, true, false),
        false,
        "OFL-1.1",
        Some("https://terminus-font.sourceforge.net/"),
        "Clean bitmap font for terminals, very sharp at small sizes",
        vec!["bitmap", "sharp", "retro", "linux", "small-size"],
        2001,
        41,
    ));

    fonts.push(mono(
        "proggy-clean",
        "ProggyClean",
        "ProggyClean",
        Some(FontSubcategory::Retro),
        false,
        true,
        Some("ProggyClean Nerd Font"),
        Some("ProggyClean"),
        13.0,
        1.0,
        0.0,
        vec![400],
        false,
        false,
        plat(false, false, false, false),
        false,
        "MIT",
        Some("https://github.com/bluescan/proggyfonts"),
        "Tiny pixel font perfect for small terminal sizes",
        vec!["pixel", "tiny", "retro", "bitmap", "compact"],
        2004,
        42,
    ));

    // ─── SANS-SERIF: App UI fonts ───────────────────────────────

    fonts.push(sans(
        "inter",
        "Inter",
        "Inter",
        Some(FontSubcategory::UiGeneral),
        vec![100, 200, 300, 400, 500, 600, 700, 800, 900],
        true,
        true,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://rsms.me/inter/"),
        "Purpose-built for computer screens, excellent at small sizes",
        vec!["ui", "screen", "readable", "modern", "variable"],
        2017,
        1,
    ));

    fonts.push(sans(
        "segoe-ui",
        "Segoe UI",
        "Segoe UI",
        Some(FontSubcategory::PlatformNative),
        vec![300, 350, 400, 600, 700, 800, 900],
        true,
        false,
        plat(true, false, false, false),
        true,
        "Proprietary",
        None,
        "Windows system font",
        vec!["windows", "system", "microsoft"],
        2004,
        2,
    ));

    fonts.push(sans(
        "sf-pro",
        "SF Pro",
        "SF Pro",
        Some(FontSubcategory::PlatformNative),
        vec![100, 200, 300, 400, 500, 600, 700, 800, 900],
        true,
        true,
        plat(false, true, false, false),
        true,
        "Proprietary",
        Some("https://developer.apple.com/fonts/"),
        "macOS/iOS system font",
        vec!["apple", "macos", "system"],
        2014,
        3,
    ));

    fonts.push(sans(
        "roboto",
        "Roboto",
        "Roboto",
        Some(FontSubcategory::UiGeneral),
        vec![100, 300, 400, 500, 700, 900],
        true,
        true,
        plat(false, false, true, true),
        false,
        "Apache-2.0",
        Some("https://fonts.google.com/specimen/Roboto"),
        "Google's design language font, friendly and professional",
        vec!["google", "android", "material", "design"],
        2011,
        4,
    ));

    fonts.push(sans(
        "noto-sans",
        "Noto Sans",
        "Noto Sans",
        Some(FontSubcategory::UiGeneral),
        vec![100, 200, 300, 400, 500, 600, 700, 800, 900],
        true,
        true,
        plat(false, false, true, true),
        false,
        "OFL-1.1",
        Some("https://fonts.google.com/noto"),
        "Google Noto — covers virtually every writing system",
        vec!["google", "noto", "unicode", "international", "cjk"],
        2014,
        5,
    ));

    fonts.push(sans(
        "open-sans",
        "Open Sans",
        "Open Sans",
        Some(FontSubcategory::Humanist),
        vec![300, 400, 500, 600, 700, 800],
        true,
        true,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://fonts.google.com/specimen/Open+Sans"),
        "Neutral, highly readable open-source sans-serif",
        vec!["neutral", "readable", "google", "popular"],
        2011,
        6,
    ));

    fonts.push(sans(
        "lato",
        "Lato",
        "Lato",
        Some(FontSubcategory::Humanist),
        vec![100, 300, 400, 700, 900],
        true,
        false,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://fonts.google.com/specimen/Lato"),
        "Warm yet stable humanist sans-serif",
        vec!["warm", "humanist", "professional"],
        2010,
        7,
    ));

    fonts.push(sans(
        "geist",
        "Geist",
        "Geist",
        Some(FontSubcategory::UiGeneral),
        vec![100, 200, 300, 400, 500, 600, 700, 800, 900],
        true,
        true,
        plat(false, false, false, false),
        false,
        "OFL-1.1",
        Some("https://vercel.com/font"),
        "Vercel's UI font, modern and technical",
        vec!["vercel", "modern", "technical", "ui"],
        2023,
        8,
    ));

    fonts.push(sans(
        "ibm-plex-sans",
        "IBM Plex Sans",
        "IBM Plex Sans",
        Some(FontSubcategory::UiGeneral),
        vec![100, 200, 300, 400, 500, 600, 700],
        true,
        true,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://www.ibm.com/plex/"),
        "IBM's corporate typeface, works great for app UI",
        vec!["ibm", "corporate", "professional", "plex"],
        2017,
        9,
    ));

    fonts.push(sans(
        "nunito",
        "Nunito",
        "Nunito",
        Some(FontSubcategory::Geometric),
        vec![200, 300, 400, 500, 600, 700, 800, 900],
        true,
        true,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://fonts.google.com/specimen/Nunito"),
        "Rounded geometric sans-serif, friendly and modern",
        vec!["rounded", "friendly", "geometric"],
        2014,
        10,
    ));

    // ─── SERIF: Documentation fonts ─────────────────────────────

    fonts.push(serif(
        "georgia",
        "Georgia",
        "Georgia",
        Some(FontSubcategory::TraditionalSerif),
        vec![400, 700],
        true,
        false,
        plat(true, true, false, true),
        true,
        "Proprietary",
        None,
        "Classic screen serif, excellent readability on monitors",
        vec!["classic", "screen", "readable"],
        1993,
        1,
    ));

    fonts.push(serif(
        "source-serif-pro",
        "Source Serif Pro",
        "Source Serif 4",
        Some(FontSubcategory::TraditionalSerif),
        vec![200, 300, 400, 600, 700, 900],
        true,
        true,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://github.com/adobe-fonts/source-serif"),
        "Adobe's open-source serif, companion to Source Sans/Code Pro",
        vec!["adobe", "readable", "documentation"],
        2014,
        2,
    ));

    fonts.push(serif(
        "ibm-plex-serif",
        "IBM Plex Serif",
        "IBM Plex Serif",
        Some(FontSubcategory::TraditionalSerif),
        vec![100, 200, 300, 400, 500, 600, 700],
        true,
        true,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://www.ibm.com/plex/"),
        "IBM's corporate serif, readable documentation font",
        vec!["ibm", "corporate", "documentation"],
        2017,
        3,
    ));

    fonts.push(serif(
        "noto-serif",
        "Noto Serif",
        "Noto Serif",
        Some(FontSubcategory::TraditionalSerif),
        vec![100, 200, 300, 400, 500, 600, 700, 800, 900],
        true,
        true,
        plat(false, false, false, true),
        false,
        "OFL-1.1",
        Some("https://fonts.google.com/noto"),
        "Google Noto serif — universal language coverage",
        vec!["google", "noto", "unicode", "international"],
        2014,
        4,
    ));

    fonts.push(serif(
        "roboto-slab",
        "Roboto Slab",
        "Roboto Slab",
        Some(FontSubcategory::SlabSerif),
        vec![100, 200, 300, 400, 500, 600, 700, 800, 900],
        true,
        true,
        plat(false, false, false, true),
        false,
        "Apache-2.0",
        Some("https://fonts.google.com/specimen/Roboto+Slab"),
        "Slab serif companion to Roboto, great for headings",
        vec!["google", "roboto", "slab", "headings"],
        2013,
        5,
    ));

    // ─── SYSTEM: Platform-specific generic stacks ───────────────

    fonts.push(FontMetadata {
        id: "system-ui".to_string(),
        name: "System UI".to_string(),
        css_family: "system-ui".to_string(),
        category: FontCategory::System,
        subcategory: Some(FontSubcategory::PlatformNative),
        ligatures: false,
        nerd_font_available: false,
        nerd_font_css: None,
        nerd_font_package: None,
        recommended_terminal_size: 14.0,
        recommended_line_height: 1.5,
        recommended_letter_spacing: 0.0,
        available_weights: vec![100, 200, 300, 400, 500, 600, 700, 800, 900],
        has_italic: true,
        is_variable: false,
        platforms: plat(true, true, true, true),
        preinstalled: true,
        is_free: true,
        license: None,
        homepage_url: None,
        description: Some(
            "Uses the OS default UI font (Segoe UI / SF Pro / Cantarell)".to_string(),
        ),
        tags: vec![
            "system".to_string(),
            "native".to_string(),
            "default".to_string(),
        ],
        year: None,
        popularity_rank: Some(1),
    });

    fonts.push(FontMetadata {
        id: "ui-monospace".to_string(),
        name: "UI Monospace".to_string(),
        css_family: "ui-monospace".to_string(),
        category: FontCategory::System,
        subcategory: Some(FontSubcategory::PlatformNative),
        ligatures: false,
        nerd_font_available: false,
        nerd_font_css: None,
        nerd_font_package: None,
        recommended_terminal_size: 14.0,
        recommended_line_height: 1.2,
        recommended_letter_spacing: 0.0,
        available_weights: vec![400, 700],
        has_italic: true,
        is_variable: false,
        platforms: plat(true, true, true, true),
        preinstalled: true,
        is_free: true,
        license: None,
        homepage_url: None,
        description: Some(
            "Uses the OS default monospace (Consolas / SF Mono / DejaVu Sans Mono)".to_string(),
        ),
        tags: vec![
            "system".to_string(),
            "native".to_string(),
            "monospace".to_string(),
        ],
        year: None,
        popularity_rank: Some(2),
    });

    fonts
}

// ═══════════════════════════════════════════════════════════════════════
//  Builder helpers to reduce boilerplate
// ═══════════════════════════════════════════════════════════════════════

#[allow(clippy::too_many_arguments)]
fn mono(
    id: &str,
    name: &str,
    css_family: &str,
    subcategory: Option<FontSubcategory>,
    ligatures: bool,
    nerd_font_available: bool,
    nerd_font_css: Option<&str>,
    nerd_font_package: Option<&str>,
    rec_size: f64,
    rec_lh: f64,
    rec_ls: f64,
    weights: Vec<u16>,
    has_italic: bool,
    is_variable: bool,
    platforms: PlatformAvailability,
    preinstalled: bool,
    license: &str,
    homepage_url: Option<&str>,
    description: &str,
    tags: Vec<&str>,
    year: u16,
    popularity_rank: u16,
) -> FontMetadata {
    FontMetadata {
        id: id.to_string(),
        name: name.to_string(),
        css_family: css_family.to_string(),
        category: FontCategory::Monospace,
        subcategory,
        ligatures,
        nerd_font_available,
        nerd_font_css: nerd_font_css.map(|s| s.to_string()),
        nerd_font_package: nerd_font_package.map(|s| s.to_string()),
        recommended_terminal_size: rec_size,
        recommended_line_height: rec_lh,
        recommended_letter_spacing: rec_ls,
        available_weights: weights,
        has_italic,
        is_variable,
        platforms,
        preinstalled,
        is_free: license != "Proprietary",
        license: Some(license.to_string()),
        homepage_url: homepage_url.map(|s| s.to_string()),
        description: Some(description.to_string()),
        tags: tags.into_iter().map(|s| s.to_string()).collect(),
        year: Some(year),
        popularity_rank: Some(popularity_rank),
    }
}

#[allow(clippy::too_many_arguments)]
fn sans(
    id: &str,
    name: &str,
    css_family: &str,
    subcategory: Option<FontSubcategory>,
    weights: Vec<u16>,
    has_italic: bool,
    is_variable: bool,
    platforms: PlatformAvailability,
    preinstalled: bool,
    license: &str,
    homepage_url: Option<&str>,
    description: &str,
    tags: Vec<&str>,
    year: u16,
    popularity_rank: u16,
) -> FontMetadata {
    FontMetadata {
        id: id.to_string(),
        name: name.to_string(),
        css_family: css_family.to_string(),
        category: FontCategory::SansSerif,
        subcategory,
        ligatures: false,
        nerd_font_available: false,
        nerd_font_css: None,
        nerd_font_package: None,
        recommended_terminal_size: 14.0,
        recommended_line_height: 1.5,
        recommended_letter_spacing: 0.0,
        available_weights: weights,
        has_italic,
        is_variable,
        platforms,
        preinstalled,
        is_free: license != "Proprietary",
        license: Some(license.to_string()),
        homepage_url: homepage_url.map(|s| s.to_string()),
        description: Some(description.to_string()),
        tags: tags.into_iter().map(|s| s.to_string()).collect(),
        year: Some(year),
        popularity_rank: Some(popularity_rank),
    }
}

#[allow(clippy::too_many_arguments)]
fn serif(
    id: &str,
    name: &str,
    css_family: &str,
    subcategory: Option<FontSubcategory>,
    weights: Vec<u16>,
    has_italic: bool,
    is_variable: bool,
    platforms: PlatformAvailability,
    preinstalled: bool,
    license: &str,
    homepage_url: Option<&str>,
    description: &str,
    tags: Vec<&str>,
    year: u16,
    popularity_rank: u16,
) -> FontMetadata {
    FontMetadata {
        id: id.to_string(),
        name: name.to_string(),
        css_family: css_family.to_string(),
        category: FontCategory::Serif,
        subcategory,
        ligatures: false,
        nerd_font_available: false,
        nerd_font_css: None,
        nerd_font_package: None,
        recommended_terminal_size: 14.0,
        recommended_line_height: 1.6,
        recommended_letter_spacing: 0.0,
        available_weights: weights,
        has_italic,
        is_variable,
        platforms,
        preinstalled,
        is_free: license != "Proprietary",
        license: Some(license.to_string()),
        homepage_url: homepage_url.map(|s| s.to_string()),
        description: Some(description.to_string()),
        tags: tags.into_iter().map(|s| s.to_string()).collect(),
        year: Some(year),
        popularity_rank: Some(popularity_rank),
    }
}

fn plat(windows: bool, macos: bool, linux: bool, web: bool) -> PlatformAvailability {
    PlatformAvailability {
        windows,
        macos,
        linux,
        web_font: web,
    }
}
