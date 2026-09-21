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
            "<style id=\"__sorng_dark_bootstrap_v1\">html:root{{color-scheme:dark!important}}html:root,html:root body,html:root frameset{{background-color:{}!important;color:{}!important}}</style>",
            self.background_color, self.text_color
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
}
