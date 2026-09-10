import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  WebAutomationControls,
  WebAutomationFavoriteChips,
} from "../../src/components/protocol/webBrowser/WebAutomationControls";
import type { useWebAutomation } from "../../src/hooks/protocol/useWebAutomation";
import type { BrowserScript } from "../../src/types/recording/webAutomation";

type Automation = ReturnType<typeof useWebAutomation>;
const script: BrowserScript = {
  kind: "script",
  id: "script",
  name: "Saved script",
  description: "Synthetic metadata",
  code: "// No execution in this fixture",
  createdAt: "2026-09-09",
  updatedAt: "2026-09-09",
};
function model(overrides: Partial<Automation> = {}): Automation {
  const value: Automation = {
    permissions: {
      showActionBar: true,
      interactionMacrosEnabled: true,
      scriptInjectionEnabled: false,
      forceDark: false,
      confirmBeforeScriptRun: true,
    },
    error: null,
    libraryReady: true,
    availableDatabaseScope: null,
    library: { version: 1, scripts: [script], macros: [] },
    allItems: [script],
    favorites: [],
    open: false,
    setOpen: vi.fn(),
    openLibrary: vi.fn(),
    libraryKind: undefined,
    busy: false,
    saving: false,
    recording: false,
    recordingScopeKey: "database-a:lease-1:connection:http",
    recordingPending: false,
    recordingUnavailableReason: null,
    canEnableMacroRecording: false,
    enableMacroRecording: vi.fn().mockResolvedValue(true),
    discardRecording: vi.fn(),
    steps: [],
    startRecording: vi.fn().mockResolvedValue(true),
    stopRecording: vi.fn().mockResolvedValue(undefined),
    requestRun: vi.fn(),
    pendingRun: null,
    setPendingRun: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
    reload: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
    favorite: vi.fn().mockResolvedValue(undefined),
    recordedMacro: (name) => ({
      kind: "macro",
      id: "capture",
      name,
      description: "Unsaved recording",
      steps: value.steps,
      createdAt: "2026-09-09",
      updatedAt: "2026-09-09",
    }),
    clearSteps: vi.fn(),
    valuePrompt: null,
    answerValue: vi.fn(),
    pageReady: true,
    ...overrides,
  };
  return value;
}
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const captured = () => [
  { kind: "click" as const, selector: "html > body > button" },
];

