// ─── Exchange Integration – authentication ──────────────────────────────────
//!
//! Handles OAuth2 token acquisition for Exchange Online / Graph API
//! and PowerShell session construction for on-premises Exchange.

use crate::types::*;
use chrono::Utc;
use log::{debug, info};
use reqwest::Client;
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Exchange Online – OAuth2 client-credential flow
// ═══════════════════════════════════════════════════════════════════════════════

/// Acquire a Microsoft Graph token using client credentials.
pub async fn acquire_graph_token(
    http: &Client,
    creds: &ExchangeOnlineCredentials,
) -> ExchangeResult<ExchangeToken> {
    let url = api::TOKEN_URL_TEMPLATE.replace("{tenant}", &creds.tenant_id);

    let client_secret = creds.client_secret.as_deref().unwrap_or_default();
    if client_secret.is_empty() {
        return Err(ExchangeError::auth("client_secret is required for client-credential flow"));
    }

    let mut form = HashMap::new();
    form.insert("grant_type", "client_credentials");
    form.insert("client_id", &creds.client_id);
    form.insert("client_secret", client_secret);
    form.insert("scope", api::scopes::MAIL_READ_WRITE);

    debug!("Acquiring Graph token for tenant {}", creds.tenant_id);

    let resp = http
        .post(&url)
        .form(&form)
        .send()
        .await
        .map_err(|e| ExchangeError::connection(format!("token request failed: {e}")))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(ExchangeError {
            kind: ExchangeErrorKind::Auth,
            message: format!("token endpoint returned {status}: {body}"),
            status_code: Some(status.as_u16()),
            code: None,
        });
    }

    token_from_response(resp).await
}

/// Acquire an Exchange Online Management token (outlook.office365.com scope).
pub async fn acquire_exo_token(
    http: &Client,
    creds: &ExchangeOnlineCredentials,
) -> ExchangeResult<ExchangeToken> {
    let url = api::TOKEN_URL_TEMPLATE.replace("{tenant}", &creds.tenant_id);

    let client_secret = creds.client_secret.as_deref().unwrap_or_default();

    let mut form = HashMap::new();
    form.insert("grant_type", "client_credentials");
    form.insert("client_id", &creds.client_id);
    form.insert("client_secret", client_secret);
    form.insert("scope", api::scopes::EXCHANGE_MANAGE);

    let resp = http
        .post(&url)
        .form(&form)
        .send()
        .await
        .map_err(|e| ExchangeError::connection(format!("EXO token request failed: {e}")))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(ExchangeError {
            kind: ExchangeErrorKind::Auth,
            message: format!("EXO token endpoint returned {status}: {body}"),
            status_code: Some(status.as_u16()),
            code: None,
        });
    }

    token_from_response(resp).await
}

/// Parse the OAuth2 `TokenResponse` into an `ExchangeToken`.
async fn token_from_response(resp: reqwest::Response) -> ExchangeResult<ExchangeToken> {
    let tr: TokenResponse = resp
        .json()
        .await
        .map_err(|e| ExchangeError::auth(format!("failed to parse token response: {e}")))?;

    let expires_at = Utc::now() + chrono::Duration::seconds(tr.expires_in);
    let scopes = tr
        .scope
        .map(|s| s.split(' ').map(String::from).collect())
        .unwrap_or_default();

    Ok(ExchangeToken {
        access_token: tr.access_token,
        token_type: tr.token_type,
        expires_at,
        refresh_token: tr.refresh_token,
        scopes,
    })
}

// ═══════════════════════════════════════════════════════════════════════════════
// On-Premises – PowerShell session helpers
// ═══════════════════════════════════════════════════════════════════════════════

/// Build the PowerShell connection URI for an on-prem Exchange server.
pub fn build_ps_connection_uri(creds: &ExchangeOnPremCredentials) -> String {
    let scheme = if creds.use_ssl { "https" } else { "http" };
    format!("{}://{}:{}/PowerShell/", scheme, creds.server, creds.port)
}

/// Generate the PowerShell script that establishes a remote EMS session.
///
/// This produces a script string suitable for execution via the `sorng-powershell`
/// crate's session / execution engine.
pub fn build_ems_connect_script(creds: &ExchangeOnPremCredentials) -> String {
    let uri = build_ps_connection_uri(creds);
    let auth = match creds.auth_method {
        OnPremAuthMethod::Kerberos => "Kerberos",
        OnPremAuthMethod::Negotiate => "Negotiate",
        OnPremAuthMethod::Basic => "Basic",
        OnPremAuthMethod::Ntlm => "NegotiateWithImplicitCredential",
    };

    let skip = if creds.skip_cert_check {
        "\n$PSSessionOption = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck"
    } else {
        ""
    };

    let session_opt = if creds.skip_cert_check {
        " -SessionOption $PSSessionOption"
    } else {
        ""
    };

    info!("Building EMS connection script for {}", creds.server);

    format!(
        r#"$cred = New-Object System.Management.Automation.PSCredential('{user}', (ConvertTo-SecureString '{pass}' -AsPlainText -Force)){skip}
$ExSession = New-PSSession -ConfigurationName Microsoft.Exchange -ConnectionUri '{uri}' -Authentication {auth} -Credential $cred{session_opt}
Import-PSSession $ExSession -DisableNameChecking -AllowClobber | Out-Null
Write-Output 'EMS_CONNECTED'"#,
        user = creds.username.replace('\'', "''"),
        pass = creds.password.replace('\'', "''"),
        uri = uri,
        auth = auth,
        skip = skip,
        session_opt = session_opt,
    )
}

/// Generate a script to cleanly disconnect an EMS session.
pub fn build_ems_disconnect_script() -> &'static str {
    "Get-PSSession | Where-Object { $_.ConfigurationName -eq 'Microsoft.Exchange' } | Remove-PSSession"
}

/// Wrap an Exchange PowerShell command so it outputs JSON.
pub fn wrap_ps_json(command: &str) -> String {
    format!("{command} | ConvertTo-Json -Depth 10 -Compress")
}

/// Build a PowerShell expression for setting parameters from an optional value.
pub fn ps_param_opt(name: &str, value: Option<&str>) -> String {
    match value {
        Some(v) => format!(" -{name} '{}'", v.replace('\'', "''")),
        None => String::new(),
    }
}

/// Build a PowerShell expression for setting a boolean parameter.
pub fn ps_param_bool(name: &str, value: bool) -> String {
    let val = if value { "$true" } else { "$false" };
    format!(" -{name} {val}")
}

/// Build a PowerShell expression for setting a list parameter.
pub fn ps_param_list(name: &str, values: &Option<Vec<String>>) -> String {
    match values {
        Some(v) if !v.is_empty() => {
            let quoted: Vec<String> = v.iter().map(|s| format!("'{}'", s.replace('\'', "''"))).collect();
            format!(" -{name} @({})", quoted.join(","))
        }
        _ => String::new(),
    }
}
