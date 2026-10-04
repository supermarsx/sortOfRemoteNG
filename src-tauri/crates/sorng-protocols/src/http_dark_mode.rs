//! An explicit, non-secret website palette for the first document paint.
//! No page-provided CSS, URLs, script, or new resource permissions are accepted.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebsiteDarkModeBootstrap {
    #[serde(deserialize_with = "color")]
    pub background_color: String,
    #[serde(deserialize_with = "color")]
    pub text_color: String,
}

fn valid_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

fn color<'de, D: serde::Deserializer<'de>>(decoder: D) -> Result<String, D::Error> {
    let value = String::deserialize(decoder)?;
    if !valid_color(&value) {
        return Err(serde::de::Error::custom("Expected a six-digit hex color"));
    }
    Ok(value)
}

fn blend(background: &str, text: &str, text_percent: u16) -> String {
    let component = |offset: usize| {
        let background = u16::from_str_radix(&background[offset..offset + 2], 16).unwrap();
        let text = u16::from_str_radix(&text[offset..offset + 2], 16).unwrap();
        (background * (100 - text_percent) + text * text_percent + 50) / 100
    };
    format!(
        "#{:02x}{:02x}{:02x}",
        component(1),
        component(3),
        component(5)
    )
}

fn force_surface_coverage(background: &str, text: &str) -> String {
    // Keep structural surfaces dark after the temporary loading palette retires,
    // including panels added by an SPA with no cPanel DOM markers.
    format!(
        "html:root body :is(main,section,article,aside,nav,header,footer,dialog,form,table,.container,.container-fluid,.content,.wrapper,.layout,.surface,.card,.panel,.panel-body,.modal-content,.dropdown-menu,[role='main'],[role='dialog'],[role~='listbox'],[role~='menu'],[role~='tooltip'],[popover],.ms-Callout,.ms-Callout-main,.ms-Suggestions,.ms-ContextualMenu,.ui-autocomplete){{background-color:{background}!important;color:{text}!important;background-image:none!important;transition:none!important}}"
    )
}

fn generic_surface_coverage(text: &str) -> String {
    // Persistent structural floor for arbitrary HTML (including pseudo surfaces),
    // independent of site markers and engine readiness. Keep this contract in
    // sync with web_dark_mode_client.js. The root paint shield is not selected.
    // Preserve sprites on explicit icon surfaces, never arbitrary panels. No
    // image analysis/fetching; actual media and the SVG subtree are untouched.
    let selector = "html:root body *:not(iframe):not(frame):not(img):not(picture):not(video):not(audio):not(canvas):not(svg):not(svg *)";
    let icons = ":is(i,span):is(.icon,.fa,.fas,.far,.fab,.glyphicon,.material-icons,.material-symbols-outlined,[class^='icon-'],[class*=' icon-'],[class^='fa-'],[class*=' fa-'])";
    let no_sprite = format!("{selector}:not({icons})");
    let icons = format!("html:root body {icons}");
    format!(
        "{selector},{selector}::before,{selector}::after,html:root body::before,html:root body::after{{background-color:transparent!important;color:{text}!important;transition:none!important}}{no_sprite},{no_sprite}::before,{no_sprite}::after,html:root body::before,html:root body::after{{background-image:none!important}}{icons},{icons}::before,{icons}::after{{-webkit-text-fill-color:currentColor!important}}"
    )
}

fn cpanel_coverage(background: &str, text: &str) -> String {
    let surface = blend(background, text, 8);
    let header = blend(background, text, 12);
    let border = blend(background, text, 22);
    let root = "html:root:has(:is(#cpanel_body,[href*='/frontend/jupiter/'],[src*='/frontend/jupiter/'],[href*='/frontend/meridian/'],[src*='/frontend/meridian/'],[href*='/frontend/paper_lantern/'],[src*='/frontend/paper_lantern/'])) ";
    format!(
        "{root}:is(#content,#main-content,.main-content,.page-content,[class*='cpanel-main'],[class*='cpanel-content']){{background-color:{background}!important;color:{text}!important}}{root}:is(.card,.panel,.panel-body,.well,.widget,.list-group-item,.modal-content,.dropdown-menu,.popover,table,thead,tbody,tr,td,th,[class*='cpanel-card'],[class*='cpanel-panel']){{background-color:{surface}!important;color:{text}!important;border-color:{border}!important}}{root}:is(div.header,header,[role='banner'],#header,#topbar,#top-bar,.topbar,.top-bar,.navbar,.navbar-header,.navbar-default,.card-header,.card-footer,.panel-heading,.panel-footer,.modal-header,.modal-footer){{background-color:{header}!important;background-image:none!important;color:{text}!important;border-color:{border}!important;transition:none!important}}"
    )
}

impl WebsiteDarkModeBootstrap {
    pub fn validate(&self) -> Result<(), String> {
        if !valid_color(&self.background_color) || !valid_color(&self.text_color) {
            return Err("Website dark-mode bootstrap requires six-digit hex colors".into());
        }
        Ok(())
    }

