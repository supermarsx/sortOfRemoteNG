import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import * as loadingElementModule from "../../src/components/ui/display/loadingElement/LoadingElement";

const { isReactRefreshBoundary } = createRequire(import.meta.url)(
  "next/dist/compiled/@next/react-refresh-utils/dist/internal/helpers.js",
).default as {
  isReactRefreshBoundary(exports: unknown): boolean;
};

describe("LoadingElement refresh boundary", () => {
  it("is accepted by the installed Next refresh runtime", () => {
    expect(isReactRefreshBoundary(loadingElementModule)).toBe(true);
  });

  it("preserves the inline and overlay component API", () => {
    expect(loadingElementModule.LoadingElement.Inline).toEqual(
      expect.any(Function),
    );
    expect(loadingElementModule.LoadingElement.Overlay).toEqual(
      expect.any(Function),
    );
  });
});
