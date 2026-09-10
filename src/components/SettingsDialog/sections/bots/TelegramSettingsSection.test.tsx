import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import TelegramSettingsSection from "./TelegramSettingsSection";
import { telegramApi } from "../../../../hooks/integration/useTelegram";
import type { GlobalSettings } from "../../../../types/settings/settings";

const noopSettings = {} as GlobalSettings;
const noop = () => {};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "read_app_data":
        return Promise.resolve(null);
      case "telegram_list_bots":
        return Promise.resolve([]);
      default:
        return Promise.resolve(null);
    }
  });
});

describe("TelegramSettingsSection in Bots settings", () => {
  it("surfaces a list failure once and retries only on explicit Refresh", async () => {
    const implementation = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation((command, args) =>
      command === "telegram_list_notification_rules"
        ? Promise.reject(new Error("Bot service unavailable"))
        : implementation(command, args),
    );
    render(<TelegramSettingsSection s={noopSettings} u={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Rules" }));
    await screen.findByText("Bot service unavailable");
    const calls = () =>
      invokeMock.mock.calls.filter(
        ([command]) => command === "telegram_list_notification_rules",
      );
    expect(calls()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(calls()).toHaveLength(1);
    const refreshButtons = screen.getAllByRole("button", { name: "Refresh" });
    fireEvent.click(refreshButtons[refreshButtons.length - 1]);
    await screen.findByText("Bot service unavailable");
    expect(calls()).toHaveLength(2);
  });
  it.each([
    ["Rules", "telegram_list_notification_rules"],
    ["Monitoring", "telegram_list_monitoring_checks"],
    ["Templates", "telegram_list_templates"],
    ["Scheduled", "telegram_list_scheduled_messages"],
    ["Digests", "telegram_list_digests"],
    ["Logs", "telegram_message_log"],
  ])(
    "refreshes %s once on entry, not again when manager loading state changes",
    async (tab, command) => {
      const implementation = invokeMock.getMockImplementation()!;
      const pending: Array<(rows: never[]) => void> = [];
      invokeMock.mockImplementation((cmd, args) =>
        cmd === command
          ? new Promise<never[]>((resolve) => pending.push(resolve))
          : implementation(cmd, args),
      );
      const view = render(
        <TelegramSettingsSection s={noopSettings} u={noop} />,
      );
      fireEvent.click(screen.getByRole("button", { name: tab }));
      expect(pending).toHaveLength(1);
      await act(async () => pending[0]([]));
      expect(pending).toHaveLength(1);
      view.rerender(<TelegramSettingsSection s={noopSettings} u={noop} />);
      expect(pending).toHaveLength(1);
      const refreshButtons = screen.getAllByRole("button", { name: "Refresh" });
      fireEvent.click(refreshButtons[refreshButtons.length - 1]);
      expect(pending).toHaveLength(2);
      await act(async () => pending[1]([]));
      expect(pending).toHaveLength(2);
    },
  );
  it("shows a visible settings heading and shared cards and controls without a collapsing page wrapper", async () => {
    const { container } = render(
      <TelegramSettingsSection s={noopSettings} u={noop} />,
    );
    expect(screen.getByRole("heading", { name: "Telegram bots" })).toHaveClass(
      "sor-settings-section-header",
    );
    expect(
      screen.queryByRole("button", { name: /Telegram bots/i }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByPlaceholderText("alerts-bot")).toBeInTheDocument(),
    );
    expect(invokeMock).toHaveBeenCalledWith("telegram_list_bots", undefined);
    expect(screen.getByPlaceholderText("alerts-bot")).toHaveClass(
      "sor-form-input",
    );
    expect(
      screen.getByPlaceholderText("alerts-bot").closest(".sor-settings-card"),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Rules" })).toHaveClass(
      "sor-btn-secondary-sm",
    );
    expect(screen.getByRole("combobox", { name: "Manage bot" })).toHaveClass(
      "sor-form-input",
    );
    expect(
      container.querySelector('[data-setting-key="telegram.bots"]'),
    ).not.toBeNull();
    expect(
      invokeMock.mock.calls.some(([command]) =>
        /telegram_(add_bot|send_message|remove_bot)/.test(command),
      ),
    ).toBe(false);
  });

  it("api wrappers map to the correct registered command names + camelCase args", () => {
    telegramApi.sendMessage("alerts-bot", { chatId: 123, text: "hi" });
    telegramApi.deleteMessage("alerts-bot", "@chan", 5);
    telegramApi.setNotificationRuleEnabled("r1", false);
    telegramApi.createInviteLink("alerts-bot", 123, "vip", 999, 10, true);

    expect(invokeMock).toHaveBeenCalledWith("telegram_send_message", {
      botName: "alerts-bot",
      req: { chatId: 123, text: "hi" },
    });
    expect(invokeMock).toHaveBeenCalledWith("telegram_delete_message", {
      botName: "alerts-bot",
      chatId: "@chan",
      messageId: 5,
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "telegram_set_notification_rule_enabled",
      { ruleId: "r1", enabled: false },
    );
    expect(invokeMock).toHaveBeenCalledWith("telegram_create_invite_link", {
      botName: "alerts-bot",
      chatId: 123,
      name: "vip",
      expireDate: 999,
      memberLimit: 10,
      createsJoinRequest: true,
    });
  });

  it("add-bot registers the bot and persists an encrypted instance", async () => {
    render(<TelegramSettingsSection s={noopSettings} u={noop} />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText("alerts-bot")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("alerts-bot"), {
      target: { value: "ops" },
    });
    // The token field is the only password input in the add-bot card.
    const pwInputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(pwInputs[0], { target: { value: "123:ABC" } });

    fireEvent.click(screen.getByRole("button", { name: /^Add bot$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("telegram_add_bot", {
        config: expect.objectContaining({ name: "ops", token: "123:ABC" }),
      }),
    );
  });
});
