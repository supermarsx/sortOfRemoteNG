import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../src/types/connection/connection";

const fixture = vi.hoisted(() => ({
  sessions: [] as ConnectionSession[],
  settings: { openToolInBackground: false },
  dispatch: vi.fn(),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { sessions: fixture.sessions },
    dispatch: fixture.dispatch,
  }),
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({ getSettings: () => fixture.settings }),
  },
}));
import { useIconExplorerSession } from "../../src/hooks/icons/useIconExplorerSession";
import { useTrustCenterSession } from "../../src/hooks/security/useTrustCenterSession";
import {
  createIconExplorerSession,
  createTrustCenterSession,
  createToolSession,
} from "../../src/components/app/toolSession";
import { activateNewToolTab } from "../../src/utils/session/activateNewToolTab";

beforeEach(() => {
  fixture.sessions = [];
  fixture.settings = { openToolInBackground: false };
  fixture.dispatch.mockReset();
});

describe.each([
  ["Icon Explorer", useIconExplorerSession, createIconExplorerSession],
  ["Trust Center", useTrustCenterSession, createTrustCenterSession],
] as const)("%s opening focus", (_name, useOpen, createSession) => {
  it("reads live settings from the same mounted opener", () => {
    const activate = vi.fn();
    const { result, rerender } = renderHook(() => useOpen(activate));
    const open = result.current;
    fixture.settings = { openToolInBackground: true };
    act(() => open());
    expect(fixture.dispatch).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
    // Close the tab, then change the setting without rebuilding the opener.
    fixture.sessions = [];
    rerender();
    expect(result.current).toBe(open);
    fixture.settings = { openToolInBackground: false };
    act(() => open());
    expect(activate).toHaveBeenCalledExactlyOnceWith(createSession().id);
  });

  it("focuses an existing tab even when new tabs open in the background", () => {
    fixture.settings = { openToolInBackground: true };
    fixture.sessions = [createSession()];
    const activate = vi.fn();
    const { result } = renderHook(() => useOpen(activate));
    act(() => result.current());
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledExactlyOnceWith(fixture.sessions[0].id);
  });
});

it("reads changed preferences from a retained toolbar setter", () => {
  const activate = vi.fn();
  const session = createToolSession("settings");
  const setter = () => activateNewToolTab(session, activate);
  setter();
  fixture.settings.openToolInBackground = true;
  setter();
  expect(activate).toHaveBeenCalledTimes(1);
  fixture.settings.openToolInBackground = false;
  setter();
  expect(activate).toHaveBeenCalledTimes(2);
});