    pub(super) fn style(&self) -> Option<String> {
        self.validate().ok()?;
        // Start the temporary loading palette in the response itself, before
        // the readiness bridge or host command can run. Important declarations
        // reverse layer order: explicit forced surfaces win over the permanent
        // generic floor, then loading protection, then the site's own layers.
        // The runtime adopts this node and retires loading protection when the
        // engine (or CSS fallback) is ready. With scripts blocked it stays a
        // static CSS fallback. DarkReader must not convert its own preload.
        Some(format!(
            "<style id=\"__sorng_dark_bootstrap_v1\" class=\"darkreader\" data-background-color=\"{}\" data-text-color=\"{}\">@layer sorng-force-dark,sorng-dark-surface,sorng-dark-loading;@layer sorng-force-dark{{html:root{{color-scheme:dark!important}}html:root,html:root body,html:root frameset{{background-color:{}!important;color:{}!important;background-image:none!important;transition:none!important}}{}{}}}@layer sorng-dark-surface{{{}}}@layer sorng-dark-loading{{html:root:not([data-sorng-dark-ready]) body *:not(iframe):not(frame):not(img):not(picture):not(video):not(audio):not(canvas):not(svg):not(svg *){{background-color:transparent!important;color:{}!important;transition:none!important}}}}</style>",
            self.background_color,
            self.text_color,
            self.background_color,
            self.text_color,
            force_surface_coverage(&self.background_color, &self.text_color),
            cpanel_coverage(&self.background_color, &self.text_color),
            generic_surface_coverage(&self.text_color),
            self.text_color,
        ))
    }

