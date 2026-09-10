---
title: Website application profiles
eyebrow: Use the app
description: Choose categorized HTTP and HTTPS application profiles and explicitly control website login.
permalink: /http-application-profiles/
---

In an HTTP or HTTPS connection, open **Protocol → Application**. Choose a category, or keep **All website applications** to search across the available website profiles. The selector separates containers, virtualization, server management/BMC, networking/proxies, monitoring, business applications, and mail/storage. Native-only integrations are listed separately with an explanation; an API integration does not necessarily provide a website.

Selecting a profile starts in **Manual browsing**. It does not change the host, port, TLS/trust policy, or saved credentials. Basics shows a shortcut to Application settings instead of a second username/password editor. Choose **Generic website** to return to the existing HTTP Authentication and Advanced controls.

Application and Organize can suggest a matching existing icon. The preview is optional: select **Use suggested icon** to apply it. Changing the application never overwrites your current icon automatically; Custom application uses a generic website suggestion.

## Choose how to sign in

| Mode                 | What happens                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual browsing      | No saved website username/password is supplied to the proxy. Sign in on the website yourself. Existing website cookies may still represent a signed-in session; manual mode does not promise logout. |
| Automatic form login | Explicitly arms one form submission per protected proxy session. The private credential dispenser fills the selected form without preemptively adding an HTTP Basic header.                          |
| HTTP Basic           | Explicitly sends the saved website credentials through the proxy's HTTP Basic authentication path. This is not form login or API-token login.                                                        |
| HTTP Digest          | Answers a supported server challenge at the configured upstream origin. No preemptive Basic header or form fill; unsupported challenges fail without Basic fallback.                                 |

Use the website account, not an API key or bearer token. Dedicated Basic username/password fields take precedence as one pair; they are never mixed with an unrelated generic password. Form login requires both username and password. Saved credentials follow the existing connection database protection policy, which the user can configure; the application profile itself contains no secrets.

Portainer, Nginx Proxy Manager, Proxmox VE, and pfSense reuse the app's existing reviewed login selectors. Nginx Proxy Manager uses the website email/password. Proxmox adds the selected realm only at runtime when the username does not already contain `@realm`; it does not rewrite the saved username. pfSense uses the WebGUI account, not REST API client credentials. Existing **Open web UI** actions use these same form-only or manual modes; API-token actions never turn tokens into web passwords.

HP/HPE iLO, other BMCs, and the other generic-form profiles use optional generic form detection. Their firmware/application-specific sign-in is not claimed verified. In particular, iLO Redfish/RIBCL sessions are not browser login sessions. Manual-only profiles do not offer unsupported automatic authentication. MFA, CAPTCHA, external SSO, and rejected passwords remain manual; this feature does not bypass them.

