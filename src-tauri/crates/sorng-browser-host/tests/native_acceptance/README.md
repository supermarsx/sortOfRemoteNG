# Independent CEF acceptance client

Opt-in actual-browser executable; never an ordinary unit test or a production
readiness grant. Uses the production host, request context, sandbox bootstrap,
renderer hooks and route proxy. Source/DOM test doubles cannot satisfy this gate.

Windows build (PowerShell, pinned SDK already staged by the packaging lane):

```powershell
$env:CEF_PATH = 'F:\Projects\sortOfRemoteNG\.artifacts\cef-app-client-windows-x64-20261006\sdk\runtime'
node scripts/native-build-env.mjs cargo build --manifest-path src-tauri/crates/sorng-browser-host/tests/native_acceptance/Cargo.toml --lib --target-dir F:/Projects/sortOfRemoteNG/src-tauri/target --offline --locked
node scripts/cef-browser-acceptance.mjs stage --runtime $env:CEF_PATH --client src-tauri/target/debug/sorng_cef_acceptance.dll --output .artifacts/cef-acceptance-bundle-01 --target x86_64-pc-windows-msvc
node scripts/cef-browser-acceptance.mjs run --executable .artifacts/cef-acceptance-bundle-01/sorng_cef_acceptance.exe --output .artifacts/cef-acceptance-run-01
```

## Where the client's windows go

On Windows every command that starts the client (`run`, `run-tls`, `measure`,
`menu`) starts it on a **private Win32 desktop** made for that run. Nothing the
client shows, focuses or activates can reach the desktop of whoever is using the
machine, and nothing typed or clicked there can reach the client. This is the
default and needs no option.

`launch-on-private-desktop.ps1` does it: it creates a desktop with a fresh name
(`sorng-acceptance-<16 hex digits>`) and the access list and integrity label of
the current desktop, starts the client suspended with that desktop in its start-up
information, puts it in a job object that kills every process in it when the
launcher ends for any reason, enforces the run's timeout, and closes its handles.
It never switches desktops, sends no input, activates no window and passes the
client no argument: the sandbox and every engine flag are what they are on any
desktop. The client's output goes to `NEW_DIR/client-stdout.txt` and
`client-stderr.txt`, the launcher's record to `NEW_DIR/private-desktop.json`, and
every report carries that record under `desktop`.

While the client runs the launcher reads, every 50 ms, on the desktop it was
started from: which process owns the foreground window, and the clipboard
sequence number. **A run does not count**, and the report says so in `failures`,
when a process of the client ever owned that foreground window (everything is
killed at that moment), when the clipboard sequence number changed (also when
somebody else copied something: the run cannot tell), when a process outlived
the client, or when the desktop could not be closed.

```powershell
# Puts the client's windows on YOUR desktop. Only for the manual TLS window.
node scripts/cef-browser-acceptance.mjs run-tls --executable ... --output NEW_DIR --manual true --use-interactive-desktop true
```

**`--use-interactive-desktop true` is the only way onto the desktop a person is
using, and it should not be used while anyone is.** In the one launch observed
on a live desktop a window of the client other than the fixture window held the
foreground for about 52 seconds (see the context-menu section). No environment
variable and no CI detection selects it. `--manual true` needs it, because a
person has to see that window.

What differs on a private desktop, as far as it was observed (three launches:
one baseline scenario, the two capacity scenarios, one context-menu run): no
window there is ever the foreground window, so the client's own foreground
records are always empty, and M6's premise ("fixture window not foreground")
would hold trivially (the `e-*` scenarios were not run there); no other
program's window covers the fixture window (`coveringWindows` 0, was 3); and
Windows adds two 50x50 topmost input-indicator windows to the client process.
Observed there with nothing to compare it to: the client's UI thread never had
an active or a focused window, also while tabs were created. In the
baseline scenario the page was `visible` with `document.hasFocus()` true, and
frame cadence (31-32 per second), the 20 ms timer (34-48 ticks per second) and
login time (1.7 s) were inside the ranges measured on the interactive desktop.
In the context-menu run every outcome, row, engine-reported value and click
point equalled the interactive launch on all 97 common steps, apart from the
one row the handler change was meant to disable. Relay counters do not depend
on a window. The OS popup of a context menu, Inspect, Developer tools and Print
are never opened in any mode, so nothing is known about them on either desktop.

