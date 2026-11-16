import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SettingsProvider,
  useSettings,
} from "../../src/contexts/SettingsContext";
import { useSettingsSelector } from "../../src/contexts/useSettingsSelector";
import { SettingsManager } from "../../src/utils/settings/settingsManager";

vi.unmock("../../src/contexts/SettingsContext");
const mocks = vi.hoisted(() => ({
  stored: {} as Record<string, unknown>,
  invoke: vi.fn(),
  invokeCounts: {} as Record<string, number>,
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => mocks.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
  emit: async () => {},
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "fixture" }),
}));

const renders = { legacy: 0, selector: 0, selectorOwn: 0 };
let update: ((u: Record<string, unknown>) => Promise<void>) | null = null;
const CONSUMERS = 40;

function LegacyConsumer() {
  const { settings, updateSettings } = useSettings();
  update = updateSettings as typeof update;
  renders.legacy++;
  void settings.folderIconColorMode;
  return null;
}

function SelectorConsumer() {
  useSettingsSelector((ctx) => ctx.settings.folderIconColorMode);
  renders.selector++;
  return null;
}

function OwnKeyConsumer() {
  const w = useSettingsSelector((ctx) => ctx.settings.sidebarWidth);
  renders.selectorOwn++;
  void w;
  return null;
}

beforeEach(() => {
  renders.selector = 0;
  renders.selectorOwn = 0;
  SettingsManager.resetInstance();
  renders.legacy = 0;
  mocks.invokeCounts = {};
  mocks.stored = { animationDuration: 0 };
  mocks.invoke.mockImplementation(async (command: string, args?: any) => {
    mocks.invokeCounts[command] = (mocks.invokeCounts[command] ?? 0) + 1;
    if (command === "read_app_settings") return structuredClone(mocks.stored);
    if (command === "write_app_settings") {
      mocks.stored = { ...mocks.stored, ...args?.patch };
      return 1;
    }
    return null;
  });
});
afterEach(cleanup);

describe("A1 baseline: settings consumer render counts", () => {
  it("records renders for an unrelated settings change (legacy useSettings)", async () => {
    render(
      <SettingsProvider>
        {Array.from({ length: CONSUMERS }, (_, i) => (
          <LegacyConsumer key={i} />
        ))}
      </SettingsProvider>,
    );
    await waitFor(() => expect(mocks.invokeCounts.read_app_settings).toBe(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const before = renders.legacy;
    await act(async () => {
      await update!({ sidebarWidth: 333 });
    });
    const delta = renders.legacy - before;
    process.stderr.write(
      `A1_BASELINE legacy consumers=${CONSUMERS} mountRenders=${before} renders-per-unrelated-change=${delta} invokes=${JSON.stringify(mocks.invokeCounts)}
`,
    );
    expect(delta).toBeGreaterThan(0);
  });

  it("selector consumers skip unrelated changes and see their own", async () => {
    render(
      <SettingsProvider>
        <LegacyConsumer />
        {Array.from({ length: CONSUMERS }, (_, i) => (
          <SelectorConsumer key={i} />
        ))}
        <OwnKeyConsumer />
      </SettingsProvider>,
    );
    await waitFor(() => expect(mocks.invokeCounts.read_app_settings).toBe(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const before = renders.selector;
    const ownBefore = renders.selectorOwn;
    await act(async () => {
      await update!({ theme: "light" });
    });
    const delta = renders.selector - before;
    process.stderr.write(
      `A1_AFTER selector consumers=${CONSUMERS} mountRenders=${before} renders-per-unrelated-change=${delta}
`,
    );
    expect(delta).toBe(0);
    expect(renders.selectorOwn).toBe(ownBefore);
    await act(async () => {
      await update!({ sidebarWidth: 444 });
    });
    expect(renders.selectorOwn).toBe(ownBefore + 1);
    expect(renders.selector - before).toBe(0);
  });
});
