// Public-source contract/model proof only. No CEF, compiler or native UI runs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { identitySha256 } from "../../scripts/lib/browser-custom-runtime.mjs";
import {
  LINUX_ISOLATED_IDENTITY,
  LINUX_ISOLATED_INPUT_RAW,
  LINUX_ISOLATED_TRANSITION,
  LINUX_EXTERNAL_WEBVIEW_IDENTITY,
  LINUX_EXTERNAL_WEBVIEW_INPUT_RAW,
  LINUX_EXTERNAL_WEBVIEW_PATCH,
  LINUX_EXTERNAL_WEBVIEW_TRANSITION,
} from "../../scripts/lib/cef-owned-sdk-handoff.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const oldNamespace =
  "native/cef-build-inputs/20261025-r5-owned-linux-x64-default-colormap";
const namespace =
  "native/cef-build-inputs/20261026-r5-owned-linux-x64-external-webview";
const hash = (b) => createHash("sha256").update(b).digest("hex");
const read = (p) => fs.readFile(path.join(root, p));
const contract = JSON.parse(
  await read("tests/fixtures/cef-native-webview-lifetime/contract.json"),
);
const source = (p) => {
  const r = contract.rows.find((r) => r.path === p);
  assert(r && Buffer.byteLength(r.text) === r.bytes);
  assert.equal(hash(r.text), r.sha256);
  return r.text;
};
function method(text, signature) {
  const start = text.indexOf(signature);
  assert(start >= 0);
  let depth = 0;
  for (let i = text.indexOf("{", start); i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  assert.fail("Unclosed public method");
}
const native = source("libcef/browser/native/native_widget_delegate.cc");
const view = source("ui/views/controls/webview/webview.cc");
const header = source("ui/views/controls/webview/webview.h");

test("source24 preserves all old23 patch bytes and all old namespace inputs", async () => {
  const oldLockBytes = execFileSync(
    "git",
    ["show", `HEAD:${oldNamespace}/source-lock.json`],
    { cwd: root },
  );
  const oldLock = JSON.parse(oldLockBytes),
    bytes = await read(`${namespace}/source-lock.json`),
    lock = JSON.parse(bytes);
  assert.equal(identitySha256(oldLock), LINUX_ISOLATED_IDENTITY);
  assert.equal(hash(oldLockBytes), LINUX_ISOLATED_INPUT_RAW);
  assert.equal(identitySha256(lock), LINUX_EXTERNAL_WEBVIEW_IDENTITY);
  assert.equal(hash(bytes), LINUX_EXTERNAL_WEBVIEW_INPUT_RAW);
  assert.deepEqual(lock.patches.slice(0, 23), oldLock.patches);
  assert.equal(lock.patches.length, 24);
  const projected = structuredClone(lock);
  projected.patches.pop();
  assert.deepEqual(projected, oldLock);
  const files = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", "HEAD", "--", oldNamespace],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split("\n");
  for (const oldPath of files) {
    const rel = oldPath.slice(oldNamespace.length + 1);
    if (["source-lock.json", "review-receipt.json"].includes(rel)) continue;
    assert.deepEqual(
      await read(`${namespace}/${rel}`),
      execFileSync("git", ["show", `HEAD:${oldPath}`], { cwd: root }),
    );
  }
  assert.equal(
    hash(await read(`${namespace}/${lock.patches.at(-1).path}`)),
    LINUX_EXTERNAL_WEBVIEW_PATCH,
  );
  const review = JSON.parse(await read(`${namespace}/review-receipt.json`));
  assert.equal(review.sourceLockIdentity, LINUX_EXTERNAL_WEBVIEW_IDENTITY);
  assert.equal(review.sourceLockRawSha256, LINUX_EXTERNAL_WEBVIEW_INPUT_RAW);
  assert.equal(review.pins.length, 30);
  assert.equal(new Set(review.pins.map((p) => p.path)).size, 30);
  for (const pin of review.pins) {
    const body = await read(`${namespace}/${pin.path}`);
    assert.equal(body.length, pin.size);
    assert.equal(hash(body), pin.sha256);
  }
  for (const name of [
    "engineBuilt",
    "nativeAcceptancePassed",
    "sdkProduced",
    "publicationAllowed",
  ])
    assert.equal(review[name], false);
});

test("real Git apply changes only the external-only Init call and preserves zombie callback ordering", async () => {
  const tmp = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), "sorng-webview-contract-"),
  );
  try {
    const name = "libcef/browser/native/native_widget_delegate.cc",
      target = path.join(tmp, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, native, { flag: "wx" });
    const patch = path.join(
      root,
      namespace,
      "patches/0024-cef-external-webview-lifetime.patch",
    );
    execFileSync(
      "git",
      ["-c", "core.autocrlf=false", "apply", "--check", patch],
      { cwd: tmp },
    );
    execFileSync("git", ["-c", "core.autocrlf=false", "apply", patch], {
      cwd: tmp,
    });
    const after = await fs.readFile(target, "utf8");
    assert.equal(
      after,
      native.replace(
        contract.candidate.oldLine,
        contract.candidate.replacement,
      ),
    );
    assert.equal(hash(after), contract.candidate.afterSha256);
    assert.equal(Buffer.byteLength(after), contract.candidate.afterSize);
    const zombie = method(
      native,
      "void CefNativeWidgetDelegate::WidgetIsZombie(",
    );
    assert.equal(
      method(after, "void CefNativeWidgetDelegate::WidgetIsZombie("),
      zombie,
    );
    assert(
      zombie.indexOf("std::move(on_delete_).Run()") <
        zombie.indexOf("widget_.reset()"),
    );
    execFileSync(
      "git",
      ["-c", "core.autocrlf=false", "apply", "--reverse", "--check", patch],
      { cwd: tmp },
    );
    execFileSync(
      "git",
      ["-c", "core.autocrlf=false", "apply", "--reverse", patch],
      { cwd: tmp },
    );
    assert.equal(await fs.readFile(target, "utf8"), native);
  } finally {
    assert(path.dirname(tmp) === (await fs.realpath(os.tmpdir())));
    await fs.rm(tmp, { recursive: true });
  }
});

