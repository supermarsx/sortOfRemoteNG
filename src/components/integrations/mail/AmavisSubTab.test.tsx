import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import AmavisSubTab from "./AmavisSubTab";
import { amavisApi } from "../../../hooks/integration/mail/useAmavis";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "read_app_data":
        return Promise.resolve(null);
      case "amavis_connect":
      case "amavis_ping":
        return Promise.resolve({
          host: "mail.lab.local",
          version: "2.13.0",
          running: true,
          uptime_secs: 42,
        });
      default:
        return Promise.resolve(null);
    }
  });
});

describe("AmavisSubTab", () => {
  it("renders its own connect form when disconnected", async () => {
    render(<AmavisSubTab active />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("mail.lab.local"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /^Connect$/i }),
    ).toBeInTheDocument();
  });

  it("connect maps to amavis_connect with a snake_case wire-shape config", async () => {
    render(<AmavisSubTab active />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("mail.lab.local"),
      ).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("mail.lab.local"), {
      target: { value: "amavis.lab.local" },
    });
    // username is required to enable Connect — it's the second SSH text input.
    fireEvent.change(
      screen.getByText("SSH username").parentElement!.querySelector("input")!,
      { target: { value: "root" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "amavis_connect",
        expect.objectContaining({
          id: expect.any(String),
          config: expect.objectContaining({
            host: "amavis.lab.local",
            username: "root",
          }),
        }),
      ),
    );
  });

  it("api wrappers map to the correct command names + camelCase args", () => {
    amavisApi.getBannedRule("c1", "b1");
    amavisApi.listEntries("c1", "sender_whitelist");
    amavisApi.releaseAllQuarantine("c1", "spam");
    amavisApi.updatePolicyBank("c1", "pb1", { description: "x" });
    expect(invokeMock).toHaveBeenCalledWith("amavis_get_banned_rule", {
      id: "c1",
      banId: "b1",
    });
    expect(invokeMock).toHaveBeenCalledWith("amavis_list_entries", {
      id: "c1",
      listType: "sender_whitelist",
    });
    expect(invokeMock).toHaveBeenCalledWith("amavis_release_all_quarantine", {
      id: "c1",
      quarantineType: "spam",
    });
    expect(invokeMock).toHaveBeenCalledWith("amavis_update_policy_bank", {
      id: "c1",
      name: "pb1",
      req: { description: "x" },
    });
  });

  it("binds the full 52-command amavis surface", () => {
    // 4 connection + 48 management = 52 distinct wrappers.
    expect(Object.keys(amavisApi)).toHaveLength(52);
  });
});
