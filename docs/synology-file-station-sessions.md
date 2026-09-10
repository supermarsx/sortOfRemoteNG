---
title: Synology browser and File Station views
description: Choose a website or API explorer and understand its authentication status.
---

# Synology browser and File Station views

Choose **HTTP** or **HTTPS**, then **Protocol → Application → Synology DSM**.
Synology is an application, not a transport protocol. Choose either the DSM
website or **File explorer — File Station API**. Existing saved Synology records
remain readable; editing and saving them uses the HTTP(S) application format.

The API explorer uses the credentials saved in Application, without a second
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
