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
    // Resolves from the latest stored library at call time.
    readEntry: async (kind: "script" | "macro", id: string) =>
      (kind === "script" ? mocks.scripts : mocks.macros).find(
        (entry) => (entry as { id: string }).id === id,
      ),
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

  it("runs the latest edited script body, not a copy captured earlier", async () => {
    const send = vi.fn(async (_text: string) => {});
    render(<SerialScriptBar session={session} connected send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Scripts" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Add Show version to favorites" }),
    );
    fireEvent.change(
      screen.getByLabelText("Delay between lines in milliseconds"),
      { target: { value: "0" } },
    );
    // The script is edited in the manager after the bar rendered.
    mocks.scripts = [{ ...script, script: "#!/bin/sh\nshow clock\n" }];
    fireEvent.click(screen.getByTestId("serial-favorite"));
    const review = await screen.findByTestId("serial-script-review");
    expect(review).toHaveTextContent("show clock");
    expect(review).not.toHaveTextContent("show version");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toBe("show clock\n");
  });

  it("reorders serial favorites by drag and by Alt+Arrow, persisting immediately", async () => {
    mocks.scripts = [
      script,
      { ...script, id: "sc2", name: "Show clock" },
      { ...script, id: "sc3", name: "Show users" },
    ];
    render(<SerialScriptBar session={session} connected send={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Scripts" }));
    for (const name of ["Show version", "Show clock", "Show users"])
      fireEvent.click(
        screen.getByRole("button", { name: `Add ${name} to favorites` }),
      );
    const names = () =>
      screen.getAllByTestId("serial-favorite").map((el) => el.textContent);
    expect(names()).toEqual(["Show version", "Show clock", "Show users"]);
    // Keyboard: Alt+ArrowRight moves the first chip later.
    fireEvent.keyDown(screen.getAllByTestId("serial-favorite")[0], {
      key: "ArrowRight",
      altKey: true,
    });
    expect(names()).toEqual(["Show clock", "Show version", "Show users"]);
    // Drag: last chip dropped before the first.
    const chips = screen.getAllByTestId("serial-favorite");
    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragStart(chips[2], { dataTransfer });
    fireEvent.dragOver(chips[0], { dataTransfer, clientX: 0 });
    expect(chips[0]).toHaveAttribute("data-drop-position", "before");
    fireEvent.drop(chips[0], { dataTransfer, clientX: 0 });
    expect(names()).toEqual(["Show users", "Show clock", "Show version"]);
    const stored = JSON.parse(
      window.localStorage.getItem("sorng.serial.favorites.v1")!,
    );
    expect(Object.values(stored)[0]).toEqual([
      { kind: "script", id: "sc3" },
      { kind: "script", id: "sc2" },
      { kind: "script", id: "sc1" },
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
    const sendButton = await screen.findByRole("button", { name: "Send" });
    await act(async () => {
      fireEvent.click(sendButton);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("changed");
    expect(send).not.toHaveBeenCalled();
  });
});
