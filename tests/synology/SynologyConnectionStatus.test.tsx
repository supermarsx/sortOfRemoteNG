import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConnectionForm from "../../src/components/synology/synologyPanel/ConnectionForm";
import type { Mgr } from "../../src/components/synology/synologyPanel/types";
vi.mock("../../src/components/ui/display/loadingElement", () => ({
  LoadingElement: () => <span data-testid="configured-app-loader" />,
}));
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
  it("uses the app-themed password control and reveals only by explicit user action without submitting", () => {
    const mgr = manager({
      targetLocked: false,
      connectionError: null,
      setPassword: vi.fn(),
      setUsername: vi.fn(),
    });
    const view = render(<ConnectionForm mgr={mgr} />);
    const password = screen.getByLabelText("Password");
    expect(password).toHaveClass("sor-form-input");
    expect(password).toHaveStyle({ paddingRight: "2.25rem" });
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("Username")).toHaveClass("sor-form-input");
    expect(screen.getByLabelText("Username")).toHaveAttribute(
      "autocomplete",
      "username",
    );
    const reveal = screen.getByRole("button", { name: "Show password" });
    expect(reveal).toHaveAttribute("type", "button");
    fireEvent.click(reveal);
    expect(password).toHaveAttribute("type", "text");
    expect(mgr.connect).not.toHaveBeenCalled();
    expect(mgr.setPassword).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
    fireEvent.change(password, { target: { value: "replacement" } });
    expect(mgr.setPassword).toHaveBeenCalledExactlyOnceWith("replacement");
    view.rerender(
      <ConnectionForm mgr={{ ...mgr, connectionStatus: "connecting" }} />,
    );
    expect(password).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Show password" }),
    ).not.toBeInTheDocument();
  });
  it("keeps vault-locked credentials disabled and unrevealable", () => {
    render(
      <ConnectionForm
        mgr={manager({ targetLocked: false, credentialsLocked: true })}
      />,
    );
    expect(screen.getByLabelText("Password")).toBeDisabled();
    expect(screen.getByLabelText("Username")).toBeDisabled();
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "type",
      "password",
    );
    expect(
      screen.queryByRole("button", { name: "Show password" }),
    ).not.toBeInTheDocument();
  });
  it.each([true, false])(
    "renders structured safe API errors in the saved=%s connection form",
    (targetLocked) => {
      const data = {
        stage: "api_discovery",
        category: "html",
        httpStatus: 200,
        contentType: "html",
        bytesRead: 4096,
      };
      render(
        <ConnectionForm
          mgr={manager({
            targetLocked,
            connectionError: `Native explanation\nsynology-diagnostic:v1:${JSON.stringify(data)}`,
          })}
        />,
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "web page instead of API JSON",
      );
      expect(screen.getByText("Discovering DSM APIs")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Copy diagnostics" }),
      ).toBeEnabled();
      expect(screen.queryByText(/synology-diagnostic/)).not.toBeInTheDocument();
    },
  );
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
    expect(screen.getByRole("status")).toHaveTextContent(
      "Resolving the NAS and signing in",
    );
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
    expect(screen.getByLabelText("One-time code")).toHaveClass(
      "sor-form-input",
    );
    expect(screen.getByLabelText("One-time code")).toHaveAttribute(
      "autocomplete",
      "one-time-code",
    );
    expect(screen.getByLabelText("One-time code")).toHaveAttribute(
      "inputmode",
      "numeric",
    );
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });
  it("shows code verification as one pending request inside the explicit challenge dialog", () => {
    render(
      <ConnectionForm
        mgr={manager({
          connectionStatus: "connecting",
          connectionError: null,
          challenge: {
            status: "otp_required",
            message: "Enter your authenticator code.",
          },
        })}
        runtimeVerified
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Verifying the one-time code…" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("DSM requested a one-time code"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("configured-app-loader")).toHaveLength(1);
    expect(
      screen.queryByText("DSM API session established"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("One-time code")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Verifying…" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Cancel sign-in" }),
    ).toBeEnabled();
  });
});
