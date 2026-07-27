import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMssql } from "./useMssql";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("useMssql session ownership", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("never adopts an arbitrary service-wide session on a cold mount", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "mssql_list_sessions") {
        return Promise.resolve([
          { id: "foreign-session", status: "Connected" },
        ]);
      }
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useMssql());

    await act(async () => {
      await expect(result.current.refreshConnection()).resolves.toBe(false);
    });

    expect(result.current.sessionId).toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith("mssql_list_sessions");
  });

  it("refreshes only the exact session handle opened by this hook", async () => {
    invokeMock.mockImplementation(
      (command: string, args?: Record<string, unknown>) => {
        if (command === "mssql_connect") {
          return Promise.resolve("owned-session");
        }
        if (command === "mssql_get_session") {
          return Promise.resolve({
            id: String(args?.sessionId),
            status: "Connected",
          });
        }
        return Promise.resolve(undefined);
      },
    );
    const { result } = renderHook(() => useMssql());

    await act(async () => {
      await result.current.connect({
        host: "sql.example.test",
        port: 1433,
        auth: {
          SqlAuth: {
            username: "sa",
            password: "secret",
          },
        },
      } as never);
    });
    invokeMock.mockClear();
    await act(async () => {
      await expect(result.current.refreshConnection()).resolves.toBe(true);
    });

    expect(invokeMock).toHaveBeenCalledWith("mssql_get_session", {
      sessionId: "owned-session",
    });
    expect(invokeMock).not.toHaveBeenCalledWith("mssql_list_sessions");
    await act(async () => {
      await result.current.disconnect();
    });
  });
});
