---
title: On-premises Exchange OWA login
eyebrow: Website connections
description: Configure Exchange Outlook on the web credentials and delegated mailbox access.
permalink: /exchange-owa-login/
---

# On-premises Exchange OWA login

Choose **Exchange Outlook on the web (on-premises)** in the connection's
Application settings. Retain your organization's HTTPS hostname/port, select
saved website credentials or a vault record, and explicitly choose
**Automatic form login**. Existing OWA connections remain manual. The default
entry is `/owa/`; this is not Outlook Online or Microsoft 365.

Enter the exact account format the Exchange deployment accepts, such as
`DOMAIN\username`, a UPN, or a short username. The app does not invent a domain
or reuse Exchange API tokens, Microsoft Graph authorization, or Windows identity.

## Delegated secondary mailbox

Optionally enter the target mailbox's SMTP email address in **Secondary mailbox**,
for example `shared@example.com` or `service+invoices@example.com`. Both manual
browsing and automatic form login start at `/owa/shared@example.com/` on the saved
HTTPS host and port. Leaving the field blank uses the saved address: a host-only
connection defaults to your own mailbox at `/owa/`, while existing saved deep
links and query parameters remain intact. A nonempty mailbox selection overrides
the saved entry path, query and fragment; it does not change the server or grant
trust to another origin. The external-browser shortcut uses the same saved entry
resolution, never a live page's URL or query parameters.

The saved primary/admin account (or selected vault record) still authenticates.
Do not replace its username/password with the target mailbox's credentials.
That account needs delegated mailbox access: an administrator role alone does
not grant mailbox permissions. Mailbox selection does not enable automatic login,
change credential storage, or grant consent to disclose vault credentials.

Targets accept a narrow ASCII email format: letters, digits, dots, `_`, `-` and
`+` in the local part, with DNS-style domain labels. URLs, paths, percent escapes,
queries, fragments, control characters and internationalized addresses are not
accepted. Validated targets are serialized as one URL pathname segment; `@` and
`+` remain literal (not query parameters or percent escapes). Malformed imported
metadata stays invalid and blocks connection instead of falling back to your own
mailbox. Changing the target in an open session stops its credential grant;
reload explicitly to use the updated settings.

Microsoft documents the explicit SMTP mailbox path and the authenticated user's
mailbox default when the identifier is omitted in its
[Exchange OWA URL syntax reference](https://learn.microsoft.com/en-us/exchange/using-outlook-web-app-web-parts-exchange-2013-help).
That reference describes Exchange 2013 Web Parts; this feature uses the mailbox
entry path, not Web Parts query parameters.

## Supported form

The adapter waits for `/owa/auth/logon.aspx`, one native `logonForm` with visible
username/password inputs, and the `.signinbutton[role="button"]` backed by
Exchange's `clkLgn()` handler. It redeems the existing same-origin, one-shot
credential nonce only after this form is ready, rechecks it while filling, and
clicks the site's handler once. It does not retry rejected credentials.

The form must POST to the same-origin `/owa/auth.owa`. Its single hidden
`destination` must return to `/owa` or a mailbox path beneath `/owa/`, not `/ecp`,
an authentication/expiry path, or another origin. The browser adapter preserves
the destination, hidden fields, and public/private-computer settings. The native
proxy inverse-maps only the destination's local authority; username, password,
flags, and all other form bytes are preserved. ECP retains its separate `/ecp`
destination restriction.

Login pages, POSTs, redirects, resources, and cookies retain the configured proxy
route. The existing bounded native Exchange cookie jar and document-cookie bridge
are also used for OWA. HttpOnly cookies remain private, cookie scope/expiry are
preserved, and cookies are revoked with the session. No direct fallback, added
third-party trust, Basic header, or TLS exception is introduced. Credential-bearing
307/308 redirects are rejected rather than replayed.

## Open email links in the system browser

In an **Exchange Outlook on the web (on-premises)** connection, click an external
HTTP or HTTPS email link to review its destination, then choose **Open in
browser**. Cancelling leaves the mailbox open. Ordinary mailbox, search, settings
and same-origin navigation continue inside OWA.

The review uses the real destination, not the app's localhost proxy address.
OWA `redir.aspx` links are unwrapped without forwarding the wrapper's mailbox
parameters; Microsoft SafeLinks addresses retain their signed destination URL.
Only the reviewed URL is passed to the system browser, never saved credentials,
embedded cookies or proxy authorization. Unsafe schemes and app-local routes
cannot be opened through this action. A navigation, lock or changed database
lease invalidates a pending action.

The external browser uses its **own network/proxy settings and cookie session**;
this is an explicit external handoff, not a direct-network fallback for the
embedded page. Rebuild the desktop backend and reopen OWA to load the updated
page-side link handler. Synthetic link tests do not establish live mailbox
compatibility.

## Interactive cases and evidence limits

MFA/CAPTCHA, ADFS/SSO, NTLM/Kerberos, password changes, rejected-login pages, and
unsupported custom forms remain interactive. Automatic MFA and selector overrides
are not accepted for this profile. No authentication or MFA bypass is provided.

If investigating **HTTP 411 (Length Required)**, rebuild the desktop backend and
reopen the connection to use the request-framing fix: empty POST/PUT/PATCH requests
send `Content-Length: 0`, and a rewritten destination gets its computed body
length. An `errorfe.aspx` GET may be reporting an earlier failed request rather
than causing the 411 itself. Authentication POSTs are not automatically replayed.
Synthetic framing tests do not prove acceptance by a real Exchange deployment.

Tests cover synthetic Exchange forms and a local TLS/CONNECT upstream through the
production proxy, including destination preservation, redirect proof and native
cookies. They do **not** establish live mailbox authentication. After rebuilding
the desktop backend and reopening the connection, live acceptance still requires
an authorized on-premises Exchange account: verify one form submission, complete
any MFA/SSO manually, reach the mailbox, and verify reload/session behavior using
the configured proxy route. Never include credentials or session cookies in logs.
