use std::fmt;

/// A parsed BCP 47 locale tag.
///
/// Supports forms like `en`, `en-US`, `pt-PT`, `zh-Hans-CN`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Locale {
    /// ISO 639 language code (lowercase), e.g. `en`, `pt`.
    pub language: String,
    /// Optional ISO 15924 script code (title-case), e.g. `Hans`.
    pub script: Option<String>,
    /// Optional ISO 3166 region code (uppercase), e.g. `US`, `PT`.
    pub region: Option<String>,
}

impl Locale {
    /// Parse a BCP 47 locale string.
    ///
    /// Accepts `-` and `_` as separators.
    pub fn parse(tag: &str) -> Option<Self> {
        let normalised = tag.replace('_', "-");
        let parts: Vec<&str> = normalised.split('-').collect();
        if parts.is_empty() || parts[0].len() < 2 {
            return None;
        }

        let language = parts[0].to_lowercase();

        let (script, region) = match parts.len() {
            1 => (None, None),
            2 => {
                let p = parts[1];
                if p.len() == 4 {
                    // Script subtag
                    let mut s = p.to_lowercase();
                    // Title-case: first char uppercase
                    if let Some(c) = s.get_mut(0..1) {
                        c.make_ascii_uppercase();
                    }
                    (Some(s), None)
                } else {
                    (None, Some(p.to_uppercase()))
                }
            }
            _ => {
                let p1 = parts[1];
                let p2 = parts[2];
                let scr = if p1.len() == 4 {
                    let mut s = p1.to_lowercase();
                    if let Some(c) = s.get_mut(0..1) {
                        c.make_ascii_uppercase();
                    }
                    Some(s)
                } else {
                    None
                };
                let reg = Some(p2.to_uppercase());
                (scr, reg)
            }
        };

        Some(Locale {
            language,
            script,
            region,
        })
    }

    /// Return the canonical BCP 47 tag, e.g. `en-US`, `pt-PT`.
    pub fn to_tag(&self) -> String {
        let mut tag = self.language.clone();
        if let Some(ref s) = self.script {
            tag.push('-');
            tag.push_str(s);
        }
        if let Some(ref r) = self.region {
            tag.push('-');
            tag.push_str(r);
        }
        tag
    }

    /// The base language without region or script, e.g. `en`.
    pub fn base_language(&self) -> &str {
        &self.language
    }

    /// Build the fallback chain for this locale.
    ///
    /// For `pt-PT` the chain is `["pt-PT", "pt"]`.  For `zh-Hans-CN` the
    /// chain is `["zh-Hans-CN", "zh-Hans", "zh"]`.
    pub fn fallback_chain(&self) -> Vec<String> {
        let mut chain = vec![self.to_tag()];

        if self.region.is_some() {
            if let Some(ref s) = self.script {
                chain.push(format!("{}-{}", self.language, s));
            }
            chain.push(self.language.clone());
        } else if self.script.is_some() {
            chain.push(self.language.clone());
        }

        chain
    }

    /// Detect the OS locale via `sys-locale` and parse it.
    pub fn detect_os_locale() -> Option<Self> {
        sys_locale::get_locale().and_then(|tag| Self::parse(&tag))
    }
}

impl fmt::Display for Locale {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_tag())
    }
}

/// Validate that a string is a plausible BCP 47 locale tag.
pub fn is_valid_locale_tag(tag: &str) -> bool {
    Locale::parse(tag).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple() {
        let l = Locale::parse("en").unwrap();
        assert_eq!(l.language, "en");
        assert_eq!(l.region, None);
        assert_eq!(l.to_tag(), "en");
    }

    #[test]
    fn parse_with_region() {
        let l = Locale::parse("pt-PT").unwrap();
        assert_eq!(l.language, "pt");
        assert_eq!(l.region, Some("PT".into()));
        assert_eq!(l.to_tag(), "pt-PT");
    }

    #[test]
    fn parse_underscore() {
        let l = Locale::parse("en_US").unwrap();
        assert_eq!(l.language, "en");
        assert_eq!(l.region, Some("US".into()));
    }

    #[test]
    fn fallback_chain_with_region() {
        let l = Locale::parse("pt-PT").unwrap();
        assert_eq!(l.fallback_chain(), vec!["pt-PT", "pt"]);
    }

    #[test]
    fn fallback_chain_with_script_and_region() {
        let l = Locale::parse("zh-Hans-CN").unwrap();
        assert_eq!(l.fallback_chain(), vec!["zh-Hans-CN", "zh-Hans", "zh"]);
    }
}
