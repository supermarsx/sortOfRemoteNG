import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepositoryCatalogPanel from "../../src/components/recording/scriptManager/RepositoryCatalogPanel";
import type {
  AutomationEntry,
  AutomationFamily,
  AutomationLibraryApi,
  AutomationLibrarySnapshot,
} from "../../src/types/recording/automationLibrary";
import {
  catalogFromFile,
  exportAutomationCatalog,
  parseAutomationCatalog,
} from "../../src/utils/recording/automationCatalog";
const h = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn(), write: vi.fn() }));
vi.mock("../../src/utils/recording/automationCatalog", async (original) => ({
  ...(await original<
    typeof import("../../src/utils/recording/automationCatalog")
  >()),
  fetchAutomationCatalog: h.fetch,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: h.save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: h.write }));
vi.mock("../../src/components/ui/editor/ScriptCodeEditor", () => ({
  default: ({ code, ariaLabel }: { code: string; ariaLabel: string }) => (
    <pre aria-label={ariaLabel}>{code}</pre>
  ),
}));
const meta = {
  id: "fixture",
  name: "Public diagnostic",
  description: "Read-only example",
  createdAt: "2026-09-10T10:00:00Z",
  updatedAt: "2026-09-10T10:00:00Z",
};
const entries: AutomationEntry[] = [
  {
    family: "website-script",
    payload: { ...meta, kind: "script", code: "document.title" },
  },
  {
    family: "terminal-macro",
    payload: {
      ...meta,
      name: "Diagnostic macro",
      steps: [{ command: "uname -a", delayMs: 0, sendNewline: true }],
    },
  },
];
beforeEach(async () => {
  vi.clearAllMocks();
  const document = await catalogFromFile(
    exportAutomationCatalog({ name: "Public sample package", entries }),
  );
  document.source = {
    ...document.source,
    kind: "remote",
    url: "https://example.com/index.json",
  };
  document.manifest.publisher = { name: "Claimed publisher" };
  h.fetch.mockResolvedValue(document);
  h.save.mockResolvedValue("fixture-export.json");
  h.write.mockResolvedValue(undefined);
});
function mount(family: AutomationFamily = "website-script") {
  const snapshot: AutomationLibrarySnapshot = {
    scope: { kind: "app" },
    family,
    receipt: "fixture-receipt",
    entries: entries.filter((entry) => entry.family === family),
  };
  const read = vi.fn(async () => snapshot),
    apply = vi.fn(async () => snapshot),
    onApplied = vi.fn();
  const api = { read, apply } as AutomationLibraryApi;
  const props = {
    api,
    scope: snapshot.scope,
    family,
    enabled: true,
    accessKey: "epoch-1",
    onApplied,
  };
  return {
    ...render(<RepositoryCatalogPanel {...props} />),
    props,
    read,
    apply,
    onApplied,
  };
}
async function refresh() {
  fireEvent.change(screen.getByLabelText("Catalog link (raw HTTPS JSON)"), {
    target: { value: "https://example.com/index.json" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh source" }));
  await screen.findByText("Public sample package");
}
describe("repository catalog review UI", () => {
  it("only fetches on request, shows unverified provenance and source, then requires explicit conflict review", async () => {
    const view = mount();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(view.read).not.toHaveBeenCalled();
    expect(screen.getByText(/No hand-written manifest/)).toBeInTheDocument();
    await refresh();
    expect(
      screen.getByRole("img", { name: "Third-party source" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Third-party source" }),
    ).toHaveAttribute(
      "data-tooltip",
      expect.stringContaining("not independently verified"),
    );
    expect(
      screen.queryByRole("img", { name: "Verified app template" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Publisher claim: Claimed publisher"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Diagnostic macro")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Public diagnostic/ }));
    expect(screen.getByLabelText("Catalog script source")).toHaveTextContent(
      "document.title",
    );
    fireEvent.click(screen.getByLabelText("Select Public diagnostic"));
    fireEvent.click(screen.getByRole("button", { name: /Review 1 selected/ }));
    await screen.findByLabelText("Import choice for Public diagnostic");
    expect(view.apply).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Apply reviewed choices" }),
    ).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText("Import choice for Public diagnostic"),
      { target: { value: "replace" } },
    );
    expect(
      screen.getByRole("button", { name: "Apply reviewed choices" }),
    ).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Apply reviewed choices" }),
    );
    await waitFor(() => expect(view.onApplied).toHaveBeenCalledOnce());
    expect(view.apply).toHaveBeenCalledOnce();
  });
  it("previews native macro steps without converting them to executable scripts", async () => {
    mount("terminal-macro");
    await refresh();
    fireEvent.click(screen.getByRole("button", { name: /Diagnostic macro/ }));
    expect(screen.getByLabelText("Catalog macro steps")).toHaveTextContent(
      '"command": "uname -a"',
    );
    expect(
      screen.queryByLabelText("Catalog script source"),
    ).not.toBeInTheDocument();
  });
  it("keys choices to each new review without erasing its first immediate selection", async () => {
    mount();
    await refresh();
    fireEvent.click(screen.getByLabelText("Select Public diagnostic"));
    for (let review = 0; review < 3; review++) {
      fireEvent.click(
        screen.getByRole("button", { name: /Review 1 selected/ }),
      );
      const choice = await screen.findByLabelText(
        "Import choice for Public diagnostic",
      );
      expect(choice).toHaveValue("");
      fireEvent.change(choice, { target: { value: "copy" } });
      expect(choice).toHaveValue("copy");
      expect(
        screen.getByRole("button", { name: "Apply reviewed choices" }),
      ).toBeEnabled();
      fireEvent.click(
        screen.getByRole("button", { name: "Cancel import review" }),
      );
    }
  });
  it("loads only explicit destination selections and exports a directly reusable index", async () => {
    const view = mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Load destination entries" }),
    );
    await screen.findByLabelText("Export Public diagnostic");
    expect(h.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Export Public diagnostic"));
    fireEvent.click(
      screen.getByRole("button", { name: "Export package (1 selected)" }),
    );
    await waitFor(() => expect(h.write).toHaveBeenCalledOnce());
    const manifest = parseAutomationCatalog(h.write.mock.calls[0][1]);
    expect(manifest.entries[0].payload).toEqual(entries[0].payload);
    expect(view.apply).not.toHaveBeenCalled();
  });
  it("immediately removes private source and destination when owner access is revoked", async () => {
    const view = mount();
    await refresh();
    fireEvent.click(
      screen.getByRole("button", { name: "Load destination entries" }),
    );
    await screen.findByLabelText("Export Public diagnostic");
    view.rerender(
      <RepositoryCatalogPanel
        {...view.props}
        enabled={false}
        accessKey="locked"
      />,
    );
    expect(screen.queryByText("Public sample package")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Export Public diagnostic"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refresh source" }),
    ).toBeDisabled();
  });
});
