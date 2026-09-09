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
