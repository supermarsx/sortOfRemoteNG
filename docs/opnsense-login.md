# OPNsense WebGUI login

The `opnsense` website profile covers the firewall's WebGUI, not its captive
portal or API. Configure the appliance's HTTPS hostname/IP and management port;
there is no shared vendor login address. Certificate verification and connection
proxy routing are unchanged. Do not disable firewall security checks to use it.

Manual is the default. Choosing automatic form login is an explicit opt-in for
username/password accounts. The profile uses the existing generic login client,
with selectors scoped to the WebGUI's login page and POST form. It clicks the
actual button so `login=1`, site handlers, session cookies and the dynamically
named CSRF input remain part of the site's normal submission. There is no custom
authentication request, credential forwarding grant or direct-network fallback.

## Limits

Use Manual for TOTP accounts: OPNsense can require a code before or after the
password in the same field. This profile neither generates nor appends a code.
SSO, password changes and custom themes with different controls remain manual.
There are no automatic MFA challenge registrations or API-key substitutions.

The selectors were verified against upstream source on 2026-10-06, including
the `stable/26.7` WebGUI. Tests use synthetic DOM and synthetic credentials and
exercise the assembled production login client. They are not a live appliance
authentication test; successful authenticated sessions have not been verified.

## Primary sources

- [WebGUI login form and authentication handler, pinned revision](https://github.com/opnsense/core/blob/be43690f7abaf6823a93d6e4f292095bc4e5d56c/src/www/authgui.inc).
- [CSRF form rewriting and validation, pinned revision](https://github.com/opnsense/core/blob/be43690f7abaf6823a93d6e4f292095bc4e5d56c/src/www/csrf.inc).
- [GUI configuration: CSRF runs before authentication](https://github.com/opnsense/core/blob/be43690f7abaf6823a93d6e4f292095bc4e5d56c/src/www/guiconfig.inc).
- [Official TOTP configuration and combined password-field behavior](https://docs.opnsense.org/manual/how-tos/two_factor.html).

## Integration contract

The shared HTTP application registry registers `OPNSENSE_PROFILE` from
`src/utils/connection/opnsenseProfile.ts`, with the existing `opnsense` brand icon
suggestion. The Networking/proxies category, manual/form options, HTTPS requirement
and selectors use existing generic UI/runtime paths; no new staged client, Rust
login-flow discriminator or hosted-origin route is required.

The dedicated editor/resolver tests verify that selecting the profile preserves
the appliance address, custom port, TLS policy and chosen icon, resets automatic
login and MFA, and clears stale selectors. Credentials are resolved only after
form-mode opt-in; vault credentials remain deferred until supplied by the owning
vault. Tests also cover token-free explicit external handoff, invalid HTTP/auth
modes, CSRF and submitter preservation, empty form actions, and rejected foreign
or mutated form actions. Advanced selector overrides remain the generic editor's
explicit customization capability; the reviewed tests cover the built-in preset.
