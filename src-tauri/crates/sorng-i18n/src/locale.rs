use std::{collections::HashSet, fmt};

fn is_ascii_alphanumeric_subtag(part: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&part.len())
        && part
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
}

fn is_variant_subtag(part: &str) -> bool {
    is_ascii_alphanumeric_subtag(part, 5, 8)
        || (part.len() == 4
            && part
                .chars()
                .next()
                .is_some_and(|character| character.is_ascii_digit())
            && part
                .chars()
                .skip(1)
                .all(|character| character.is_ascii_alphanumeric()))
}

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
    /// Canonicalized variant, extension, and private-use subtags.
    pub extensions: Vec<String>,
}

impl Locale {
    /// Parse a BCP 47 locale string.
    ///
    /// Accepts `-` and `_` as separators.
    pub fn parse(tag: &str) -> Option<Self> {
        let normalised = tag.replace('_', "-");
        let parts: Vec<&str> = normalised.split('-').collect();
        if parts.is_empty()
            || !(2..=8).contains(&parts[0].len())
            || !parts[0]
                .chars()
                .all(|character| character.is_ascii_alphabetic())
            || parts.iter().any(|part| part.is_empty())
        {
            return None;
        }

        let language = parts[0].to_lowercase();
        let mut index = 1;
        let mut script = None;
        let mut region = None;

        if let Some(part) = parts.get(index).copied() {
            if part.len() == 4
                && part
                    .chars()
                    .all(|character| character.is_ascii_alphabetic())
            {
                let mut canonical = part.to_lowercase();
                canonical.get_mut(0..1)?.make_ascii_uppercase();
                script = Some(canonical);
                index += 1;
            }
        }
        if let Some(part) = parts.get(index).copied() {
            let valid_region = (part.len() == 2
                && part
                    .chars()
                    .all(|character| character.is_ascii_alphabetic()))
                || (part.len() == 3 && part.chars().all(|character| character.is_ascii_digit()));
            if valid_region {
                region = Some(part.to_uppercase());
                index += 1;
            }
        }

        // Variants precede extensions and must be unique. BCP 47 variants are
        // either 5-8 alphanumeric characters or four characters beginning
        // with a digit (for example `1901`).
        let mut extensions = Vec::new();
        let mut seen_variants = HashSet::new();
        while let Some(part) = parts.get(index).copied() {
            if !is_variant_subtag(part) {
                break;
            }
            let canonical = part.to_ascii_lowercase();
            if !seen_variants.insert(canonical.clone()) {
                return None;
            }
            extensions.push(canonical);
            index += 1;
        }

        // Extensions consist of a unique singleton (except `x`) followed by
        // one or more 2-8 character subtags. Rejecting bare and duplicate
        // singletons keeps malformed values such as `en-u` and
        // `en-a-foo-a-bar` out of `is_valid_locale_tag`.
        let mut seen_singletons = HashSet::new();
        while let Some(singleton) = parts.get(index).copied() {
            if singleton.eq_ignore_ascii_case("x") {
                break;
            }
            if !is_ascii_alphanumeric_subtag(singleton, 1, 1) {
                return None;
            }

            let canonical_singleton = singleton.to_ascii_lowercase();
            if !seen_singletons.insert(canonical_singleton.clone()) {
                return None;
            }
            extensions.push(canonical_singleton);
            index += 1;

            let payload_start = index;
            while let Some(part) = parts.get(index).copied() {
                if !is_ascii_alphanumeric_subtag(part, 2, 8) {
                    break;
                }
                extensions.push(part.to_ascii_lowercase());
                index += 1;
            }
            if index == payload_start {
                return None;
            }
        }

        // Private use is terminal and requires at least one 1-8 character
        // subtag after `x`.
        if parts
            .get(index)
            .is_some_and(|part| part.eq_ignore_ascii_case("x"))
        {
            extensions.push("x".to_string());
            index += 1;
            let private_start = index;
            while let Some(part) = parts.get(index).copied() {
                if !is_ascii_alphanumeric_subtag(part, 1, 8) {
                    return None;
                }
                extensions.push(part.to_ascii_lowercase());
                index += 1;
            }
            if index == private_start {
                return None;
            }
        }

        if index != parts.len() {
            return None;
        }

        Some(Locale {
            language,
            script,
            region,
            extensions,
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
        for extension in &self.extensions {
            tag.push('-');
            tag.push_str(extension);
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

        if !self.extensions.is_empty() {
            let mut core = self.language.clone();
            if let Some(ref script) = self.script {
                core.push('-');
                core.push_str(script);
            }
            if let Some(ref region) = self.region {
                core.push('-');
                core.push_str(region);
            }
            if core != self.language {
                chain.push(core);
            }
        }

        if self.region.is_some() {
            if let Some(ref s) = self.script {
                let script_fallback = format!("{}-{}", self.language, s);
                if !chain.contains(&script_fallback) {
                    chain.push(script_fallback);
                }
            }
            if !chain.contains(&self.language) {
                chain.push(self.language.clone());
            }
        } else if self.script.is_some() {
            if !chain.contains(&self.language) {
                chain.push(self.language.clone());
            }
        } else if !self.extensions.is_empty() {
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

    #[test]
    fn private_use_styled_english_roundtrips_and_falls_back_to_english() {
        for tag in ["en-x-leet", "en-x-pirate"] {
            let locale = Locale::parse(tag).unwrap();
            assert_eq!(locale.to_tag(), tag);
            assert_eq!(locale.fallback_chain(), vec![tag, "en"]);
            assert!(is_valid_locale_tag(tag));
        }
    }

    #[test]
    fn rejects_invalid_private_use_subtags() {
        assert!(Locale::parse("en-x").is_none());
        assert!(Locale::parse("en-x-piratespeak").is_none());
        assert!(Locale::parse("en-x-pirate!").is_none());
    }

    #[test]
    fn parses_variants_extensions_and_private_use_strictly() {
        for (tag, expected) in [
            ("de-ch-1901", "de-CH-1901"),
            ("sl-ROZAJ-BISKE", "sl-rozaj-biske"),
            ("en-us-u-CA-GREGORY", "en-US-u-ca-gregory"),
            ("en-a-FOOBAR-x-DEMO", "en-a-foobar-x-demo"),
        ] {
            let locale = Locale::parse(tag).unwrap();
            assert_eq!(locale.to_tag(), expected);
        }
    }

    #[test]
    fn rejects_malformed_variants_and_extensions() {
        for tag in [
            "en-abc",
            "en-u",
            "en-a-1",
            "en-a-foo-a-bar",
            "sl-rozaj-rozaj",
        ] {
            assert!(Locale::parse(tag).is_none(), "accepted malformed tag {tag}");
            assert!(!is_valid_locale_tag(tag), "validated malformed tag {tag}");
        }
    }
}
