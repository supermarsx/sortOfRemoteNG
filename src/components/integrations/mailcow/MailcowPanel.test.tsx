import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  renderHook,
  act,
} from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import MailcowPanel from "./MailcowPanel";
import { mailcowDescriptor } from "./descriptor";
import { mailcowCategoryTabs } from "./registry";
import {
  mailcowConnectionApi,
  useMailcowConnection,
} from "../../../hooks/integration/mailcow";

beforeEach(() => {
  invokeMock.mockReset();
  (
    globalThis as unknown as {
      __TAURI__?: { core: { invoke: typeof invokeMock } };
    }
  ).__TAURI__ = {
    core: {
      invoke: ((cmd: string, args?: Record<string, unknown>) =>
        invokeMock(cmd, args)) as unknown as typeof invokeMock,
    },
  };
});

describe("mailcowConnectionApi", () => {
  it("maps connect/ping/disconnect to their id-keyed commands", async () => {
    invokeMock.mockResolvedValue({ host: "mail.example.com", containers_count: 0 });
    const config = { base_url: "https://mail.example.com", api_key: "k" };
    await mailcowConnectionApi.connect("inst-1", config);
    await mailcowConnectionApi.ping("inst-1");
    await mailcowConnectionApi.disconnect("inst-1");
    expect(invokeMock).toHaveBeenCalledWith("mailcow_connect", {
      id: "inst-1",
      config,
    });
    expect(invokeMock).toHaveBeenCalledWith("mailcow_ping", { id: "inst-1" });
    expect(invokeMock).toHaveBeenCalledWith("mailcow_disconnect", {
      id: "inst-1",
    });
  });
});

describe("useMailcowConnection", () => {
  it("connect stores the summary and connection id", async () => {
    invokeMock.mockResolvedValue({
      host: "mail.example.com",
      version: "2024-01",
      containers_count: 20,
    });
    const { result } = renderHook(() => useMailcowConnection());
    await act(async () => {
      await result.current.connect("inst-1", {
        base_url: "https://mail.example.com",
        api_key: "k",
      });
    });
    expect(result.current.connectionId).toBe("inst-1");
    expect(result.current.summary?.containers_count).toBe(20);
  });
});

describe("mailcowDescriptor", () => {
  it("registers as an app-service integration with a lazy panel import", async () => {
    expect(mailcowDescriptor.key).toBe("mailcow");
    expect(mailcowDescriptor.category).toBe("app-service");
    const mod = await mailcowDescriptor.importPanel();
    expect(mod.default).toBeTypeOf("function");
  });

  it("registers both category sub-tabs in display order", () => {
    expect(Array.isArray(mailcowCategoryTabs)).toBe(true);
    expect(mailcowCategoryTabs.map((tab) => tab.categoryKey)).toEqual([
      "objects",
      "operations",
    ]);
    for (const tab of mailcowCategoryTabs) {
      expect(typeof tab.importTab).toBe("function");
    }
  });
});

describe("MailcowPanel shell", () => {
  it("connect form persists creds then drives mailcow_connect with snake_case config", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_app_data") return Promise.resolve(null);
      if (cmd === "mailcow_connect")
        return Promise.resolve({
          host: "mail.example.com",
          containers_count: 20,
        });
      return Promise.resolve(undefined);
    });

    render(<MailcowPanel isOpen onClose={() => {}} />);

    fireEvent.change(
      screen.getByPlaceholderText("https://mail.example.com"),
      { target: { value: "https://mail.example.com" } },
    );
    // API key is the only password-type input in the connect form.
    const apiKey = document.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    fireEvent.change(apiKey, { target: { value: "secret-key" } });
    fireEvent.click(screen.getByText("Connect"));

    // The api_key is written to the OS vault, never into the config blob.
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "vault_store_secret",
        expect.objectContaining({ secret: "secret-key" }),
      ),
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "mailcow_connect",
        expect.objectContaining({
          config: expect.objectContaining({
            base_url: "https://mail.example.com",
            api_key: "secret-key",
          }),
        }),
      ),
    );
  });
});
