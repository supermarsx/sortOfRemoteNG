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
        "html:root body :is(main,section,article,aside,nav,header,footer,dialog,form,table,.container,.container-fluid,.content,.wrapper,.layout,.surface,.card,.panel,.panel-body,.modal-content,.dropdown-menu,[role='main'],[role='dialog']){{background-color:{background}!important;color:{text}!important;background-image:none!important;transition:none!important}}"
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
        // reverse layer order: persistent canvas/surface/cPanel colors win over
        // loading transparency, and both must precede the site's own layers.
        // The runtime adopts this node and retires loading protection when the
        // engine (or CSS fallback) is ready. With scripts blocked it stays a
        // static CSS fallback. DarkReader must not convert its own preload.
        Some(format!(
            "<style id=\"__sorng_dark_bootstrap_v1\" class=\"darkreader\" data-background-color=\"{}\" data-text-color=\"{}\">@layer sorng-force-dark,sorng-dark-loading;@layer sorng-force-dark{{html:root{{color-scheme:dark!important}}html:root,html:root body,html:root frameset{{background-color:{}!important;color:{}!important;transition:none!important}}{}{}}}@layer sorng-dark-loading{{html:root:not([data-sorng-dark-ready]) body :not(iframe):not(img):not(video):not(canvas):not(svg):not(svg *){{background-color:transparent!important;color:{}!important;background-image:none!important;transition:none!important}}}}</style>",
            self.background_color,
            self.text_color,
            self.background_color,
            self.text_color,
            force_surface_coverage(&self.background_color, &self.text_color),
            cpanel_coverage(&self.background_color, &self.text_color),
            self.text_color,
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
        assert!(style.contains("@layer sorng-force-dark,sorng-dark-loading;"));
        assert!(style.contains("@layer sorng-dark-loading{html:root:not([data-sorng-dark-ready]) body :not(iframe):not(img):not(video):not(canvas):not(svg):not(svg *){background-color:transparent!important;color:#e8e6e3!important;background-image:none!important;transition:none!important}}"));
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
            .split_once("}@layer sorng-dark-loading{")
            .unwrap()
            .0;
        let baseline = "html:root body :is(main,section,article,aside,nav,header,footer,dialog,form,table,.container,.container-fluid,.content,.wrapper,.layout,.surface,.card,.panel,.panel-body,.modal-content,.dropdown-menu,[role='main'],[role='dialog']){background-color:#102030!important;color:#d0e0f0!important;background-image:none!important;transition:none!important}";
        assert!(force.contains(baseline));
        assert!(!force.contains("data-sorng-dark-ready"));
        let baseline_end = force.find(baseline).unwrap() + baseline.len();
        assert!(force[baseline_end..].starts_with("html:root:has(:is(#cpanel_body,"));
        // The permanent rule must not directly target embedded/media elements.
        let selectors = baseline.split_once('{').unwrap().0;
        for media in ["iframe", "img", "video", "canvas", "svg"] {
            assert!(!selectors.contains(media));
        }
    }
}
