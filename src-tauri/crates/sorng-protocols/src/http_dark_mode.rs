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
        Some(format!(
            "<style id=\"__sorng_dark_bootstrap_v1\" data-background-color=\"{}\" data-text-color=\"{}\">@layer sorng-force-dark;@layer sorng-force-dark{{html:root{{color-scheme:dark!important}}html:root,html:root body,html:root frameset{{background-color:{}!important;color:{}!important;transition:none!important}}{}}}</style>",
            self.background_color,
            self.text_color,
            self.background_color,
            self.text_color,
            cpanel_coverage(&self.background_color, &self.text_color),
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
}
