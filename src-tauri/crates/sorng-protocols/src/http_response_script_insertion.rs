//! Conservative executable HTML tail placement, not a general HTML rewriter.

use super::html_tag;

/// A quote only opens a quoted attribute value immediately after '='. The
/// shared tag reader is intentionally simpler; do not let its wider scan hide
/// a live template after malformed unquoted text such as x=a'.
fn conservative_attributes(bytes: &[u8], mut cursor: usize, end: usize) -> bool {
    while cursor < end {
        while cursor < end && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        match bytes.get(cursor) {
            Some(b'>') => return cursor + 1 == end,
            Some(b'/') => return bytes.get(cursor + 1) == Some(&b'>') && cursor + 2 == end,
            None => return false,
            _ => {}
        }
        let name_start = cursor;
        while cursor < end
            && !bytes[cursor].is_ascii_whitespace()
            && !matches!(bytes[cursor], b'=' | b'/' | b'>')
        {
            if matches!(bytes[cursor], b'\'' | b'"' | b'<' | b'`') {
                return false;
            }
            cursor += 1;
        }
        if cursor == name_start {
            return false;
        }
        while cursor < end && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if bytes.get(cursor) != Some(&b'=') {
            continue; // Boolean attribute.
        }
        cursor += 1;
        while cursor < end && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if matches!(bytes.get(cursor), Some(b'\'' | b'"')) {
            let quote = bytes[cursor];
            cursor += 1;
            while cursor < end && bytes[cursor] != quote {
                cursor += 1;
            }
            if cursor >= end {
                return false;
            }
            cursor += 1;
            if cursor < end
                && !bytes[cursor].is_ascii_whitespace()
                && !matches!(bytes[cursor], b'/' | b'>')
            {
                return false;
            }
        } else {
            let value_start = cursor;
            while cursor < end && !bytes[cursor].is_ascii_whitespace() && bytes[cursor] != b'>' {
                if matches!(bytes[cursor], b'\'' | b'"' | b'<' | b'=' | b'`') {
                    return false;
                }
                cursor += 1; // Slash is valid inside an unquoted value.
            }
            if cursor == value_start {
                return false;
            }
        }
    }
    false
}

fn delimited_tag(html: &str, start: usize) -> Option<(&str, bool, usize)> {
    let (name, closing, end) = html_tag(html, start)?;
    if !name.is_empty() {
        let delimiter = html
            .as_bytes()
            .get(start + 1 + usize::from(closing) + name.len())?;
        if !delimiter.is_ascii_whitespace() && !matches!(delimiter, b'/' | b'>') {
            return None;
        }
        if !conservative_attributes(
            html.as_bytes(),
            start + 1 + usize::from(closing) + name.len(),
            end,
        ) {
            return None;
        }
    } else {
        // Unknown declarations/processing instructions are HTML bogus comments,
        // whose first-> rule differs from this quote-aware tag reader.
        let declaration = &html[start..];
        if !declaration.starts_with("<!doctype")
            || !declaration
                .as_bytes()
                .get(9)
                .is_some_and(u8::is_ascii_whitespace)
        {
            return None;
        }
    }
    Some((name, closing, end))
}

pub(super) fn insertion_position(html: &str) -> Option<usize> {
    let lower = html.to_ascii_lowercase();
    let mut cursor = 0;
    let mut templates = 0usize;
    let mut foreign = Vec::new();
    while let Some(offset) = lower[cursor..].find('<') {
        let start = cursor + offset;
        if lower[start..].starts_with("<!--") {
            let end = lower[start + 4..].find("-->")?;
            let content = &lower[start + 4..start + 4 + end];
            // HTML can terminate malformed comments before the usual -->.
            // Refuse rather than skip a following live template/tag as comment.
            if content.starts_with('>')
                || content.starts_with("->")
                || content.contains("--!")
                || content.contains("<!--")
            {
                return None;
            }
            cursor = start + 4 + end + 3;
            continue;
        }
        if lower[start..].starts_with("<![cdata[") {
            // CDATA meaning depends on the complete namespace/integration-
            // point stack. Do not mistake HTML bogus comments for inert data.
            return None;
        }
        let (name, closing, end) = delimited_tag(&lower, start)?;
        cursor = end;
        if matches!(name, "svg" | "math") {
            if closing {
                if foreign.last().copied() != Some(name) {
                    return None;
                }
                foreign.pop();
            } else if !lower[start..end]
                .trim_end_matches('>')
                .trim_end()
                .ends_with('/')
            {
                if foreign.len() >= 128 {
                    return None;
                }
                foreign.push(name);
            }
            continue;
        }
        if name == "template" {
            if closing {
                templates = templates.checked_sub(1)?;
            } else {
                templates = templates.checked_add(1)?;
            }
            continue;
        }
        if closing {
            if name == "body" && templates == 0 && foreign.is_empty() {
                return Some(start);
            }
            continue;
        }
        if name == "plaintext" {
            return None;
        }
        if matches!(
            name,
            "script"
                | "style"
                | "textarea"
                | "title"
                | "xmp"
                | "iframe"
                | "noembed"
                | "noframes"
                | "noscript"
        ) {
            let prefix = format!("</{name}");
            let mut search = end;
            let (close, close_end) = loop {
                let offset = lower[search..].find(&prefix)?;
                let candidate = search + offset;
                if let Some((closed_name, true, candidate_end)) = delimited_tag(&lower, candidate) {
                    if closed_name == name {
                        break (candidate, candidate_end);
                    }
                }
                search = candidate + prefix.len();
            };
            // Script double-escaped states need a full HTML tokenizer. Refuse
            // this unusual ambiguous case instead of inserting inside script.
            if name == "script" {
                let body = &lower[end..close];
                if body
                    .find("<!--")
                    .is_some_and(|escaped| body[escaped + 4..].contains("<script"))
                {
                    return None;
                }
            }
            cursor = close_end;
        }
    }
    // Appending is safe only when EOF was reached outside inert/raw-text state.
    (templates == 0 && foreign.is_empty()).then_some(html.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn executable_tail_matches_shared_browser_fixtures() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/proxy-page-script-insertion.json"
        ))
        .unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let html = fixture["input"].as_str().unwrap();
            let expected = fixture["expected"].as_str().unwrap();
            assert_eq!(
                super::super::inject_page_scripts(html, "__SORNG_PAGE_SCRIPTS__"),
                expected,
                "{}",
                fixture["name"]
            );
        }
    }

    #[test]
    fn ambiguous_or_unclosed_inert_contexts_do_not_receive_scripts() {
        for html in [
            "<body><!-- unclosed </body>",
            "<body><script>let example = '</body>'",
            "<body><script>window.example='</script:fake>';</body>",
            "<body><script>window.example='</script!>';</body>",
            "<body><template><input></body>",
            "<body><textarea>example </body>",
            "<body><plaintext>example </body>",
            "<body><svg><text>example </body>",
            "<body><script><!--<script>nested</script></body>",
            "<body><div title='unterminated </body>",
            "<body><![CDATA[><template>]]></body>",
            "<body><!-- --!><template><!-- x --></body>",
            "<body><!--><template><!-- x --></body>",
            "<body><!example \"><template>\"></body>",
        ] {
            assert_eq!(insertion_position(html), None, "{html}");
            assert_eq!(
                super::super::inject_page_scripts(html, "<script>no()</script>"),
                html
            );
        }
    }
}