Linux and macOS have no such launcher: the client uses whatever display the
caller provides (CI wraps the Linux run in `xvfb-run`). The Windows CI job calls
the runner with defaults and therefore now runs on a private desktop too; that
was not verified on a hosted runner.

Both stage and run require new output directories and retain evidence. Staging
reuses packaging-lane binary/SDK inspection but does not establish archive-to-tree
provenance, signing or release acceptance. Use Dirac's archive-backed staging for
those independent claims. Windows runs the pinned bootstrap, not a fabricated
sandbox pointer or the normal Rust test harness.

Fixture key/certificate and profile are disposable. The private key stays in
memory. A test-only native App wrapper forwards production handlers and adds
the newly generated certificate SPKI pin and a local netlog output. After the
first run exposed global-profile public egress, it also installs a rejecting
loopback proxy on the global request context and maps non-loopback DNS to NOTFOUND. These extra
guards are explicitly labelled test scaffolding, not production containment.
Run 02 established that a command-line proxy prevents private-context proxy
writes (`Failed(ProxyRejected)`), so the fixture now installs and reads back the
global context preference during `OnContextInitialized` instead. The private
context is created only after that test guard succeeds. Production startup
containment still needs independent evidence without these extra guards. No system
certificate store, host mapping, firewall or sandbox privilege is changed.

The route dialer accepts only `fixture.test:443`, `frame.test:443` and
`accounts.google.com:443`, mapping them to the numeric loopback fixture listener.
It performs no DNS and has no network fallback. `accounts.google.com` is a local
synthetic staged form, **not** a public-provider login test. Credentials are fixed
synthetic literals; no application vault/database/profile is opened.

Evidence distinguishes real HTTPS/secure origin, HttpOnly and cross-context
cookies, cross-origin iframe access, native synthetic form filling, native
per-stage Google grants, request revocation and `OnBeforeClose`. DOM background
and prefers-dark observations are separate from actual native pixels. Native
first paint remains `not-run` until a pixel/frame capture is collected. Netlog
checks do not replace OS DNS/socket tripwires or renderer sandbox token evidence.
Missing observations always fail acceptance; the tool never unlocks runtime Ready.

## Measurement mode: hidden, blocked, concurrent and background logins

`measure` runs the same client and fixture server through twelve scenarios and
prints observations, not a verdict. Its report is marked `mode: "measure"`; the
acceptance validator rejects such a report and nothing here unlocks Ready.

```powershell
node scripts/cef-browser-acceptance.mjs measure --executable .artifacts/cef-acceptance-bundle-NEW/sorng_cef_acceptance.exe --output NEW_DIR [--window-ms 5000..40000] [--only SCENARIO_ID,...]
```

Build and stage as above; any bundle staged from this client works. A full run
takes about 2 min 40 s (default 12 s window) and opens one 800x600 window titled
"Local CEF acceptance — synthetic fixtures only"; the `e-covered` scenario adds a
second, slightly larger "decoy" window for 15 s. On Windows both are on the
run's private desktop. Both are shown without activation and the fixture window
is disabled, so the fixture window cannot be activated or clicked into. That is
not the same as the process never owning the foreground window: it owns other
top-level windows (the toolkit's and the engine's), and in one context-menu
launch on the interactive desktop one of them was the foreground window for
about 52 s (see that section). The earlier statement that the nine measurement
launches of 2026-10-12 "never took the foreground" rests on a check that only
compares the foreground window with the fixture window; it cannot rule out
another window of the client having been foreground in those launches, and
nothing recorded then can settle it. Each scenario now records the first window
of the process seen as the foreground window
(`windowState.foregroundOwnedByFixtureProcess`), M1 prints it and M6 is not
`MEASURED` when there was one; on a private desktop that record is always empty,
because no window there is the foreground window. It writes
`NEW_DIR/measurement-matrix.txt` (the M1-M8 matrix), `NEW_DIR/measurements.json`
(matrix plus runner summary) and `NEW_DIR/run-*/native-report.json` (every raw
page and native observation under `measurements`). The exit code is 0 when the
tool ran cleanly; whether a login completed is a result, not a failure.

