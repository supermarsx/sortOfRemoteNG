import { useEffect, useRef, useState } from "react";
import { getInvoke } from "../../utils/tauri/invoke";

const CONFIRMATION = "FORCE DELETE LEGACY TRUST";
interface Preview {
  token: string;
  expiresAt: number;
  confirmationPhrase: string;
  files: { name: string; bytes: number; sha256: string }[];
}
interface Result {
  completed: boolean;
  removedFiles: string[];
  preservedFiles: string[];
  recoveryPath: string | null;
  errors: string[];
}
interface Options {
  acquire: () => boolean;
  release: () => void;
  refresh: () => Promise<void>;
}
const names = new Set(
  ["trust_store.json", "rdp-cert-trust.json"].flatMap((name) => [
    name,
    `${name}.bak`,
    `${name}.v0.bak`,
    `${name}.tmp`,
    `.${name}.tmp`,
  ]),
);
function isToken(token: unknown): token is string {
  return typeof token === "string" && /^[0-9a-f-]{36}$/i.test(token);
}
function validatePreview(value: Preview): Preview {
  if (
    !value ||
    !isToken(value.token) ||
    value.confirmationPhrase !== CONFIRMATION ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= Date.now() ||
    value.expiresAt > Date.now() + 300000 ||
    !Array.isArray(value.files) ||
    value.files.length === 0 ||
    value.files.length > 10 ||
    new Set(value.files.map((file) => file?.name)).size !==
      value.files.length ||
    value.files.some(
      (file) =>
        !file ||
        !names.has(file.name) ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 0 ||
        typeof file.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/i.test(file.sha256),
    )
  ) {
    throw new Error(
      "Native force-delete review was invalid. No files were removed.",
    );
  }
  return value;
}
function validateResult(value: Result, preview: Preview): Result {
  const selected = new Set(preview.files.map((file) => file.name));
  const validList = (list: unknown): list is string[] =>
    Array.isArray(list) &&
    list.length <= selected.size &&
    new Set(list).size === list.length &&
    list.every((name) => selected.has(name));
  if (
    !value ||
    typeof value.completed !== "boolean" ||
    !validList(value.removedFiles) ||
    !validList(value.preservedFiles) ||
    value.removedFiles.some((name) => !value.preservedFiles.includes(name)) ||
    !Array.isArray(value.errors) ||
    value.errors.some(
      (error) => typeof error !== "string" || error.length > 8192,
    ) ||
    (value.recoveryPath !== null &&
      (typeof value.recoveryPath !== "string" ||
        value.recoveryPath.length > 32768 ||
        value.recoveryPath.includes("\0"))) ||
    (value.preservedFiles.length > 0 && !value.recoveryPath) ||
    (value.completed &&
      (value.removedFiles.length !== selected.size ||
        value.errors.length !== 0))
  ) {
    throw new Error(
      "Native cleanup returned an invalid report. The outcome is uncertain; inspect the legacy files and recovery location before retrying.",
    );
  }
  return value;
}
async function cancelToken(token: string) {
  const invoke = await getInvoke();
  if (invoke) await invoke("trust_cancel_force_delete_legacy", { token });
}

/** Holds the shared migration action lease throughout review, never across unrelated settings. */
export function useLegacyTrustForceDelete(options: Options) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const generation = useRef(0);
  const held = useRef(false);
  const applying = useRef(false);
  const token = useRef<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [refreshWarning, setRefreshWarning] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const release = () => {
    if (held.current) {
      held.current = false;
      optionsRef.current.release();
    }
  };
  useEffect(
    () => () => {
      generation.current += 1;
      if (token.current && !applying.current)
        void cancelToken(token.current).catch(() => undefined);
      token.current = null;
      if (held.current) {
        held.current = false;
        optionsRef.current.release();
      }
    },
    [],
  );

  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(
      () => {
        if (applying.current || token.current !== preview.token) return;
        generation.current += 1;
        void cancelToken(preview.token).catch(() => undefined);
        token.current = null;
        setPreview(null);
        setConfirmation("");
        setError(
          "Force-delete review expired. Inspect the files again before confirming.",
        );
        if (held.current) {
          held.current = false;
          optionsRef.current.release();
        }
      },
      Math.max(0, preview.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [preview]);

  const review = async () => {
    if (held.current || !optionsRef.current.acquire()) return;
    held.current = true;
    const request = ++generation.current;
    setRunning(true);
    setError("");
    setRefreshWarning("");
    setResult(null);
    setConfirmation("");
    try {
      const invoke = await getInvoke();
      if (!invoke) throw new Error("Force cleanup requires the desktop app.");
      const response = await invoke<Preview>(
        "trust_preview_force_delete_legacy",
      );
      if (request !== generation.current) {
        if (isToken(response?.token))
          void cancelToken(response.token).catch(() => undefined);
        return;
      }
      // Release even a malformed review's valid token; never leave it armed.
      if (isToken(response?.token)) token.current = response.token;
      setPreview(validatePreview(response));
    } catch (failure) {
      if (request === generation.current) {
        if (token.current)
          void cancelToken(token.current).catch(() => undefined);
        token.current = null;
        setError(failure instanceof Error ? failure.message : String(failure));
        release();
      }
    } finally {
      if (request === generation.current) setRunning(false);
    }
  };
  const cancel = () => {
    if (applying.current) return;
    generation.current += 1;
    if (token.current) void cancelToken(token.current).catch(() => undefined);
    token.current = null;
    setPreview(null);
    setConfirmation("");
    setRunning(false);
    release();
  };
  const apply = async () => {
    if (!preview || confirmation !== CONFIRMATION || applying.current) return;
    if (preview.expiresAt <= Date.now()) {
      cancel();
      setError(
        "Force-delete review expired. Inspect the files again before confirming.",
      );
      return;
    }
    const request = generation.current;
    applying.current = true;
    setRunning(true);
    setError("");
    try {
      const invoke = await getInvoke();
      if (!invoke) throw new Error("Force cleanup requires the desktop app.");
      const response = await invoke<Result>("trust_force_delete_legacy", {
        token: preview.token,
        confirmation,
      });
      if (request === generation.current)
        setResult(validateResult(response, preview));
    } catch (failure) {
      if (request === generation.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      // Apply consumes the native token; cancellation also clears a rejected preflight token.
      void cancelToken(preview.token).catch(() => undefined);
      try {
        if (request === generation.current) {
          token.current = null;
          setPreview(null);
          setConfirmation("");
          await optionsRef.current.refresh();
        }
      } catch {
        if (request === generation.current)
          setRefreshWarning(
            "Cleanup outcome is shown above, but legacy status could not be refreshed. Inspect again before another action.",
          );
      } finally {
        if (request === generation.current) {
          setRunning(false);
          release();
        }
        applying.current = false;
      }
    }
  };
  return {
    preview,
    confirmation,
    setConfirmation,
    running,
    error,
    refreshWarning,
    result,
    review,
    cancel,
    apply,
  };
}
