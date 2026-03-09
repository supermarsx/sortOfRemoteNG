use crate::types::SystemFont;

/// Detect fonts installed on the system.
pub struct FontDetector;

impl FontDetector {
    /// Enumerate system-installed fonts.
    /// Returns a list of discovered fonts with basic metadata.
    pub async fn detect() -> Vec<SystemFont> {
        #[allow(unused_mut, unused_assignments)]
        let mut fonts = Vec::new();

        #[cfg(target_os = "windows")]
        {
            fonts = Self::detect_windows().await;
        }

        #[cfg(target_os = "macos")]
        {
            fonts = Self::detect_macos().await;
        }

        #[cfg(target_os = "linux")]
        {
            fonts = Self::detect_linux().await;
        }

        // De-duplicate by family name.
        fonts.sort_by(|a, b| a.family.cmp(&b.family));
        fonts.dedup_by(|a, b| a.family == b.family);

        fonts
    }

    /// Detect monospace-only system fonts.
    pub async fn detect_monospace() -> Vec<SystemFont> {
        Self::detect()
            .await
            .into_iter()
            .filter(|f| f.is_monospace)
            .collect()
    }

    // ─── Windows: enumerate via registry ────────────────────────

    #[cfg(target_os = "windows")]
    async fn detect_windows() -> Vec<SystemFont> {
        use std::process::Command;

        // Use PowerShell to list installed fonts via .NET.
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                r#"
                Add-Type -AssemblyName System.Drawing
                $fonts = (New-Object System.Drawing.Text.InstalledFontCollection).Families
                foreach ($f in $fonts) {
                    Write-Output $f.Name
                }
                "#,
            ])
            .output();

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                stdout
                    .lines()
                    .filter(|l| !l.trim().is_empty())
                    .map(|line| {
                        let family = line.trim().to_string();
                        let is_mono = is_likely_monospace(&family);
                        SystemFont {
                            family,
                            full_name: None,
                            path: None,
                            is_monospace: is_mono,
                            in_registry: false,
                        }
                    })
                    .collect()
            }
            Err(e) => {
                log::warn!("Failed to detect Windows fonts: {}", e);
                Vec::new()
            }
        }
    }

    // ─── macOS: Core Text via system_profiler ────────────────────

    #[cfg(target_os = "macos")]
    async fn detect_macos() -> Vec<SystemFont> {
        use std::process::Command;

        // Use system_profiler to enumerate fonts.
        let output = Command::new("system_profiler")
            .args(["SPFontsDataType", "-detailLevel", "mini"])
            .output();

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let mut fonts = Vec::new();
                let mut current_family: Option<String> = None;
                let mut current_path: Option<String> = None;

                for line in stdout.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("Family:") {
                        if let Some(family) = current_family.take() {
                            let is_mono = is_likely_monospace(&family);
                            fonts.push(SystemFont {
                                family,
                                full_name: None,
                                path: current_path.take(),
                                is_monospace: is_mono,
                                in_registry: false,
                            });
                        }
                        current_family =
                            Some(trimmed.trim_start_matches("Family:").trim().to_string());
                    } else if trimmed.starts_with("Location:") {
                        current_path =
                            Some(trimmed.trim_start_matches("Location:").trim().to_string());
                    }
                }
                // Don't forget the last one.
                if let Some(family) = current_family {
                    let is_mono = is_likely_monospace(&family);
                    fonts.push(SystemFont {
                        family,
                        full_name: None,
                        path: current_path,
                        is_monospace: is_mono,
                        in_registry: false,
                    });
                }

                fonts
            }
            Err(e) => {
                log::warn!("Failed to detect macOS fonts: {}", e);
                Vec::new()
            }
        }
    }

    // ─── Linux: fc-list ─────────────────────────────────────────

    #[cfg(target_os = "linux")]
    async fn detect_linux() -> Vec<SystemFont> {
        use std::process::Command;

        let output = Command::new("fc-list")
            .args(["--format", "%{family}|%{file}|%{spacing}\n"])
            .output();

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                stdout
                    .lines()
                    .filter(|l| !l.trim().is_empty())
                    .filter_map(|line| {
                        let parts: Vec<&str> = line.splitn(3, '|').collect();
                        if parts.is_empty() {
                            return None;
                        }

                        // fc-list may return "Family1,Family2" — take the first.
                        let family = parts[0].split(',').next()?.trim().to_string();
                        let path = parts.get(1).map(|p| p.trim().to_string());

                        // spacing=100 means monospace in fontconfig.
                        let spacing = parts.get(2).and_then(|s| s.trim().parse::<u32>().ok());
                        let is_mono = spacing == Some(100) || is_likely_monospace(&family);

                        Some(SystemFont {
                            family,
                            full_name: None,
                            path,
                            is_monospace: is_mono,
                            in_registry: false,
                        })
                    })
                    .collect()
            }
            Err(e) => {
                log::warn!("Failed to detect Linux fonts via fc-list: {}", e);
                Vec::new()
            }
        }
    }
}

/// Heuristic: is this font family likely monospace?
fn is_likely_monospace(name: &str) -> bool {
    let lower = name.to_lowercase();
    let mono_keywords = [
        "mono",
        "consol",
        "courier",
        "terminal",
        "fixed",
        "code",
        "hack",
        "menlo",
        "iosevka",
        "proggy",
        "terminus",
        "luxi",
        "nerd font",
        "powerline",
    ];
    mono_keywords.iter().any(|k| lower.contains(k))
}
