---
title: Synology browser and NAS API views
description: Choose the DSM website or Synology NAS API and understand its authentication status.
---

# Synology browser and NAS API views

Choose **HTTP** or **HTTPS**, then **Protocol → Application → Synology DSM**.
Synology is an application, not a transport protocol. Choose either the DSM
website or **Synology NAS API**. Existing saved Synology records
remain readable; editing and saving them uses the HTTP(S) application format.

## DSM website sign-in

Choose **DSM website** and **Manual browsing** to sign in yourself without
providing saved credentials to the website proxy. Saved API credentials do not
become a website session, and website cookies do not sign the API view in.

For the reviewed DSM 7 desktop login, use an HTTPS address, save the website
username/password, and explicitly select **Automatic form login**. The app
submits the username once, waits for the matching password panel, then releases
and submits the password once. It never fills the hidden password control on
the username screen, selects “remember me,” or retries a rejected password.
Advanced selector, timing, extra-field and fill-only overrides are not supported
by this fixed staged flow. Other DSM layouts remain manual.

Authenticator codes can be entered manually. To opt into automatic codes, add
the account's authenticator in the connection's 2FA settings, then select
**Automatic 2FA → DSM 7 verification code**, choose that authenticator, enable
codes for the displayed HTTPS origin, and save the connection. This is separate
consent: choosing DSM or enabling password login does not enable automatic 2FA.
The app sends at most one code to the reviewed OTP panel and never selects
“trust this device.” Submission is not proof of successful sign-in.

CAPTCHA, Approve sign-in, security keys/passkeys, account recovery and password
changes remain interactive. Use the explicit original-origin browser action
when the embedded view cannot complete them. That browser has separate cookies
and does not sign in the embedded session. See Synology's
[two-factor authentication instructions](https://kb.synology.com/en-global/DSM/help/DSM/SecureSignIn/2factor_authentication?version=7).

The DOM contract was reviewed against DSM's public desktop Vue login assets:
`dsmAccountPanel.vue`, `dsmPasswordPanel.vue`, `otpPanel.vue` and `nextButton.vue`
as embedded in `webman/login/dist/dsm.login.bundle.js` (SHA-256
`4b75091b7f860b06ae37a7339d0fa067dd8c367664a4622262766348ae47e384`).
Regression fixtures use synthetic inputs only; this is not a claim of a live
NAS authentication test. A changed layout stops automation rather than guessing.

## Native NAS API sign-in

**Synology NAS API** includes the **File Station** file-management section and
supported NAS administration tools such as system, storage, network, users and
packages. Individual operations depend on DSM version, installed packages and
account permissions; this is not coverage of every DSM API.

The API view uses the credentials saved in Application, without a second
username/password form in the session tab. A DSM authenticator challenge opens
a one-time-code dialog. Browser cookies do not authenticate the API explorer.
The API currently supports direct routing and verified system TLS, not browser
certificate exceptions or proxy/VPN routes; unsupported settings are refused.

A reverse-proxy hostname is supported as the server address when it forwards
DSM's `/webapi/` routes. The native client requests DSM's session cookie and
keeps it in a private per-connection jar; it also sends SID/SynoToken parameters
and the CSRF token header. These values never go in the request URL or browser
storage. The proxy must preserve session cookies and authentication headers and
route login and subsequent calls to the same DSM server. API reverse-proxy
access is different from configuring an outbound proxy/VPN inside this app.

Addresses may be hostnames, DNS subdomains, IP addresses, host:port pairs or
root HTTP(S) URLs. An explicit URL uses its own scheme and port (80/443 when
omitted). A plain host uses the configured port. URLs with credentials, query
strings or application paths cannot be used as API server addresses.

### Initialization status

Opening a saved API tab shows the app's configured loading element alongside
the current observed stage and elapsed time for that stage:

1. **Checking desktop capabilities** verifies native API availability before
   sending NAS credentials.
2. **Contacting DSM and signing in** waits for one native request. Network
   connection, DSM discovery and authentication are not reported as separate
   backend events, so the app does not invent sub-stages or a percentage.
3. **Loading shared folders** starts only after an API session is established.
   Other administration data loads when its section is opened.

A requested one-time code remains an explicit dialog; its verification request
has its own status. Completed-stage labels only describe observed results.
Elapsed-time updates and the loader pause while the tab or app is hidden, and
stop when the request finishes or the view closes. Cancel connection keeps the
existing cancellation and late-session cleanup protections. An actual sign-in
or shared-folder error replaces loading with the error and an explicit retry
action; no password, OTP or file operation is automatically replayed.

The NAS sections, folder navigation and selected file rows follow the app's
outlined accent styling. The file selection column stays compact while the
remaining columns retain horizontal scrolling on narrow views.

## Keeping an API session active

The desktop keeps each open API session alive with an authenticated, read-only
File Station information request every minute, including when its tab is in the
background. Network failures back off to at most five minutes. The status strip
shows degraded verification; hover for the last successful check. Closing the
session, replacing it, or locking its owning database ends the connection and
stops its worker. Native DSM session IDs and tokens are not sent to the page.

This helps avoid inactivity expiry, but cannot override a NAS administrator's
forced logout, absolute session lifetime, reboot, account policy or network
outage. The app never silently replays passwords, OTPs or failed file changes.
When DSM rejects the session, reconnect explicitly and inspect a destination
before repeating any operation whose result is uncertain.

## DSM code 119

Synology documents code 119 as **invalid session / SID not found**. It does not
by itself identify a bad password or TLS certificate failure. If it occurs just
after sign-in, verify that the login and subsequent API requests reach the same
DSM server. If it occurs later, reconnect to obtain a new session. Code 106 is
timeout, 107 is interruption by duplicate login, and 150 identifies a source-IP
mismatch. See the [official DSM login API guide](https://kb.synology.com/en-us/DG/DSM_Login_Web_API_Guide/2).
