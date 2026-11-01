import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import type { Connection } from "../../src/types/connection/connection";
import {
  useNativeBrowserExtensions,
  type NativeBrowserExtensionsOptions,
} from "../../src/hooks/protocol/useNativeBrowserExtensions";
import NativeBrowserExtensionControls, {
  NativeBrowserExtensionPanel,
} from "../../src/components/protocol/webBrowser/NativeBrowserExtensionControls";
import { NATIVE_EXTENSION_WIRING_REQUIRED } from "../../src/types/protocols/nativeBrowserExtensions";

const db = vi.hoisted(() => ({
  id: "a",
  generation: 1,
  locked: false,
  rows: [] as Connection[],
  persisted: [] as Connection[],
  read: vi.fn(),
  listeners: new Set<() => void>(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onDatabaseAccessChange: (callback: () => void) => {
    db.listeners.add(callback);
    return () => db.listeners.delete(callback);
  },
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: db.id }),
      captureCurrentDatabaseDataTarget: () => {
        const id = db.id,
          generation = db.generation;
        return {
          databaseId: id,
          readCurrent: db.read,
          assertAccessible: () => {
            if (db.locked || id !== db.id || generation !== db.generation)
              throw new Error("revoked");
          },
        };
      },
    }),
  },
}));
vi.mock("../../src/utils/session/runtimeConnectionRegistry", () => ({
  getRuntimeWebNavigation: () => undefined,
}));

const fixture = (): Connection => ({
  id: "same",
  name: "Website",
  hostname: "example.test",
  port: 443,
  protocol: "https",
  isGroup: false,
  createdAt: "2026-10-08",
  updatedAt: "2026-10-08",
});
function context() {
  return {
    state: { connections: db.rows },
    databaseAvailability: {
      status: db.locked ? "suspended" : "ready",
      databaseId: db.id,
      generation: db.generation,
    },
    getCurrentConnections: ({
      databaseId,
      generation,
    }: {
      databaseId: string;
      generation: number;
    }) => {
      if (db.locked || databaseId !== db.id || generation !== db.generation)
        throw new Error("revoked");
      return db.rows;
    },
  } as unknown as ConnectionContextType;
}
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionContext.Provider value={context()}>
      {children}
    </ConnectionContext.Provider>
  );
}
function options(): NativeBrowserExtensionsOptions {
  const identity = {
    ownerDatabaseId: "a",
    connectionId: "same",
    sessionId: "tab",
    attemptId: "native-attempt",
  };
  return {
    connection: db.rows[0],
    ownerDatabaseId: "a",
    identity,
    webBrowserSettings: undefined,
    settingsReady: true,
    blocked: false,
    receipt: {
      version: 1,
      identity,
      appControls: true,
      appEnabled: true,
      forcedDark: true,
      chromium: "unsupportedPrivateContext",
    },
    updateConnection: vi.fn(async (connection: Connection) => {
      db.rows = [connection];
      db.persisted = structuredClone(db.rows);
    }),
  };
}
beforeEach(() => {
  db.id = "a";
  db.generation = 1;
  db.locked = false;
  db.rows = [fixture()];
  db.persisted = structuredClone(db.rows);
  db.read.mockReset().mockImplementation(async () => ({
    connections: structuredClone(db.persisted),
  }));
});
afterEach(cleanup);