describe("visible website macro recording facilities", () => {
  it("dismisses favorite menus when bookmark menus open, and refuses unavailable management", () => {
    const actions = model({ favorites: [script] });
    const opened = vi.fn();
    const view = render(
      <WebAutomationFavoriteChips
        automation={actions}
        onContextMenuOpen={opened}
      />,
    );
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Saved script" }).parentElement!,
    );
    expect(opened).toHaveBeenCalledOnce();
    expect(
      screen.getByTestId("web-automation-favorite-menu"),
    ).toBeInTheDocument();
    view.rerender(
      <WebAutomationFavoriteChips automation={actions} otherMenuOpen />,
    );
    expect(
      screen.queryByTestId("web-automation-favorite-menu"),
    ).not.toBeInTheDocument();
    view.rerender(
      <WebAutomationFavoriteChips
        automation={{ ...actions, libraryReady: false }}
      />,
    );
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Saved script" }).parentElement!,
    );
    expect(
      screen.queryByTestId("web-automation-favorite-menu"),
    ).not.toBeInTheDocument();
    expect(actions.openLibrary).not.toHaveBeenCalled();
  });
  it("defaults new items to app storage and requires explicit database destination selection", async () => {
    const actions = model({
      open: true,
      availableDatabaseScope: { kind: "database", databaseId: "database-a" },
    });
    render(<WebAutomationControls automation={actions} />);
    click("New JavaScript");
    expect(screen.getByLabelText("Saved item destination")).toHaveValue("app");
    expect(
      screen.getByRole("button", { name: "Run JavaScript" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Saved item destination"), {
      target: { value: "database" },
    });
    click("Save script");
    await waitFor(() => expect(actions.save).toHaveBeenCalledOnce());
    expect(vi.mocked(actions.save).mock.calls[0][0]).toMatchObject({
      kind: "script",
      scope: { kind: "database", databaseId: "database-a" },
    });
    expect(actions.execute).not.toHaveBeenCalled();
  });
  it("requires explicit consent and a separate manual Record click; enabling never starts or runs", async () => {
    const actions = model({ canEnableMacroRecording: true });
    actions.permissions!.interactionMacrosEnabled = false;
    const view = render(<WebAutomationControls automation={actions} />);
    expect(actions.startRecording).not.toHaveBeenCalled();
    click("Record macro");
    expect(
      screen.getByText(/does not enable JavaScript injection/),
    ).toBeInTheDocument();
    expect(actions.enableMacroRecording).not.toHaveBeenCalled();
    click("Enable website macros");
    expect(actions.enableMacroRecording).toHaveBeenCalledOnce();
    expect(actions.startRecording).not.toHaveBeenCalled();
    expect(actions.execute).not.toHaveBeenCalled();
    actions.permissions!.interactionMacrosEnabled = true;
    actions.canEnableMacroRecording = false;
    view.rerender(<WebAutomationControls automation={actions} />);
    click("Record macro");
    await waitFor(() => expect(actions.startRecording).toHaveBeenCalledOnce());
  });
  it("respects the hidden action bar while retaining Stop or Review for an unsaved capture", () => {
    const actions = model({ favorites: [script] });
    actions.permissions!.showActionBar = false;
    const view = render(<WebAutomationControls automation={actions} />);
    expect(screen.queryByRole("button", { name: "Record macro" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Saved script" })).toBeNull();
    view.rerender(
      <WebAutomationControls
        automation={{ ...actions, recording: true, steps: captured() }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Stop recording and review macro" }),
    ).toBeEnabled();
    view.rerender(
      <WebAutomationControls automation={{ ...actions, steps: captured() }} />,
    );
    expect(
      screen.getByRole("button", { name: "Review 1 steps" }),
    ).toBeEnabled();
  });
  it.each([
    "Website macros are disabled in global settings.",
    "Unlock the owning database.",
    "Wait for the current page to become ready.",
  ])("shows the actionable unavailable reason: %s", (reason) => {
    const actions = model({ recordingUnavailableReason: reason });
    render(<WebAutomationControls automation={actions} />);
    expect(screen.getByRole("status")).toHaveTextContent(reason);
    expect(screen.getByRole("button", { name: "Record macro" })).toBeDisabled();
    expect(actions.startRecording).not.toHaveBeenCalled();
  });
  it("shows the active count and Stop & review; pending transitions prevent repeat requests", () => {
    const actions = model({ recording: true, steps: captured() });
    const view = render(<WebAutomationControls automation={actions} />);
    expect(screen.getByText("Stop & review · 1")).toBeInTheDocument();
    click("Stop recording and review macro");
    expect(actions.stopRecording).toHaveBeenCalledOnce();
    view.rerender(
      <WebAutomationControls
        automation={{ ...actions, recordingPending: true }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Stop recording and review macro" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Discard unsaved recording" }),
    ).toBeDisabled();
  });
  it("keeps stopped steps reviewable and requires confirmation to discard without deleting saved macros", () => {
    const actions = model({
      steps: captured(),
      pageReady: false,
      recordingUnavailableReason: "Navigation stopped the recording.",
    });
    render(<WebAutomationControls automation={actions} />);
    click("Review 1 steps");
    expect(actions.setOpen).toHaveBeenCalledWith(true);
    click("Discard unsaved recording");
    click("Cancel");
    expect(actions.discardRecording).not.toHaveBeenCalled();
    click("Discard unsaved recording");
    click("Discard recording");
    expect(actions.discardRecording).toHaveBeenCalledOnce();
    expect(actions.remove).not.toHaveBeenCalled();
    expect(actions.startRecording).not.toHaveBeenCalled();
  });
  it("offers Record new macro in the library and closes only after a successful start acknowledgement", async () => {
    const actions = model({ open: true });
    vi.mocked(actions.startRecording).mockResolvedValueOnce(false);
    render(<WebAutomationControls automation={actions} />);
    click("Record new macro");
    await waitFor(() => expect(actions.startRecording).toHaveBeenCalledOnce());
    expect(actions.setOpen).not.toHaveBeenCalledWith(false);
    click("Record new macro");
    await waitFor(() => expect(actions.setOpen).toHaveBeenCalledWith(false));
    expect(actions.execute).not.toHaveBeenCalled();
  });
  it("protects a captured draft on selection and never clears its steps while saving an unrelated script", async () => {
    const actions = model({ open: true, steps: captured() });
    render(<WebAutomationControls automation={actions} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Important draft" },
    });
    click("JS · Saved script · App-wide");
    click("Cancel");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Important draft",
    );
    click("JS · Saved script · App-wide");
    click("Leave draft");
    click("Save script");
    await waitFor(() => expect(actions.save).toHaveBeenCalledOnce());
    expect(actions.clearSteps).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Review captured 1 steps" }),
    ).toBeInTheDocument();
  });
  it("confirms both unsaved draft loss and replacement before recording a new macro", async () => {
    const actions = model({ open: true, steps: captured() });
    render(<WebAutomationControls automation={actions} />);
    click("Record new macro");
    expect(actions.startRecording).not.toHaveBeenCalled();
    click("Leave draft");
    expect(actions.discardRecording).not.toHaveBeenCalled();
    click("Discard and record new");
    expect(actions.discardRecording).toHaveBeenCalledOnce();
    await waitFor(() => expect(actions.startRecording).toHaveBeenCalledOnce());
    expect(actions.execute).not.toHaveBeenCalled();
  });
  it("retains the captured draft after a save failure and warns before closing it", async () => {
    const actions = model({ open: true, steps: captured() });
    vi.mocked(actions.save).mockResolvedValue(false);
    render(<WebAutomationControls automation={actions} />);
    click("Save macro");
    await waitFor(() => expect(actions.save).toHaveBeenCalledOnce());
    expect(actions.clearSteps).not.toHaveBeenCalled();
    click("Close library");
    click("Cancel");
    expect(actions.setOpen).not.toHaveBeenCalledWith(false);
    expect(screen.getByText("1 value-free steps")).toBeInTheDocument();
  });
  it("dismisses pending consent when access is lost", () => {
    const actions = model({ canEnableMacroRecording: true });
    actions.permissions!.interactionMacrosEnabled = false;
    const view = render(<WebAutomationControls automation={actions} />);
    click("Record macro");
    view.rerender(
      <WebAutomationControls
        automation={{
          ...actions,
          libraryReady: false,
          canEnableMacroRecording: false,
          recordingUnavailableReason: "Owning database locked.",
        }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Enable website macros" }),
    ).toBeNull();
    expect(actions.enableMacroRecording).not.toHaveBeenCalled();
  });
  it.each(["enable", "discard", "replace"] as const)(
    "cancels a reviewed %s action when the owning connection scope changes",
    (action) => {
      const actions = model({
        canEnableMacroRecording: action === "enable",
        open: action === "replace",
        steps: action === "enable" ? [] : captured(),
      });
      actions.permissions!.interactionMacrosEnabled = action !== "enable";
      const view = render(<WebAutomationControls automation={actions} />);
      if (action === "enable") click("Record macro");
      else if (action === "discard") click("Discard unsaved recording");
      else {
        click("Record new macro");
        click("Leave draft");
      }
      expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
      view.rerender(
        <WebAutomationControls
          automation={{
            ...actions,
            recordingScopeKey: "database-b:lease-2:connection:http",
            open: false,
          }}
        />,
      );
      expect(screen.queryByTestId("confirm-dialog")).toBeNull();
      expect(actions.enableMacroRecording).not.toHaveBeenCalled();
      expect(actions.discardRecording).not.toHaveBeenCalled();
      expect(actions.startRecording).not.toHaveBeenCalled();
    },
  );
  it("allows explicit consent retry despite a failed-save reason without starting anything", () => {
    const actions = model({
      canEnableMacroRecording: true,
      recordingUnavailableReason:
        "Macro permission could not be confirmed saved. Retry enablement.",
    });
    actions.permissions!.interactionMacrosEnabled = false;
    render(<WebAutomationControls automation={actions} />);
    click("Record macro");
    click("Enable website macros");
    expect(actions.enableMacroRecording).toHaveBeenCalledOnce();
    expect(actions.startRecording).not.toHaveBeenCalled();
  });
});