test("complete actual WebView contract permits external-only construction without lazy replacement", () => {
  assert(
    header.includes(
      "explicit WebView(content::BrowserContext* browser_context = nullptr)",
    ),
  );
  assert(
    header.includes(
      "WebView does not assume ownership of WebContents set via this method",
    ),
  );
  assert.equal((view.match(/\bbrowser_context_\b/g) || []).length, 5);
  assert.equal((view.match(/\bGetWebContents\(/g) || []).length, 2);
  assert.equal((view.match(/\bGetBrowserContext\(/g) || []).length, 1);
  const get = method(view, "content::WebContents* WebView::GetWebContents(");
  assert(
    get.includes("if (!web_contents())") &&
      get.includes("if (!browser_context_)") &&
      get.includes("return nullptr;") &&
      get.includes("CreateWebContents(browser_context_"),
  );
  const destroyed = method(view, "void WebView::WebContentsDestroyed()");
  assert(
    destroyed.includes("SetWebContents(nullptr)") &&
      !destroyed.includes("browser_context_"),
  );
  assert(
    !method(view, "void WebView::SetWebContents(").includes("browser_context_"),
  );
  const destructor = method(view, "WebView::~WebView()");
  assert(
    destructor.includes("SetWebContents(nullptr)") &&
      destructor.includes("browser_context_ = nullptr"),
  );
  for (const signature of [
    "void WebView::OnFocus()",
    "void WebView::OnBoundsChanged(",
    "void WebView::AddedToWidget()",
  ])
    assert(!method(view, signature).includes("browser_context_"));
  const init = method(native, "void CefNativeWidgetDelegate::Init(");
  assert(
    init.includes("web_view_->SetWebContents(web_contents)") &&
      init.includes("web_view_->SetPreferredSize(bounds.size())"),
  );
  assert(
    !/GetWebContents\(|GetBrowserContext\(|LoadInitialURL\(/.test(
      init.replace(contract.candidate.oldLine, ""),
    ),
  );
});

test("actual-body-derived lifetime model keeps the detector strict: old RED, external-only GREEN", () => {
  const simulate = (old) => {
    const profile = { alive: true },
      external = {};
    let cached = old ? profile : null,
      attached = external,
      lazy = 0;
    const contents = () => {
      if (!attached && cached) {
        assert(cached.alive);
        lazy++;
        return {};
      }
      return attached;
    };
    assert.equal(contents(), external);
    attached = null; // WebContentsDestroyed -> SetWebContents(nullptr)
    profile.alive = false; // last CEF context release shuts down OTR profile
    const dangling = cached && !cached.alive ? 1 : 0;
    cached = null; // later native-widget WebView destructor releases raw_ptr
    assert.equal(contents(), null);
    assert.equal(lazy, 0);
    return dangling;
  };
  assert.equal(simulate(true), 1);
  assert.equal(simulate(false), 0);
  assert.equal(contract.nativeAcceptance, false);
});

test("closed69 transition adds one changed row and retains all before rows and absences", () => {
  assert.equal(LINUX_EXTERNAL_WEBVIEW_TRANSITION.before.length, 69);
  assert.deepEqual(
    LINUX_EXTERNAL_WEBVIEW_TRANSITION.before,
    LINUX_ISOLATED_TRANSITION.before,
  );
  const differences = LINUX_EXTERNAL_WEBVIEW_TRANSITION.after.filter(
    (r, i) =>
      identitySha256(r) !== identitySha256(LINUX_ISOLATED_TRANSITION.after[i]),
  );
  assert.equal(differences.length, 1);
  assert.equal(
    differences[0].path,
    "cef/libcef/browser/native/native_widget_delegate.cc",
  );
  assert.equal(differences[0].sha256, contract.candidate.afterSha256);
  assert.equal(differences[0].size, contract.candidate.afterSize);
  assert.equal(
    LINUX_EXTERNAL_WEBVIEW_TRANSITION.after.filter(
      (r, i) =>
        identitySha256(r) !==
        identitySha256(LINUX_EXTERNAL_WEBVIEW_TRANSITION.before[i]),
    ).length,
    33,
  );
});
