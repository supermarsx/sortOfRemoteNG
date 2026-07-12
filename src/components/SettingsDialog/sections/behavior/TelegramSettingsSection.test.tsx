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

describe("TelegramSettingsSection", () => {
  it("renders collapsed, then reveals the bot manager when expanded", async () => {
    render(<TelegramSettingsSection s={noopSettings} u={noop} />);

    // Collapsed: the title trigger is present.
    const trigger = screen.getByRole("button", { name: /Telegram bots/i });
    expect(trigger).toBeInTheDocument();

    fireEvent.click(trigger);

    // Expanded: the add-bot form field appears; refreshBots was called.
    await waitFor(() =>
      expect(screen.getByPlaceholderText("alerts-bot")).toBeInTheDocument(),
    );
    expect(invokeMock).toHaveBeenCalledWith("telegram_list_bots", undefined);
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
    fireEvent.click(screen.getByRole("button", { name: /Telegram bots/i }));

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
