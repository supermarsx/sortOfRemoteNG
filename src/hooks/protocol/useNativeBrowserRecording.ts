"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { OriginBrowserIdentity } from "../../types/protocols/originBrowser";
import { onDatabaseAccessChange } from "../../utils/connection/databaseManager";
import { createNativeBrowserHarAdapter } from "./nativeBrowserRecordingHar";

export const NATIVE_VIDEO_LIMITS = Object.freeze({
  bytes: 64 * 1024 * 1024,
  milliseconds: 10 * 60 * 1000,
  chunks: 1024,
});

export interface NativeRecordingTarget {
  readonly identity: OriginBrowserIdentity;
  readonly viewId: string | null;
}

/** Native must enforce the target's owner/window lease and bounded memory on
 * every operation. Save opens a native destination picker; it never auto-exports.
 * Discard is idempotent cleanup, including after owner revocation. */
export interface NativeBrowserHarAdapter {
  available?(target: NativeRecordingTarget): boolean;
  status?(target: NativeRecordingTarget): Promise<NativeHarStatus | null>;
  start(target: NativeRecordingTarget): Promise<NativeHarStatus | void>;
  stop(target: NativeRecordingTarget): Promise<NativeHarStatus | void>;
  discard(target: NativeRecordingTarget): Promise<void>;
  save(target: NativeRecordingTarget): Promise<"saved" | "cancelled">;
}

export interface NativeHarStatus {
  phase: "recording" | "stopped" | "limitReached";
  durationMs: number;
  entryCount: number;
  droppedEntries: number;
}

type HarActionResult = NativeHarStatus | void | "saved" | "cancelled";

export interface NativeBrowserRecordingOptions extends NativeRecordingTarget {
  enabled: boolean;
  assertOwner: () => void;
  /** Undefined selects native metadata HAR; null explicitly disables HAR. */
  har?: NativeBrowserHarAdapter | null;
}

type Phase =
  | "idle"
  | "starting"
  | "recording"
  | "paused"
  | "stopping"
  | "ready"
  | "saving";
interface RecordingState {
  phase: Phase;
  bytes: number;
  seconds: number;
  message: string;
  entryCount: number;
  droppedEntries: number;
}
const empty = (): RecordingState => ({
  phase: "idle",
  bytes: 0,
  seconds: 0,
  message: "",
  entryCount: 0,
  droppedEntries: 0,
});
interface VideoRun {
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  bytes: number;
  blob: Blob | null;
  stopping: boolean;
  timer?: ReturnType<typeof setTimeout>;
  stopTimer?: ReturnType<typeof setTimeout>;
  removeEnded?: () => void;
}
interface Lifetime {
  key: string;
  target: NativeRecordingTarget;
  live: boolean;
  video: VideoRun | null;
  har?: NativeBrowserHarAdapter;
  harUsed: boolean;
  harPending: Promise<HarActionResult> | null;
  harPoll: Promise<NativeHarStatus | null> | null;
  videoState: RecordingState;
  harState: RecordingState;
  timer?: ReturnType<typeof setTimeout>;
}

function releaseVideo(run: VideoRun) {
  clearTimeout(run.timer);
  clearTimeout(run.stopTimer);
  run.removeEnded?.();
  run.removeEnded = undefined;
  if (run.recorder) {
    run.recorder.ondataavailable = null;
    run.recorder.onstop = null;
    run.recorder.onerror = null;
    try {
      if (run.recorder.state !== "inactive") run.recorder.stop();
    } catch {
      /* Tracks still must be stopped if the encoder failed. */
    }
  }
  run.stream?.getTracks().forEach((track) => track.stop());
  run.stream = null;
  run.recorder = null;
  run.chunks = [];
  run.blob = null;
  run.bytes = 0;
}

/** Mount once per selected native view, outside transient menus. No recording
 * data enters storage or React state. Disabling/replacing its scope discards it.
 * A browser encoder may internally buffer more than its requested timeslice;
 * these limits bound retained application data, not the browser's own buffers. */
