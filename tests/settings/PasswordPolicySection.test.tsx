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
import { DEFAULT_PASSWORD_POLICY } from "../../src/types/security/passwordPolicy";
const mocks = vi.hoisted(() => ({
  policy: undefined as unknown,
  update: vi.fn(),
  invoke: vi.fn(),
  ready: true,
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({
    settings: {
      passwordPolicy:
        mocks.policy === undefined ? DEFAULT_PASSWORD_POLICY : mocks.policy,
    },
    settingsReady: mocks.ready,
    updateSettings: mocks.update,
  }),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => mocks.invoke,
}));
import PasswordPolicySection from "../../src/components/SettingsDialog/sections/security/PasswordPolicySection";
beforeEach(() => {
  mocks.policy = undefined;
  mocks.ready = true;
  mocks.update.mockReset().mockResolvedValue(undefined);
  mocks.invoke.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);
describe("password policy settings", () => {
  it("themes every policy action and retains disabled settings gating", async () => {
    const view = render(<PasswordPolicySection />);
    expect(
      screen.getByRole("button", { name: "Apply password policy" }),
    ).toHaveClass("sor-btn", "sor-btn-primary");
    const generate = screen.getByRole("button", {
      name: "Generate using saved policy",
    });
    expect(generate).toHaveClass("sor-btn", "sor-btn-secondary");
    fireEvent.click(generate);
    const clear = await screen.findByRole("button", {
      name: "Clear generated password",
    });
    expect(clear).toHaveClass("sor-btn", "sor-btn-secondary");
    fireEvent.click(clear);
    expect(
      screen.queryByLabelText("Generated policy password"),
    ).not.toBeInTheDocument();
    mocks.ready = false;
    view.rerender(<PasswordPolicySection />);
    expect(
      screen.getByRole("button", { name: "Apply password policy" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Generate using saved policy" }),
    ).toBeDisabled();
  });
  it("retains an invalid saved policy until explicit review and repair", async () => {
    mocks.policy = { enabled: "broken" };
    render(<PasswordPolicySection />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "saved password policy is invalid",
    );
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Apply password policy" }),
    );
    await screen.findByText(/Password policy saved/);
    expect(mocks.update).toHaveBeenCalledWith({
      passwordPolicy: DEFAULT_PASSWORD_POLICY,
    });
  });
  it("does not persist on typing and requires explicit valid Apply", async () => {
    render(<PasswordPolicySection />);
    fireEvent.change(screen.getByLabelText("Password policy minimum length"), {
      target: { value: "" },
    });
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Apply password policy" }),
    );
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Password policy minimum length"), {
      target: { value: "16" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Apply password policy" }),
    );
    await screen.findByText(/Password policy saved/);
    expect(mocks.update).toHaveBeenCalledWith({
      passwordPolicy: { ...DEFAULT_PASSWORD_POLICY, minLength: 16 },
    });
  });
  it("reports save failure honestly", async () => {
    mocks.update.mockRejectedValueOnce(Error("synthetic-secret"));
    render(<PasswordPolicySection />);
    fireEvent.click(
      screen.getByRole("button", { name: "Apply password policy" }),
    );
    await screen.findByText(/Password policy was not saved/);
    expect(screen.queryByText(/synthetic-secret/)).not.toBeInTheDocument();
  });
  it("disables while settings unavailable and discards delayed generated output after lock", async () => {
    let resolve!: () => void;
    mocks.invoke.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const view = render(<PasswordPolicySection />);
    fireEvent.click(
      screen.getByRole("button", { name: "Generate using saved policy" }),
    );
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
    mocks.ready = false;
    view.rerender(<PasswordPolicySection />);
    await act(async () => resolve());
    mocks.ready = true;
    view.rerender(<PasswordPolicySection />);
    expect(
      screen.queryByLabelText("Generated policy password"),
    ).not.toBeInTheDocument();
  });
});
