import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { PromptHost } from "../../src/components/ui/dialogs/PromptHost";
import { resetPromptQueueForTests } from "../../src/utils/prompts/promptQueue";
import { openTerminalLink } from "../../src/utils/ssh/terminalLinks";
import { trustedClick } from "../helpers/trustedClick";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
  isTauri: () => true,
}));

beforeEach(() => {
  resetPromptQueueForTests();
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  resetPromptQueueForTests();
  vi.restoreAllMocks();
});

it("shows the actual OSC8 destination in the themed dialog and opens only after approval", async () => {
  render(<PromptHost />);
  const onError = vi.fn();
  let pending!: Promise<void>;
  act(() => {
    pending = openTerminalLink(
      "https://actual.test/path?q=fixture",
      "osc8",
      () => true,
      onError,
    );
  });
  expect(
    screen.getByRole("dialog", {
      name: "Open this terminal link in your browser?",
    }),
  ).toBeVisible();
  expect(screen.getByText("https://actual.test/path?q=fixture")).toBeVisible();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus(),
  );
  expect(invoke).not.toHaveBeenCalled();
  trustedClick(screen.getByRole("button", { name: "Cancel" }));
  await pending;
  expect(invoke).not.toHaveBeenCalled();
  act(() => {
    pending = openTerminalLink(
      "https://actual.test/path?q=fixture",
      "osc8",
      () => true,
      onError,
    );
  });
  const now = performance.now();
  vi.spyOn(performance, "now").mockReturnValue(now + 500);
  trustedClick(screen.getByRole("button", { name: "Open link" }));
  await pending;
  expect(invoke).toHaveBeenCalledExactlyOnceWith("open_url_external", {
    url: "https://actual.test/path?q=fixture",
  });
  expect(window.confirm).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

it("dismisses a terminal owner's prompt on abort without opening the destination", async () => {
  render(<PromptHost />);
  const controller = new AbortController();
  let pending!: Promise<void>;
  act(() => {
    pending = openTerminalLink(
      "https://actual.test/",
      "osc8",
      () => true,
      vi.fn(),
      controller.signal,
    );
  });
  expect(screen.getByRole("dialog")).toBeVisible();
  act(() => controller.abort());
  await pending;
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(invoke).not.toHaveBeenCalled();
  expect(window.confirm).not.toHaveBeenCalled();
});
