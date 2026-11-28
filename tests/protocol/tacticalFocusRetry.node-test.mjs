import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "src-tauri/crates/sorng-browser-host/src/native_login/tactical_focus.js",
  "utf8",
);
const allowed = new Function(`${source}; return tacticalFocusRetryAllowed;`)();
const state = {
  stopped: false,
  beforeGrant: true,
  attempts: 0,
  empty: true,
  sameScope: true,
  sameInput: true,
  previousDetached: false,
  focus: "body",
};
test("Tactical focus recovery admits inert initial focus for three retries only", () => {
  for (const focus of ["body", "container"]) {
    for (let attempts = 0; attempts < 3; attempts++)
      assert.equal(allowed({ ...state, focus, attempts }), true);
    assert.equal(allowed({ ...state, focus, attempts: 3 }), false);
  }
});
test("recovery cannot repeat an OTP grant, overwrite manual input or cross a changed scope", () => {
  for (const patch of [
    { stopped: true },
    { beforeGrant: false },
    { empty: false },
    { sameScope: false },
    { focus: "other" },
  ])
    assert.equal(allowed({ ...state, ...patch }), false);
});
test("replacement inputs require the old field to be detached", () => {
  for (const focus of ["body", "input", "container"]) {
    assert.equal(
      allowed({ ...state, sameInput: false, previousDetached: true, focus }),
      true,
    );
    assert.equal(
      allowed({ ...state, sameInput: false, previousDetached: false, focus }),
      false,
    );
  }
});
