---
title: Apple Screen Sharing and portable ARD access
eyebrow: Use the app
description: Build one portable remote-Mac profile with a native Apple Account handoff on macOS and an explicit embedded fallback on Windows and Linux.
permalink: /apple-screen-sharing/
---

Apple Remote Desktop, VNC compatibility, and Apple Account (formerly Apple ID) screen-sharing requests reach similar-looking remote desktops through different authentication systems. sortOfRemoteNG keeps those systems separate while allowing one saved connection to choose a supported path for the current operating system.

<div class="callout">
  <strong>Never enter an Apple Account password or verification code in sortOfRemoteNG.</strong>
  <p>Apple Account authentication stays in Screen Sharing.app. The saved Apple Account identifier is routing and identity metadata, not a password and not an ARD/RFB credential.</p>
</div>

## Cross-platform profile

A portable ARD profile combines two independent routes to the same saved target:

1. **Native Apple Account handoff on macOS.** sortOfRemoteNG opens Screen Sharing.app. Apple owns the account password, two-factor authentication, connection approval, and remote-session state.
2. **Embedded fallback when the native handoff is unavailable.** On Windows and Linux—and on a Mac where Screen Sharing.app cannot be opened—sortOfRemoteNG connects to the same saved host and port using either an account authorized by the remote Mac or a dedicated VNC-viewer password.

