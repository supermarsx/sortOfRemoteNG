import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Hoisted so the module-mock factory can see it (mirrors the sibling tabs).
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import MailcowOperationsTab from "./MailcowOperationsTab";
import { mailcowOperationsApi } from "../../../hooks/integration/mailcow/useMailcowOperations";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
});

describe("mailcowOperationsApi bindings", () => {
  it("binds all 28 operations-category commands", () => {
    // 5 transport + 5 queue + 7 quarantine + 2 logs + 6 status + 3 rate limits.
    expect(Object.keys(mailcowOperationsApi)).toHaveLength(28);
  });

  it("passes the connection id as the first invoke arg", () => {
    mailcowOperationsApi.getQueueSummary("conn-1");
    expect(invokeMock).toHaveBeenCalledWith("mailcow_get_queue_summary", {
      id: "conn-1",
    });
  });

  it("camelCases two-word Rust params (transport_id, queue_name, quarantine_id, log_type)", () => {
    mailcowOperationsApi.getTransportMap("conn-1", 7);
    expect(invokeMock).toHaveBeenCalledWith("mailcow_get_transport_map", {
      id: "conn-1",
      transportId: 7,
    });

    mailcowOperationsApi.listQueue("conn-1", "deferred");
    expect(invokeMock).toHaveBeenCalledWith("mailcow_list_queue", {
      id: "conn-1",
      queueName: "deferred",
    });

    mailcowOperationsApi.deleteQueueItem("conn-1", "ABC123");
    expect(invokeMock).toHaveBeenCalledWith("mailcow_delete_queue_item", {
      id: "conn-1",
      queueId: "ABC123",
    });

    mailcowOperationsApi.releaseQuarantine("conn-1", 42);
    expect(invokeMock).toHaveBeenCalledWith("mailcow_release_quarantine", {
      id: "conn-1",
      quarantineId: 42,
    });

    mailcowOperationsApi.getLogs("conn-1", "postfix", 50);
    expect(invokeMock).toHaveBeenCalledWith("mailcow_get_logs", {
      id: "conn-1",
      logType: "postfix",
      count: 50,
    });
  });

  it("passes request/config/settings-bearing commands through unwrapped", () => {
    mailcowOperationsApi.setRateLimit("conn-1", {
      object: "user@d.tld",
      value: "10",
      frame: "h",
    });
    expect(invokeMock).toHaveBeenCalledWith("mailcow_set_rate_limit", {
      id: "conn-1",
      req: { object: "user@d.tld", value: "10", frame: "h" },
    });

    mailcowOperationsApi.updateFail2banConfig("conn-1", {
      ban_time: 3600,
      max_attempts: 3,
      retry_window: 600,
      whitelist: [],
      blacklist: [],
    });
    expect(invokeMock).toHaveBeenCalledWith("mailcow_update_fail2ban_config", {
      id: "conn-1",
      config: {
        ban_time: 3600,
        max_attempts: 3,
        retry_window: 600,
        whitelist: [],
        blacklist: [],
      },
    });

    mailcowOperationsApi.updateQuarantineSettings("conn-1", { max_score: 9 });
    expect(invokeMock).toHaveBeenCalledWith(
      "mailcow_update_quarantine_settings",
      { id: "conn-1", settings: { max_score: 9 } },
    );
  });
});

describe("MailcowOperationsTab", () => {
  it("renders its six grouped sections", () => {
    render(<MailcowOperationsTab connectionId="conn-1" />);
    expect(screen.getByText("Transport Maps")).toBeInTheDocument();
    expect(screen.getByText("Mail Queue")).toBeInTheDocument();
    expect(screen.getByText("Quarantine")).toBeInTheDocument();
    expect(screen.getByText("Logs")).toBeInTheDocument();
    expect(screen.getByText("Server Status")).toBeInTheDocument();
    expect(screen.getByText("Rate Limits")).toBeInTheDocument();
  });
});