| Scenario                                        | What is presented                                                                      | Feeds |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- | ----- |
| `baseline-visible`                              | shown view; hidden at 60 % of the window                                               | M1-M3 |
| `a-hidden-after-attach`                         | `show`, `focus`, `hide`, then navigate; shown again at 60 %                            | M1-M3 |
| `b-born-hidden-1x1`, `b-born-hidden-1280x800`   | never shown; the second runs 2.5 windows                                               | M1-M4 |
| `b-born-hidden-generic`                         | never shown, `Generic` adapter                                                         | M3    |
| `c-visible-input-blocked`                       | `occlude(.., true)`, `show`, `occlude(.., true)`                                       | M3    |
| `d-concurrent`                                  | three browsers navigated in one loop turn: shown, hidden after attach, born hidden     | M5    |
| `f-relay-capacity`                              | 40 WebSockets and 2 x 6 held requests through one relay with its default client cap    | M7    |
| `f-relay-capacity-capped`                       | the same page through a relay whose cap the fixture sets to 32                         | M8    |
| `e-inactive`, `e-covered`, `e-minimized-hidden` | fixture window not foreground; covered by the decoy; minimized with a born-hidden view | M6    |

Logins use `ModularForm`, the adapter production selects for a saved form
profile and the only form path that types through CEF key events
(`FormPrepare`, `Form`, `FormSubmit`). `Generic` assigns field values in page
script and sends no key event, so it cannot answer whether keys reach a hidden
frame. The hooks grant ten minutes, as the app's attempt consent does, so the
production budgets are what limits a login. Credentials are the same synthetic
literals; the route admits only `fixture.test:443` and `frame.test:443`.

The page probes are passive: a chained 20 ms timer and `requestAnimationFrame`
counted per second, `visibilitychange`, capture-phase `keydown`/`beforeinput`/
`input` counts with `isTrusted`, and layout boxes. Reports carry counts, sizes
and times, never a typed value. Each row of the matrix is `MEASURED` only when
its page report covers the whole window and the native state was the planned
one at navigation (lifecycle, child-window `WS_VISIBLE`, window state for M6);
otherwise it prints its reasons and no value. Window state, the child windows
and the exposure estimate are Windows-only: elsewhere the three `e-*` scenarios
are skipped and their rows stay `NOT MEASURED`.

First results (Windows 11 x64, 2026-10-12; host and protocols at `af3a0002`;
two full runs, and three earlier ones taken while the machine was short of
loopback ports that gave the same values; per-run values in
`.orchestration/logs/t101-e1r.md`):

- A hidden native view is not a hidden page. `document.visibilityState` was
  `visible` at start and end in every hidden slot, with no `visibilitychange`
  when a view was hidden or shown mid-window, when the fixture window was
  covered, and when it was minimized.
- Hiding a view does not throttle its timers or frames: 42-49 ticks of a 20 ms
  timer and 27-33 frames per second, hidden or visible, including over 30 s. In
  one run the timer ran at 32-35 ticks per second (31 ms apart) for about 100 s
  in shown and hidden views alike; frames, key timing and login times did not
  change and the cause was not determined.
- Key events reach a hidden frame, including one never shown and never focused:
  22+20 trusted `input` events at the same 35-38 ms per key as visible.
- A visible view with input blocked received no key: the login was rejected
  right after its `form` delivery, in five runs of five.
- A 1x1 view gives the page a 14x14 viewport and its narrow-screen layout.
- Three concurrent logins all completed, in 1.8-2.1 s against 1.7-1.9 s alone.
- 52 requested connections against a relay limit of 32, which was the relay's
  default at `af3a0002`: 20 refusals every run, seen by the page as 19-20
  failed WebSockets and at most one failed request. That is a property of a cap
  of 32, not of the relay as it is now (see below).

