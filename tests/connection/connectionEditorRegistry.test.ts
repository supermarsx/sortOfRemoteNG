import { describe, expect, it, vi } from "vitest";
import {
  CONNECTION_EDITOR_SEARCH_DESCRIPTORS,
  CONNECTION_EDITOR_TABS,
  getConnectionEditorSearchDescriptors,
  getConnectionEditorTabs,
  navigateToConnectionEditorSearchDescriptor,
} from "../../src/components/connection/editor/editorRegistry";

describe("connection editor registry", () => {
  it("registers the stable editor tab order and filters connection-only tabs", () => {
    expect(CONNECTION_EDITOR_TABS.map((tab) => tab.id)).toEqual([
      "general",
      "protocol",
      "behavior",
      "organize",
      "notes",
    ]);
    expect(getConnectionEditorTabs(false).map((tab) => tab.id)).toEqual([
      "general",
      "protocol",
      "behavior",
      "organize",
      "notes",
    ]);
    expect(getConnectionEditorTabs(true).map((tab) => tab.id)).toEqual([
      "general",
      "organize",
      "notes",
    ]);
  });

  it("describes every extracted section with searchable keywords and fields", () => {
    const tabIds = new Set(CONNECTION_EDITOR_TABS.map((tab) => tab.id));
    const sectionIds = CONNECTION_EDITOR_SEARCH_DESCRIPTORS.map(
      (descriptor) => descriptor.id,
    );

    expect(new Set(sectionIds).size).toBe(sectionIds.length);
    expect(sectionIds).toEqual([
      "general-basics",
      "general-parent",
      "general-connection",
      "protocol-options",
      "behavior-focus",
      "organize-icon",
      "organize-tags",
      "notes-description",
    ]);

    for (const descriptor of CONNECTION_EDITOR_SEARCH_DESCRIPTORS) {
      expect(tabIds.has(descriptor.tabId)).toBe(true);
      expect(descriptor.keywords.length).toBeGreaterThan(0);
      expect(descriptor.fields.length).toBeGreaterThan(0);
      expect(new Set(descriptor.fields.map((field) => field.id)).size).toBe(
        descriptor.fields.length,
      );
    }
  });

  it("filters connection-only search descriptors for folders", () => {
    expect(
      getConnectionEditorSearchDescriptors(true).map(
        (descriptor) => descriptor.id,
      ),
    ).toEqual([
      "general-basics",
      "general-parent",
      "general-connection",
      "organize-icon",
      "organize-tags",
      "notes-description",
    ]);
  });

  it("navigates through the descriptor contract in tab, expansion, field order", () => {
    const calls: string[] = [];
    const didNavigate = navigateToConnectionEditorSearchDescriptor(
      "notes-description",
      {
        activateTab: (tabId) => calls.push(`tab:${tabId}`),
        expandSection: (sectionId) => calls.push(`expand:${sectionId}`),
        focusField: (fieldId, sectionId) =>
          calls.push(`field:${sectionId}:${fieldId}`),
      },
      "description",
    );

    expect(didNavigate).toBe(true);
    expect(calls).toEqual([
      "tab:notes",
      "expand:description",
      "field:notes-description:description",
    ]);
  });

  it("rejects unavailable sections and unknown fields without navigating", () => {
    const activateTab = vi.fn();
    const folderDescriptors = getConnectionEditorSearchDescriptors(true);

    expect(
      navigateToConnectionEditorSearchDescriptor(
        "behavior-focus",
        { activateTab },
        undefined,
        folderDescriptors,
      ),
    ).toBe(false);
    expect(
      navigateToConnectionEditorSearchDescriptor(
        "notes-description",
        { activateTab },
        "missing-field",
        folderDescriptors,
      ),
    ).toBe(false);
    expect(activateTab).not.toHaveBeenCalled();
  });
});
