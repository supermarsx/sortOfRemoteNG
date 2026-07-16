import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../types/connection/connection";

const mocks = vi.hoisted(() => ({
  x2goHook: vi.fn(),
  nxHook: vi.fn(),
}));

vi.mock("../../hooks/protocol/useX2goNativeSession", () => ({
  useX2goNativeSession: (...args: unknown[]) => mocks.x2goHook(...args),
}));
vi.mock("../../hooks/protocol/useNxNativeSession", () => ({
  useNxNativeSession: (...args: unknown[]) => mocks.nxHook(...args),
}));

import { NxNativeClient } from "./NxNativeClient";
import { X2goNativeClient } from "./X2goNativeClient";

const session = (protocol: string): ConnectionSession => ({
  id: `${protocol}-session`,
  connectionId: `${protocol}-connection`,
  name: `${protocol} desktop`,
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol,
  hostname: `${protocol}.example.test`,
});

const model = (pid: number) => ({
  status: "native-client-running" as const,
  error: null,
  info: { native_client_pid: pid },
  launch: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn().mockResolvedValue(true),
  disconnect: vi.fn().mockResolvedValue(undefined),
});

beforeEach(() => {
  mocks.x2goHook.mockReset();
  mocks.nxHook.mockReset();
  mocks.x2goHook.mockReturnValue(model(123));
  mocks.nxHook.mockReturnValue(model(456));
});

describe("native NX-family clients", () => {
  it("labels X2Go as a native process handoff, not authenticated pixels", () => {
    const current = model(123);
    mocks.x2goHook.mockReturnValue(current);
    render(<X2goNativeClient session={session("x2go")} />);

    expect(
      screen.getByText("Native X2Go Client is running"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Process status, not an auth claim/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no embedded framebuffer is claimed/i),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /close native client/i }),
    );
    expect(current.disconnect).toHaveBeenCalledOnce();
  });

  it("labels NoMachine as an nxplayer handoff and keeps auth native", () => {
    const current = model(456);
    mocks.nxHook.mockReturnValue(current);
    render(<NxNativeClient session={session("nx")} />);

    expect(
      screen.getByText("Native NoMachine Client is running"),
    ).toBeInTheDocument();
    expect(screen.getByText(/empty-password marker/i)).toBeInTheDocument();
    expect(
      screen.getByText(/does not invent an embedded framebuffer/i),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /refresh process status/i }),
    );
    expect(current.refresh).toHaveBeenCalledOnce();
  });
});
