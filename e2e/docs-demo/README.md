# Actual-component documentation captures

Run `node scripts/docs-app-capture.mjs editor` for one view, or
`node scripts/docs-app-capture.mjs --publish` for the complete reviewed asset set.
The default output is `.artifacts/docs-app`; publishing copies the verified set
and SHA-256/dimension manifest into `docs/assets/screenshots`.

The fixture imports the real React components, providers, hooks and app CSS.
Only native/storage boundaries and the initial provider snapshots are synthetic.
Database unlock initialization uses the real manager with a synthetic native
lease; no OS vault, password operation, key, user profile or native file is used.
Hosts use reserved `example.test` names. CSP refuses remote resources. IndexedDB
access is blocked; benign browser history storage stays in memory. Settings and
connection saves fail closed. Every unconfigured IPC is refused and recorded as
fatal, including errors a production hook catches.

Capture waits for each view's actual asynchronous data (records, status, summary,
or statistics), checks fatal markers, and uses a fresh disposable Chrome profile
and Vite cache on every run (including cold CommonJS dependency prebundling).
The fixed app viewport is 1440×1000, or 1440×1500 for the full artifact table.
`DOCS_CHROME_BINARY` can select an installed Chrome binary. The loopback fixture
uses port 4319 and refuses a port conflict; it never stops an existing process.

The Vite adapter bounds source discovery, prebundles known CommonJS dependencies,
and only reorders the real Next stylesheet's imports for Vite compatibility.
It does not replace app styling or render screenshots from imitation markup.
Screenshots must be visually reviewed before publication and clearly captioned
as demo data. They demonstrate the interface, not native functionality, a live
connection, real certificate validation, or successful data encryption.