export function useNativeBrowserRecording(
  options: Omit<NativeBrowserRecordingOptions, "identity"> & {
    identity: OriginBrowserIdentity | null;
  },
) {
  const key =
    options.enabled && options.identity
      ? JSON.stringify([
          options.identity.ownerDatabaseId,
          options.identity.connectionId,
          options.identity.sessionId,
          options.identity.attemptId,
          options.viewId,
        ])
      : "";
  const latest = useRef({ options, key });
  latest.current = { options, key };
  const lifetime = useRef<Lifetime | null>(null);
  const [published, publish] = useState({
    key: "",
    video: empty(),
    har: empty(),
  });
  const renderedLifetime = lifetime.current;
  const actionable = () =>
    lifetime.current === renderedLifetime && renderedLifetime?.key === key
      ? renderedLifetime
      : null;

  function update(
    life: Lifetime,
    kind: "video" | "har",
    next: Partial<RecordingState>,
  ) {
    const previous = life[kind === "video" ? "videoState" : "harState"];
    if (
      (Object.keys(next) as (keyof RecordingState)[]).every(
        (field) => previous[field] === next[field],
      )
    )
      return;
    life[kind === "video" ? "videoState" : "harState"] = {
      ...life[kind === "video" ? "videoState" : "harState"],
      ...next,
    };
    if (
      life.live &&
      lifetime.current === life &&
      latest.current.key === life.key
    )
      publish({ key: life.key, video: life.videoState, har: life.harState });
  }
  function revoke(life: Lifetime) {
    if (!life.live) return;
    life.live = false;
    clearTimeout(life.timer);
    if (life.video) releaseVideo(life.video);
    life.video = null;
    if (life.har && life.harUsed) {
      // Ordered after an in-flight start/stop: a late start ACK must not resurrect
      // collection. Native revocation is authoritative if the renderer vanishes.
      void Promise.resolve(life.harPending)
        .catch(() => {})
        .then(() => life.har!.discard(life.target))
        .catch(() => {});
    }
    if (lifetime.current === life)
      publish({ key: life.key, video: empty(), har: empty() });
  }
  function current(life: Lifetime): boolean {
    if (
      !life.live ||
      lifetime.current !== life ||
      latest.current.key !== life.key
    )
      return false;
    try {
      latest.current.options.assertOwner();
      return true;
    } catch {
      revoke(life);
      return false;
    }
  }

  useLayoutEffect(() => {
    if (!key || !latest.current.options.identity) return;
    const life: Lifetime = {
      key,
      target: {
        identity: { ...latest.current.options.identity },
        viewId: latest.current.options.viewId,
      },
      live: true,
      video: null,
      har: latest.current.options.har ?? undefined,
      harUsed: false,
      harPending: null,
      harPoll: null,
      videoState: empty(),
      harState: empty(),
    };
    if (latest.current.options.har === undefined)
      life.har = createNativeBrowserHarAdapter(() => {
        if (!current(life)) throw new Error("Owner unavailable");
      });
    if (life.har?.available && !life.har.available(life.target))
      life.har = undefined;
    lifetime.current = life;
    publish({ key, video: empty(), har: empty() });
    const off = onDatabaseAccessChange(() => {
      current(life);
    });
    return () => {
      off();
      revoke(life);
    };
    // Only immutable owner/view identity and adapter lifetime recreate resources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, options.har]);

  function failVideo(life: Lifetime, run: VideoRun, message: string) {
    releaseVideo(run);
    if (life.video !== run) return;
    life.video = null;
    update(life, "video", { ...empty(), message });
  }
  function stopVideoFor(life: Lifetime, run: VideoRun, message = "") {
    if (life.video !== run || run.stopping || !current(life)) return;
    if (!run.recorder) {
      // Cancels an outstanding capture picker. Its eventual stream is stopped.
      failVideo(life, run, "Screen capture cancelled.");
      return;
    }
    run.stopping = true;
    clearTimeout(run.timer);
    run.removeEnded?.();
    run.removeEnded = undefined;
    update(life, "video", { phase: "stopping", message });
    run.stopTimer = setTimeout(() => {
      if (life.video === run)
        failVideo(
          life,
          run,
          "The recorder did not finish. Unsaved video was discarded.",
        );
    }, 5000);
    try {
      if (run.recorder.state !== "inactive") run.recorder.stop();
    } catch {
      failVideo(life, run, "Recording failed. Unsaved video was discarded.");
    } finally {
      run.stream?.getTracks().forEach((track) => track.stop());
      run.stream = null;
    }
  }
  async function startVideo() {
    const life = actionable();
    if (!life || life.key !== key || !current(life) || life.video) return false;
    const run: VideoRun = {
      stream: null,
      recorder: null,
      chunks: [],
      bytes: 0,
      blob: null,
      stopping: false,
    };
    life.video = run;
    update(life, "video", { ...empty(), phase: "starting" });
    try {
      if (
        !navigator.mediaDevices?.getDisplayMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error();
      const mimeType = [
        "video/webm;codecs=vp8",
        "video/webm",
        "video/mp4",
      ].find((mime) => MediaRecorder.isTypeSupported(mime));
      if (!mimeType) throw new Error();
      // Called synchronously from the user's click, before any await.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 15, max: 30 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      if (!current(life) || life.video !== run) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      run.stream = stream;
      if (!stream.getVideoTracks().some((track) => track.readyState === "live"))
        throw new Error();
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 1_000_000,
      });
      run.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (!current(life) || life.video !== run || !event.data.size) return;
        if (
          event.data.size > NATIVE_VIDEO_LIMITS.bytes - run.bytes ||
          run.chunks.length >= NATIVE_VIDEO_LIMITS.chunks
        ) {
          // Dropping an encoder chunk can produce a corrupt file. Discard the
          // whole recording instead of offering a misleading truncated export.
          failVideo(
            life,
            run,
            "Video memory limit reached (64 MiB). Unsaved video was discarded; record a shorter clip.",
          );
          return;
        }
        run.chunks.push(event.data);
        run.bytes += event.data.size;
        update(life, "video", { bytes: run.bytes });
        if (
          run.bytes >= NATIVE_VIDEO_LIMITS.bytes - 4 * 1024 * 1024 &&
          !run.stopping
        )
          stopVideoFor(
            life,
            run,
            "Video stopped near its memory limit. Save or discard this recording.",
          );
      };
      recorder.onerror = () =>
        failVideo(life, run, "Recording failed. Unsaved video was discarded.");
      recorder.onstop = () => {
        if (!current(life) || life.video !== run) return;
        const blob = new Blob(run.chunks, {
          type: recorder.mimeType || mimeType,
        });
        releaseVideo(run);
        if (!blob.size) {
          life.video = null;
          update(life, "video", {
            ...empty(),
            message: "No video was captured.",
          });
          return;
        }
        run.blob = blob;
        run.bytes = blob.size;
        update(life, "video", { phase: "ready", bytes: blob.size });
      };
      const ended = () =>
        stopVideoFor(
          life,
          run,
          "Screen sharing ended. Save or discard this recording.",
        );
      stream
        .getTracks()
        .forEach((track) => track.addEventListener("ended", ended));
      run.removeEnded = () =>
        stream
          .getTracks()
          .forEach((track) => track.removeEventListener("ended", ended));
      recorder.start(1000);
      const started = Date.now();
      const tick = () => {
        if (!current(life) || life.video !== run || run.stopping) return;
        const elapsed = Date.now() - started;
        update(life, "video", { seconds: Math.floor(elapsed / 1000) });
        if (elapsed >= NATIVE_VIDEO_LIMITS.milliseconds)
          stopVideoFor(
            life,
            run,
            "The 10-minute limit was reached. Save or discard this recording.",
          );
        else run.timer = setTimeout(tick, 250);
      };
      run.timer = setTimeout(tick, 250);
      update(life, "video", { phase: "recording" });
      return true;
    } catch {
      if (life.video === run)
        failVideo(
          life,
          run,
          "Screen recording was cancelled or is unavailable in this runtime.",
        );
      return false;
    }
  }
  function stopVideo() {
    const life = actionable();
    if (life?.video && life.key === key) stopVideoFor(life, life.video);
  }
  function pauseVideo() {
    const life = actionable();
    if (
      !life ||
      life.key !== key ||
      !current(life) ||
      !life.video?.recorder ||
      life.video.stopping
    )
      return;
    try {
      const recorder = life.video.recorder;
      if (recorder.state === "recording") {
        recorder.pause();
        update(life, "video", { phase: "paused" });
      } else if (recorder.state === "paused") {
        recorder.resume();
        update(life, "video", { phase: "recording" });
      }
    } catch {
      failVideo(
        life,
        life.video,
        "Recording failed. Unsaved video was discarded.",
      );
    }
  }
  function discardVideo() {
    const life = actionable();
    if (!life || life.key !== key || life.videoState.phase === "saving") return;
    if (life.video) releaseVideo(life.video);
    life.video = null;
    update(life, "video", empty());
  }
  async function saveVideo() {
    const life = actionable(),
      run = life?.video;
    if (
      !life ||
      life.key !== key ||
      !run?.blob ||
      !current(life) ||
      life.videoState.phase !== "ready"
    )
      return false;
    update(life, "video", { phase: "saving", message: "" });
    const valid = () => current(life) && life.video === run;
    try {
      const extension = run.blob.type.startsWith("video/mp4") ? "mp4" : "webm";
      const path = await save({
        title: "Save native browser video",
        defaultPath: `browser-recording.${extension}`,
        filters: [{ name: "Video recording", extensions: [extension] }],
      });
      if (!valid()) return false;
      if (path === null) {
        update(life, "video", { phase: "ready" });
        return false;
      }
      const bytes = new Uint8Array(await run.blob!.arrayBuffer());
      if (!valid()) {
        bytes.fill(0);
        return false;
      }
      try {
        await writeFile(path, bytes);
      } finally {
        bytes.fill(0);
      }
      if (!valid()) return false;
      releaseVideo(run);
      life.video = null;
      update(life, "video", { ...empty(), message: "Video saved." });
      return true;
    } catch {
      if (valid())
        update(life, "video", {
          phase: "ready",
          message: "Video could not be saved. Retry or discard it.",
        });
      return false;
    }
  }
  function applyHarStatus(life: Lifetime, status: NativeHarStatus | null) {
    if (!status) {
      life.harUsed = false;
      update(life, "har", empty());
      return;
    }
    update(life, "har", {
      phase: status.phase === "recording" ? "recording" : "ready",
      seconds: Math.floor(status.durationMs / 1000),
      entryCount: status.entryCount,
      droppedEntries: status.droppedEntries,
      ...(status.phase === "limitReached"
        ? {
            message:
              "The native HAR limit was reached. Save or discard the bounded capture.",
          }
        : {}),
    });
  }
  function scheduleHarStatus(life: Lifetime) {
    clearTimeout(life.timer);
    if (
      !life.live ||
      !life.har?.status ||
      !life.harUsed ||
      life.harState.phase !== "recording"
    )
      return;
    life.timer = setTimeout(async () => {
      if (!current(life)) return;
      if (!life.harPending) {
        try {
          life.harPoll = life.har!.status!(life.target);
          const status = await life.harPoll;
          if (current(life) && !life.harPending) applyHarStatus(life, status);
        } catch {
          if (current(life) && !life.harPending)
            update(life, "har", {
              message:
                "HAR status could not be refreshed. Stop or discard the capture.",
            });
        } finally {
          life.harPoll = null;
        }
      }
      scheduleHarStatus(life);
    }, 1000);
  }
  async function harAction(action: "start" | "stop" | "discard" | "save") {
    const life = actionable();
    if (!life?.har || life.key !== key || !current(life) || life.harPending)
      return false;
    const phase = life.harState.phase;
    if (
      (action === "start" && phase !== "idle") ||
      (action === "stop" && phase !== "recording") ||
      (action === "save" && phase !== "ready")
    )
      return false;
    life.harUsed = true;
    update(life, "har", {
      phase:
        action === "start"
          ? "starting"
          : action === "save"
            ? "saving"
            : "stopping",
      message: "",
    });
    try {
      life.harPending = Promise.resolve(life.harPoll)
        .catch(() => {})
        .then<HarActionResult>(() => {
          if (!current(life)) throw new Error();
          return life.har![action](life.target);
        });
      const result = await life.harPending;
      if (!current(life)) return false;
      if (action === "discard") life.harUsed = false;
      update(life, "har", {
        ...(action === "discard" ? empty() : {}),
        phase:
          action === "start"
            ? "recording"
            : action === "discard"
              ? "idle"
              : "ready",
        message:
          action === "save" && result === "saved"
            ? "HAR saved. Discard the temporary capture when finished."
            : "",
      });
      if (result && typeof result === "object") applyHarStatus(life, result);
      return result !== "cancelled";
    } catch {
      if (current(life))
        update(life, "har", {
          phase,
          message:
            "The HAR action was not confirmed. Retry or discard this capture.",
        });
      return false;
    } finally {
      life.harPending = null;
      scheduleHarStatus(life);
    }
  }
  const visible = published.key === key && lifetime.current?.live;
  return {
    scope: key,
    available: !!key && !!lifetime.current?.live,
    videoSupported:
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getDisplayMedia &&
      typeof MediaRecorder !== "undefined",
    harAvailable: !!lifetime.current?.har,
    video: visible ? published.video : empty(),
    har: visible ? published.har : empty(),
    startVideo,
    stopVideo,
    pauseVideo,
    discardVideo,
    saveVideo,
    startHar: () => harAction("start"),
    stopHar: () => harAction("stop"),
    discardHar: () => harAction("discard"),
    saveHar: () => harAction("save"),
  };
}
export type NativeBrowserRecordingController = ReturnType<
  typeof useNativeBrowserRecording
>;
