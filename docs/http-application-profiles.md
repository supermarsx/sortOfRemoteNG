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

Use the website account, not an API key or bearer token. Dedicated Basic username/password fields take precedence as one pair; they are never mixed with an unrelated generic password. Form login requires both username and password. Saved credentials follow the existing connection database protection policy, which the user can configure; the application profile itself contains no secrets.

Portainer, Nginx Proxy Manager, Proxmox VE, and pfSense reuse the app's existing reviewed login selectors. Nginx Proxy Manager uses the website email/password. Proxmox adds the selected realm only at runtime when the username does not already contain `@realm`; it does not rewrite the saved username. pfSense uses the WebGUI account, not REST API client credentials. Existing **Open web UI** actions use these same form-only or manual modes; API-token actions never turn tokens into web passwords.

HP/HPE iLO, other BMCs, and the other generic-form profiles use optional generic form detection. Their firmware/application-specific sign-in is not claimed verified. In particular, iLO Redfish/RIBCL sessions are not browser login sessions. Manual-only profiles do not offer unsupported automatic authentication. MFA, CAPTCHA, external SSO, and rejected passwords remain manual; this feature does not bypass them.

## Form overrides and safety

For a website without a preset, choose **Custom websites → Custom application**. It also starts in Manual browsing. After opting into form login, enter all three CSS selectors—for example `input[name="username"]`, `input[type="password"]`, and `button[type="submit"]`. The selectors identify visible controls in the same login form, not API endpoints. Custom form login refuses missing, invalid, or unmatched selectors and never falls back to generic detection. Each selector is limited to 512 characters; no script or custom JavaScript is accepted.

Optional CSS selector overrides are bounded and validated. Leave them blank to use a reviewed preset or generic detection. Explicit selectors must match visible controls in the intended form; an unmatched override is not permission to fill a different field. Delayed single-page-app forms can receive the one-shot fill during the bounded attempt window; credentials are cleared after completion, timeout, or cancellation.

Changing an application's login settings stops its old protected web session. Reload explicitly to use the revised settings. Malformed or unknown imported profiles and unsupported modes block connection rather than falling back to legacy Basic authentication. Invalid selectors block automatic form login; manual mode does not use them.

HTTPS inspection, trust approval, accepted-certificate pinning, and configured outbound proxy routing remain in force. Selecting an application does not weaken TLS or create an external-browser SSO session. See [Web viewer trust and authentication]({{ '/http-viewer-trust/' | relative_url }}) for diagnostics and transport details. Arbitrary custom-header authentication and HTTP Digest are not implemented by these profiles.

## Save, export, and compatibility

Profiles are versioned, non-secret connection metadata. JSON/clone and native CSV/XML portability retain the selected profile and bounded selector overrides; credential-free exports still remove passwords. Exports that include credentials may contain plaintext secrets and must be protected. Third-party formats do not gain application-profile support automatically.

Existing saved generic HTTP connections and Quick Connect retain their previous authentication behavior. The new no-Basic form mode requires a matching updated native backend; older backends reject an unsupported mode rather than silently treating it as Basic. Tests use synthetic connections, mocked native boundaries, and isolated native proxy fixtures—not live device sign-ins or user vault data.
