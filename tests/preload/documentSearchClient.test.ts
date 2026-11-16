import { describe, expect, it, vi } from "vitest";
import { documentSearchProjection } from "../../src/utils/documents/documentSearch";
import {
  createDocumentSearchBackend,
  createWorkerSearchBackend,
} from "../../src/utils/documents/documentSearchClient";
import { fixture } from "../documents/fixtures";

describe("document search worker client", () => {
  it("falls back inline when Worker is unavailable (jsdom)", async () => {
    const backend = createDocumentSearchBackend(fixture().documents);
    expect(backend.kind).toBe("inline");
    const ids = await backend.search(fixture().documents, "inventory", true);
    expect([...ids]).toEqual(["doc"]);
  });

  it("never sends secret-bearing fields to the worker", () => {
    const projected = JSON.stringify(
      documentSearchProjection(fixture().documents[0]),
    );
    expect(projected).not.toContain("PRIVATE_FIXTURE");
    expect(projected).not.toContain("private notes");
    expect(projected).toContain("Router");
  });

  it("uses a worker and falls back inline when it errors", async () => {
    const posted: unknown[] = [];
    const fake = {
      onmessage: null as null | ((event: { data: unknown }) => void),
      onerror: null as null | (() => void),
      postMessage: vi.fn((message: { type: string; id?: number }) => {
        posted.push(message);
        if (message.type === "query")
          queueMicrotask(() =>
            fake.onmessage?.({ data: { id: message.id, ids: ["doc"] } }),
          );
      }),
      terminate: vi.fn(),
    };
    const backend = createWorkerSearchBackend(() => fake as unknown as Worker);
    const docs = fixture().documents;
    expect([...(await backend.search(docs, "x", true))]).toEqual(["doc"]);
    expect(JSON.stringify(posted)).not.toContain("PRIVATE_FIXTURE");
    fake.postMessage.mockImplementation(() => {
      throw new Error("worker died");
    });
    expect([
      ...(await backend.search(fixture().documents, "inventory", true)),
    ]).toEqual(["doc"]);
    backend.dispose();
    expect(fake.terminate).toHaveBeenCalled();
  });
});
