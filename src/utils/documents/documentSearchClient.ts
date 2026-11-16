import type { DatabaseDocument } from "../../types/documents/document";
import {
  documentMatchesSearch,
  documentSearchProjection,
} from "./documentSearch";

/** Below this many blocks a worker round trip costs more than scanning inline. */
export const WORKER_BLOCK_THRESHOLD = 300;

export interface DocumentSearchBackend {
  /** Id set of matching documents. */
  search(
    documents: readonly DatabaseDocument[],
    query: string,
    fullText: boolean,
  ): Promise<Set<string>>;
  readonly kind: "worker" | "inline";
  dispose(): void;
}

export const documentBlockCount = (documents: readonly DatabaseDocument[]) =>
  documents.reduce((total, entry) => total + entry.blocks.length, 0);

/** Synchronous scan used in jsdom/tests, when Worker is missing or on failure. */
export function createInlineSearchBackend(): DocumentSearchBackend {
  return {
    kind: "inline",
    async search(documents, query, fullText) {
      return new Set(
        documents
          .filter((entry) => documentMatchesSearch(entry, query, fullText))
          .map((entry) => entry.id),
      );
    },
    dispose() {},
  };
}

type WorkerFactory = () => Worker;

/** Worker backend; throws on construction when workers are unavailable. */
export function createWorkerSearchBackend(
  factory: WorkerFactory = () =>
    new Worker(new URL("./documentSearch.worker.ts", import.meta.url), {
      type: "module",
    }),
): DocumentSearchBackend {
  const worker = factory();
  const inline = createInlineSearchBackend();
  let loaded: readonly DatabaseDocument[] | null = null;
  let epoch = 0;
  let next = 0;
  let dead = false;
  const waiting = new Map<
    number,
    {
      resolve: (ids: Set<string>) => void;
      fallback: () => Promise<Set<string>>;
    }
  >();
  const fail = () => {
    dead = true;
    for (const [id, entry] of waiting) {
      waiting.delete(id);
      void entry.fallback().then(entry.resolve);
    }
  };
  worker.onmessage = ({
    data,
  }: MessageEvent<{ id: number; ids?: string[]; stale?: boolean }>) => {
    const entry = waiting.get(data.id);
    if (!entry) return;
    waiting.delete(data.id);
    if (data.stale || !data.ids) void entry.fallback().then(entry.resolve);
    else entry.resolve(new Set(data.ids));
  };
  worker.onerror = fail;
  return {
    kind: "worker",
    search(documents, query, fullText) {
      const fallback = () => inline.search(documents, query, fullText);
      if (dead) return fallback();
      try {
        if (loaded !== documents) {
          loaded = documents;
          epoch += 1;
          worker.postMessage({
            type: "load",
            epoch,
            documents: documents.map(documentSearchProjection),
          });
        }
        const id = ++next;
        return new Promise<Set<string>>((resolve) => {
          waiting.set(id, { resolve, fallback });
          worker.postMessage({ type: "query", id, epoch, query, fullText });
        });
      } catch {
        fail();
        return fallback();
      }
    },
    dispose() {
      // Drop the copy of the library with the worker.
      try {
        worker.postMessage({ type: "clear" });
      } catch {
        /* already gone */
      }
      worker.terminate();
      loaded = null;
      fail();
    },
  };
}

/** Worker when available and worthwhile, inline otherwise. Never throws. */
export function createDocumentSearchBackend(
  documents: readonly DatabaseDocument[],
): DocumentSearchBackend {
  if (
    typeof Worker === "undefined" ||
    documentBlockCount(documents) < WORKER_BLOCK_THRESHOLD
  )
    return createInlineSearchBackend();
  try {
    return createWorkerSearchBackend();
  } catch {
    return createInlineSearchBackend();
  }
}
