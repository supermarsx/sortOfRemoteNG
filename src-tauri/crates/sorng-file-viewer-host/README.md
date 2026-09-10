# Isolated file-viewer host

This is a **separate raw-Wry/Tao executable**, not a Tauri window or a native decoder DLL. Windows is the first implementation. Other platforms exit with `SORNG_VIEWER_UNSUPPORTED_V1` before opening a viewer; there is no in-process fallback. The Windows WebView2 runtime supplies its normal OS renderer sandbox. The small Rust UI host/broker is **not** itself AppContainer-sandboxed. This is not a VM/container, an exploit-proof promise, or an OS-wide network firewall.

No Tauri dependency, application IPC callback, host object, app cookie store, NAS credential, source URL, source path, or app directory grant is provided to the renderer. Wry installs a `window.ipc` wrapper even without a handler; mandatory `IsWebMessageEnabled(false)` disables its underlying channel. The helper reads that setting back, and the hidden smoke posts a probe while a native negative observer verifies zero delivery (disabled messages may be silently dropped). Each helper gets a new private profile. Environment runtime/loader overrides and HKCU/HKLM WebView2 launch-override policy values in both registry views are rejected (conservatively including entries for other applications). Elevated hosts are refused. Mandatory settings failures stop startup; older runtimes without private profiles/all-source filtering cannot view files.

## Parent protocol v1

Launch with `--profile-dir <absolute broker-created empty directory>`. Symlink/reparse ancestors, nonempty directories and unknown arguments are refused. The broker owns this private profile and its cleanup after job termination. Write a four-byte **little-endian unsigned JSON-header length**, 1–4096 bytes of UTF-8 JSON, then exactly `byteLength` raw bytes (up to 16 MiB; only text may be empty):

```json
{
  "version": 1,
  "kind": "text",
  "name": "example.txt",
  "byteLength": 5,
  "display": { "textWrap": true, "textFontSize": 14, "imageFit": "contain" }
}
```

Kinds: `text`, `image`, `pdf`. `display` is optional, with the defaults above. If supplied, all its fields are required; font size is 10–24 and image fit `contain|actual`. Unknown fields, invalid scalar types, invalid UTF-8 text, NUL text and unsupported magic signatures are refused. Name is display-only, at most 512 UTF-8 bytes with no controls, and never used in an HTML template/path/command. The unsandboxed host performs only bounded framing/UTF-8/signature checks, **no image or PDF decoding**.

Keep stdin open while authorization remains valid. EOF, pipe error or another byte closes the window. One process handles one file. Broker must impose a 20-second startup deadline, enforce DB/session/receipt validity through download/startup/close, kill the child tree on revocation/hang, and allowlist the environment. Stdout is exactly `SORNG_VIEWER_READY_V1\n` after the trusted shell's initial navigation succeeds (not a claim that arbitrary file content decoded successfully). Failures use fixed, secret-free stderr statuses. The trusted shell displays a local generic decode error. No content/error details are returned to the app.

## Renderer and network policy

All page/subframe/worker HTTP resources are intercepted by mandatory WebView2 `_22` request-source-ALL filtering. Only exact GETs for seven memory assets under `https://sorng-viewer.invalid` are served. Other requests receive local 403 responses; no server or listener is created. CSP additionally denies frames, objects, form actions and remote scripts/connections. Navigation, new windows, downloads, external URI launches, permissions, browser accelerators, default context menus, drag/drop, autofill and host messaging are disabled. The page has no file inputs, print/save controls, hyperlink/PDF annotation overlays or editable forms. Engine background networking is suppressed by flags; this is not a guarantee that every system component performs zero network activity. Administrator-installed engine policies and a compromised OS/runtime are outside this threat model.

Text uses `textContent`. Images decode in the OS renderer into a canvas (not Rust); output canvas is limited to 16 Mi pixels / 16,384 per edge. This check occurs **after engine decoding**, so it is not a hard decoder-memory bound. PDFs use pinned, bundled PDF.js 6.3.289 worker and canvas-only rendering; no PDF scripting, XFA, links, forms, attachments, external fonts/CMaps/WASM, or live PDF embedding. Pages render individually with capped canvases. Some uncommon PDFs need omitted assets and may fail safely. Text/image options are captured at launch.

PDF.js and its Apache-2.0 license are copied from the installed pinned npm dependency by `build.rs`, then embedded in the executable; no CDN/runtime package lookup. Packaging must include its license attribution. No source file is written to a temporary file. The engine may create private profile/diagnostic files; graceful shutdown removes the profile best-effort, and forced termination/crashes require parent cleanup. Do not advertise forensic erasure.

## Building and packaging

Managed `npm run tauri:dev` and Tauri's normal build hook stage this helper before the application starts or is bundled. For a direct Cargo development launch, first run `npm run stage:file-viewer`; for release use `npm run stage:file-viewer -- --release --target x86_64-pc-windows-msvc` (use `aarch64-pc-windows-msvc` for ARM64). Install the pinned npm dependencies first. Staging builds the helper serially before the application and reuses compatible Cargo dependencies in `src-tauri/target`, or `CARGO_TARGET_DIR` when configured. Relative configured paths resolve from `src-tauri`; absolute paths remain absolute. Sharing a compilation cache does not share runtime permissions or processes. The helper does not recursively build from an application build script.

The stage verifies the executable's architecture, copies the PDF.js notice, and publishes the helper only after success. If Windows Authenticode signing is configured for a release, the helper is signed and verified before packaging. Standard Windows bundles use `file-viewer/windows-<architecture>/`; portable archives use `resources/file-viewer/windows-<architecture>/`. Neither lookup searches the working directory, PATH, or a runtime environment override. Packaging verifies the portable resources byte for byte. The tracked bundle placeholder permits non-Windows packaging without pretending a viewer implementation exists there.

## Required acceptance

Unit tests validate actual framing/resource policy and reject malformed/escaped inputs. A platform integration run must additionally verify the helper's process sandbox, separate profile/process collection, IPC absence, denial of hostile network/file/navigation/download attempts, parent EOF/crash cleanup, PDF/image/text rendering and untrusted-file failure. A compile or unit test pass alone is not that proof. Linux needs a pre-WebView explicit WebKit sandbox enable/verification and macOS a verified isolated nonpersistent WKWebView route before either may be enabled. External `Open with` remains outside this sandbox and must not be an automatic fallback.

`--profile-dir <empty dir> --smoke-test` runs the same Windows restrictions with a hidden window and ten-second limit. Only after an actual `pre`/`canvas` renders, Tauri internals are absent, and the disabled message probe has no native delivery for 500 ms, it emits `SORNG_VIEWER_SMOKE_PASSED_V1` and closes. It is never a headless/unsandboxed browser flag. The retained Node test uses synthetic text/empty text/GIF/PDF fixtures, wipes only its own temporary profiles and needs `SORNG_VIEWER_TEST_EXE` set to the compiled absolute helper path. It does not prove resistance to arbitrary zero-days or platform acceptance outside Windows.

Debug builds additionally accept `--smoke-hold`: the window remains hidden but otherwise follows the normal READY/EOF lifecycle, with no extra stdout or automatic successful exit. This is solely for broker Job/receipt/profile cleanup acceptance. Release builds reject this argument, and the production broker must never expose either test option to frontend IPC.
