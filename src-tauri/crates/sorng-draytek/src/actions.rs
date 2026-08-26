//! State-changing device actions. Reboot is NEVER called implicitly: the
//! panel must confirm before invoking, and the result is typed.

use crate::client::DraytekClient;
use crate::error::{DraytekError, DraytekResult};
use crate::types::DraytekRebootResult;

/// DrayOS "System Maintenance → Reboot System" endpoint.
pub const REBOOT_CGI_PATH: &str = "/cgi-bin/reboot.cgi";

/// Build the reboot form body: reboot with the current configuration and
/// echo the anti-CSRF token when the firmware issued one.
pub fn reboot_form(form_auth_str: Option<&str>) -> Vec<(&'static str, String)> {
    let mut form = vec![("sReboot", "Current".to_string())];
    if let Some(token) = form_auth_str.filter(|t| !t.is_empty()) {
        form.push(("sFormAuthStr", token.to_string()));
    }
    form
}

/// Reboot the device over the HTTP session. Requires a live login.
pub async fn reboot(client: &DraytekClient) -> DraytekResult<DraytekRebootResult> {
    if !client.is_logged_in() {
        return Err(DraytekError::not_connected(
            "DrayTek session is not logged in; connect before rebooting",
        ));
    }
    let token = client.form_auth_str();
    let form = reboot_form(token.as_deref());
    match client.post_form(REBOOT_CGI_PATH, &form).await {
        Ok(body) => {
            if crate::client::contains_login_form(&body) {
                return Err(DraytekError::auth(
                    "DrayTek session expired: reboot request returned the login form",
                ));
            }
            Ok(DraytekRebootResult {
                accepted: true,
                message: "Reboot request accepted; the device will drop the session".into(),
            })
        }
        // The device commonly closes the socket while rebooting; treat a
        // transport drop after a successful send as an accepted reboot.
        Err(e)
            if matches!(
                e.kind,
                crate::error::DraytekErrorKind::HttpError | crate::error::DraytekErrorKind::Timeout
            ) =>
        {
            Ok(DraytekRebootResult {
                accepted: true,
                message: format!(
                    "Reboot request sent; device stopped responding ({})",
                    e.message
                ),
            })
        }
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reboot_form_echoes_token_only_when_present() {
        assert_eq!(reboot_form(None), vec![("sReboot", "Current".to_string())]);
        assert_eq!(
            reboot_form(Some("tok")),
            vec![
                ("sReboot", "Current".to_string()),
                ("sFormAuthStr", "tok".to_string())
            ]
        );
    }
}
