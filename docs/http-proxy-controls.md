---
title: Website login and proxy controls
eyebrow: Use the app
description: Choose an authentication method, review form filling, and control an embedded website session.
permalink: /http-proxy-controls/
---

# Website login and proxy controls

Edit an HTTP or HTTPS connection and open **Protocol**. Use **Application** to
choose a reviewed application or a generic login method. Use **Advanced** for
form timing, extra fields, and internal proxy controls. Save the connection
before reconnecting. Changes to these options start a fresh proxy session.

## Choose the right login method

- **HTTP Basic** is the server's username/password challenge, not a login form.
  Use HTTPS: Basic credentials are not encrypted by the authentication scheme.
- **HTTP Digest** answers the server's Digest challenge. It supports MD5 and
  SHA-256, their session variants, and the supported `auth` challenge. An
  unsupported challenge is reported rather than silently falling back to Basic.
- **Header authentication** sends the headers explicitly configured on a generic
  connection. Credential-bearing headers require this mode. Headers that
  control routing, cookies, or browser origin cannot be overridden here.
- **Automatic form login** fills the reviewed website form once. A custom form
  requires explicit username, password, and submit selectors. Selecting an
  application does not automatically enable login.
- **Manual** leaves login interactive. SSO, CAPTCHA, passkeys, and unsupported
  two-factor challenges may require manual interaction or the system browser at
  the website's original address.

Application profiles use their own authentication settings; legacy generic
authentication headers are not added to an application login. See
[website application login and two-factor authentication](/http-application-logins/)
for supported application forms and explicit authenticator-code consent.

## Review a form before submitting

In **Advanced form automation**, turn off **Submit after filling** to review the
filled form yourself. This does not enable automatic form login by itself.

An optional exact form selector scopes all controls to one form. You can add
delays before filling and before submission for applications that initialize
their controls slowly. Each delay is limited to 30 seconds; the overall deadline
is at most 60 seconds and must cover both delays. A replaced form or a changed
destination stops the attempt. Failed submissions are not retried in a loop.

**Additional explicit fields** can fill text, hidden, or select controls such as
a tenant or domain. Adding a field switches to fill-only mode so you can review
it first. Controls must already exist in the same form. Username, password,
one-time-code, file, CSRF, and token controls cannot be repurposed as extra
fields. Let the website manage its own CSRF tokens.

Extra field values may contain secrets. They are omitted from credential-free
exports and backups. Imported invalid settings block connecting until reviewed;
they are not silently replaced with less restrictive settings.

## Restrict the embedded website

- **Website scripts** can allow scripts, block external script files (including
  same-origin files), or block scripts and automation entirely. Restricting
  scripts can break login and application features.
- **Require HTTPS upstream** refuses HTTP destinations and insecure resources.
  It does not guess another port, silently upgrade an HTTP connection, or skip
  certificate trust checks.
- **Same-origin resources and forms** restricts page resources and form
  submissions. It can break CDN resources or SSO. It is not a complete browser
  navigation sandbox. Proxy-mediated redirects outside the approved origin are
  refused even with this option off, before credentials or request bodies are
  sent there.
- **Bypass cache / no-store** requests fresh responses and discourages storage
  of new responses. It does not promise to erase existing browser disk data.
- **Extra upstream query parameters** adds explicit parameters on the upstream
  request, not to the displayed address. Values are masked in settings and
  omitted from credential-free exports. The remote server still receives them.
  Up to 16 parameters are supported; reserved internal names are refused.

### Remember a redirect destination

Enable **Allow reviewed cross-origin redirects** to review a website's change of
address inside its tab. For Synology DSM website connections this switch is also
available in **Application**. Each chain is limited to five handoffs.

The inline review shows the complete destination and its exact **Destination
origin** (scheme, hostname and port). **Trust destination** saves that origin for
the original saved connection in its currently open, unlocked owning database.
It is a separate action: it does not continue the redirect or send credentials.
Unsaved or inaccessible connections explain why remembering is unavailable;
failed persistence does not mark an origin trusted. You can manage or remove
origins under **Advanced → Trusted redirect destinations**. Wildcards and paths
are not origin grants; trusting one port or subdomain does not trust another.

**Automatically continue to trusted HTTPS destinations** is off by default.
When explicitly enabled, only an exact trusted HTTPS destination can continue
automatically, signed out in the same tab, and only when saved-login forwarding
is not configured. Each handoff still requires a current native redirect receipt
and a fresh certificate trust check. HTTP destinations and HTTPS-to-HTTP
downgrades always require manual review; **Require HTTPS upstream** remains
stronger than redirect settings. Remembering an origin does not grant certificate
trust, enable login forwarding, or transfer cookies, form bodies, custom headers,
MFA secrets, or scripts. Portal redirects that depend on stripped query parameters
may still need manual sign-in or the original website in your system browser.

If the source proxy is no longer available, use **Reload source page** in the
inline review to request a fresh redirect. **Back to page** remains available
without approving or following any destination.

These are typed connection settings, not arbitrary command-line arguments or
proxy scripts. Certificate verification and credential-origin checks remain
enforced independently.

## Clear one website session

Use **Clear session data** in the website toolbar and confirm. This stops that
connection's proxy session, discards its proxy cookie jar, and opens a fresh
isolated session. Other connections and your system browser are not cleared.
If stopping fails, the app reports the failure and does not start a replacement
session or claim that the old session was cleared.

This action does not delete saved connection credentials or remembered
certificates. Manage remembered identities separately in the Trust Center.
