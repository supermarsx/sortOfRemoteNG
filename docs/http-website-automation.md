---
title: Website macros, scripts and dark mode
eyebrow: Use the app
description: Explicit, page-only website actions beside your bookmarks, with protected libraries and per-connection consent.
permalink: /http-website-automation/
---

Open an HTTP or HTTPS connection's **Protocol → Advanced** settings to opt into website macros, manual JavaScript, or the dark-mode extension. Each capability starts off. Global **Session quick actions** settings control availability but never grant permission for a connection. Save the connection and open its website normally; certificate approval and website sign-in remain separate.

## Record a website macro

Choose **Record macro** beside the bookmarks. If this connection has not opted in, review **Enable website macros?** first. Enabling saves only that connection's macro permission; it does not start recording, enable JavaScript, or change dark mode. Click **Record macro** again when ready. The library also offers **Record new macro**.

Click public page controls or change non-secret fields. The pinned recording controls show **Stop & review** and the captured step count even when a long bookmark list scrolls. Choose **Stop & review**, give the macro a name, and select **Save macro**. Unsaved steps can be reviewed again or explicitly discarded; discarding a capture does not delete saved library macros. Starting over or leaving an edited draft asks before dropping it. Use a saved macro's favorite star to add a replay chip for this connection.

Website macros are not HAR recordings, videos, or terminal command macros. They contain up to 200 structural click, checkbox/radio, and field-fill steps. They do **not** store typed values, page text, URLs, request bodies, element IDs, or credentials. A field-fill step asks for a temporary value during replay. Recognized password, authentication/OTP, file and hidden fields are excluded; a hidden CSRF bookkeeping field does not prevent recording unrelated public controls. Do not use this feature to automate sign-in or enter secrets.

Public buttons and submit inputs are supported, but buttons belonging to a recognized login or credential form are excluded, including externally associated form controls. Text, search, email, URL, telephone, number, date/time, month/week, range and color inputs, text areas and selection fields use the same supported types for capture and replay. Their values are still never recorded. Reset and image inputs are not captured.

Review the current page before replay: a structural position can point at a different button after the website layout changes. There is no promise of detecting such replacements. These macros operate on one loaded document; navigation cancels pending steps. Nested frames, shadow DOM, arbitrary SPA state, drag gestures, uploads and multi-page workflows are not captured. Website actions can change remote data; stopping cannot undo completed actions.

## Keep and run JavaScript

Open **Website macros & JavaScript library**, choose **New JavaScript**, and enter your own page script. Save it for reuse or run the draft manually. The confirmation shows the code before execution; the global script confirmation setting defaults on. Macro replay uses the existing macro replay confirmation setting.

Scripts have only the website's JavaScript privileges, including any current signed-in session—not desktop files, native commands, saved connection credentials, or other app capabilities. They can still change or send website data. Review code carefully. A secret-pattern check rejects some obvious credential literals, but it cannot prove arbitrary code is secret-free. Never put passwords or tokens in scripts or notes. Already-running JavaScript cannot reliably be interrupted or reversed.

Libraries use the desktop **Macros** artifact protection policy, not browser local storage or the Connections artifact policy. Encryption depends on that policy; it is not always enabled. The library is limited to 128 scripts, 128 macros and 2 MiB total, with each script at most 64 KiB. Favorites save only ordered item IDs in the connection. A failed save is reported rather than silently switching to browser storage. Locked, unavailable or changed owning databases prevent new actions; older sessions without an owner receipt must be reconnected.

## Enable the dark-mode extension

Choose the moon icon immediately before the website recording controls, then
**Enable extension**. Use **Disable extension** to restore the site's appearance.
Enabling is remembered for this saved connection in its owning database; another
website does not become enabled automatically. Appearance can also be configured
in the connection editor. Saving appearance changes does not reconnect the proxy
or discard the website login session.

Choose **Use app appearance defaults**, or turn it off to customize this
connection. **Settings → Web Browser → Website appearance** holds shared defaults
and your named presets. Save the Settings dialog to apply those defaults to
already-enabled connections that use them. The global **Allow dark-mode
extension** switch controls availability, not consent for every website.

- **Dynamic** recolors backgrounds, text, borders and other styled elements as
  the page changes, using the locally bundled [Dark Reader API](https://github.com/darkreader/darkreader/blob/main/README.md),
  pinned to version 4.9.130. No CDN script is downloaded at runtime.
- **Filter** applies a whole-page inversion and color adjustments, without
  loading the dynamic engine. This can help unusual pages, but may affect fixed
  positioning and media colors.
- **Dynamic + filter** combines dynamic recoloring with brightness, contrast,
  sepia and grayscale adjustments. It does not invert the page twice.
- **Custom CSS only** applies your local styles without either conversion engine.
  Custom CSS can also supplement the other modes.

Adjust the base background and text colors, brightness, contrast, sepia and
grayscale, and choose whether to preserve images and video. Media preservation
reduces recoloring; whole-page filters can still affect their appearance. Start
with a built-in preset or save your current app defaults as a named custom preset.
Use **Save appearance** to persist connection changes; selecting a preset alone
does not save or enable the extension.

Custom CSS is limited to 16 KiB of local styles: selectors, colors, gradients and
calculations are supported. Imports, URLs, external fonts, at-rules, comments,
escapes and indirect resource functions such as `var()` are intentionally
rejected. For example:

```css
main {
  background: #151515 !important;
  color: #ededed !important;
}
```

The dynamic engine can fetch resources only from the same proxy origin, with
redirects refused; the page receives no native fetch bridge. Site CSP, disabled
page scripts, unusual styling or blocked resources can prevent conversion. No
security policy is relaxed to make a theme work. Database locks, owner changes
and navigation revoke pending operations and remove old-document styles. A save
or engine failure is reported in the extension controls instead of being treated
as success. The dark-mode controls do not depend on the scripts/macros library
being available.

After updating the native proxy, rebuild/restart the desktop app and reopen the
web tab. Frontend Fast Refresh alone cannot update the injected native helper.

Website replies are untrusted. The app checks the iframe, origin, proxy session, document identity and current navigation, and accepts only replies to its own armed operations. These freshness checks do not bypass TLS trust or establish that a website account is signed in. See [website application profiles]({{ '/http-application-profiles/' | relative_url }}) for supported sign-in modes and [web viewer troubleshooting]({{ '/http-viewer-trust/' | relative_url }}) for trust and loading behavior.