The relay's default client cap has since been raised to 256, the sum of the
engine's two per-proxy socket pools (128 ordinary, 128 WebSocket), because a cap
below it refuses connections the engine has already admitted. The capacity
scenario is therefore two scenarios. `f-relay-capacity` (M7) sends the same 52
connections through a relay with its default cap and reports what that relay
did, whatever its default is: with 256 the expectation is 0 refusals and 0
failed WebSockets, and a client built before the change measures the 20
refusals above. `f-relay-capacity-capped` (M8) gives its relay a cap of 32 in
the fixture (`ProxyLimits { max_clients: 32, .. }`), so the refusal path keeps
its real-engine coverage without depending on the default; M8 is `MEASURED`
only when the cap was set by the fixture and the page asked for more.

Measured once with the new default (2026-10-12 23:00, private desktop, client
built at `b8eda5db` with `private_forward_proxy.rs` sha256 `02df39eeb83ed237`):

- M7, default cap 256: 52 connections requested, **0 capacity refusals**; all 40
  WebSockets open, 0 WebSocket errors, 0 failed held requests; the fixture held
  52 at once.
- M8, cap 32 set by the fixture: **21 refusals**; 22 WebSockets open and 18
  failed, 2 held requests failed (one per host); the fixture never held more
  than 32 at once.

macOS and Linux are not measured. The app shell itself (the Tauri window, its
overlays and its tab management) was not measured either: these results are for
the standalone client only. The three acceptance attempts (`run`) still
create their window focused and enabled; a shown view takes native focus when
it navigates, which is how an early measurement launch took the foreground. On
Windows they now do so on the run's private desktop.

## Context-menu evidence mode: rows, commands and "the page's own menu wins"

`menu` runs the same client and fixture server through two scenarios that
right-click a fixture page and record what the production context-menu handler
did. It prints observations next to what K10 and the handler's unit tests
expect. A difference is a result to read, never a failure of the run, and the
report (`mode: "menu"`) is rejected by the acceptance validator.

```powershell
node scripts/cef-browser-acceptance.mjs menu --executable .artifacts/cef-acceptance-bundle-NEW/sorng_cef_acceptance.exe --output NEW_DIR
```

Build and stage as above. This crate's manifest enables the host's
`acceptance-probe` feature, and nothing else does: the app's build contains no
probe. A run takes about 1 min 20 s and opens the same 800x600 window, disabled,
shown without activation and placed below every other window; on Windows that
is on the run's private desktop. No menu, inspector or print dialog is ever
shown; up to five hidden child views exist briefly for "Open ... in new tab".
It writes `NEW_DIR/menu-evidence.txt` (every step, then the differences
grouped), `NEW_DIR/menu-evidence.json` and `NEW_DIR/run-*/native-report.json`
(raw records under `menu`).

**Never run it with `--use-interactive-desktop true` while someone is using the
machine.** In the one launch made on a desktop that had a foreground window, a
window of the client other than the fixture window owned the foreground for
about 52 s (see Foreground below).

How it observes:

- A right-click is CEF's own `send_mouse_click_event` on the scenario's browser
  (found with `browser_host_get_browser_by_identifier` when the host creates
  the view, and checked against the view's child window), at the centre the
  fixture page reported for the target. One pointer move per zoom level, which
  the page answers, gives view units per CSS pixel. The context-menu key, the
  wheel and End/Home go through the same engine methods. No OS-level input.
- The host's probe stands in for the OS popup and for the clipboard writer and
  counts every menu the engine asks for; its observer reports what the engine
  told the policy. The page reports what it saw of each `contextmenu` event,
  after all of its handlers ran.
- One right-click is then one of: **native-menu** (engine asked, probe got
  rows), **host-refused** (engine asked, no rows), **page-handled** (the page
  prevented the default, the engine did not ask and the probe was not called
  for 900 ms; a request otherwise arrives within 50 ms), or not delivered.
- Seven rows are never selected, whatever a step asks for: Print, Inspect and
  Developer tools open an OS dialog or an activating top-level window; Copy and
  Cut write the OS clipboard; Paste and Paste as plain text would read whatever
  the desktop's clipboard holds into the page. They are observed as rows only.
  The OS clipboard is never written and nothing of it is read: only its
  sequence number is recorded, around every step.
- Each scenario records every change of which window of the client, if any, is
  the desktop's foreground window (`window.foregroundOwnedByClient`; always
  empty on a private desktop), every change of the active and of the focused
  window of the client's UI thread (`window.uiThreadWindows`, which a private
  desktop does not hide), and every shown top-level window of the client other
  than the fixture window, by class.

