---
title: Exchange ECP login
eyebrow: Website connections
description: Configure on-premises Exchange Admin Center website login.
permalink: /exchange-ecp-login/
---

# Exchange ECP / Admin Center website login

Select **Exchange Admin Center / ECP** under the connection's **Application**
settings. Keep the Exchange server hostname and HTTPS port, select a saved
username/password or a vault record, then explicitly select **Automatic form
login**. Existing saved ECP connections stay manual until this is enabled.
The default entry point is `/ecp/`; the existing Exchange icon is reused.

Enter the exact username format your server requires: `DOMAIN\username`,
`user@example.com`, or a short username when the server supplies the domain.
The app does not add a domain, change the account, or turn API/Graph tokens into
website credentials. Microsoft documents these options in
[Outlook on the web virtual directories](https://learn.microsoft.com/en-us/exchange/clients/outlook-on-the-web/virtual-directories)
and the on-premises entry point in
[Exchange admin center](https://learn.microsoft.com/en-us/exchange/architecture/client-access/exchange-admin-center).

## Supported form contract

- ECP's same-origin redirect to `/owa/auth/logon.aspx` is preserved so the
  browser retains the correct address and relative-resource base.
- The client waits for `form[name="logonForm"]`, its visible `username` and
  password-type `password` inputs, and the `.signinbutton[role="button"]`
  control backed by the website's `clkLgn()` handler. It clicks that handler
  once, without replacing it with a synthetic authentication API call.
- The form must POST to the same-origin `/owa/auth.owa`, with one hidden
  `destination` returning to `/ecp` or a page beneath `/ecp/`. The native proxy
  restores this field's upstream authority if HTML rewriting made it local;
  it does not rewrite credentials or other form fields.
- Page loads, authentication, redirects, resources and cookies continue to use
  the saved connection's internal proxy/network path. No direct fallback,
  extra-origin permission, HTTP Basic header or certificate exception is added.
- Exchange cookies are held in a bounded, volatile native jar for the saved
  HTTPS origin, independent of third-party browser cookie acceptance. The
  proxy installs a synchronous `document.cookie` bridge before page scripts,
  so cookie probes can write, read and delete real cookies before login.
  Authentication cookies issued during login and redirects use that same jar;
  HttpOnly cookies are never exposed to scripts or overwritten by them. Cookie
  paths, domains, expiry and secure-prefix validation are preserved. Explicit
  `credentials: "omit"` requests neither send nor accept session cookies. The
  jar is discarded when its connection session ends; no cookies are persisted
  or shared with other saved connections.
- The client preserves hidden form fields, public/private computer settings,
  and Show password. It checks for form/handler/destination changes before
  filling or submitting and does not loop after a rejected login.

## Interactive cases and verification limits

Windows-integrated authentication (NTLM/Kerberos), ADFS/Entra federation,
third-party MFA, CAPTCHA, password expiry/change, unsupported customized forms
and the separate Exchange Online portal are not automated by this form adapter.
They remain manual. Generic Exchange and Microsoft 365 profiles do not gain
form automation. The separate [on-premises OWA profile](exchange-owa-login.md)
uses its own mailbox destination scope. No automatic MFA challenge is
registered for either Exchange form adapter.

Regression tests use synthetic form and proxy fixtures, including destination
serialization, cookie probe/login round trips without browser cookies, and
rejection paths. They do not prove successful authentication
against a live Exchange deployment or compatibility with every Exchange version.
Native changes require a desktop backend rebuild and reopening the connection.