Webmin has reviewed username/password selectors for its classic and Authentic Theme session-login forms. The usual endpoint is HTTPS on port 10000, but selecting Webmin never changes an existing host, port, path, or TLS policy. Banners, two-factor codes, and password reset remain manual. This is a form-profile fixture check, not a live server sign-in guarantee. See the [official connection instructions](https://webmin.com/download/), [classic form source](https://github.com/webmin/webmin/blob/master/session_login.cgi), and [Authentic Theme form source](https://github.com/webmin/authentic-theme/blob/master/session_login.cgi).

## Cloudflare Dashboard and interactive 2FA

**Mail / storage** also includes self-hosted Bitwarden, community Vaultwarden and
Nextcloud. They require your saved HTTPS origin and start in manual mode. Their
explicit login flows, supported authenticator challenges and browser handoff
limitations are documented in [Website application login]({{ '/http-application-logins/' | relative_url }}).

Choose **Networking / proxies → Cloudflare Dashboard**. This is a manual-only hosted profile, not a Cloudflare API integration. **Use Cloudflare Dashboard address** explicitly sets HTTPS, `dash.cloudflare.com`, and port 443; selecting the profile alone leaves your existing address and TLS settings unchanged. A different host, port, or plain HTTP address is refused before native preflight. Saved passwords, API tokens, and old form selectors are not sent by this profile.

Sign in on the website and enter its authenticator or email-code prompt yourself. Cloudflare also offers SSO and social login; its security-key authentication uses WebAuthn. The web toolbar's **2FA Codes** panel only displays and manually copies already configured per-connection authenticator codes. It does not enroll Cloudflare, automatically fill a challenge, or create Cloudflare recovery codes. Configure an authenticator through the existing connection TOTP settings only if you deliberately want its secret stored under your database's protection policy. See Cloudflare's [sign-in options](https://developers.cloudflare.com/fundamentals/user-profiles/login/) and [two-factor authentication instructions](https://developers.cloudflare.com/fundamentals/user-profiles/2fa/).

For security keys, Windows Hello, external SSO, or incompatible challenges, select **Open Cloudflare in system browser** in the session. This explicit action opens only the fixed public HTTPS dashboard address, with no saved credentials, proxy URL, or current-page query attached. The system browser uses separate cookies and its own network route and TLS policy, outside this app's proxy and Trust Center. Signing in there does not authenticate the embedded tab. Embedded/custom browsers have limited Cloudflare challenge support, so this preset does not promise a successful embedded login. See [supported browsers](https://developers.cloudflare.com/cloudflare-challenges/reference/supported-browsers/).

## Form overrides and safety

Tactical RMM, WordPress, Joomla Administrator, Drupal, Payload CMS, MeshCentral,
and Apache Guacamole have source-reviewed password-form presets. Automatic
authenticator codes require a separate explicit, saved HTTPS-origin opt-in and
support only the reviewed Tactical, WordPress Two-Factor plugin, Guacamole
TOTP-extension and Gitea local-account challenges. Other providers remain manual. See the
[website login and 2FA guide]({{ '/http-application-logins/' | relative_url }})
for setup, exact scope, source references, and proxy/true-origin limitations.

For a website without a preset, choose **Custom websites → Custom application**. It also starts in Manual browsing. After opting into form login, enter all three CSS selectors—for example `input[name="username"]`, `input[type="password"]`, and `button[type="submit"]`. The selectors identify visible controls in the same login form, not API endpoints. Custom form login refuses missing, invalid, or unmatched selectors and never falls back to generic detection. Each selector is limited to 512 characters; no script or custom JavaScript is accepted.

Optional CSS selector overrides are bounded and validated. Leave them blank to use a reviewed preset or generic detection. Explicit selectors must match visible controls in the intended form; an unmatched override is not permission to fill a different field. Delayed single-page-app forms can receive the one-shot fill during the bounded attempt window; private in-memory credential copies are cleared after completion, timeout, or cancellation. Fill-only intentionally leaves values in the selected website controls for your review.

**Custom websites** also offers dedicated **Generic login form**, **HTTP Basic authentication**, and **HTTP Digest authentication** profiles. Each starts in manual mode. Generic login form permits conservative detection; Custom application requires all three explicit control selectors. Generic website retains the legacy Authentication controls, including explicitly selected custom headers. Digest supports MD5/SHA-256 and their `-sess` variants, `qop=auth` or legacy no-qop, and UTF-8; unsupported algorithms and `auth-int`-only challenges are not silently downgraded. HTTPS remains recommended.

Under **Protocol → Advanced → Advanced form automation**, you can set one exact form selector, a delay before filling and a delay before submission (each 0–30 seconds), and an overall 1–60 second deadline covering both delays. Defaults preserve the existing eight-second attempt window. Turning **Submit after filling** off fills only. These options do not enable automatic login by themselves. The client captures the exact form and controls, then rechecks them and the same-origin action around input events and delays. A replaced form, changed destination, page navigation, disabled control, timeout, or unavailable guarded client stops the attempt; it never reacquires another form after filling. Implicit-method SPA forms retain their JavaScript handlers, but the client suppresses a fallback native GET that could place credentials in a URL.

**Additional explicit fields** support existing same-form text, hidden, and single-select controls for values such as tenant/domain. No field is guessed or created. Password, username, OTP, file, CSRF and token controls are refused; normal CSRF tokens remain site-managed. Select values must match an enabled option. Adding an extra field switches to fill-only; re-enable submission only after reviewing it. Limits are 16 fields, 512 characters per selector, 4096 characters per value, and 16 KiB total UTF-8 value bytes. Values are secret-capable connection data, masked in settings, and sent only in the protected one-use, no-store credential response—not injected HTML or proxy logs. Credential-free exports remove these fields and disable automatic submission.

Changing an application's login settings stops its old protected web session. Reload explicitly to use the revised settings. Malformed or unknown imported profiles and unsupported modes block connection rather than falling back to legacy Basic authentication. Invalid selectors block automatic form login; manual mode does not use them.

HTTPS inspection, trust approval, accepted-certificate pinning, and configured outbound proxy routing remain in force. Selecting an application does not weaken TLS or create an external-browser SSO session. Credential-origin checks cannot be disabled by browsing policy; blocking page scripts also disables automatic form login. See [Web viewer trust and authentication]({{ '/http-viewer-trust/' | relative_url }}) for diagnostics and transport details.

## Save, export, and compatibility

Profiles are versioned, non-secret connection metadata. JSON/clone and native CSV/XML portability retain the selected profile and bounded selector overrides; credential-free exports still remove passwords. Exports that include credentials may contain plaintext secrets and must be protected. Third-party formats do not gain application-profile support automatically.

Existing saved generic HTTP connections and Quick Connect retain their previous authentication behavior. The new no-Basic form mode requires a matching updated native backend; older backends reject an unsupported mode rather than silently treating it as Basic. Tests use synthetic connections, mocked native boundaries, and isolated native proxy fixtures—not live device sign-ins or user vault data.