| Scenario      | Popup policy | What it covers                                                                                                                                          |
| ------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `menu-main`   | Tabs         | rows per target, the page's own handling (element, inline, `document`, two frames, keyboard), every selectable command, scroll, zoom, refusals, history |
| `menu-global` | Block        | first page of a view, Back on it, the four "Open ... in new tab" rows with popups blocked, a document that prevents every `contextmenu`                 |

Results (Windows 11 x64, 2026-10-12; five launches. Launches 1-4: interactive
desktop, host at `41117759` plus the uncommitted menu work, `cef_context_menu.rs`
sha256 `6e9062ce405e4985`. Launch 5: private desktop, client built at `b60d0a1a`
with the handler at sha256 `ca65fc1e2b45e161` and the plan as committed here,
101 steps. Per-run values in `.orchestration/logs/t101-e24.md`):

- **The page's own menu wins.** 13 cases in each of five launches, 65 of 65:
  the page saw the event and prevented it, the engine asked for no menu and the
  probe was never called. `preventDefault()` on the element; the same with the
  page drawing its own menu; inline `oncontextmenu="return false"`; a handler on
  `document`; a handler inside a same-origin frame and inside a frame of another
  origin; the context-menu key on a focused element; and a document that
  prevents every `contextmenu` (plain area, link, image, video, text field,
  keyboard). A handler that does not prevent the default (listening only,
  `stopPropagation()` only, or preventing `mousedown`/`mouseup`/`pointerdown`/
  `auxclick`) leaves the native menu, and so does a frame without a handler
  inside a document that prevents everything.
- **Rows** were the same in all five launches. Link: Open link in new tab,
  Copy link address. Image, video, audio: Open ... in new tab, Copy ...
  address; an image inside a link gets both groups, link first. Editable field:
  Undo, Redo, Cut, Copy, Paste, Paste as plain text, Delete, Select all, with
  both paste rows enabled. Selected text: Copy, Select all. Every menu: Back,
  Forward, Reload, Stop loading, Print, Inspect, Developer tools. Open is
  disabled for `javascript:`, another origin, a plain-http downgrade and a
  `data:` image, and enabled for the attempt's second origin. Password field:
  Cut and Copy disabled, both paste rows enabled, empty or filled or fully
  selected.
- **Differences from the unit tests' assumptions**: the engine sets
  `CAN_SELECT_ALL` on every page, so Select all is on every menu, including a
  plain page, a link and an image; and Back is enabled on the first page of a
  view once it has loaded (selecting it shows `about:blank`). While a document
  loads, Back and Forward show the state from before the navigation and Print
  is disabled.
- **No menu** while input is blocked, the view is hidden, a manual-input slot
  is active, or the attempt is revoked: the engine still asks and the host
  offers no rows. The next right-click after each state ends gets the menu
  again.
- **Commands**: every Copy ... address row delivered the expected text to the
  probe's sink (13 targets, and three more on the scrolled and zoomed page).
  Open link/image/video in new tab opened exactly one hidden view each and the
  fixture served exactly that address; a disabled Open row cannot be run.
  Select all, Delete, Undo, Redo, Stop loading, Back, Forward and Reload did
  what their names say. All 33 commands selected in launch 4 and all 33 in
  launch 5 reached the handler with its receipt intact, so the command arrives
  before the dismissal that clears it.
