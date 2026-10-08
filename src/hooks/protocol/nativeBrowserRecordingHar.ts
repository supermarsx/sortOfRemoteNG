import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type {
  NativeBrowserHarAdapter,
  NativeHarStatus,
  NativeRecordingTarget,
} from "./useNativeBrowserRecording";

const invalid = () => new Error("Native HAR data is unavailable or changed.");
const count = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
type Snapshot = NativeHarStatus & { recordingId: string };
function snapshot(
  value: unknown,
  target: NativeRecordingTarget,
): Snapshot | null {
  if (value === null) return null;
  const row = value as
    | (Snapshot & {
        identity?: Record<string, unknown>;
        metadataOnly?: boolean;
      })
    | null;
  if (
    !row ||
    !row.identity ||
    !(
      ["ownerDatabaseId", "connectionId", "sessionId", "attemptId"] as const
    ).every((key) => row.identity![key] === target.identity[key]) ||
    typeof row.recordingId !== "string" ||
    !/^[a-f0-9-]{1,80}$/.test(row.recordingId) ||
    !["recording", "stopped", "limitReached"].includes(row.phase) ||
    row.metadataOnly !== true ||
    !count(row.durationMs) ||
    !count(row.entryCount) ||
    row.entryCount > 2048 ||
    !count(row.droppedEntries)
  )
    throw invalid();
  return {
    recordingId: row.recordingId,
    phase: row.phase,
    durationMs: row.durationMs,
    entryCount: row.entryCount,
    droppedEntries: row.droppedEntries,
  };
}

/** Copy the narrow metadata-only wire schema, never arbitrary extra response
 * fields. Entry count and every retained string are bounded before encoding. */
function metadataHar(value: unknown, expected: Snapshot): Uint8Array {
  const log = (value as { log?: Record<string, unknown> } | null)?.log;
  if (
    !log ||
    log.version !== "1.2" ||
    log._metadataOnly !== true ||
    !Array.isArray(log.entries) ||
    log.entries.length !== expected.entryCount ||
    log.entries.length > 2048
  )
    throw invalid();
  const entries = log.entries.map((raw: unknown) => {
    const entry = raw as Record<string, any>;
    if (
      !entry ||
      typeof entry.startedDateTime !== "string" ||
      entry.startedDateTime.length > 40 ||
      !Number.isFinite(Date.parse(entry.startedDateTime)) ||
      !count(entry.time) ||
      !entry.request ||
      typeof entry.request.url !== "string" ||
      entry.request.url.length > 1025 ||
      ![
        "GET",
        "HEAD",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
        "CONNECT",
        "TRACE",
        "OTHER",
      ].includes(entry.request.method) ||
      !entry.response ||
      !count(entry.response.status) ||
      entry.response.status > 65535 ||
      !count(entry.response.content?.size) ||
      !["success", "redirect", "cancelled", "failed"].includes(entry._outcome)
    )
      throw invalid();
    const url = new URL(entry.request.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      entry.request.url !== `${url.origin}/`
    )
      throw invalid();
    return {
      startedDateTime: entry.startedDateTime,
      time: entry.time,
      request: {
        method: entry.request.method,
        url: entry.request.url,
        httpVersion: "",
        cookies: [],
        headers: [],
        queryString: [],
        headersSize: -1,
        bodySize: -1,
      },
      response: {
        status: entry.response.status,
        statusText: "",
        httpVersion: "",
        cookies: [],
        headers: [],
        content: { size: entry.response.content.size, mimeType: "" },
        redirectURL: "",
        headersSize: -1,
        bodySize: -1,
      },
      cache: {},
      timings: { send: 0, wait: entry.time, receive: 0 },
      _timingsAggregated: true,
      _outcome: entry._outcome,
    };
  });
  const bytes = new TextEncoder().encode(
    JSON.stringify(
      {
        log: {
          version: "1.2",
          creator: {
            name: "sortOfRemoteNG native CEF metadata recorder",
            version: "1",
          },
          entries,
          _metadataOnly: true,
          _omitted: [
            "urlPath",
            "urlQuery",
            "urlFragment",
            "urlCredentials",
            "headers",
            "cookies",
            "requestBodies",
            "responseBodies",
            "detailedTimings",
          ],
          _droppedEntries: expected.droppedEntries,
          _phase: expected.phase,
        },
      },
      null,
      2,
    ),
  );
  if (bytes.byteLength > 8 * 1024 * 1024) {
    bytes.fill(0);
    throw invalid();
  }
  return bytes;
}

/** One adapter per hook lifetime. Current native HAR is source/root-only; never
 * silently redirect a selected popup to its source's recording. */
export function createNativeBrowserHarAdapter(
  assertCurrent: () => void,
): NativeBrowserHarAdapter {
  let id: string | null = null;
  let bound: string | null = null;
  const request = async (
    target: NativeRecordingTarget,
    operation: { kind: string; metadataOnly?: boolean; recordingId?: string },
    cleanup = false,
  ) => {
    if (target.viewId !== null) throw invalid();
    const scope = JSON.stringify(target.identity);
    if (bound !== null && bound !== scope) throw invalid();
    bound = scope;
    if (!cleanup) assertCurrent();
    const reply = await invoke<{ snapshot: unknown; har: unknown }>(
      "origin_browser_recording",
      {
        request: { identity: target.identity, operation },
      },
    );
    if (!reply || typeof reply !== "object") throw invalid();
    const row = snapshot(reply.snapshot, target);
    if (id && row && id !== row.recordingId) throw invalid();
    // Retain only the exact handle acknowledged by our start, even if owner
    // revocation won the race. Cleanup must never adopt some other capture.
    if (operation.kind === "start" && row) id = row.recordingId;
    if (!cleanup) assertCurrent();
    return { row, har: reply.har };
  };
  return {
    available: (target) => target.viewId === null,
    async status(target) {
      if (!id) return null;
      const { row } = await request(target, { kind: "status" });
      id = row?.recordingId ?? null;
      return row;
    },
    async start(target) {
      const { row } = await request(target, {
        kind: "start",
        metadataOnly: true,
      });
      if (!row) throw invalid();
      id = row.recordingId;
      return row;
    },
    async stop(target) {
      if (!id) throw invalid();
      const { row } = await request(target, { kind: "stop", recordingId: id });
      if (!row || row.phase === "recording") throw invalid();
      return row;
    },
    async discard(target) {
      if (!id) return;
      await request(target, { kind: "discard", recordingId: id }, true);
      id = null;
    },
    async save(target) {
      if (!id) throw invalid();
      assertCurrent();
      const path = await save({
        title: "Save native browser HAR",
        defaultPath: "browser-recording.har",
        filters: [{ name: "HTTP Archive", extensions: ["har"] }],
      });
      assertCurrent();
      if (path === null) return "cancelled";
      const { row, har } = await request(target, {
        kind: "export",
        recordingId: id,
      });
      if (!row || row.phase === "recording") throw invalid();
      const bytes = metadataHar(har, row);
      try {
        assertCurrent();
        await writeFile(path, bytes);
        assertCurrent();
      } finally {
        bytes.fill(0);
      }
      return "saved";
    },
  };
}