describe("native extension controller", () => {
  it("requires positive native confirmation; saved values do not enable controls", async () => {
    const props = { ...options(), receipt: null };
    const hook = renderHook(() => useNativeBrowserExtensions(props), {
      wrapper,
    });
    expect(hook.result.current.available).toBe(false);
    expect(hook.result.current.reason).toBe(NATIVE_EXTENSION_WIRING_REQUIRED);
    await act(async () => {
      expect(
        await hook.result.current.save({ kind: "app", enabled: false }),
      ).toBe(false);
    });
    expect(props.updateConnection).not.toHaveBeenCalled();
  });
  it("saves through the owning database and distinguishes requested from active state", async () => {
    const props = options();
    const hook = renderHook(() => useNativeBrowserExtensions(props), {
      wrapper,
    });
    await act(async () => {
      expect(
        await hook.result.current.save({ kind: "app", enabled: false }),
      ).toBe(true);
    });
    expect(db.persisted[0].browserSession?.websiteExtensionsEnabled).toBe(
      false,
    );
    expect(hook.result.current.saved).toBe(true);
    expect(hook.result.current.activeEnabled).toBe(true);
    expect(db.read).toHaveBeenCalledTimes(2);
  });
  it("rejects receipt from a previous attempt even for the same saved connection", () => {
    const props = options();
    props.receipt!.identity = { ...props.identity!, attemptId: "old" };
    const hook = renderHook(() => useNativeBrowserExtensions(props), {
      wrapper,
    });
    expect(hook.result.current.available).toBe(false);
  });
  it("rejects a database switch while checking a same-ID connection", async () => {
    const props = options();
    db.read.mockImplementationOnce(async () => {
      db.id = "b";
      db.generation++;
      return { connections: [fixture()] };
    });
    const hook = renderHook(() => useNativeBrowserExtensions(props), {
      wrapper,
    });
    await act(async () => {
      expect(
        await hook.result.current.save({ kind: "scripts", enabled: true }),
      ).toBe(false);
    });
    expect(props.updateConnection).not.toHaveBeenCalled();
  });
  it("revokes a pending save on database lock", async () => {
    const props = options();
    db.read.mockImplementationOnce(async () => {
      db.locked = true;
      db.listeners.forEach((listener) => listener());
      return { connections: [fixture()] };
    });
    const hook = renderHook(() => useNativeBrowserExtensions(props), {
      wrapper,
    });
    await act(async () => {
      expect(
        await hook.result.current.save({ kind: "scripts", enabled: true }),
      ).toBe(false);
    });
    expect(props.updateConnection).not.toHaveBeenCalled();
  });
  it("does not write a response that completed after unmount", async () => {
    const props = options();
    let finish!: (value: { connections: Connection[] }) => void;
    db.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const hook = renderHook(() => useNativeBrowserExtensions(props), {
      wrapper,
    });
    let pending!: Promise<boolean>;
    act(() => {
      pending = hook.result.current.save({ kind: "scripts", enabled: true });
    });
    hook.unmount();
    finish({ connections: [fixture()] });
    expect(await pending).toBe(false);
    expect(props.updateConnection).not.toHaveBeenCalled();
  });
});

function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const item = screen.getByRole("option", { name: option });
  fireEvent.mouseDown(item);
  fireEvent.click(item);
}

