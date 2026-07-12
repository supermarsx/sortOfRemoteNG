import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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

import PhpRuntimeTab from "./PhpRuntimeTab";
import { phpRuntimeApi } from "../../../hooks/integration/php/usePhpRuntime";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
});

describe("phpRuntimeApi bindings", () => {
  it("binds all 43 runtime-category commands", () => {
    // 8 versions + 9 FPM pools + 13 process/service + 7 OPcache + 6 sessions.
    expect(Object.keys(phpRuntimeApi)).toHaveLength(43);
  });

  it("passes the connection id + version as invoke args", () => {
    phpRuntimeApi.getOpcacheStatus("conn-1", "8.3");
    expect(invokeMock).toHaveBeenCalledWith("php_get_opcache_status", {
      id: "conn-1",
      version: "8.3",
    });
  });

  it("camelCases the optional u64 param (max_age_secs)", () => {
    phpRuntimeApi.cleanupSessions("conn-1", "8.3", 3600);
    expect(invokeMock).toHaveBeenCalledWith("php_cleanup_sessions", {
      id: "conn-1",
      version: "8.3",
      maxAgeSecs: 3600,
    });
  });

  it("passes request-bearing commands through as `request` (not `req`)", () => {
    phpRuntimeApi.createFpmPool("conn-1", { name: "www", version: "8.3" });
    expect(invokeMock).toHaveBeenCalledWith("php_create_fpm_pool", {
      id: "conn-1",
      request: { name: "www", version: "8.3" },
    });
  });

  it("passes update_fpm_pool with version + name + request", () => {
    phpRuntimeApi.updateFpmPool("conn-1", "8.3", "www", { max_children: 10 });
    expect(invokeMock).toHaveBeenCalledWith("php_update_fpm_pool", {
      id: "conn-1",
      version: "8.3",
      name: "www",
      request: { max_children: 10 },
    });
  });

  it("passes update_opcache_config as `config`", () => {
    phpRuntimeApi.updateOpcacheConfig("conn-1", "8.3", { enable: true });
    expect(invokeMock).toHaveBeenCalledWith("php_update_opcache_config", {
      id: "conn-1",
      version: "8.3",
      config: { enable: true },
    });
  });
});

describe("PhpRuntimeTab", () => {
  it("fetches the version list on mount for its selector", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "php_list_versions")
        return Promise.resolve([
          { version: "8.3", major: 8, minor: 3, patch: 0, sapis: ["fpm"], binary_path: "/usr/bin/php8.3", is_default: true },
        ]);
      return Promise.resolve([]);
    });

    render(<PhpRuntimeTab connectionId="conn-1" />);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("php_list_versions", {
        id: "conn-1",
      }),
    );
    expect(await screen.findByText("PHP Versions")).toBeInTheDocument();
  });
});
