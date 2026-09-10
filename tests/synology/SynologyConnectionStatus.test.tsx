import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConnectionForm from "../../src/components/synology/synologyPanel/ConnectionForm";
import type { Mgr } from "../../src/components/synology/synologyPanel/types";
afterEach(cleanup);
const manager = (overrides: Partial<Mgr> = {}) =>
  ({
    targetLocked: true,
    host: "nas.example.test",
    port: 5001,
    username: "user",
    password: "secret",
    useHttps: true,
    otpCode: "",
    connectionStatus: "error",
    connectionError: "Connection refused by NAS",
    challenge: null,
    connect: vi.fn(),
    cancelChallenge: vi.fn(),
    ...overrides,
  }) as unknown as Mgr;
describe("saved NAS status page", () => {
  it("shows the actual failure and Retry without duplicate credential fields", () => {
    const mgr = manager();
    render(<ConnectionForm mgr={mgr} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Connection refused by NAS",
    );
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mgr.connect).toHaveBeenCalledOnce();
  });
  it("shows a cancellable connecting state instead of a login form", () => {
    const mgr = manager({
      connectionStatus: "connecting",
      connectionError: null,
    });
    render(<ConnectionForm mgr={mgr} />);
    expect(screen.getByRole("status")).toHaveTextContent("Connecting to NAS");
    fireEvent.click(screen.getByRole("button", { name: "Cancel connection" }));
    expect(mgr.cancelChallenge).toHaveBeenCalledOnce();
  });
  it("keeps the explicit two-factor popup, not a username/password prompt", () => {
    render(
      <ConnectionForm
        mgr={manager({
          connectionError: null,
          challenge: {
            status: "otp_required",
            message: "Enter your authenticator code.",
          },
        })}
      />,
    );
    expect(
      screen.getByRole("dialog", {
        name: "Synology two-factor authentication",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("One-time code")).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });
});
