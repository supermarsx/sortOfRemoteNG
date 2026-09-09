import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConnectionFavoritesSection } from "../../src/components/connectionEditor/ConnectionFavoritesSection";
import { SessionQuickActionsSection } from "../../src/components/connectionEditor/SessionQuickActionsSection";
import { getProtocolSubtabs } from "../../src/components/connection/editor/protocolSubtabs";
import { PROTOCOL_SEARCH_FIELD_SUBTABS } from "../../src/components/connection/editor/editorRegistry";
import type { Connection } from "../../src/types/connection/connection";

const automation = {
  version: 1 as const,
  interactionMacrosEnabled: false,
  scriptInjectionEnabled: false,
  forceDark: false,
  items: [
    { kind: "script" as const, id: "missing-script" },
    { kind: "macro" as const, id: "macro-2" },
  ],
};
function Harness({ initial }: { initial: Partial<Connection> }) {
  const [draft, setDraft] = useState(initial);
  return (
    <>
      <ConnectionFavoritesSection formData={draft} setFormData={setDraft} />
      <output data-testid="draft">{JSON.stringify(draft)}</output>
    </>
  );
}
const draft = () => JSON.parse(screen.getByTestId("draft").textContent!);

describe("connection draft Favorites", () => {
  it("reorders and removes disabled HTTP favorites without changing permissions or resolving private libraries", () => {
    const initial = {
      id: "web",
      protocol: "https" as const,
      httpAutomation: automation,
      password: "fixture-password",
    };
    render(<Harness initial={initial} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Library name unavailable/)).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Move macro macro-2 up" }),
    );
    expect(draft().httpAutomation.items).toEqual([
      automation.items[1],
      automation.items[0],
    ]);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove script missing-script favorite",
      }),
    );
    expect(draft()).toEqual({
      ...initial,
      httpAutomation: { ...automation, items: [automation.items[1]] },
    });
    expect(initial.httpAutomation.items).toHaveLength(2);
  });
  it("reviews SSH references only, without bookmarks or web permission controls", () => {
    render(
      <Harness
        initial={{
          protocol: "ssh",
          sshQuickActions: { version: 1, items: automation.items },
        }}
      />,
    );
    expect(screen.queryByLabelText("HTTP bookmarks")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove macro macro-2 favorite" }),
    );
    expect(draft().sshQuickActions.items).toEqual([automation.items[0]]);
  });
  it("edits nested bookmarks and folder names, preserving metadata and empty folders", () => {
    const folder = {
      name: "Tools",
      isFolder: true as const,
      color: "blue",
      children: [
        { name: "Status", path: "/status", customMetadata: { color: "green" } },
        { name: "Logs", path: "/logs" },
      ],
    };
    const initial = {
      id: "web",
      protocol: "http" as const,
      httpBookmarks: [folder],
    };
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByText("Folder contents (2)"));
    fireEvent.click(
      screen.getByRole("button", { name: "Edit bookmark Status" }),
    );
    fireEvent.change(screen.getByLabelText("Bookmark name"), {
      target: { value: "Health" },
    });
    fireEvent.change(screen.getByLabelText("Bookmark path"), {
      target: { value: "health?view=all#top" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save bookmark draft" }),
    );
    expect(draft().httpBookmarks[0].children[0]).toEqual({
      ...folder.children[0],
      name: "Health",
      path: "/health?view=all#top",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Move bookmark Logs up" }),
    );
    expect(
      draft().httpBookmarks[0].children.map(
        (item: { name: string }) => item.name,
      ),
    ).toEqual(["Logs", "Health"]);
    fireEvent.click(screen.getByRole("button", { name: "Edit folder Tools" }));
    expect(screen.queryByLabelText("Bookmark path")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Bookmark name"), {
      target: { value: "Team" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save bookmark draft" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove bookmark Logs" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove bookmark Health" }),
    );
    expect(draft().httpBookmarks).toEqual([
      { ...folder, name: "Team", children: [] },
    ]);
    expect(folder.children).toHaveLength(2);
  });
  it("keeps bookmark edits draft-only, cancels, and rejects stale callbacks after replacement", () => {
    const source = {
      id: "same",
      protocol: "http" as const,
      httpBookmarks: [{ name: "Old", path: "/old" }],
    };
    const setFormData = vi.fn();
    const { rerender } = render(
      <ConnectionFavoritesSection
        formData={source}
        setFormData={setFormData}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit bookmark Old" }));
    fireEvent.change(screen.getByLabelText("Bookmark name"), {
      target: { value: "Changed" },
    });
    expect(setFormData).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Save bookmark draft" }),
    );
    const update = setFormData.mock.calls[0][0];
    const replacement = {
      ...source,
      httpBookmarks: [{ name: "Other database", path: "/other" }],
    };
    expect(update(replacement)).toBe(replacement);
    rerender(
      <ConnectionFavoritesSection
        formData={replacement}
        setFormData={setFormData}
      />,
    );
    expect(screen.queryByLabelText("Bookmark name")).not.toBeInTheDocument();
  });
  it("does not apply stale favorite callbacks to a replacement connection config", () => {
    const initial = {
      id: "same",
      protocol: "https" as const,
      httpAutomation: automation,
    };
    const setter = vi.fn();
    render(
      <ConnectionFavoritesSection formData={initial} setFormData={setter} />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove script missing-script favorite",
      }),
    );
    const replacement = {
      ...initial,
      httpAutomation: { ...automation, items: [...automation.items] },
    };
    expect(setter.mock.calls[0][0](replacement)).toBe(replacement);
  });
  it("keeps Advanced permissions separate from favorite controls", () => {
    render(
      <SessionQuickActionsSection
        protocol="http"
        view="permissions"
        formData={{ httpAutomation: automation }}
        setFormData={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.queryByText(/missing-script/)).not.toBeInTheDocument();
  });
  it("offers Favorites only for supported protocols and routes bookmark and ref searches there", () => {
    for (const protocol of ["ssh", "http", "https"] as const)
      expect(
        getProtocolSubtabs({ protocol }).some((tab) => tab.id === "favorites"),
      ).toBe(true);
    for (const protocol of ["rdp", "sftp", "serial"] as const)
      expect(
        getProtocolSubtabs({ protocol }).some((tab) => tab.id === "favorites"),
      ).toBe(false);
    expect(PROTOCOL_SEARCH_FIELD_SUBTABS["http-bookmarks"]).toBe("favorites");
    expect(PROTOCOL_SEARCH_FIELD_SUBTABS["session-favorites"]).toBe(
      "favorites",
    );
    const { container } = render(
      <ConnectionFavoritesSection
        formData={{ protocol: "rdp" }}
        setFormData={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
  it("excludes folders even when their saved protocol is HTTP", () => {
    const { container } = render(
      <ConnectionFavoritesSection
        formData={{
          protocol: "http",
          isGroup: true,
          httpBookmarks: [{ name: "Preserved", path: "/" }],
        }}
        setFormData={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
  it("does not let Enter in bookmark fields submit the surrounding connection form", () => {
    render(<Harness initial={{ protocol: "http" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add bookmark" }));
    expect(
      fireEvent.keyDown(screen.getByLabelText("Bookmark name"), {
        key: "Enter",
      }),
    ).toBe(false);
    expect(draft().httpBookmarks).toBeUndefined();
  });
});