- **Popup policy.** With the policy Block, Open link in new tab was offered
  enabled and did nothing but log `action=OpenLink failure=command-unavailable`,
  in launches 1-4. The handler was then changed to read the view's popup policy
  (sha256 `ca65fc1e2b45e161`), and launch 5 observed the change in the engine:
  with Block, Open link, Open image, Open video and Open audio in new tab were
  each shown **disabled** beside an enabled Copy ... address row, the probe
  could not run any of them, no tab opened and the handler logged no failure
  line; with Tabs the same four rows were enabled and each opened exactly one
  hidden view (0 to 1, 1 to 2, 2 to 3, 3 to 4).
- **What the engine reports**: `link_url` and `unfiltered_link_url` are both
  the resolved address (`/menu-target?item=7&q=a b` arrives as
  `https://fixture.test/menu-target?item=7&q=a%20b`); for `javascript:void(0)`
  they are `about:blank#blocked` and `javascript:void(0)`. `media_type` follows
  the element, also for a video whose source failed to load. Edit flags: empty
  password field `CAN_PASTE`, filled `CAN_PASTE|CAN_SELECT_ALL`, plus
  `CAN_TRANSLATE` everywhere and `CAN_EDIT_RICHLY` in a contenteditable.
  Launch 5 reported the same link address, unfiltered address, source address,
  media type, edit flags, editable state and point as launch 4 on all 80 common
  steps that have an engine report.
- **The click point** the menu would hand to Inspect equalled the view
  coordinates of the click in every case: page, scrolled page (viewport, not
  document), same-origin frame and other-origin frame (the page's view, not the
  frame's), and at 125 % zoom (view units, not CSS pixels; one unit of rounding
  inside a frame). The context-menu key reports the focused element's centre,
  or (1, 1) with nothing focused.
