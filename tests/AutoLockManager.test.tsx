import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoLockManager } from "../src/components/security/AutoLockManager";
import { SecureStorage } from "../src/utils/storage";
import { AutoLockConfig } from "../src/types/settings";

const renderAutoLock = (overrides?: Partial<AutoLockConfig>) => {
  const config: AutoLockConfig = {
    enabled: true,
    timeoutMinutes: 0,
    lockOnIdle: true,
    lockOnSuspend: true,
    requirePassword: false,
    ...overrides,
  };

  const onLock = vi.fn();
  render(
    <AutoLockManager
      config={config}
      onConfigChange={vi.fn()}
      onLock={onLock}
    />,
  );

  return { onLock };
};

describe("AutoLockManager", () => {
  afterEach(() => {
    vi.useRealTimers();
    SecureStorage.clearPassword();
  });

  it("locks and unlocks with click-only flow", () => {
    vi.useFakeTimers();
    const { onLock } = renderAutoLock({ requirePassword: false });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText("Session Locked")).toBeInTheDocument();
    expect(screen.getByTestId("auto-lock-modal")).toBeInTheDocument();
    expect(onLock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Click to Unlock" }));
    expect(screen.queryByText("Session Locked")).not.toBeInTheDocument();
  });

  it("unlocks with the configured storage password", () => {
    vi.useFakeTimers();
    SecureStorage.setPassword("secret");
    renderAutoLock({ requirePassword: true });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText("Session Locked")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Enter password to unlock"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(screen.queryByText("Session Locked")).not.toBeInTheDocument();
  });
});
