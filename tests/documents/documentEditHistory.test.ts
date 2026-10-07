import { describe, expect, it } from "vitest";
import {
  createDocumentEditHistory,
  documentEditSnapshot,
  type DocumentEditSnapshot,
} from "../../src/utils/documents/documentEditHistory";
import { fixture } from "./fixtures";
import type { DocumentAttachment } from "../../src/types/documents/document";

const snapshot = (name = "Inventory") =>
  documentEditSnapshot({ ...fixture().documents[0], name }, []);

describe("bounded document edit history", () => {
  it("steps backwards/forwards through named edits without mutating snapshots", () => {
    const history = createDocumentEditHistory();
    history.observe(snapshot(), false, 0);
    history.observe(snapshot("One"), true, 1000);
    history.observe(snapshot("Two"), true, 2000);
    history.observe(snapshot("Three"), true, 3000);
    expect(history.view.undo).toEqual(Array(3).fill("Rename document"));
    let applied: DocumentEditSnapshot | undefined;
    expect(
      history.restore("undo", 2, (value) => {
        applied = value;
        return true;
      }),
    ).toBe(true);
    expect(applied!.document.name).toBe("One");
    expect(history.view.redo).toHaveLength(2);
    applied!.document.name = "mutated callback copy";
    history.restore("redo", 2, (value) => {
      applied = value;
      return true;
    });
    expect(applied!.document.name).toBe("Three");
    history.restore("undo", 2, (value) => {
      expect(value.document.name).toBe("One");
      return true;
    });
  });
  it("coalesces fast typing but starts a new step after save or history navigation", () => {
    const history = createDocumentEditHistory();
    history.observe(snapshot(), false, 0);
    history.observe(snapshot("O"), true, 1000);
    history.observe(snapshot("On"), true, 1100);
    history.observe(snapshot("One"), true, 1200);
    expect(history.view.undo).toHaveLength(1);
    history.observe(snapshot("One"), false, 1250);
    history.observe(snapshot("Two"), true, 1300);
    expect(history.view.undo).toHaveLength(2);
    history.restore("undo", 1, () => true);
    history.observe(snapshot("Three"), true, 1400);
    expect(history.view.undo).toHaveLength(2);
    expect(history.view.redo).toEqual([]);
  });
  it("ignores timestamp-only changes and retains steps after a verified save", () => {
    const history = createDocumentEditHistory();
    history.observe(snapshot(), false);
    history.observe(snapshot("New title"), true);
    history.observe(
      documentEditSnapshot(
        {
          ...snapshot("New title").document,
          updatedAt: "2030-01-01T00:00:00Z",
        },
        [],
      ),
      false,
    );
    expect(history.view.undo).toHaveLength(1);
  });
  it("drops obsolete steps on external replacement and clear", () => {
    const history = createDocumentEditHistory();
    history.observe(snapshot(), false);
    history.observe(snapshot("New"), true);
    history.observe(snapshot("Remote"), false);
    expect(history.view.undo).toEqual([]);
    history.observe(snapshot("Local"), true);
    history.clear();
    expect(history.view).toEqual({ undo: [], redo: [], notice: "" });
  });
  it("does not advance on rejected, invalid or out-of-range steps", () => {
    const history = createDocumentEditHistory();
    history.observe(snapshot(), false);
    history.observe(snapshot("New"), true);
    for (const count of [0, -1, 2, 1.5, NaN])
      expect(history.restore("undo", count, () => true)).toBe(false);
    expect(history.restore("undo", 1, () => false)).toBe(false);
    expect(history.view.undo).toHaveLength(1);
    expect(history.view.redo).toHaveLength(0);
  });
  it("retains only owned attachments so removing a block can be undone safely", () => {
    const attachment = {
      id: "used",
      name: "fixture",
      dataBase64: "AA==",
    } as unknown as DocumentAttachment;
    const original = snapshot().document;
    original.blocks.push({
      id: "image",
      type: "attachment",
      attachmentId: "used",
      caption: "Image",
    });
    const before = documentEditSnapshot(original, [
      attachment,
      { ...attachment, id: "unrelated" },
    ]);
    expect(before.attachments).toEqual([attachment]);
    const history = createDocumentEditHistory();
    history.observe(before, false);
    history.observe(snapshot(), true);
    expect(history.view.undo).toEqual(["Remove content"]);
    history.restore("undo", 1, (value) => {
      expect(value.attachments).toEqual([attachment]);
      return true;
    });
  });
  it("enforces step and byte budgets without truncating the current document", () => {
    const history = createDocumentEditHistory(100_000, 2);
    for (let index = 0; index < 5; index++)
      history.observe(snapshot(String(index)), index > 0, index * 1000);
    expect(history.view.undo).toHaveLength(2);
    expect(history.view.notice).toContain("limit memory");
    const size = JSON.stringify(snapshot()).length * 2;
    const bounded = createDocumentEditHistory(size * 2 + 20);
    bounded.observe(snapshot(), false, 0);
    bounded.observe(snapshot("One"), true, 1000);
    bounded.observe(snapshot("Two"), true, 2000);
    expect(bounded.view.undo).toHaveLength(1);
    bounded.observe(snapshot("X".repeat(size * 2)), true);
    expect(bounded.view.undo).toHaveLength(0);
    expect(bounded.view.notice).toContain("too large");
  });
});
