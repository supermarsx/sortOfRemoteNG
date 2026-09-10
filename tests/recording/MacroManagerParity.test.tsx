import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MacroManager from "../../src/components/recording/MacroManager";
import { MacroEditor } from "../../src/components/recording/MacroEditor";
import { bundledMacroCatalog } from "../../src/data/bundledMacroCatalog";
import { normalizeAutomationEntry } from "../../src/utils/recording/automationLibraryValidation";
import type {
  AutomationEntry,
  AutomationLibrarySnapshot,
  AutomationLibraryChange,
  AutomationScope,
} from "../../src/types/recording/automationLibrary";
const h = vi.hoisted(() => ({
  read: vi.fn(),
  apply: vi.fn(),
  ready: true,
  diagnostic: null as null | {
    code: string;
    message: string;
    retryable: boolean;
  },
  retry: vi.fn(),
  recordings: vi.fn(),
  saveRecording: vi.fn(),
}));
vi.mock("../../src/hooks/recording/useAutomationLibraryApi", () => ({
  useAutomationLibraryApi: () => ({
    api: { read: h.read, apply: h.apply },
    ready: h.ready,
    diagnostic: h.diagnostic,
    retry: h.retry,
    settingsReady: true,
    accessEpoch: 1,
    databaseScope: { databaseId: "db-fixture", generation: 1 },
  }),
}));
vi.mock("../../src/utils/recording/macroService", () => ({
  loadRecordings: h.recordings,
  saveRecording: h.saveRecording,
  deleteRecording: vi.fn(),
  exportRecording: vi.fn(),
}));
vi.mock(
  "../../src/components/recording/scriptManager/RepositoryCatalogPanel",
  () => ({
    default: ({
      family,
      scope,
    }: {
      family: string;
      scope: AutomationScope;
    }) => (
      <section aria-label="Repository catalog fixture">
        {family} → {scope.kind}
      </section>
    ),
  }),
);
const terminal = structuredClone(bundledMacroCatalog[0]);
terminal.payload.id = "saved";
terminal.payload.name = "Saved sequence";
const web: AutomationEntry<"website-macro"> = {
  family: "website-macro",
  payload: {
    id: "web",
    kind: "macro",
    name: "Public filter",
    description: "Recorded layout",
    createdAt: "2026-09-01",
    updatedAt: "2026-09-01",
    steps: [
      { kind: "fill", selector: "html > body > input:nth-of-type(1)" },
      {
        kind: "check",
        selector: "html > body > input:nth-of-type(2)",
        checked: true,
      },
    ],
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  h.ready = true;
  h.diagnostic = null;
  h.recordings.mockResolvedValue([]);
  h.saveRecording.mockResolvedValue(undefined);
  h.read.mockImplementation(async (scope, family) => ({
    scope,
    family,
    receipt: crypto.randomUUID(),
    entries:
      scope.kind === "database"
        ? []
        : [structuredClone(family === "terminal-macro" ? terminal : web)],
  }));
  h.apply.mockImplementation(
    async (
      snapshot: AutomationLibrarySnapshot,
      changes: AutomationLibraryChange[],
    ) => ({
      ...snapshot,
      entries: changes.flatMap((change) =>
        change.operation === "put" ? [change.entry] : [],
      ),
      receipt: "saved",
    }),
  );
});
const mount = () => render(<MacroManager isOpen onClose={vi.fn()} />);
describe("Macro Manager parity", () => {
  it("searches platform filters and preserves user-assigned distro tags in the macro editor", async () => {
    const entry = {
      ...structuredClone(terminal),
      provenance: { platforms: ["ubuntu"] },
    };
    h.read.mockImplementation(async (scope, family) => ({
      scope,
      family,
      receipt: "platform-review",
      entries: [entry],
    }));
    mount();
    await screen.findByRole("button", { name: /Saved sequence/ });
    fireEvent.click(screen.getByRole("combobox", { name: "Macro platform" }));
    fireEvent.change(screen.getByPlaceholderText("Search platforms…"), {
      target: { value: "Ubuntu" },
    });
    fireEvent.mouseDown(screen.getByRole("option", { name: "Ubuntu" }));
    fireEvent.click(screen.getByRole("button", { name: /Saved sequence/ }));
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search platform tags" }),
      { target: { value: "CentOS" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "CentOS / CentOS Stream" }),
    );
    expect(screen.getByText(/2 selected/)).toBeInTheDocument();
    expect(h.apply).not.toHaveBeenCalled();
  });
  it("renders scoped searchable macros with vector platform tags and compact filters", async () => {
    mount();
    await screen.findByRole("button", { name: /Saved sequence/ });
    expect(
      screen.getByRole("combobox", { name: "Macro library scope" }).style.width,
    ).toBe("auto");
    expect(screen.getByRole("combobox", { name: "Category" }).style.width).toBe(
      "auto",
    );
    expect(
      within(screen.getByRole("region", { name: "Saved macros" }))
        .getByText("Linux")
        .querySelector("svg"),
    ).not.toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Search macros" }), {
      target: { value: "missing" },
    });
    expect(screen.getByText("No macros match these filters.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("button", { name: /Saved sequence/ })).toBeTruthy();
  });
  it("requires discard before scope change and loads an empty database without app fallback", async () => {
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: /Saved sequence/ }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Draft" },
    });
    fireEvent.change(
      screen.getByRole("combobox", { name: "Macro library scope" }),
      { target: { value: "db-fixture" } },
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(h.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await screen.findByText(
      "No macros in this scope. Create one or browse templates.",
    );
    expect(h.read).toHaveBeenCalledWith(
      { kind: "database", databaseId: "db-fixture" },
      "terminal-macro",
    );
  });
  it("edits website fill/check steps without any persisted input value control", async () => {
    mount();
    await screen.findByRole("button", { name: /Saved sequence/ });
    fireEvent.click(screen.getByRole("tab", { name: "Website macros" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Public filter/ }),
    );
    expect(
      screen.getByText("No input value is stored in this macro."),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/fill value|password|OTP code/i)).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Structural selector 1" }),
    ).toHaveValue(web.payload.steps[0].selector);
    fireEvent.click(screen.getByRole("button", { name: "Save macro" }));
    await waitFor(() => expect(h.apply).toHaveBeenCalledOnce());
    expect(h.apply.mock.calls[0][1][0].entry.payload.steps).toEqual(
      web.payload.steps,
    );
  });
  it("browses native macro templates and creates a reviewed copy, without saving/executing", async () => {
    mount();
    await screen.findByRole("button", { name: /Saved sequence/ });
    fireEvent.click(screen.getByRole("tab", { name: "Browse macros" }));
    await screen.findByRole("region", { name: "Repository catalog fixture" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Use copy as draft" })[0],
    );
    expect(
      screen.getByRole("tab", { name: "Terminal macros" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      bundledMacroCatalog[0].payload.name,
    );
    expect(h.apply).not.toHaveBeenCalled();
  });
  it("shows an app-wide listener failure with explicit retry, not database guidance", async () => {
    h.ready = false;
    h.diagnostic = {
      code: "backend-unavailable",
      message: "The desktop access listener is unavailable.",
      retryable: true,
    };
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "desktop access listener",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("owning database");
    fireEvent.click(
      screen.getByRole("button", { name: "Retry library access" }),
    );
    expect(h.retry).toHaveBeenCalledOnce();
    expect(h.read).not.toHaveBeenCalled();
    await act(async () => {});
  });
  it("keeps recording rename draft on failed save", async () => {
    h.recordings.mockResolvedValue([
      {
        id: "r",
        name: "Session",
        savedAt: "2026-09-01",
        recording: {
          metadata: { host: "fixture", duration_ms: 10, entry_count: 1 },
        },
      },
    ]);
    h.saveRecording.mockRejectedValue(new Error("Failed"));
    mount();
    await screen.findByRole("button", { name: /Saved sequence/ });
    fireEvent.click(screen.getByRole("tab", { name: "Recordings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Recording name" }), {
      target: { value: "Retain me" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await screen.findByText(/recording name could not be saved/);
    expect(screen.getByRole("textbox", { name: "Recording name" })).toHaveValue(
      "Retain me",
    );
  });
  it("preserves command/delay/Enter association when reordering sequence steps", () => {
    const save = vi.fn();
    function Harness() {
      const [macro, setMacro] = useState({
        ...terminal.payload,
        steps: [
          { command: "first", delayMs: 123, sendNewline: false },
          { command: "second", delayMs: 456, sendNewline: true },
        ],
      });
      return (
        <MacroEditor
          macro={macro}
          onChange={setMacro}
          onSave={save}
          onDelete={vi.fn()}
          onDuplicate={vi.fn()}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Move step 2 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save macro" }));
    expect(save.mock.calls[0][0].steps).toEqual([
      { command: "second", delayMs: 456, sendNewline: true },
      { command: "first", delayMs: 123, sendNewline: false },
    ]);
  });
  it("validates all original app-shipped diagnostic macro payloads", () => {
    expect(
      new Set(bundledMacroCatalog.map((entry) => entry.payload.id)).size,
    ).toBe(4);
    for (const entry of bundledMacroCatalog)
      expect(normalizeAutomationEntry(entry)).toEqual(entry);
  });
  it("retains comma typing in the tags field and saves separate normalized tags", () => {
    const save = vi.fn();
    function Harness() {
      const [macro, setMacro] = useState(terminal.payload);
      return (
        <MacroEditor
          macro={macro}
          onChange={setMacro}
          onSave={save}
          onDelete={vi.fn()}
          onDuplicate={vi.fn()}
        />
      );
    }
    render(<Harness />);
    const tags = screen.getByRole("textbox", {
      name: "Tags (comma-separated)",
    });
    fireEvent.change(tags, { target: { value: "first," } });
    expect(tags).toHaveValue("first,");
    fireEvent.change(tags, { target: { value: "first, second" } });
    fireEvent.click(screen.getByRole("button", { name: "Save macro" }));
    expect(save.mock.calls[0][0].tags).toEqual(["first", "second"]);
    expect(
      screen.getByRole("spinbutton", { name: "Step 1 delay" }).style.width,
    ).toBe("6rem");
  });
});
