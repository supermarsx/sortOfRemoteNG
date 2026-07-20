import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSidebar } from "../../src/hooks/connection/useSidebar";
import { SecureStorage } from "../../src/utils/storage/storage";

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      connections: [],
      filter: {
        searchTerm: "",
        tags: [],
        colorTags: [],
        protocols: [],
        showRecent: false,
        showFavorites: false,
        sortBy: "name",
        sortDirection: "asc",
      },
    },
    dispatch: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("useSidebar lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not dispatch storage status after unmount", async () => {
    let resolveStorageStatus!: (encrypted: boolean) => void;
    const storageStatus = new Promise<boolean>((resolve) => {
      resolveStorageStatus = resolve;
    });
    const storageSpy = vi
      .spyOn(SecureStorage, "isStorageEncrypted")
      .mockReturnValue(storageStatus);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const unhandledRejections: unknown[] = [];
    const recordUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", recordUnhandledRejection);

    const { unmount } = renderHook(() => useSidebar());
    expect(storageSpy).toHaveBeenCalledOnce();
    unmount();

    const windowDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "window",
    );
    expect(windowDescriptor?.configurable).toBe(true);

    try {
      Reflect.deleteProperty(globalThis, "window");
      resolveStorageStatus(true);
      await Promise.resolve();
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      if (windowDescriptor) {
        Object.defineProperty(globalThis, "window", windowDescriptor);
      }
      process.off("unhandledRejection", recordUnhandledRejection);
    }

    expect(unhandledRejections).toEqual([]);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("handles a rejected storage probe without an unhandled rejection", async () => {
    const probeError = new Error("storage probe failed");
    let rejectStorageStatus!: (reason: Error) => void;
    const storageStatus = new Promise<boolean>((_resolve, reject) => {
      rejectStorageStatus = reject;
    });
    const storageSpy = vi
      .spyOn(SecureStorage, "isStorageEncrypted")
      .mockReturnValue(storageStatus);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const unhandledRejections: unknown[] = [];
    const recordUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", recordUnhandledRejection);

    const { unmount } = renderHook(() => useSidebar());
    expect(storageSpy).toHaveBeenCalledOnce();
    unmount();

    try {
      rejectStorageStatus(probeError);
      await Promise.resolve();
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      process.off("unhandledRejection", recordUnhandledRejection);
    }

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    expect(consoleErrorSpy).toHaveBeenCalledWith(probeError);
    expect(unhandledRejections).toEqual([]);
  });
});
