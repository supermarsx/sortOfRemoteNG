import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../../types/connection/connection";

const mocks = vi.hoisted(() => ({
  settings: {
    sessionQuickActions: {
      serialEnabled: true,
      confirmBeforeScriptRun: true,
    } as Record<string, boolean>,
  },
  scripts: [] as unknown[],
  macros: [] as unknown[],
  assertReviewed: vi.fn(async () => {}),
}));

vi.mock("../../../contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: mocks.settings }),
}));
vi.mock("../../../hooks/recording/useTerminalAppLibrary", () => ({
  useTerminalAppLibrary: () => ({
    available: true,
    error: null,
    scripts: mocks.scripts,
    macros: mocks.macros,
    refresh: vi.fn(),
    reviewScript: () => mocks.assertReviewed,
    reviewMacro: () => mocks.assertReviewed,
  }),
}));
vi.mock("../../../utils/session/runtimeConnectionRegistry", () => ({
  getQuickConnectConnection: () => undefined,
}));

import { SerialScriptBar } from "./SerialScriptBar";

const session = {
  id: "s",
  connectionId: "saved-1",
  protocol: "serial",
  hostname: "COM3",
} as ConnectionSession;

const script = {
  id: "sc1",
  name: "Show version",
  description: "",
  script: "#!/bin/sh\nshow version\nshow ip int brief\n",
  language: "sh",
  category: "x",
  osTags: [],
  createdAt: "",
  updatedAt: "",
};

beforeEach(() => {
  window.localStorage.clear();
  mocks.settings.sessionQuickActions = {
    serialEnabled: true,
    confirmBeforeScriptRun: true,
  };
  mocks.scripts = [script];
  mocks.macros = [];
  mocks.assertReviewed.mockReset();
  mocks.assertReviewed.mockResolvedValue(undefined);
});

describe("SerialScriptBar", () => {
  it("renders nothing when serial quick actions are disabled", () => {
    mocks.settings.sessionQuickActions.serialEnabled = false;
    const { container } = render(
      <SerialScriptBar session={session} connected send={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("favorites a script, shows it as a chip, and persists identifier-only", () => {
    render(<SerialScriptBar session={session} connected send={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Scripts" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Add Show version to favorites" }),
    );
    expect(screen.getByTestId("serial-favorite")).toHaveTextContent(
      "Show version",
    );
    const stored = window.localStorage.getItem("sorng.serial.favorites.v1");
    expect(stored).toContain("sc1");
    expect(stored).not.toContain("show version");
  });

  it("requires review, re-verifies the library entry, then sends paced lines", async () => {
    const send = vi.fn(async (_text: string) => {});
    render(<SerialScriptBar session={session} connected send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Scripts" }));
    fireEvent.change(
      screen.getByLabelText("Delay between lines in milliseconds"),
      { target: { value: "0" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Run Show version" }));

    const review = await screen.findByTestId("serial-script-review");
    expect(review).toHaveTextContent("show version");
    expect(send).not.toHaveBeenCalled();
    expect(mocks.assertReviewed).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(mocks.assertReviewed).toHaveBeenCalledOnce();
    expect(send.mock.calls.map((call) => call[0])).toEqual([
      "show version\n",
      "show ip int brief\n",
    ]);
  });

  it("sends nothing when the review is cancelled or the library changed", async () => {
    const send = vi.fn(async (_text: string) => {});
    render(<SerialScriptBar session={session} connected send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Scripts" }));
    fireEvent.click(screen.getByRole("button", { name: "Run Show version" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(send).not.toHaveBeenCalled();

    mocks.assertReviewed.mockRejectedValueOnce(
      new Error("The saved script changed."),
    );
    fireEvent.click(screen.getByRole("button", { name: "Run Show version" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Send" }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("changed");
    expect(send).not.toHaveBeenCalled();
  });
});
