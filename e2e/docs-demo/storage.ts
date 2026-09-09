import type { SavedRecording } from "../../src/types/recording/macroTypes";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { refuse } from "./failures";

const recordings: SavedRecording[] = [
  "Deployment walkthrough",
  "Service health review",
].map((name, index) => ({
  id: `docs-recording-${index}`,
  name,
  description: "Synthetic documentation recording",
  savedAt: "2026-09-09T09:15:00Z",
  tags: ["demo", index ? "diagnostics" : "runbook"],
  connectionId: "docs-demo-ssh",
  recording: {
    metadata: {
      session_id: `docs-recorded-session-${index}`,
      start_time: "2026-09-09T09:00:00Z",
      end_time: "2026-09-09T09:05:00Z",
      host: "app.example.test",
      username: "demo.operator",
      cols: 120,
      rows: 36,
      duration_ms: index ? 92000 : 305000,
      entry_count: 2,
    },
    entries: [
      {
        timestamp_ms: 0,
        data: "$ printf 'Documentation demo\\n'\r\n",
        entry_type: "Output",
      },
      {
        timestamp_ms: 1200,
        data: "Documentation demo\r\n",
        entry_type: "Output",
      },
    ],
  },
}));
const values: Record<string, unknown> = {
  "mremote-session-recordings": recordings,
  "mremote-rdp-recordings": [],
  "mremote-web-recordings": [],
  "mremote-web-video-recordings": [],
  "mremote-terminal-macros": [],
};
export const storageReads: string[] = [];
export function installDemoStorage() {
  // Browser profile is fresh too, but keep even benign UI history in memory.
  const memory = new WeakMap<Storage, Map<string, string>>();
  const map = (store: Storage) => {
    if (!memory.has(store)) memory.set(store, new Map());
    return memory.get(store)!;
  };
  Storage.prototype.getItem = function (key) {
    return map(this).get(String(key)) ?? null;
  };
  Storage.prototype.setItem = function (key, value) {
    map(this).set(String(key), String(value));
  };
  Storage.prototype.removeItem = function (key) {
    map(this).delete(String(key));
  };
  Storage.prototype.clear = function () {
    map(this).clear();
  };
  Storage.prototype.key = function (index) {
    return [...map(this).keys()][index] ?? null;
  };
  Object.defineProperty(Storage.prototype, "length", {
    configurable: true,
    get() {
      return map(this).size;
    },
  });
  indexedDB.open = () => refuse("direct IndexedDB open");
  indexedDB.deleteDatabase = () => refuse("direct IndexedDB deletion");
  const read = async <T>(key: string): Promise<T | null> => {
    storageReads.push(key);
    return structuredClone(values[key] ?? null) as T | null;
  };
  IndexedDbService.getItem = read;
  IndexedDbService.getItemStrict = read;
  IndexedDbService.init = async () => {};
  IndexedDbService.setItem = async () => refuse("IndexedDB write");
  IndexedDbService.setItemStrict = async () => refuse("IndexedDB strict write");
  IndexedDbService.removeItem = async () => refuse("IndexedDB delete");
  IndexedDbService.removeItemStrict = async () =>
    refuse("IndexedDB strict delete");
  IndexedDbService.transactItemsStrict = async () =>
    refuse("IndexedDB transaction");
}
