import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TOTPConfig } from "../../src/types/settings/settings";

const boundary = vi.hoisted(() => ({
  owner: "db-a",
  lease: 1,
  accessible: true,
  access: null as
    null | ((event: { databaseId: string; status: string }) => void),
  current: null as null | (() => void),
  nativeLock: null as null | (() => void),
  compute: vi.fn(),
  copy: vi.fn(),
}));
vi.mock("../../src/hooks/totp/useTOTP", () => ({
  totpApi: { computeCode: boundary.compute },
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_name: string, listener: () => void) => {
    boundary.nativeLock = listener;
    return () => {
      boundary.nativeLock = null;
    };
  },
}));
vi.mock("../../src/utils/connection/databaseManager", () => {
  const manager = {
    getCurrentDatabase: () => ({ id: boundary.owner }),
    captureCurrentDatabaseDataTarget: () => {
      const lease = boundary.lease,
        owner = boundary.owner;
      return {
        databaseId: owner,
        assertAccessible: () => {
          if (
            !boundary.accessible ||
            boundary.lease !== lease ||
            boundary.owner !== owner
          )
            throw new Error("revoked");
        },
      };
    },
    onCurrentDatabaseChange: (listener: () => void) => {
      boundary.current = listener;
      return () => {
        boundary.current = null;
      };
    },
  };
  return {
    DatabaseManager: { getInstance: () => manager },
    onDatabaseAccessChange: (listener: typeof boundary.access) => {
      boundary.access = listener;
      return () => {
        boundary.access = null;
      };
    },
  };
});
import WebTotpPanel from "../../src/components/protocol/webBrowser/WebTotpPanel";
const configs: TOTPConfig[] = [
  {
    secret: "JBSWY3DPEHPK3PXP",
    account: "Demo account",
    issuer: "Demo",
    algorithm: "sha1",
    digits: 6,
    period: 30,
    backupCodes: ["never-display-backup"],
  },
];
const mount = (items = configs, owner: string | undefined = "db-a") =>
  render(
    <WebTotpPanel
      configs={items}
      ownerDatabaseId={owner}
      connectionId="same-id"
      onClose={() => {}}
    />,
  );
beforeEach(() => {
  boundary.owner = "db-a";
  boundary.lease = 1;
  boundary.accessible = true;
  boundary.compute.mockReset().mockResolvedValue("123456");
  boundary.copy.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: boundary.copy },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("code-only owner-scoped website TOTP", () => {
  it("clears on global encryption lock even when the inner database lease remains valid", async () => {
    mount();
    await screen.findByText("123456");
    await waitFor(() => expect(boundary.nativeLock).not.toBeNull());
    act(() => boundary.nativeLock?.());
    expect(screen.queryByText("123456")).not.toBeInTheDocument();
    expect(screen.getByText(/reopen 2FA Codes/)).toBeInTheDocument();
  });
  it("masks codes on a connection change even when the configs array is identical", async () => {
    const view = mount();
    await screen.findByText("123456");
    boundary.compute.mockImplementation(() => new Promise(() => {}));
    view.rerender(
      <WebTotpPanel
        configs={configs}
        ownerDatabaseId="db-a"
        connectionId="different-id"
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText("123456")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy code 1" })).toBeDisabled();
  });
  it("updates countdown each second but computes only once per time period", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(30001);
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(boundary.compute).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(boundary.compute).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(27000);
    });
    expect(boundary.compute).toHaveBeenCalledTimes(2);
  });
  it("computes an existing config and copies only on an explicit click, without management affordances or secrets", async () => {
    mount();
    await screen.findByText("123456");
    expect(boundary.compute).toHaveBeenCalledWith(
      configs[0].secret,
      "SHA1",
      6,
      30,
    );
    expect(boundary.copy).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(configs[0].secret);
    expect(document.body.textContent).not.toContain("never-display-backup");
    expect(
      screen.queryByRole("button", {
        name: /export|reveal|generate|type code|add|remove/i,
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy code 1" }));
    await screen.findByText(/Code copied/);
    expect(boundary.copy).toHaveBeenCalledWith("123456");
  });
  it.each([undefined, "db-b"])(
    "does not compute for absent or mismatched owner %s",
    (owner) => {
      render(
        <WebTotpPanel
          configs={configs}
          ownerDatabaseId={owner}
          connectionId="same-id"
          onClose={() => {}}
        />,
      );
      expect(
        screen.getByText(/owning database is unavailable/),
      ).toBeInTheDocument();
      expect(boundary.compute).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain("Demo account");
    },
  );
  it("gives enrollment guidance without generating an unregistered secret or fake recovery codes", () => {
    mount([]);
    expect(screen.getByText(/already-enrolled secret/)).toBeInTheDocument();
    expect(boundary.compute).not.toHaveBeenCalled();
  });
  it("clears immediately on suspension and refuses a delayed computation after unlock", async () => {
    let resolve!: (value: string) => void;
    boundary.compute.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    mount();
    act(() => {
      boundary.accessible = false;
      boundary.access?.({ databaseId: "db-a", status: "suspended" });
    });
    boundary.accessible = true;
    boundary.lease++;
    await act(async () => resolve("123456"));
    expect(screen.queryByText("123456")).not.toBeInTheDocument();
    expect(screen.getByText(/reopen 2FA Codes/)).toBeInTheDocument();
  });
  it("rechecks access at copy even before a lock notification renders", async () => {
    mount();
    await screen.findByText("123456");
    boundary.accessible = false;
    fireEvent.click(screen.getByRole("button", { name: "Copy code 1" }));
    expect(boundary.copy).not.toHaveBeenCalled();
    expect(screen.queryByText("123456")).not.toBeInTheDocument();
  });
  it("clears codes when another database becomes active with the same connection ID", async () => {
    mount();
    await screen.findByText("123456");
    act(() => {
      boundary.owner = "db-b";
      boundary.current?.();
    });
    expect(screen.queryByText("123456")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy code 1" }),
    ).not.toBeInTheDocument();
  });
  it("rejects stale completion after configs change and ignores completion after unmount", async () => {
    let resolve!: (value: string) => void;
    boundary.compute.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = mount();
    view.rerender(
      <WebTotpPanel
        configs={[]}
        ownerDatabaseId="db-a"
        connectionId="same-id"
        onClose={() => {}}
      />,
    );
    await act(async () => resolve("123456"));
    expect(screen.queryByText("123456")).not.toBeInTheDocument();
    view.unmount();
    expect(boundary.access).toBeNull();
    expect(boundary.current).toBeNull();
  });
  it("does not copy an expired code and reports clipboard failure without leaking native errors", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(30001);
    mount();
    await screen.findByText("123456");
    boundary.copy.mockRejectedValueOnce(new Error("private-clipboard-detail"));
    fireEvent.click(screen.getByRole("button", { name: "Copy code 1" }));
    await screen.findByText(/Could not copy/);
    clock.mockReturnValue(60001);
    fireEvent.click(screen.getByRole("button", { name: "Copy code 1" }));
    expect(boundary.copy).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("private-clipboard-detail");
  });
  it("suppresses malformed configs and native failure text", async () => {
    boundary.compute.mockRejectedValueOnce(new Error("private-seed-error"));
    mount([...configs, { ...configs[0], period: 0 }]);
    await waitFor(() => expect(boundary.compute).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("123456")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("private-seed-error");
  });
});
