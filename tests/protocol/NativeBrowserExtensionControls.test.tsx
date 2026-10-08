import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
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
import { NativeBrowserExtensionPanel } from "../../src/components/protocol/webBrowser/NativeBrowserExtensionControls";
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
      screen.getByRole("region", { name: "Native website appearance" }),
    ).toHaveTextContent("Follow app theme colors");
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).toHaveClass("sor-settings-checkbox");
    }
    expect(
      screen.getByRole("checkbox", { name: "User scripts" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: "Follow app theme colors" }),
    ).toBeDisabled();
    await act(async () =>
      fireEvent.click(screen.getByRole("checkbox", { name: "User scripts" })),
    );
    expect(db.persisted[0].httpAutomation?.scriptInjectionEnabled).toBe(true);
    expect(
      screen.getByText(
        "Saved to this connection. Reopen the website to apply.",
      ),
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
        name: "App login and website automation",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "App login and website automation" })
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
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Use global website appearance defaults",
      }),
    );
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
});
