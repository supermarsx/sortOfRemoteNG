/// <reference lib="webworker" />
import type { DatabaseDocument } from "../../types/documents/document";
import { documentMatchesSearch } from "./documentSearch";

/**
 * Receives only `documentSearchProjection` output (no secret-bearing fields),
 * keeps it in memory for the life of the worker and answers id sets.
 */
type Request =
  | { type: "load"; epoch: number; documents: DatabaseDocument[] }
  | {
      type: "query";
      id: number;
      epoch: number;
      query: string;
      fullText: boolean;
    }
  | { type: "clear" };

let epoch = -1;
let documents: DatabaseDocument[] = [];

self.onmessage = ({ data }: MessageEvent<Request>) => {
  if (data.type === "clear") {
    documents = [];
    epoch = -1;
    return;
  }
  if (data.type === "load") {
    documents = data.documents;
    epoch = data.epoch;
    return;
  }
  if (data.epoch !== epoch) {
    self.postMessage({ id: data.id, stale: true });
    return;
  }
  const ids = documents
    .filter((entry) => documentMatchesSearch(entry, data.query, data.fullText))
    .map((entry) => entry.id);
  self.postMessage({ id: data.id, ids });
};
