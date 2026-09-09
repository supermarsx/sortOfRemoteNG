# Isolated database UI review

Run `node scripts/database-ui-capture.mjs` from the repository root. Chrome is
read from `DOCS_CHROME_BINARY`, or its standard Windows installation path.

The fixture renders the real database authentication dialog, bulk controls,
bulk-operation hook, and toast provider using synthetic databases. Native IPC,
native resources, browser storage, and IndexedDB are refused and recorded as
fatal errors. Authentication is never attempted. The clone demo advances only
explicitly deferred, in-memory operations. This verifies presentation and UI
behavior, not a live database, vault, or encryption implementation.

Each run uses a fresh temporary Chrome profile and Vite cache, binds localhost
only, and removes its own validated temporary directory in `finally`. Output
is written to `.artifacts/database-ui/`: six screenshots and a JSON report for
1440px and 390px viewports. Checks cover all 18 bulk password fields, body
padding and scrolling, a fixed reachable footer, no page overflow, and exactly
one incomplete progress toast. Every screenshot visibly identifies demo data.

Run `node scripts/database-ui-capture.mjs --recycle` for six additional desktop/narrow
views of the real recycle-bin explorer, purge review and retention review. Only
redacted synthetic rows and in-memory review tokens are provided; all archive,
restore and commit methods refuse execution. The run checks the 50-row page cap,
search-icon gutter, friendly database names and fixed, reachable review footers.
The report is `.artifacts/database-ui/report-recycle.json`; no live database
or persistence behavior is claimed by these screenshots.