The fallback makes the connection definition portable; it does not make Apple Account authentication cross-platform. Apple documents Apple Account entry in [Screen Sharing.app on Mac](https://support.apple.com/guide/mac-help/mh14066/mac), but does not publish a Windows/Linux Screen Sharing client or an Apple Account-to-ARD/RFB credential exchange. The app therefore never replays an Apple Account password, verification code, Sign in with Apple token, or app-specific password.

| Running sortOfRemoteNG on | Selected path                                   | Required saved data                                                    | Result when the path is unavailable                                                         |
| ------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| macOS                     | Native Apple Account handoff                    | Apple Account identifier                                               | Uses the enabled embedded fallback if native handoff is unavailable; otherwise fails closed |
| macOS                     | Embedded remote-Mac account or VNC fallback     | Target host/port and the selected embedded credential                  | Reports the real ARD/RFB connection error                                                   |
| Windows or Linux          | Embedded fallback from a portable Apple profile | Target host/port plus a configured remote-Mac or dedicated VNC account | Fails closed with setup guidance when no valid fallback is configured                       |
| Any supported platform    | Explicit embedded-only profile                  | Target host/port and the selected embedded credential                  | Reports the real ARD/RFB connection error; no Apple handoff is involved                     |

The platform resolver is deterministic: native capability takes precedence on macOS; static native unavailability or a failed app launch selects the enabled fallback. A successful app launch never triggers the fallback because it proves neither Apple authentication nor a remote connection. The resolver does not silently substitute one password type for another.

### Create or migrate a portable profile

1. Confirm that the remote Mac has Screen Sharing or Remote Management enabled and that the intended user is allowed access.
2. Keep a reachable hostname or IP address and ARD/RFB port on the saved connection. The embedded fallback always needs a network target even if the macOS path is normally reached by Apple Account.
3. Select the Apple Account native-handoff option and save the account email address or phone number as the handoff reference.
4. Enable **Cross-platform fallback**, then select one explicit fallback authentication mode:
   - **Remote Mac account:** save the username and credential of a local or directory-backed account authorized on the target Mac.
   - **Dedicated VNC password:** enable VNC-viewer access on the target and create a unique VNC-only password.
5. Save the profile, then test it on every operating system you plan to use. A macOS handoff test does not test the embedded fallback, and an embedded test does not verify Apple Account approval.

Existing embedded-only ARD connections continue to use their selected embedded authentication path. To make one portable, edit it and add the Apple Account handoff plus a deliberate fallback; do not copy an Apple Account password into the existing password field.

Existing Apple Account handoff profiles migrate with the fallback disabled. This prevents an old generic username or password from being silently reinterpreted as a fallback credential. Enabling the fallback is a deliberate setup step; disabling it again clears those generic embedded credentials. A dedicated-VNC fallback does not use or preserve a username.

## Choose an authentication path

| Path                   | Where the session runs      | What sortOfRemoteNG saves                                                                                     | Who authenticates the user                                                                             |
| ---------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Remote Mac account     | Embedded ARD/RFB client     | Host, authorized local or directory username, and its remote-Mac credential under the selected storage policy | The remote Mac validates the account authorized for Screen Sharing or Remote Management                |
| Dedicated VNC password | Embedded ARD/RFB client     | Host and the separately configured VNC-viewer password under the selected storage policy                      | The remote Mac's VNC-compatible service validates the dedicated VNC password                           |
| Apple Account handoff  | Screen Sharing.app on macOS | A non-secret Apple Account identifier; no Apple password, verification code, or token                         | Apple's Screen Sharing app owns sign-in, two-factor authentication, remote approval, and session state |

### Remote Mac local or directory account

Use this path when the target Mac grants Screen Sharing or Remote Management access to a local user or an eligible network/directory user. Enter the username and password for that account, not the Apple Account used for App Store or iCloud services.

Apple's [Remote Desktop access-privilege guide](https://support.apple.com/guide/remote-desktop/set-access-privileges-apdfab787da/mac) describes authorizing local users and directory-service groups. The embedded client sends the configured remote-Mac credentials to that target; it does not contact Apple's Apple Account service.

### Dedicated VNC password

Use this compatibility path only after the target Mac is configured to allow VNC viewers with a password. Apple explains that the VNC password is selected in the Mac's sharing configuration and does not necessarily match any other system credential.

Create a unique password for this purpose. Apple explicitly warns not to use the password of a local user or Remote Desktop administrator for third-party VNC access. An Apple Account password must not be used either. Review Apple's [VNC access and security guidance](https://support.apple.com/guide/remote-desktop/virtual-network-computing-access-and-control-apde0dd523e/mac) before enabling the compatibility option.

### Native Apple Account handoff

Use this path when the remote person or Mac is reached through an Apple Account rather than a hostname and remote-Mac login. It is available only on macOS:

1. Save the Apple Account identifier on the ARD connection. The identifier is not treated as a secret or password.
2. Connect from sortOfRemoteNG to open Screen Sharing.app.
3. In Apple's New Connection flow, enter or confirm the Apple Account identifier.
4. Complete any password, device approval, two-factor authentication, invitation, or remote-control approval only in Apple's UI.

Apple's [Screen Sharing guide](https://support.apple.com/guide/mac-help/mh14066/mac) documents entering either a hostname or Apple Account in Screen Sharing.app and allowing requests from Apple Accounts. Apple Account connections are system-managed and cannot be inspected or edited like ordinary host connections, as described in Apple's [connection-settings guide](https://support.apple.com/guide/mac-help/mchl67d5398b/mac).

Apple documents `vnc://` addresses for host or DNS-based screen-sharing endpoints in its [network-address guide](https://support.apple.com/guide/mac-help/mchlp1177/mac). It does not document an Apple Account URL scheme, public target-prefill API, or third-party token exchange for Screen Sharing.app. The handoff therefore opens Apple's app without trying to inject the identifier, password, or approval response into its UI.

On Windows and Linux, the Apple Account handoff is unavailable. A portable profile uses its explicitly configured embedded remote-Mac-account or dedicated-VNC fallback; a profile without one fails closed instead of asking for or reinterpreting the Apple Account password.

## Network reachability

Embedded ARD/RFB connects directly to the saved hostname or IP address and port. Apple identifies TCP port 5900 for Remote Desktop control and observation in its [Remote Desktop port reference](https://support.apple.com/guide/remote-desktop/tcp-and-udp-port-reference-apd0c903fec/mac), and its troubleshooting guidance begins by checking that the computers are on a reachable network and that sharing permissions are enabled.

- A system VPN may make the target address reachable, but the ARD client does not start, stop, or verify that VPN.
- App-level proxy chains, SSH hops, and tunnel-chain routes are not applied to embedded ARD. Configure a directly reachable endpoint or establish the required system network path first.
- The Apple Account handoff uses Screen Sharing.app and that app's network environment. sortOfRemoteNG can confirm only that the handoff opened, not that Apple established or approved a session.
- Do not expose an RFB/VNC listener to an untrusted network merely to make a profile portable. Apple warns that third-party VNC viewers may not encrypt keystrokes and that screen control grants extensive access. Prefer a trusted private network or a separately secured system VPN.

See [Network Paths]({{ '/network-paths/' | relative_url }}) for protocols whose proxy, VPN, and tunnel lifecycle is managed inside sortOfRemoteNG.

## What Apple identity features do not provide

### Sign in with Apple

Sign in with Apple authenticates a person to the developer's app or web service. Apple returns an identity token whose audience is that app's client identifier; the documented scopes cover identity information such as name and email. It does not issue a remote-Mac login, ARD credential, RFB password, or Screen Sharing approval.

See Apple's [Sign in with Apple authentication flow](https://developer.apple.com/documentation/signinwithapple/authenticating-users-with-sign-in-with-apple), [token-verification requirements](https://developer.apple.com/documentation/signinwithapple/verifying-a-user), and [authorization scopes](https://developer.apple.com/documentation/authenticationservices/asauthorization/scope). A future Sign in with Apple option could identify a user to a sortOfRemoteNG-owned service, but it could not authenticate that user to another Mac.

### App-specific passwords

Apple describes app-specific passwords for third-party applications accessing Apple Account-backed services such as iCloud Mail, Calendar, and Contacts. Apple does not document them as ARD/RFB credentials, and the remote Mac's ARD/RFB authentication paths do not accept them as such. See Apple's [app-specific password guidance](https://support.apple.com/102654).

Using an app-specific password in the ARD password field would therefore be both misleading and nonfunctional. Use the native Apple Account handoff when Apple identity is required.

## Saved data and exports

The portable profile keeps its native identity reference and embedded fallback separate:

- Full-fidelity JSON exports with credentials enabled preserve the Apple Account identifier, fallback mode, host, and the data allowed by the selected export/storage policy so the profile can be restored deliberately.
- Credential-free JSON exports omit the Apple Account identifier and generic embedded credentials while retaining the non-secret enabled state and fallback mode. The imported profile may therefore require both identity and fallback credential setup before it can connect.
- Apple Account passwords, verification codes, approval responses, and Sign in with Apple tokens cannot appear in any export because sortOfRemoteNG never receives or stores them for ARD.
- Switching platforms does not copy, transform, or reuse a credential between the Apple and embedded paths.

Inspect credential-bearing JSON exports before sharing them, just as you would inspect hostnames and usernames. Apple recommends that users never share their Apple Account password, verification codes, recovery key, or other account-security details in its [Apple Account security guidance](https://support.apple.com/102614).

## Troubleshooting

- If embedded authentication fails, verify that the chosen local or directory account is allowed by the target Mac's Screen Sharing or Remote Management settings.
- If VNC authentication fails, confirm that VNC viewers are enabled and that the dedicated password—not a local-user or Apple Account password—was saved.
- If a portable profile opens on Windows or Linux without connecting, verify that a fallback is selected, its credential is available under the current storage policy, and the saved host is reachable directly.
- If Apple Account handoff does not start, confirm that sortOfRemoteNG is running on macOS and Screen Sharing.app is available.
- If Screen Sharing.app requests authentication or approval, complete it there. A launched native app proves only that the handoff started, not that Apple authenticated the account or that the remote person approved control.

Return to the [protocol matrix]({{ '/protocols/' | relative_url }}) for ARD runtime scope and other client boundaries.
