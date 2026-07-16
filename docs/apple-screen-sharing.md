---
title: Apple Screen Sharing authentication
eyebrow: Use the app
description: Choose the truthful ARD authentication path without exposing an Apple Account password or confusing Apple identity with RFB credentials.
permalink: /apple-screen-sharing/
---

Apple Remote Desktop, VNC compatibility, and Apple Account (formerly Apple ID) screen-sharing requests reach similar-looking remote desktops through different authentication systems. sortOfRemoteNG keeps those systems separate so a credential is never sent to a protocol that cannot accept it.

<div class="callout">
  <strong>Never enter an Apple Account password or verification code in sortOfRemoteNG.</strong>
  <p>Apple Account authentication stays in Screen Sharing.app. The saved Apple Account identifier is routing and identity metadata, not a password and not an ARD/RFB credential.</p>
</div>

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

On Windows and Linux, Apple Account mode fails closed because Apple's Screen Sharing app and its account-mediated connection service are unavailable. Use an embedded remote-Mac account or dedicated VNC password instead.

## What Apple identity features do not provide

### Sign in with Apple

Sign in with Apple authenticates a person to the developer's app or web service. Apple returns an identity token whose audience is that app's client identifier; the documented scopes cover identity information such as name and email. It does not issue a remote-Mac login, ARD credential, RFB password, or Screen Sharing approval.

See Apple's [Sign in with Apple authentication flow](https://developer.apple.com/documentation/signinwithapple/authenticating-users-with-sign-in-with-apple), [token-verification requirements](https://developer.apple.com/documentation/signinwithapple/verifying-a-user), and [authorization scopes](https://developer.apple.com/documentation/authenticationservices/asauthorization/scope). A future Sign in with Apple option could identify a user to a sortOfRemoteNG-owned service, but it could not authenticate that user to another Mac.

### App-specific passwords

Apple describes app-specific passwords for third-party applications accessing Apple Account-backed services such as iCloud Mail, Calendar, and Contacts. Apple does not document them as ARD/RFB credentials, and the remote Mac's ARD/RFB authentication paths do not accept them as such. See Apple's [app-specific password guidance](https://support.apple.com/102654).

Using an app-specific password in the ARD password field would therefore be both misleading and nonfunctional. Use the native Apple Account handoff when Apple identity is required.

## Saved data and exports

The Apple Account identifier is non-secret connection metadata, but it can still identify a person:

- Normal and full exports preserve it so the saved connection remains portable.
- Credential-free exports omit it as sensitive identity metadata.
- Apple Account passwords, verification codes, approval responses, and Sign in with Apple tokens cannot appear in any export because sortOfRemoteNG never receives or stores them for ARD.

Inspect full exports before sharing them, just as you would inspect hostnames and usernames. Apple recommends that users never share their Apple Account password, verification codes, recovery key, or other account-security details in its [Apple Account security guidance](https://support.apple.com/102614).

## Troubleshooting

- If embedded authentication fails, verify that the chosen local or directory account is allowed by the target Mac's Screen Sharing or Remote Management settings.
- If VNC authentication fails, confirm that VNC viewers are enabled and that the dedicated password—not a local-user or Apple Account password—was saved.
- If Apple Account handoff does not start, confirm that sortOfRemoteNG is running on macOS and Screen Sharing.app is available.
- If Screen Sharing.app requests authentication or approval, complete it there. A launched native app proves only that the handoff started, not that Apple authenticated the account or that the remote person approved control.

Return to the [protocol matrix]({{ '/protocols/' | relative_url }}) for ARD runtime scope and other client boundaries.
