//! Native-only adaptation of the pinned, unmodified Dark Reader API bundle.
//! The web-proxy engine continues to use the exact upstream vendor artifact.

const DOM_PROXY: &str = include_str!("native_darkreader_dom_proxy.js.in");
const NATIVE_PROXY: &str = include_str!("native_darkreader_proxy.js");

pub(super) fn adapt(source: &str) -> Option<String> {
    // Git checkouts may use either line ending. Only a single exact reviewed
    // upstream block can be adapted; vendor drift disables this enhancement
    // instead of attempting a broad rewrite or relaxing the website's CSP.
    let source = source.replace("\r\n", "\n");
    let old = DOM_PROXY.replace("\r\n", "\n");
    if source.matches(old.as_str()).count() != 1 {
        return None;
    }
    Some(source.replacen(old.as_str(), &NATIVE_PROXY.replace("\r\n", "\n"), 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinned_bundle_has_one_native_only_adaptation() {
        let vendor = include_str!("../../sorng-protocols/src/vendor/darkreader/darkreader.js");
        let output = adapt(vendor).expect("review vendor proxy changes before upgrading");
        assert!(!output.contains("const proxyScript = createOrUpdateScript"));
        assert_eq!(
            output
                .matches(NATIVE_PROXY.replace("\r\n", "\n").trim())
                .count(),
            1
        );
        assert!(output.contains("function injectProxy("));
        assert!(output.contains("__darkreader__cleanUp"));
        let crlf = vendor.replace("\r\n", "\n").replace('\n', "\r\n");
        assert!(adapt(&crlf).is_some_and(|adapted| adapted == output));
    }

    #[test]
    fn unknown_or_ambiguous_vendor_shapes_fail_closed() {
        assert!(adapt("unreviewed vendor source").is_none());
        assert!(adapt(&format!("{DOM_PROXY}{DOM_PROXY}")).is_none());
    }
}
