import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parsePassiveSvg,
  validateIconLibrary,
  parseIconPack,
  MAX_ICON_SVG_BYTES,
  type IconLibraryData,
} from "../../src/utils/icons/iconLibrary";
import {
  publishIconLibrary,
  getIconLibrarySnapshot,
  getRuntimeIconEntry,
} from "../../src/utils/icons/iconLibraryRuntime";
import {
  applyIconImport,
  discardIconImport,
  exportIconPack,
  exportLibrarySvg,
  previewIconImport,
  useIconLibrary,
} from "../../src/hooks/icons/useIconLibrary";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";
import { ConnectionIconPicker } from "../../src/components/connection/editor/ConnectionIconPicker";
import {
  CONNECTION_ICON_CATALOG,
  CONNECTION_ICON_CATEGORIES,
} from "../../src/utils/icons/connectionIconCatalog";
const save = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ saveIconLibrary: save }) },
}));
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" d="M2 2L20 20"/></svg>';
const key = "custom:12345678-1234-4123-8123-123456789abc" as const;
const library = (): IconLibraryData => ({
  version: 1,
  customIcons: [
    {
      key,
      label: "Operations mark",
      notes: "Private library note",
      svg: parsePassiveSvg(svg),
    },
  ],
  builtInOverrides: {},
});
beforeEach(() => {
  act(() => publishIconLibrary(undefined, { ready: true }));
  save.mockReset();
  save.mockImplementation(async (data) => {
    publishIconLibrary(data, { ready: true });
  });
});
describe("passive SVG boundary", () => {
  it.each([
    "<script>alert(1)</script>",
    '<image href="https://example.test/x"/>',
    '<use href="#a"/>',
    "<foreignObject/>",
    "<style>svg{}</style>",
    '<path onclick="x()" d="M0 0"/>',
    '<path style="fill:red" d="M0 0"/>',
    '<path fill="url(https://example.test)" d="M0 0"/>',
    "<animate/>",
    '<path d="M0 0L1e999 1"/>',
    '<circle r="40000"/>',
  ])("rejects active or unbounded element %s", (child) =>
    expect(() =>
      parsePassiveSvg(`<svg viewBox="0 0 24 24">${child}</svg>`),
    ).toThrow(),
  );
  it("bounds XML traversal before recursion and rejects entities, excessive nodes, bytes and malformed roots", () => {
    for (const source of [
      "<!DOCTYPE svg><svg/>",
      `<svg viewBox="0 0 24 24">${"<g>".repeat(1000)}${"</g>".repeat(1000)}</svg>`,
      `<svg viewBox="0 0 24 24">${"<path d='M0 0'/>".repeat(257)}</svg>`,
      " ".repeat(MAX_ICON_SVG_BYTES + 1),
      '<svg viewBox="0 0 -1 24"/>',
    ])
      expect(() => parsePassiveSvg(source)).toThrow();
  });
  it("revalidates persisted AST and UUID/metadata instead of trusting JSON", () => {
    expect(() =>
      validateIconLibrary({
        ...library(),
        customIcons: [
          {
            ...library().customIcons[0],
            svg: { tag: "script", attrs: {}, children: [] },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      validateIconLibrary({
        ...library(),
        customIcons: [{ ...library().customIcons[0], key: "folder-work" }],
      }),
    ).toThrow();
    expect(() =>
      parseIconPack(
        '{"format":"sorng-icon-library","version":1,"customIcons":[],"builtInIcons":[{"key":"__proto__","label":"x","notes":""}]}',
      ),
    ).toThrow();
  });
});
describe("reviewed icon library", () => {
  it("updates recommended chips on a live rename and restores catalog labels on lock", async () => {
    const change = vi.fn();
    render(
      <ConnectionIconPicker
        connection={{ protocol: "ssh", isGroup: true }}
        onChange={change}
      />,
    );
    const recommendations = within(
      screen.getByText("Recommended for folders").parentElement!,
    );
    const original = getRuntimeIconEntry("folder-lock")!;
    const chip = recommendations.getByText(original.label).parentElement!;
    const originalArtwork = chip.querySelector("svg")!.innerHTML;
    const { result } = renderHook(useIconLibrary);
    await act(() =>
      result.current.updateMetadata("folder-lock", {
        label: "My recommended work folder",
        notes: "Private recommendation note",
      }),
    );
    const renamed = recommendations.getByText(
      "My recommended work folder",
    ).parentElement!;
    expect(renamed.querySelector("svg")!.innerHTML).toBe(originalArtwork);
    expect(change).not.toHaveBeenCalled();
    act(() => publishIconLibrary(undefined, { ready: false, locked: true }));
    expect(
      recommendations.queryByText("My recommended work folder"),
    ).not.toBeInTheDocument();
    expect(recommendations.getByText(original.label)).toBeInTheDocument();
  });
  it("edits personal built-in metadata without altering catalog artwork and refuses built-in deletion", async () => {
    const original = CONNECTION_ICON_CATALOG.find(
      (icon) => icon.key === "server",
    )!;
    const { result } = renderHook(useIconLibrary);
    await act(() =>
      result.current.updateMetadata("server", {
        label: "My infrastructure",
        notes: "Personal note",
      }),
    );
    expect(getRuntimeIconEntry("server")).toMatchObject({
      label: "My infrastructure",
      notes: "Personal note",
      icon: original.icon,
    });
    expect(original.label).not.toBe("My infrastructure");
    await expect(result.current.deleteCustom(["server"])).rejects.toThrow(
      "Only existing custom",
    );
    await act(() =>
      result.current.updateMetadata("server", { label: "", notes: "" }),
    );
    expect(getRuntimeIconEntry("server")?.label).toBe(original.label);
  });
  it("replaces custom artwork only after explicit conflict review and supports skipping", async () => {
    act(() => publishIconLibrary(library(), { ready: true }));
    const pack = parseIconPack(exportIconPack([key]));
    pack.customIcons[0].label = "Replacement";
    const skipped = previewIconImport(JSON.stringify(pack), "json");
    await act(() => applyIconImport(skipped, { [key]: "skip" }));
    expect(getRuntimeIconEntry(key)?.label).toBe("Operations mark");
    const replacement = previewIconImport(JSON.stringify(pack), "json");
    await act(() => applyIconImport(replacement, { [key]: "replace" }));
    expect(getRuntimeIconEntry(key)?.label).toBe("Replacement");
    expect(getIconLibrarySnapshot().data.customIcons).toHaveLength(1);
  });
  it.each(CONNECTION_ICON_CATEGORIES)(
    "exports every %s built-in as a re-importable passive SVG",
    (category) => {
      const failures: string[] = [];
      for (const icon of CONNECTION_ICON_CATALOG.filter(
        (entry) => entry.category === category,
      )) {
        try {
          parsePassiveSvg(exportLibrarySvg(icon.key));
        } catch (error) {
          failures.push(`${icon.key}: ${String(error)}`);
        }
      }
      expect(failures).toEqual([]);
    },
  );
  it("previews without writes, persists only reviewed keys and resolves imported connection/group overrides", async () => {
    const preview = previewIconImport(svg, "svg", "My drawing");
    expect(save).not.toHaveBeenCalled();
    expect(getRuntimeIconEntry(preview.entries[0].key)).toBeUndefined();
    await act(() => applyIconImport(preview, {}));
    const resolution = resolveEffectiveConnectionIcon({
      protocol: "ssh",
      isGroup: true,
      icon: preview.entries[0].key,
    });
    expect(resolution).toMatchObject({
      source: "override",
      category: "custom",
      label: "My drawing",
    });
    expect(save).toHaveBeenCalledTimes(1);
  });
  it("requires explicit conflict handling and refuses stale or discarded reviews", async () => {
    act(() => publishIconLibrary(library(), { ready: true }));
    const text = exportIconPack([key]);
    const preview = previewIconImport(text, "json");
    await expect(applyIconImport(preview, {})).rejects.toThrow("Review every");
    discardIconImport(preview);
    await expect(
      applyIconImport(preview, { [key]: "replace" }),
    ).rejects.toThrow("expired");
    const next = previewIconImport(text, "json");
    act(() => publishIconLibrary(undefined, { ready: false, locked: true }));
    await expect(applyIconImport(next, { [key]: "replace" })).rejects.toThrow(
      "expired",
    );
    expect(save).not.toHaveBeenCalled();
    expect(
      getIconLibrarySnapshot().entries.some((entry) => entry.key === key),
    ).toBe(false);
    expect(JSON.stringify(getIconLibrarySnapshot())).not.toContain(
      "Private library note",
    );
    expect(() => exportIconPack(["folder-work"])).toThrow();
    expect(() => exportLibrarySvg("folder-work")).toThrow();
  });
  it("does not install failed imports or metadata, and allows a deliberate retry", async () => {
    const preview = previewIconImport(svg, "svg");
    save.mockRejectedValueOnce(new Error("disk refused"));
    await expect(applyIconImport(preview, {})).rejects.toThrow("disk refused");
    expect(getRuntimeIconEntry(preview.entries[0].key)).toBeUndefined();
    await act(() => applyIconImport(preview, {}));
    const { result } = renderHook(useIconLibrary);
    save.mockRejectedValueOnce(new Error("disk refused"));
    await expect(
      result.current.updateMetadata(preview.entries[0].key, {
        label: "Unsaved",
        notes: "secret draft",
      }),
    ).rejects.toThrow();
    expect(getRuntimeIconEntry(preview.entries[0].key)?.label).toBe(
      "Imported icon",
    );
  });
  it("exports explicit built-in references, preserves custom keys, and roundtrips actual artwork", () => {
    act(() => publishIconLibrary(library(), { ready: true }));
    const pack = parseIconPack(exportIconPack(["folder-work", key]));
    expect(pack.builtInIcons).toEqual([
      { key: "folder-work", label: "Work folder", notes: "" },
    ]);
    expect(pack.customIcons[0].key).toBe(key);
    for (const exported of ["folder-work", "github", "circle", key]) {
      const result = exportLibrarySvg(exported);
      expect(result).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(() => parsePassiveSvg(result)).not.toThrow();
    }
  });
  it("updates picker labels/search live and clears deleted custom resolution", async () => {
    act(() => publishIconLibrary(library(), { ready: true }));
    const change = vi.fn();
    render(
      <ConnectionIconPicker
        connection={{ protocol: "ssh", icon: key }}
        onChange={change}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "Private library note" },
    });
    fireEvent.click(screen.getByRole("option", { name: /Operations mark/ }));
    expect(change).toHaveBeenCalledWith(key);
    act(() => publishIconLibrary(undefined, { ready: true }));
    expect(
      screen.queryByRole("option", { name: /Operations mark/ }),
    ).not.toBeInTheDocument();
    expect(
      resolveEffectiveConnectionIcon({ protocol: "ssh", icon: key })
        .overrideState,
    ).toBe("unknown");
  });
});