describe("native extension controls", () => {
  it("explains pending Chromium support without install buttons and keeps app controls functional", async () => {
    const props = options();
    function Panel() {
      return (
        <NativeBrowserExtensionPanel
          controller={useNativeBrowserExtensions(props)}
        />
      );
    }
    render(<Panel />, { wrapper });
    expect(
      screen.queryByRole("button", { name: "Install CRX" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load unpacked" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Chromium extensions" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    expect(
      screen.getByRole("region", { name: "Website appearance" }),
    ).toHaveTextContent("Follow app theme colors");
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).toHaveClass("sor-settings-checkbox");
    }
    expect(
      screen.getByRole("checkbox", { name: "Follow app theme colors" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: "Automation" }));
    expect(
      screen.getByRole("checkbox", { name: "User scripts" }),
    ).toBeEnabled();
    await act(async () =>
      fireEvent.click(screen.getByRole("checkbox", { name: "User scripts" })),
    );
    expect(db.persisted[0].httpAutomation?.scriptInjectionEnabled).toBe(true);
    expect(
      screen.getByText("Saved. Reconnecting this tab to apply your changes…"),
    ).toBeInTheDocument();
  });
  it("does not expose functioning toggles before native enforcement is confirmed", () => {
    const props = { ...options(), receipt: null };
    function Panel() {
      return (
        <NativeBrowserExtensionPanel
          controller={useNativeBrowserExtensions(props)}
        />
      );
    }
    render(<Panel />, { wrapper });
    for (const checkbox of screen.getAllByRole("checkbox"))
      expect(checkbox).toBeDisabled();
    expect(
      screen.getByRole("combobox", {
        name: "Automation for this connection",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Automation for this connection" })
        .tagName,
    ).toBe("BUTTON");
  });
  it("saves per-connection appearance without changing script or login grants", async () => {
    const props = options();
    function Panel() {
      return (
        <NativeBrowserExtensionPanel
          controller={useNativeBrowserExtensions(props)}
        />
      );
    }
    render(<Panel />, { wrapper });
    fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    choose("Appearance settings", "Customize this connection");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Follow app theme colors" }),
    );
    fireEvent.change(screen.getByLabelText("Background color"), {
      target: { value: "#223344" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save appearance" }));
    });
    expect(db.persisted[0].httpAutomation?.darkMode).toMatchObject({
      useGlobalDefaults: false,
      theme: { followAppTheme: false, backgroundColor: "#223344" },
    });
    expect(db.persisted[0].httpAutomation?.scriptInjectionEnabled).toBe(false);
    expect(db.persisted[0].httpAutoLogin).toBeUndefined();
  });
  it.each([
    ["login", "Automatic form login", "httpAutoLogin"],
    ["macros", "Interaction macros", "interactionMacrosEnabled"],
  ] as const)(
    "persists %s through the shared settings checkbox",
    async (_kind, label, field) => {
      const props = options();
      function Panel() {
        return (
          <NativeBrowserExtensionPanel
            controller={useNativeBrowserExtensions(props)}
          />
        );
      }
      render(<Panel />, { wrapper });
      await act(async () =>
        fireEvent.click(screen.getByRole("checkbox", { name: label })),
      );
      expect(props.updateConnection).toHaveBeenCalledTimes(1);
      if (field === "httpAutoLogin")
        expect(db.persisted[0].httpAutoLogin).toBe(true);
      else expect(db.persisted[0].httpAutomation?.[field]).toBe(true);
    },
  );

  function uiController() {
    const hook = renderHook(() => useNativeBrowserExtensions(options()), {
      wrapper,
    });
    return { ...hook.result.current, save: vi.fn().mockResolvedValue(true) };
  }
  async function openPopup() {
    fireEvent.click(screen.getByRole("button", { name: "Website extensions" }));
    return screen.findByRole("dialog", { name: "Website extensions" });
  }
  function customAppearance() {
    fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    choose("Appearance settings", "Customize this connection");
  }

  it("offers linked keyboard-accessible subtabs and keeps unsupported add-ons in About", async () => {
    const controller = uiController();
    render(<NativeBrowserExtensionControls controller={controller} />);
    const dialog = await openPopup();
    const automation = within(dialog).getByRole("tab", { name: "Automation" });
    await waitFor(() => expect(automation).toHaveFocus());
    expect(automation).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Automation" }).id).toBe(
      automation.getAttribute("aria-controls"),
    );
    expect(
      screen.queryByRole("region", { name: "Chromium extensions" }),
    ).toBeNull();
    fireEvent.keyDown(automation, { key: "ArrowRight" });
    const appearance = screen.getByRole("tab", { name: "Appearance" });
    expect(appearance).toHaveFocus();
    expect(appearance).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    fireEvent.keyDown(appearance, { key: "End" });
    expect(screen.getByRole("tab", { name: "About" })).toHaveFocus();
    expect(
      screen.getByRole("region", { name: "Chromium extensions" }),
    ).toHaveTextContent("Chrome Web Store add-ons cannot be installed here");
    expect(
      screen.queryByRole("button", { name: /install|load unpacked/i }),
    ).toBeNull();
    fireEvent.keyDown(screen.getByRole("tab", { name: "About" }), {
      key: "Home",
    });
    expect(automation).toHaveFocus();
    expect(controller.save).not.toHaveBeenCalled();
  });

  it("keeps nested source, mode and preset pointer gestures inside the owning popup", async () => {
    const controller = uiController();
    render(<NativeBrowserExtensionControls controller={controller} />);
    const dialog = await openPopup();
    customAppearance();
    expect(dialog).toBeInTheDocument();
    choose("Conversion mode", "Filter");
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Conversion mode" }),
    ).toHaveTextContent("Filter");
    choose("Apply appearance preset", "Dim");
    expect(screen.getByRole("slider", { name: "Brightness" })).toHaveValue(
      "85",
    );
    expect(dialog).toBeInTheDocument();
    expect(controller.save).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Website extensions" }),
    ).toHaveFocus();
  });

  it("keeps an unsaved appearance draft across subtabs and a same-owner attempt reconnect", async () => {
    const controller = uiController();
    const view = render(
      <NativeBrowserExtensionControls controller={controller} />,
    );
    await openPopup();
    customAppearance();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Follow app theme colors" }),
    );
    fireEvent.change(screen.getByLabelText("Background color"), {
      target: { value: "#123456" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Automation" }));
    view.rerender(
      <NativeBrowserExtensionControls
        controller={{
          ...controller,
          scope: "replacement-attempt",
          available: false,
          saved: true,
          reason: "Waiting for replacement",
        }}
      />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Saved. Reconnecting this tab",
    );
    expect(screen.queryByText("Waiting for replacement")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    expect(screen.getByLabelText("Background color")).toHaveValue("#123456");
    expect(
      screen.getByRole("button", { name: "Save appearance" }),
    ).toBeDisabled();
    view.rerender(
      <NativeBrowserExtensionControls
        controller={{ ...controller, scope: "replacement-attempt" }}
      />,
    );
    expect(screen.getByText("Unsaved appearance changes")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save appearance" }));
    await waitFor(() =>
      expect(controller.save).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "appearance",
          configuration: expect.objectContaining({
            theme: expect.objectContaining({ backgroundColor: "#123456" }),
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save appearance" }),
      ).toBeDisabled(),
    );
  });

  it("starts customization from current defaults and preserves custom edits when toggling the source", async () => {
    const controller = uiController();
    controller.appearance = {
      ...controller.appearance,
      defaults: {
        ...controller.appearance.defaults,
        defaults: {
          ...controller.appearance.defaults.defaults,
          followAppTheme: false,
          brightness: 83,
          backgroundColor: "#102030",
        },
      },
    };
    render(<NativeBrowserExtensionPanel controller={controller} />);
    fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    expect(screen.getByRole("slider", { name: "Brightness" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Brightness" })).toHaveValue(
      "83",
    );
    choose("Appearance settings", "Customize this connection");
    expect(screen.getByRole("slider", { name: "Brightness" })).toHaveValue(
      "83",
    );
    fireEvent.change(screen.getByRole("slider", { name: "Brightness" }), {
      target: { value: "95" },
    });
    fireEvent.change(screen.getByLabelText("Background color"), {
      target: { value: "#445566" },
    });
    choose("Appearance settings", "Use app defaults");
    expect(screen.getByRole("slider", { name: "Brightness" })).toHaveValue(
      "83",
    );
    choose("Appearance settings", "Customize this connection");
    expect(screen.getByRole("slider", { name: "Brightness" })).toHaveValue(
      "95",
    );
    expect(screen.getByLabelText("Background color")).toHaveValue("#445566");
    fireEvent.click(screen.getByRole("button", { name: "Save appearance" }));
    await waitFor(() =>
      expect(controller.save).toHaveBeenCalledWith({
        kind: "appearance",
        enabled: true,
        configuration: expect.objectContaining({
          useGlobalDefaults: false,
          theme: expect.objectContaining({
            brightness: 95,
            backgroundColor: "#445566",
          }),
        }),
      }),
    );
    expect(controller.appearance.defaults.defaults.brightness).toBe(83);
  });

  it("retains invalid or unsaved CSS for correction and reports a refused save", async () => {
    const controller = uiController();
    controller.save.mockResolvedValue(false);
    render(<NativeBrowserExtensionPanel controller={controller} />);
    customAppearance();
    choose("Conversion mode", "Custom CSS");
    fireEvent.change(screen.getByRole("textbox", { name: "Custom CSS" }), {
      target: { value: "@import 'unsafe.css';" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save appearance" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Review the appearance values",
    );
    expect(controller.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "About" }));
    fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    expect(screen.getByRole("textbox", { name: "Custom CSS" })).toHaveValue(
      "@import 'unsafe.css';",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Custom CSS" }), {
      target: { value: "body { color: #eeeeee; }" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save appearance" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Appearance was not saved",
    );
    expect(screen.getByRole("textbox", { name: "Custom CSS" })).toHaveValue(
      "body { color: #eeeeee; }",
    );
  });

  it.each(["owner", "visibility"] as const)(
    "closes immediately on %s loss and does not reopen when it returns",
    async (change) => {
      const controller = uiController();
      const view = render(
        <NativeBrowserExtensionControls controller={controller} />,
      );
      await openPopup();
      customAppearance();
      view.rerender(
        <NativeBrowserExtensionControls
          visible={change !== "visibility"}
          controller={
            change === "owner"
              ? { ...controller, owner: "another-owner" }
              : controller
          }
        />,
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      view.rerender(<NativeBrowserExtensionControls controller={controller} />);
      expect(screen.queryByRole("dialog")).toBeNull();
      await openPopup();
      expect(screen.getByRole("tab", { name: "Automation" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
      expect(
        screen.getByRole("combobox", { name: "Appearance settings" }),
      ).toHaveTextContent("Use app defaults");
    },
  );

  it("blocks every close gesture while saving, then permits dismissal", async () => {
    const controller = uiController();
    const view = render(
      <NativeBrowserExtensionControls controller={controller} />,
    );
    const dialog = await openPopup();
    view.rerender(
      <NativeBrowserExtensionControls
        controller={{ ...controller, busy: true }}
      />,
    );
    expect(dialog).toHaveTextContent("Saving changes…");
    expect(
      screen.getByRole("button", { name: "Website extensions" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Close extension settings" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Website extensions" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(document.body);
    expect(dialog).toBeInTheDocument();
    view.rerender(<NativeBrowserExtensionControls controller={controller} />);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("dismisses the nonmodal popup when keyboard focus leaves without stealing the new focus", async () => {
    const controller = uiController();
    render(
      <>
        <NativeBrowserExtensionControls controller={controller} />
        <button>Next control</button>
      </>,
    );
    await openPopup();
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Automation" })).toHaveFocus(),
    );
    const outside = screen.getByRole("button", { name: "Next control" });
    act(() => outside.focus());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(outside).toHaveFocus();
  });

  it("dismisses focus leaving through the anchor and saves only the requested automation override", async () => {
    const controller = uiController();
    render(
      <>
        <NativeBrowserExtensionControls controller={controller} />
        <button>Outside</button>
      </>,
    );
    await openPopup();
    choose("Automation for this connection", "Off for this connection");
    expect(controller.save).toHaveBeenCalledExactlyOnceWith({
      kind: "app",
      enabled: false,
    });
    expect(screen.getByRole("dialog")).toBeVisible();
    act(() =>
      screen.getByRole("button", { name: "Website extensions" }).focus(),
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    const outside = screen.getByRole("button", { name: "Outside" });
    act(() => outside.focus());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(outside).toHaveFocus();
  });
});
