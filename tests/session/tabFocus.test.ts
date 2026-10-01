import { describe, expect, it } from "vitest";
import { createToolSession } from "../../src/components/app/toolSession";
import {
  shouldFocusNewToolTab,
  tabOpeningModifier,
} from "../../src/utils/session/tabFocus";

describe("new tab focus policy", () => {
  it.each([
    "connectionEditor",
    "bulkEditor",
    "settings",
    "diagnostics",
    "shortcutCreator",
  ] as const)(
    "focuses %s with older settings that omit new preferences",
    (tool) =>
      expect(shouldFocusNewToolTab(createToolSession(tool), {})).toBe(true),
  );

  it("keeps connection editor and general tool preferences independent", () => {
    const editor = createToolSession("connectionEditor");
    const tool = createToolSession("settings");
    expect(shouldFocusNewToolTab(editor, { openToolInBackground: true })).toBe(
      true,
    );
    expect(shouldFocusNewToolTab(tool, { openToolInBackground: true })).toBe(
      false,
    );
    expect(
      shouldFocusNewToolTab(editor, { openConnectionEditorInBackground: true }),
    ).toBe(false);
    expect(
      shouldFocusNewToolTab(tool, { openConnectionEditorInBackground: true }),
    ).toBe(true);
  });

  it("does not claim connection sessions or Windows management tools", () => {
    for (const protocol of [
      "ssh",
      "rdp",
      "https",
      "integration:proxmox",
      "winmgmt:services",
    ])
      expect(shouldFocusNewToolTab({ protocol }, {})).toBe(false);
  });

  it("preserves explicit opening intent ahead of the category default", () => {
    expect(
      shouldFocusNewToolTab(
        createToolSession("connectionEditor", { openInBackground: true }),
        {},
      ),
    ).toBe(false);
    expect(
      shouldFocusNewToolTab(
        createToolSession("settings", { openInBackground: false }),
        { openToolInBackground: true },
      ),
    ).toBe(true);
  });

  it("preserves background modifiers without changing unmodified opening", () => {
    expect(tabOpeningModifier({})).toBeUndefined();
    expect(tabOpeningModifier({ ctrlKey: true })).toBe(true);
    expect(tabOpeningModifier({ metaKey: true })).toBe(true);
    expect(tabOpeningModifier({ button: 1 })).toBe(true);
    expect(tabOpeningModifier({ ctrlKey: true, shiftKey: true })).toBe(false);
  });
});