- **Foreground.** In one observed launch on the interactive desktop (launch 4)
  a window of the client other than the fixture window held the foreground for
  about 52 seconds. What is known: a 50 ms outside sampler found a process of
  the bundle owning the foreground window in 826 of 1,317 samples; the client's
  own record says the fixture window was never the foreground window and that
  the only other shown top-level window of its process, from start to end, was
  the toolkit's 16x16 `WS_EX_NOACTIVATE` event window; the 52 s fit the time
  from the first "Open link in new tab", which creates a second browser, to the
  end of the run, and the other reading (start-up to the end of the first
  scenario) is not excluded; the host creates a view and a tab from the same
  prepared window description (a child of the fixture window, `WS_VISIBLE`
  cleared, `WS_EX_NOACTIVATE` set), then calls `set_focus(0)` and disables and
  hides the child, and nothing in its tab path activates a window. What is not
  known: which window it was, and even which process of the client owned it
  (the sampler kept only whether the owner's image was in the bundle); why
  Windows allowed it; and whether the app does the same, since the same
  `open_tab` path runs there. Launches 1-3 could not show it: the session had
  no foreground window then. Launch 5 cannot show it either: on a private
  desktop no window is the foreground window. What launch 5 adds is that the
  client's UI thread had no active window and no focused window at any moment,
  including while five tabs were created.

Not measured: what Inspect, Developer tools, Print, Copy, Cut, Paste and Paste
as plain text do (they are never selected); the OS popup itself and its keyboard
handling; the real clipboard writer; anything on macOS or Linux; a device scale
factor other than 1; the app shell. After Back the host reported the earlier
document as loading for about 8 s in launches 2 and 3 (session without a
foreground window) and for less than 0.4 s in launches 4 (interactive desktop)
and 5 (private desktop); the cause was not determined.

## Portable gate and remaining platform measurements

The same `run --executable ... --output NEW_DIR` and report validator work on
Windows, Linux and macOS. The Rust binary invokes the existing Unix bootstrap on
Unix. Linux requires a packaging-lane X11/XWayland bundle and sandbox setup;
macOS requires the correctly signed application/framework/helper bundles. The
tool does not install packages, change setuid/user namespaces, sign binaries or
create signing identities. These platforms must run on their native runners;
Windows results do not count for Linux/macOS or either ARM64 target.

The Windows-only SDK copier intentionally rejects other targets rather than
inventing an unsupported package layout. Package the Unix executable/helper using
the existing platform packaging gate. Anonymous public provider acceptance is
separate and has not run here; CAPTCHA requires manual handling, never bypass.

## Bounded diagnosis and run-07 evidence

`native-trace.jsonl` is an append-only crash checkpoint: each bounded, redacted
entry is written and synchronized before returning to native code. A crash may
leave an incomplete final line; only complete lines are evidence. It is created
exclusively in the fresh run directory and never grants acceptance. Native hook
notifications and entry/return phases around context creation, browser creation,
and navigation help narrow failures before the first periodic snapshot.
`native-progress.json` is a once-per-second and after-each-attempt snapshot;
`native-report.json` remains the terminal report. The timeline retains at most
256 fixed-label entries plus a dropped count. It records context preparation,
native renderer/lifecycle notifications, synthetic grant stages, route-dial
results and fixture connection outcomes, never credentials or full page URLs.
The attempt table exposes only fixture names and numeric loopback proxy endpoints.
TLS counters distinguish accept, handshake completion and handshake failure.

Windows-only crash diagnosis is separately opt-in: set
`SORNG_CEF_ACCEPTANCE_EXCEPTION_TRACE=1` for the runner command. This installs a
process-local vectored exception observer after validating the fresh output
directory and before CEF initialization. `native-exceptions.txt` is exclusively
created and pre-opened. At most eight severe exceptions record the fixed code,
instruction address, known module label/base/relative offset, and up to 24
handler-stack addresses. It never records exception parameters, registers,
memory contents, URLs, credentials, or module paths; no symbol server is used.
The handler always returns `EXCEPTION_CONTINUE_SEARCH`, does not change context,
and neither overrides crash behavior nor enables global dumps. Stack capture and
disk writes are best effort and can perturb timing; the instruction record is
flushed before stack capture. Stack overflow, language exceptions, and debugger
breaks are excluded. The browser-process-only observer cannot attest child faults
or guarantee capture of fail-fast exceptions. Its file/registration deliberately
live until process exit to avoid callback teardown races. No acceptance or
production-readiness claim follows from this evidence.
The `native-command-line` trace reads the actual CEF global command-line object's
`disable-chrome-login-prompt` switch after initialization (not just source text
or the OS launch arguments). A missing switch is an explicit fixture failure;
auth-hook entry/return remains separate evidence that must actually occur.

For subsequent runs, `native-network-policy` calls production's
`network_policy_configured()` before each private context and before shutdown.
It also reads both actual preference stores, emitting only fixed comparison
booleans. The terminal `networkPolicy` stores the latest readback; the gate
requires both stores and the production check to pass, independently of traffic
containment. The legacy fixture proxy is installed first, then replaced by the
production global policy; metadata identifies that ordering explicitly.
The isolation attempt also exercises native zoom/reset/find/stop-find before
revocation and checks rejection afterward. `native-controls` reports dispatch
and admission only: there is no native zoom readback/find-result hook, so visual
effects and app IPC integration are not claimed.

### Run 17: local login passes; overall gate remains false

Latest measured artifacts: `.artifacts/cef-acceptance-run-17/run-OMJsDI/` and
`.artifacts/cef-acceptance-run-17/acceptance.json`. Host source snapshot:
`.artifacts/cef-acceptance-source-17/src/`; the five relevant host files matched
that snapshot after the run. Build/staging succeeded; the actual sandboxed CEF
fixture exited 0, with no native failures, no deadline termination, and no severe
exception records. The aggregate runner exited 1 for the remaining gates below.

- Generic `Form` and Google-shaped `Identifier`/`Password` grants reached
  `NativeSent`, `RendererReceived`, `RendererExecuting`, and `RendererAccepted`.
  Real local form proofs validated the synthetic values and completion.
- Real HTTPS-origin, native-cookie, iframe isolation, private-context isolation,
  and absent privileged-page-bridge checks passed. Nine HTTP requests reached the
  local TLS server; no upstream proxy-authorization header was observed.
- Production policy readback was true before private contexts and before
  shutdown, with all fixed checks true in both system and global stores.
- Zoom/reset/find/stop-find dispatch succeeded in isolation; zoom/find/stop-find
  were rejected after revocation. Visual effects and app IPC remain unmeasured.
- All three attempts closed with zero post-revocation requests. Restricted
  renderer-token observation passed for seven renderers; this is not a general
  sandbox security attestation.
- Remaining aggregate failures: unmeasured native first paint, unverified
  DNS/socket containment, and unexpected socket observations. The complete
  netlog has zero unexpected DNS entries and three `UDP_CONNECT` attempts to
  `[2001:4860:4860::8888]:443`, each ending -109. This is not proof of transmitted
  packets; classification remains unresolved and the tripwire was not relaxed.
- DOM background was white and `prefersDark` true; neither measures Chromium
  auto-dark pixels. `nativePixelsCaptured=false`, `firstPaint=not-run`.

No public provider was tested; Google-shaped content was served only through
the local synthetic route. Production readiness remains false. Tooling tests
passed 12/12 after the run. No lane-owned processes remained at handoff.

### Run 14: terminal local evidence, not acceptance

Artifacts: `.artifacts/cef-acceptance-run-14/run-Ms6ciJ/`; aggregate result:
`.artifacts/cef-acceptance-run-14/acceptance.json`. Run 13 was not launched: the
baseline build overlapped the host close fix. Run 14 includes the completed
deferred-close fix and native Chrome-login-prompt switch, with exception
observation explicitly enabled.

- CEF global switch readback was true; all three attempts emitted proxy
  `AuthChallenge` and `AuthCompleted { handled: true }`.
- The local TLS server observed 26 HTTP requests; private-context isolation
  returned its proof. This does not prove full native cookie/login acceptance.
- Each attempt emitted one `Closed` event and reported zero post-revocation
  requests. The parent was reused across all three attempts; native shutdown
  returned and produced a terminal report. The observer recorded no severe
  exception; process exit was ordinary failure code 1, not `0xC000041D`.
- Generic and Google-shaped completion timed out. Grants reached only `Form`
  and `Identifier`; successful native filling/submission is not established.
- The complete netlog still recorded 20 public UDP connection attempts, so the
  egress tripwire failed. First-paint pixels remain unmeasured. Public-provider
  acceptance has not run and production readiness remains false.
- This run exercised orderly timeout/revocation close, not a separately forced
  `OnLoadError`/failed-navigation regression.

Repeat with a new output directory (never reuse a profile):

```powershell
$env:SORNG_CEF_ACCEPTANCE_EXCEPTION_TRACE='1'
node scripts/cef-browser-acceptance.mjs run --executable .artifacts/cef-acceptance-bundle-14/sorng_cef_acceptance.exe --output .artifacts/cef-acceptance-run-NEW
```

Re-analyze a completed or truncated log without launching anything:

```powershell
node scripts/cef-browser-acceptance.mjs trace --netlog .artifacts/cef-acceptance-run-07/run-96yT3X/netlog.json --output .artifacts/cef-acceptance-run-07/run-96yT3X/redacted-connect-trace-new.json
```

The output path must be new. CONNECT correlation retains at most 128 sockets and
16 observations per socket. Only known fixture authorities, loopback endpoints,
numeric HTTP/native errors and authentication-presence booleans survive; raw
headers, realms, tokens, usernames, passwords and full URLs are not retained.
The tripwire includes TCP, UDP and generic socket-connect attempts. A failed
non-loopback attempt is still a failure, never discarded because no bytes flowed.

Run 07 established private proxy write/readback, inert renderer bootstrap and
acknowledged closure, but **not** page/login acceptance. It had 14 HTTP 407
challenges followed by Basic-handler initialization and CONNECT cancellation
(`-3`), no successful tunnels, no route dials and no fixture TLS accepts. A
separate six CONNECTs reached the test global rejecting proxy and got 403.
Corresponding fixture stream-controller records include `is_preconnect: true`;
these speculative CONNECT failures do not by themselves establish the main
navigation's cause. Run 08's native hook confirms browse admission followed by
main-frame `LoadError -3`; resource/auth host observations must narrow it further.
Its netlog also contains failed non-loopback UDP attempts (`-109`); the earlier
TCP-only summary was insufficient. No production-containment claim follows.
