import { describe, expect, it } from "vitest";

import capability from "../../src-tauri/capabilities/default.json";

describe("native window close permissions", () => {
  it("covers the labels used by main and detached session windows", () => {
    // useSessionDetach creates windows as `detached-${session.id}`. Keep the
    // capability least-privilege while covering those real runtime labels.
    expect(capability.windows).toEqual(["main", "detached-*"]);
  });

  it("allows Tauri close-request listeners to finish without a denied destroy", () => {
    // Tauri's onCloseRequested helper invokes Window.destroy() after an
    // unprevented close event. Both permissions are therefore part of the
    // close lifecycle contract for every app-controlled window.
    expect(capability.permissions).toEqual(
      expect.arrayContaining([
        "core:window:allow-close",
        "core:window:allow-destroy",
      ]),
    );
  });
});
