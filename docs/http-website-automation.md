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
grayscale, and choose whether to preserve images and video. Preserving media
keeps pictures roughly as the site drew them: **Filter** mode inverts images back
so a photograph is not shown as a negative, and the dynamic modes tell the engine
not to analyze them. Device pages often use line art instead — a toolbar strip,
status icons, a logo — drawn dark on a white background, which stays a bright
block on an otherwise dark page. Turn media preservation off for those. In
**Filter** mode the page inversion then reaches the images as well, which
darkens such a strip reliably; in the dynamic modes the engine analyzes each
image and may still leave small or ambiguous ones exactly as they were. Start
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

Device interfaces often build a page out of frames — a banner, a menu and a
content pane, sometimes inside a `<frameset>` that draws nothing of its own.
Every document of the page that comes from this website is themed, not only the
outer one, and each frame themes itself as it loads, so following a menu link
does not flash a white pane first. Changing the appearance re-themes the frames
that are already open.

- **Frames from this website** are themed in full, including the dynamic engine,
  at any nesting depth.
- **A `<frameset>` page** contributes only its own background and the gutters
  between its frames. Gutters are painted from the frameset's `bordercolor`
  attribute, which no stylesheet reaches, so the extension sets that attribute
  and puts the original back when you disable the extension. In **Filter** mode
  the background and the gutters are both left alone: the whole-page inversion
  already darkens them, and a pre-inverted color would leave them tinted green
  rather than gray. The dynamic engine is skipped in a frameset document, which
  has no content of its own to recolor; the panels are themed inside the frames.
- **Frames the page builds in the browser** — `document.write`, `srcdoc`, an
  empty frame filled by script — are never fetched, so they carry no extension
  of their own. The document that owns them styles them with CSS only:
  background, text, the legacy color attributes and your custom CSS. The dynamic
  engine converts the document it runs in and cannot be aimed at another one. At
  most 64 such documents, up to eight levels deep, are styled this way.
- **Frames from another website** are never themed. They are not served through
  this connection, and the browser keeps them in their own origin, out of reach
  of everything on the surrounding page. That is the same separation that keeps
  a website out of the app, so it is not relaxed to make a theme look complete.
  An embedded map, advertisement or sign-in widget staying in its own colors is
  expected.

Inversion happens once and in one place: **Filter** and **Dynamic + filter** put
their filter on the outermost document, where it composites over every frame
below it. Those frames do not filter themselves again, so nested content is not
inverted twice.

Pages that set color in markup instead of styles — `bgcolor` on a table, `text`
on the body, `<font color>` around a label — are handled by whichever engine is
running: the dynamic engine rewrites those attributes, and a filter inverts them
with everything else. They are overridden explicitly only where no engine runs:
**Custom CSS only**, the CSS-only frames above, and the engine-less fallback
described below when the engine cannot load at all. Otherwise such a page would
read as black text on a near-black background. This needs no setting of its own.

The dynamic engine can fetch resources only from the same proxy origin, with
redirects refused; the page receives no native fetch bridge. Unusual styling or
blocked page resources can still prevent a faithful conversion. Database locks,
owner changes and navigation revoke pending operations and remove old-document
styles. A save or engine failure is reported in the extension controls instead
of being treated as success, and those controls also say which way the page was
themed — by the engine, or with CSS only and why — so a page that comes out
plainer than expected is explained rather than left to guess at. The dark-mode
controls do not depend on the scripts/macros library being available.

The engine is itself a script the page has to load, so a policy that blocks
scripts blocks it too. With **Internal proxy controls → Website scripts** set to
**Block external script files**, the engine would be refused by the page's
content security policy, so it is not requested at all — no blocked load, no
wait — and **Dynamic** and **Dynamic + filter** theme the page with the
engine-less CSS path instead of leaving it untouched: the base background
and text colors, the legacy `bgcolor`, `text` and `<font color>` rules, and your
custom CSS. The extension controls say the page is themed with CSS only and name
the setting to change; choose **Allow website scripts** there for full
conversion. **Filter** and **Custom CSS only** never used the engine and are
unaffected, while **Block website scripts and automation** leaves nothing of the
extension running on the page at all.

A website can refuse the engine with its own content security policy even where
this connection allows scripts. That is not known in advance, so the engine is
requested and either fails outright or does not install within a few seconds;
the page is then themed the same CSS-only way. Every frame of it falls back
together, and a page where any frame missed the engine is reported as themed
with CSS only rather than as fully converted. The cause here is the site's
decision rather than one of your settings, so the controls name no setting to
change. No security policy is relaxed, on either side, to make a theme work.

Dark mode is a screen theme. Nothing is added for printing, so a page printed or
saved as PDF from the website's own print control can come out dark, with
inverted images in the filter modes. Disable the extension, print, then enable it
again.

After updating the native proxy, rebuild/restart the desktop app and reopen the
web tab. Frontend Fast Refresh alone cannot update the injected native helper.

Website replies are untrusted. The app checks the iframe, origin, proxy session, document identity and current navigation, and accepts only replies to its own armed operations. These freshness checks do not bypass TLS trust or establish that a website account is signed in. See [website application profiles]({{ '/http-application-profiles/' | relative_url }}) for supported sign-in modes and [web viewer troubleshooting]({{ '/http-viewer-trust/' | relative_url }}) for trust and loading behavior.
