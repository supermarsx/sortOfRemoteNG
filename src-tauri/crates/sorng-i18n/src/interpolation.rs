use std::collections::HashMap;

/// Interpolate `{{variable}}` placeholders in a template string.
///
/// Variables are looked up in `vars`.  Unknown placeholders are left as-is
/// so the caller can decide whether to raise an error or degrade gracefully.
pub fn interpolate(template: &str, vars: &HashMap<String, String>) -> String {
    let mut result = String::with_capacity(template.len());
    let bytes = template.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if i + 1 < len && bytes[i] == b'{' && bytes[i + 1] == b'{' {
            // Found opening "{{"
            i += 2;
            let start = i;
            let mut found_close = false;
            while i + 1 < len {
                if bytes[i] == b'}' && bytes[i + 1] == b'}' {
                    found_close = true;
                    break;
                }
                i += 1;
            }

            if found_close {
                let var_name = &template[start..i];
                let trimmed = var_name.trim();
                if let Some(val) = vars.get(trimmed) {
                    result.push_str(val);
                } else {
                    result.push_str("{{");
                    result.push_str(var_name);
                    result.push_str("}}");
                }
                i += 2; // skip closing "}}"
            } else {
                // unterminated placeholder — emit raw
                result.push_str("{{");
                result.push_str(&template[start..]);
                break;
            }
        } else {
            result.push(bytes[i] as char);
            i += 1;
        }
    }

    result
}

/// Resolve an ICU-style plural form.
///
/// Given a map of plural category → template (e.g. `{"one": "{{count}} item",
/// "other": "{{count}} items"}`) and a `count`, selects the right form and
/// interpolates `{{count}}`.
///
/// Categories tried (in order): exact match `=N`, then `zero`, `one`, `two`,
/// `few`, `many`, `other`.
pub fn pluralise(
    forms: &HashMap<String, String>,
    count: i64,
    extra_vars: &HashMap<String, String>,
) -> Option<String> {
    // 1. Exact match  =0, =1, =42 …
    let exact_key = format!("={count}");
    if let Some(tmpl) = forms.get(&exact_key) {
        let mut vars = extra_vars.clone();
        vars.insert("count".into(), count.to_string());
        return Some(interpolate(tmpl, &vars));
    }

    // 2. CLDR category (simplified English-centric rules; extend as needed)
    let category = cldr_category_en(count);
    let candidates = [category, "other"];

    for cat in &candidates {
        if let Some(tmpl) = forms.get(*cat) {
            let mut vars = extra_vars.clone();
            vars.insert("count".into(), count.to_string());
            return Some(interpolate(tmpl, &vars));
        }
    }

    None
}

/// Simplified CLDR plural category for English-like locales.
fn cldr_category_en(count: i64) -> &'static str {
    match count.unsigned_abs() {
        0 => "zero",
        1 => "one",
        2 => "two",
        _ => "other",
    }
}

/// Plural categories supported by the CLDR for common European languages.
///
/// Extend this mapping when adding locale-specific plural rules.
pub fn cldr_category(locale_language: &str, count: i64) -> &'static str {
    match locale_language {
        // English, German, Dutch, Italian, Spanish, Portuguese …
        "en" | "de" | "nl" | "it" | "es" | "pt" => cldr_category_en(count),

        // French: 0 and 1 are singular
        "fr" => match count.unsigned_abs() {
            0 | 1 => "one",
            _ => "other",
        },

        // Polish: complex rules
        "pl" => {
            let abs = count.unsigned_abs();
            let mod10 = abs % 10;
            let mod100 = abs % 100;
            if abs == 1 {
                "one"
            } else if (2..=4).contains(&mod10) && !(12..=14).contains(&mod100) {
                "few"
            } else if mod10 == 0 || (5..=9).contains(&mod10) || (12..=14).contains(&mod100) {
                "many"
            } else {
                "other"
            }
        }

        // Russian / Ukrainian
        "ru" | "uk" => {
            let abs = count.unsigned_abs();
            let mod10 = abs % 10;
            let mod100 = abs % 100;
            if mod10 == 1 && mod100 != 11 {
                "one"
            } else if (2..=4).contains(&mod10) && !(12..=14).contains(&mod100) {
                "few"
            } else {
                "many"
            }
        }

        // Arabic
        "ar" => {
            let abs = count.unsigned_abs();
            let mod100 = abs % 100;
            match abs {
                0 => "zero",
                1 => "one",
                2 => "two",
                _ if (3..=10).contains(&mod100) => "few",
                _ if (11..=99).contains(&mod100) => "many",
                _ => "other",
            }
        }

        _ => cldr_category_en(count),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simple_interpolation() {
        let mut vars = HashMap::new();
        vars.insert("name".into(), "Alice".into());
        assert_eq!(interpolate("Hello {{name}}!", &vars), "Hello Alice!");
    }

    #[test]
    fn missing_variable_preserved() {
        let vars = HashMap::new();
        assert_eq!(interpolate("Hello {{name}}!", &vars), "Hello {{name}}!");
    }

    #[test]
    fn multiple_variables() {
        let mut vars = HashMap::new();
        vars.insert("count".into(), "5".into());
        vars.insert("item".into(), "file".into());
        assert_eq!(
            interpolate("{{count}} {{item}}(s) found", &vars),
            "5 file(s) found"
        );
    }

    #[test]
    fn pluralise_english() {
        let mut forms = HashMap::new();
        forms.insert("one".into(), "{{count}} item".into());
        forms.insert("other".into(), "{{count}} items".into());
        let empty = HashMap::new();

        assert_eq!(pluralise(&forms, 1, &empty).unwrap(), "1 item");
        assert_eq!(pluralise(&forms, 5, &empty).unwrap(), "5 items");
        assert_eq!(pluralise(&forms, 0, &empty).unwrap(), "0 items");
    }

    #[test]
    fn pluralise_exact() {
        let mut forms = HashMap::new();
        forms.insert("=0".into(), "no items".into());
        forms.insert("one".into(), "{{count}} item".into());
        forms.insert("other".into(), "{{count}} items".into());
        let empty = HashMap::new();

        assert_eq!(pluralise(&forms, 0, &empty).unwrap(), "no items");
    }
}
