import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const hostRoot = new URL(
  "../../src-tauri/crates/sorng-browser-host/",
  import.meta.url,
);
const read = (name) => readFile(new URL(name, hostRoot), "utf8");

test("macOS Objective-C++ bridges use C++20 for pinned CEF concept headers", async () => {
  const build = await read("build.rs");
  const mac = build.slice(
    build.indexOf('.file("src/platform/macos_application.mm")'),
  );
  assert.match(mac, /\.std\("c\+\+20"\)/);
  assert.doesNotMatch(mac, /-std=c\+\+17/);
  assert.match(mac, /\.file\("src\/platform\/macos_occlusion\.mm"\)/);
  assert.match(mac, /\.flag\("-fobjc-arc"\)/);
  assert.match(mac, /\.flag\("-mmacosx-version-min=14\.0"\)/);
});

test("actual Linux surface block typechecks with opaque X display pointers (no CEF/X11 linkage)", async (t) => {
  const source = (await read("src/cef_browser.rs")).replaceAll("\r\n", "\n");
  const marker = '#[cfg(target_os = "linux")]\nmod native_surface {';
  const start = source.indexOf(marker);
  const end = source.indexOf(
    '#[cfg(target_os = "macos")]\nmod native_surface {',
    start,
  );
  assert.ok(start >= 0 && end > start, "locate the actual platform module");
  // Remove only the platform gate so every development host can typecheck the
  // production functions. Metadata compilation does not link/call X11 or CEF.
  const module = source
    .slice(start, end)
    .replace('#[cfg(target_os = "linux")]\n', "");
  const root = await mkdtemp(path.join(os.tmpdir(), "cef-linux-pointer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const harness = path.join(root, "surface.rs");
  await writeFile(
    harness,
    `
#![allow(dead_code, non_camel_case_types)]
mod cef { pub mod sys { pub type cef_window_handle_t = std::ffi::c_ulong; } }
struct WindowInfo;
struct Rect { x: i32, y: i32, width: i32, height: i32 }
enum BrowserError { NativeSurface }
struct XDisplay { _opaque: [u8; 0] }
fn get_xdisplay() -> *mut XDisplay { std::ptr::null_mut() }
${module}
`,
  );
  execFileSync(
    "rustc",
    [
      "--edition=2021",
      "--crate-type=lib",
      "--emit=metadata",
      "-Dwarnings",
      harness,
      "-o",
      path.join(root, "surface.rmeta"),
    ],
    {
      encoding: "utf8",
      timeout: 60_000,
    },
  );
});

test("actual Linux occlusion block typechecks and detects an untyped X display cast (no CEF/X11 linkage)", async (t) => {
  const source = (await read("src/cef_occlusion.rs")).replaceAll("\r\n", "\n");
  const linuxGate = '#[cfg(all(feature = "cef-host", target_os = "linux"))]\n';
  const start = source.indexOf(linuxGate);
  const end = source.indexOf(
    '#[cfg(all(feature = "cef-host", target_os = "macos"))]',
    start,
  );
  const clipRect = source.match(
    /pub\(crate\) struct ClipRect \{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(
    clipRect && start >= 0 && end > start,
    "locate actual Linux occlusion code",
  );
  // Include the production apply function AND its checked-X11 adapter. Remove
  // only their platform gates; metadata compilation never links/calls CEF/X11.
  const module = source
    .slice(start, end)
    .replaceAll(linuxGate, "")
    .replaceAll(
      '#[cfg(any(test, all(feature = "cef-host", target_os = "linux")))]\n',
      "",
    );
  assert.match(module, /mod x11_checked/);
  assert.match(module, /cef::get_xdisplay\(\)\.cast::<c_void>\(\)/);
  const root = await mkdtemp(path.join(os.tmpdir(), "cef-linux-occlusion-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const harness = path.join(root, "occlusion.rs");
  const prelude = `
#![allow(dead_code, non_camel_case_types)]
mod cef {
    pub mod sys { pub type cef_window_handle_t = std::ffi::c_ulong; }
    pub struct XDisplay { _opaque: [u8; 0] }
    pub fn get_xdisplay() -> *mut XDisplay { std::ptr::null_mut() }
}
${clipRect}
`;
  const compile = () =>
    spawnSync(
      "rustc",
      [
        "--edition=2021",
        "--crate-type=lib",
        "--emit=metadata",
        "-Dwarnings",
        harness,
        "-o",
        path.join(root, "occlusion.rmeta"),
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
  await writeFile(
    harness,
    prelude + module.replace(".cast::<c_void>()", ".cast()"),
  );
  const old = compile();
  assert.ifError(old.error);
  assert.notEqual(
    old.status,
    0,
    "the fixture must catch the old inference failure",
  );
  assert.match(old.stderr, /E0282/);
  await writeFile(harness, prelude + module);
  const fixed = compile();
  assert.ifError(fixed.error);
  assert.equal(fixed.status, 0, fixed.stderr);
});

test("retained cookie capture normalizes both enums without changing the signed schema", async () => {
  const source = await read("src/cef_session_retention.rs");
  assert.match(source, /pub same_site: i32/);
  assert.match(source, /pub priority: i32/);
  assert.match(
    source,
    /cookie_enum_values\(\s*cookie\.same_site\.get_raw\(\),\s*cookie\.priority\.get_raw\(\)/,
  );
  assert.doesNotMatch(source, /same_site:\s*cookie\.same_site\.get_raw\(\)/);
  const bridge = await read("src/cef_tls_bridge.rs");
  assert.match(
    bridge,
    /#\[cfg\(any\(target_os = "windows", test\)\)\]\s*use std::ptr;/,
  );
});

test("actual cookie enum conversion and its signed/unsigned regressions run without Cargo/CEF", async (t) => {
  const source = (await read("src/cef_session_retention.rs")).replaceAll(
    "\r\n",
    "\n",
  );
  const conversion = source.match(/fn cookie_enum_values\([\s\S]*?\n\}/)?.[0];
  const start = source.indexOf(
    "    #[test]\n    fn cookie_enum_values_preserve_",
  );
  const end = source.indexOf("    fn cookie()", start);
  assert.ok(conversion && start >= 0 && end > start);
  const root = await mkdtemp(path.join(os.tmpdir(), "cef-cookie-enums-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const harness = path.join(root, "enums.rs");
  const binary = path.join(
    root,
    process.platform === "win32" ? "enums.exe" : "enums",
  );
  await writeFile(harness, `${conversion}\n${source.slice(start, end)}`);
  execFileSync(
    "rustc",
    ["--edition=2021", "--test", "-Dwarnings", harness, "-o", binary],
    {
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  t.diagnostic(
    execFileSync(binary, [], { encoding: "utf8", timeout: 60_000 }).trim(),
  );
});

test("available pinned CEF header fails C++17 and passes C++20 (syntax only)", async (t) => {
  // Opt in with an already available SDK. Never acquire/build/launch CEF.
  const sdk = process.env.SORNG_CEF_HEADER_TEST_SDK;
  if (!sdk) {
    t.skip("Set SORNG_CEF_HEADER_TEST_SDK to an existing pinned CEF SDK");
    return;
  }
  const compiler = process.env.SORNG_CEF_HEADER_TEST_CXX || "clang++";
  const header = await readFile(
    path.join(sdk, "include/base/cef_scoped_refptr.h"),
    "utf8",
  );
  assert.match(header, /std::same_as/);
  assert.match(header, /std::derived_from/);
  const input = '#include "include/base/cef_scoped_refptr.h"\n';
  const compile = (standard) =>
    spawnSync(
      compiler,
      [`-std=${standard}`, "-fsyntax-only", "-x", "c++", "-I", sdk, "-"],
      { input, encoding: "utf8", timeout: 60_000 },
    );
  const old = compile("c++17");
  assert.ifError(old.error);
  assert.notEqual(
    old.status,
    0,
    "the fixture must reproduce the old language-mode failure",
  );
  assert.match(old.stderr, /cef_scoped_refptr\.h/);
  assert.match(old.stderr, /same_as|derived_from/);
  const fixed = compile("c++20");
  assert.ifError(fixed.error);
  assert.equal(fixed.status, 0, fixed.stderr);
});
