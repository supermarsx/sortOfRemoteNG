# Isolated Icon Explorer review

Run `node scripts/icon-ui-capture.mjs` from the repository root. Uses installed
Chrome (`DOCS_CHROME_BINARY` can override the Windows default), a fresh temporary
profile and fresh Vite cache. Its validated profile directory and server/browser
are cleaned up in `finally`.

This renders the actual explorer, catalog, passive SVG renderer, library hook,
search, sidebar, and import-review model. Only the Open/stat/read boundary returns
a synthetic in-memory JSON pack; no import is applied. All other native calls,
filesystem writes, browser storage and IndexedDB are refused and recorded as
fatal markers. No user profile, credentials, vault or remote endpoint is used.

Six images and a JSON report are written to `.artifacts/icon-ui/` at 1440px and
390px. Assertions cover the 96-cell cap, empty-search icon gutter and compact
desktop width, category/sidebar selection, sticky details/sidebar during scroll,
reachable SVG export, bounded import names/fields and fixed import actions.
The visible demo caption distinguishes these screenshots from native persistence
or live-profile verification.

## Provider size contact sheet

Run `node scripts/provider-icons-capture.mjs` to render the explicit provider
review inventory using its actual catalog components. The 1440×1920 sheet shows
34 icons at 16, 24, and 32 CSS pixels on light and dark backgrounds. Output is
`.artifacts/provider-icons/provider-size-sheet.png` plus `report.json` containing
per-icon rendered artwork bounds. Missing keys, empty vectors, incorrect sizes,
active/external SVG content, overflow, and all native/storage boundary calls fail
the capture. This uses the same isolated temporary-profile cleanup as the main
Explorer review and performs no persistence or external endpoint requests.

The same command also captures all 27 role silhouettes using actual catalog
examples (including the existing open-folder counterpart), and every cloud or
database-role composite, including Citrix Web. These sheets verify common badge
coordinates and sample painted outline/emblem collisions at each size. Empty
badge viewport space is not treated as artwork: the unchanged open-folder ledge
can extend into that space without touching the emblem. Add `--roles-only` to
capture those two sheets independently while provider artwork is being edited;
that writes `role-report.json` and leaves the provider sheet/report unchanged.
