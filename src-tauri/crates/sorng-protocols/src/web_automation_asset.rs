//! Code-only automation injection. Per-document identities and grants remain
//! separate bootstrap data; the shared cache never contains credential values.
use std::sync::OnceLock;

pub fn web_automation_client_source() -> &'static str {
    static SOURCE: OnceLock<String> = OnceLock::new();
    SOURCE
        .get_or_init(|| {
            let template = include_str!("web_automation_client.js");
            assert_eq!(template.matches("/* REVIEWED_TOTP_GUARDS */").count(), 1);
            template.replace(
                "/* REVIEWED_TOTP_GUARDS */",
                include_str!("autologin/common/totp_guards.js"),
            )
        })
        .as_str()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn code_is_assembled_once_and_retains_the_shared_challenge_guards() {
        let source = web_automation_client_source();
        assert!(std::ptr::eq(
            source.as_ptr(),
            web_automation_client_source().as_ptr()
        ));
        assert!(source.contains("function synologyButtonReady("));
        assert!(source.contains("function probeTotp("));
        assert!(!source.contains("/* REVIEWED_TOTP_GUARDS */"));
    }
}
