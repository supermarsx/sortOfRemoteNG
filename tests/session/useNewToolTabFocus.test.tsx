import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createToolSession } from "../../src/components/app/toolSession";
import { useNewToolTabFocus } from "../../src/hooks/session/useNewToolTabFocus";
import type { ConnectionSession } from "../../src/types/connection/connection";
import type { TabFocusSettings } from "../../src/utils/session/tabFocus";

describe("committed tool tab activation", () => {
  function setup(
    initial: ConnectionSession[] = [],
    initialSettings: TabFocusSettings = {},
  ) {
    const activate = vi.fn();
    let settings = initialSettings;
    const getSettings = () => settings;
    const hook = renderHook(
      ({ sessions }) => useNewToolTabFocus(sessions, activate, getSettings),
      {
        initialProps: { sessions: initial },
      },
    );
    return {
      ...hook,
      activate,
      setSettings: (value: TabFocusSettings) => {
        settings = value;
      },
    };
  }

  it("focuses a dispatch-only configuration tab after commit, once", () => {
    const existing = createToolSession("settings");
    const editor = createToolSession("connectionEditor");
    const hook = setup([existing]);
    expect(hook.activate).not.toHaveBeenCalled();
    hook.rerender({ sessions: [existing, editor] });
    expect(hook.activate).toHaveBeenCalledExactlyOnceWith(editor.id);
    hook.rerender({ sessions: [{ ...editor, name: "Updated" }, existing] });
    expect(hook.activate).toHaveBeenCalledTimes(1);
  });

  it("keeps background opens behind and reads changed preferences while mounted", () => {
    const hook = setup([], { openConnectionEditorInBackground: true });
    const background = createToolSession("connectionEditor");
    hook.rerender({ sessions: [background] });
    expect(hook.activate).not.toHaveBeenCalled();
    hook.setSettings({ openConnectionEditorInBackground: false });
    hook.rerender({ sessions: [background] });
    expect(hook.activate).not.toHaveBeenCalled();
    const foreground = createToolSession("connectionEditor");
    hook.rerender({ sessions: [background, foreground] });
    expect(hook.activate).toHaveBeenCalledExactlyOnceWith(foreground.id);
  });

  it("respects explicit background intent and existing connection policies", () => {
    const hook = setup();
    hook.rerender({
      sessions: [
        createToolSession("settings", { openInBackground: true }),
        { ...createToolSession("settings"), protocol: "ssh" },
        { ...createToolSession("settings"), protocol: "winmgmt:services" },
      ],
    });
    expect(hook.activate).not.toHaveBeenCalled();
  });

  it("does not focus a detached tab or steal focus when it is reattached", () => {
    const hook = setup();
    const detached: ConnectionSession = {
      ...createToolSession("settings"),
      layout: {
        isDetached: true,
        windowId: "second",
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        zIndex: 1,
      },
    };
    hook.rerender({ sessions: [detached] });
    hook.rerender({ sessions: [{ ...detached, layout: undefined }] });
    expect(hook.activate).not.toHaveBeenCalled();
  });

  it("selects the last foreground tool in a batch without letting background tools steal focus", () => {
    const hook = setup();
    const editor = createToolSession("connectionEditor");
    hook.rerender({
      sessions: [
        createToolSession("settings"),
        editor,
        createToolSession("diagnostics", { openInBackground: true }),
      ],
    });
    expect(hook.activate).toHaveBeenCalledExactlyOnceWith(editor.id);
  });
});