    pub(super) fn paint_shield(&self) -> Option<String> {
        self.validate().ok()?;
        // Installed only when the readiness runtime is permitted. The root
        // pseudo-element covers even inline-important light content while the
        // engine prepares its sheets; the runtime explicitly releases it.
        Some(format!(
            "<style id=\"__sorng_dark_paint_shield_v1\" class=\"darkreader\">@layer sorng-force-dark{{html:root:not([data-sorng-dark-presented])::after{{content:\"\"!important;display:block!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;background:{}!important;opacity:1!important;visibility:visible!important;z-index:2147483647!important;pointer-events:none!important;transition:none!important;animation:none!important;filter:none!important;transform:none!important}}}}</style>",
            self.background_color,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn palette_is_closed_and_never_accepts_css_or_markup() {
        for value in [
            "red",
            "#fff",
            "#000000;",
            "#000000</style>",
            "url(https://evil.test)",
            "#１２３",
        ] {
            assert!(
                serde_json::from_value::<WebsiteDarkModeBootstrap>(serde_json::json!({
                    "backgroundColor": value, "textColor": "#e8e6e3"
                }))
                .is_err()
            );
            let direct = WebsiteDarkModeBootstrap {
                background_color: value.into(),
                text_color: "#e8e6e3".into(),
            };
            assert!(direct.style().is_none());
        }
        assert!(
            serde_json::from_value::<WebsiteDarkModeBootstrap>(serde_json::json!({
                "backgroundColor": "#181a1b", "textColor": "#e8e6e3", "css": "body{}"
            }))
            .is_err()
        );
    }

    #[test]
    fn first_paint_style_covers_cpanel_surfaces_without_external_css() {
        let style = WebsiteDarkModeBootstrap {
            background_color: "#181a1b".into(),
            text_color: "#e8e6e3".into(),
        }
        .style()
        .unwrap();

        assert!(style.contains("[href*='/frontend/jupiter/']"));
        assert!(style.contains("[href*='/frontend/meridian/']"));
        assert!(style.contains("#cpanel_body"));
        assert!(style.contains(".panel-body"));
        assert!(style.contains("background-color:#292a2b!important"));
        assert!(style.contains("border-color:#464747!important"));
        assert!(!style.contains("@import"));
        assert!(!style.contains("url("));
    }

    #[test]
    fn first_paint_loading_palette_precedes_scripts_and_yields_to_runtime_readiness() {
        let style = WebsiteDarkModeBootstrap {
            background_color: "#181a1b".into(),
            text_color: "#e8e6e3".into(),
        }
        .style()
        .unwrap();

        assert!(style.contains("class=\"darkreader\""));
        assert!(style.contains("@layer sorng-force-dark,sorng-dark-surface,sorng-dark-loading;"));
        assert!(style.contains("@layer sorng-dark-loading{html:root:not([data-sorng-dark-ready]) body *:not(iframe):not(frame):not(img):not(picture):not(video):not(audio):not(canvas):not(svg):not(svg *){background-color:transparent!important;color:#e8e6e3!important;transition:none!important}}"));
        // Background removal belongs to the permanent, icon-aware surface
        // layer. A blanket loading rule would erase icon sprites before the
        // runtime starts, even though the permanent layer preserves them.
        let loading = style.split_once("@layer sorng-dark-loading{").unwrap().1;
        assert!(!loading.contains("background-image:"));
        let surface = style
            .split_once("@layer sorng-dark-surface{")
            .unwrap()
            .1
            .split_once("}@layer sorng-dark-loading{")
            .unwrap()
            .0;
        let backgrounds: Vec<_> = surface
            .split('}')
            .filter(|rule| rule.contains("background-image:none!important"))
            .collect();
        assert_eq!(backgrounds.len(), 1);
        assert!(backgrounds[0].contains(":not(:is(i,span):is(.icon,"));
        assert!(!style.contains("<script"));
        assert!(!style.contains("visibility:"));
        assert!(!style.contains("display:"));
    }

    #[test]
    fn structural_force_palette_survives_readiness_and_precedes_cpanel_overrides() {
        let style = WebsiteDarkModeBootstrap {
            background_color: "#102030".into(),
            text_color: "#d0e0f0".into(),
        }
        .style()
        .unwrap();
        let force = style
            .split_once("@layer sorng-force-dark{")
            .unwrap()
            .1
            .split_once("}@layer sorng-dark-surface{")
            .unwrap()
            .0;
        let baseline = "html:root body :is(main,section,article,aside,nav,header,footer,dialog,form,table,.container,.container-fluid,.content,.wrapper,.layout,.surface,.card,.panel,.panel-body,.modal-content,.dropdown-menu,[role='main'],[role='dialog'],[role~='listbox'],[role~='menu'],[role~='tooltip'],[popover],.ms-Callout,.ms-Callout-main,.ms-Suggestions,.ms-ContextualMenu,.ui-autocomplete){background-color:#102030!important;color:#d0e0f0!important;background-image:none!important;transition:none!important}";
        assert!(force.contains(baseline));
        assert!(force.contains("html:root,html:root body,html:root frameset{background-color:#102030!important;color:#d0e0f0!important;background-image:none!important;transition:none!important}"));
        assert!(!force.contains("data-sorng-dark-ready"));
        let baseline_end = force.find(baseline).unwrap() + baseline.len();
        assert!(force[baseline_end..].starts_with("html:root:has(:is(#cpanel_body,"));
        // The permanent rule must not directly target embedded/media elements.
        let selectors = baseline.split_once('{').unwrap().0;
        for media in ["iframe", "img", "video", "canvas", "svg"] {
            assert!(!selectors.contains(media));
        }
    }

    #[test]
    fn generic_surface_floor_is_permanent_marker_free_and_below_explicit_force() {
        let style = WebsiteDarkModeBootstrap {
            background_color: "#102030".into(),
            text_color: "#d0e0f0".into(),
        }
        .style()
        .unwrap();
        assert!(style.contains("@layer sorng-force-dark,sorng-dark-surface,sorng-dark-loading;"));
        let force = style.find("@layer sorng-force-dark{").unwrap();
        let generic = style.find("@layer sorng-dark-surface{").unwrap();
        let loading = style.find("@layer sorng-dark-loading{").unwrap();
        assert!(force < generic && generic < loading);
        let floor = &style[generic..loading];
        for marker in [
            "data-sorng-dark-ready",
            "data-sorng-dark-presented",
            "cpanel",
            ":has(",
            ".panel",
            ".container",
        ] {
            assert!(!floor.contains(marker), "unexpected marker: {marker}");
        }
        assert!(floor.contains("background-color:transparent!important;color:#d0e0f0!important;transition:none!important"));
        assert!(floor.contains(":not(:is(i,span):is(.icon,"));
        assert!(floor.contains("{-webkit-text-fill-color:currentColor!important}"));
        assert!(!floor.contains("url("));
        assert!(!floor.contains("@import"));
        assert!(!floor.contains("html:root::after"));
    }

    #[test]
    fn generic_floor_covers_arbitrary_descendants_and_pseudos_but_excludes_media() {
        let floor = generic_surface_coverage("#d0e0f0");
        let (selectors, _) = floor.split_once('{').unwrap();
        let selectors: Vec<_> = selectors.split(',').collect();
        assert_eq!(selectors.len(), 5);
        assert_eq!(selectors[1], format!("{}::before", selectors[0]));
        assert_eq!(selectors[2], format!("{}::after", selectors[0]));
        assert_eq!(selectors[3], "html:root body::before");
        assert_eq!(selectors[4], "html:root body::after");
        assert!(!selectors
            .iter()
            .any(|selector| selector.starts_with("html:root::")));
        for selector in &selectors[..3] {
            assert!(selector.starts_with("html:root body *"));
            for media in [
                "iframe", "frame", "img", "picture", "video", "audio", "canvas", "svg", "svg *",
            ] {
                assert!(
                    selector.contains(&format!(":not({media})")),
                    "{selector} must exclude {media}"
                );
            }
        }
    }
}
