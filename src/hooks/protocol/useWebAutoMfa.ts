import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Connection } from "../../types/connection/connection";
import type { DatabaseAvailability } from "../../contexts/ConnectionContextTypes";
import type { WebAutomationDocument } from "../../types/recording/webAutomation";
import type { TotpAlgorithm } from "../../types/totp";
import { ENCRYPTION_EVENT_LOCKED } from "../../types/encryption/encryption";
import {
  DatabaseManager,
  onDatabaseAccessChange,
  type DatabaseDataTarget,
} from "../../utils/connection/databaseManager";
import {
  getHttpAutoMfaOrigin,
  normalizeHttpAutoMfa,
} from "../../utils/connection/httpAutoMfa";
import { getHttpApplicationProfile } from "../../utils/connection/httpApplicationProfiles";
import { WebAutomationBridge } from "../../utils/recording/webAutomationBridge";
import { totpApi } from "../totp/useTOTP";

interface Options {
  connection: Connection | undefined;
  ownerDatabaseId: string | undefined;
  availability: DatabaseAvailability | undefined;
  settingsReady: boolean;
  blocked: boolean;
  currentUrl: string;
  navigationKey: string;
  iframe: React.RefObject<HTMLIFrameElement | null>;
  getDocument: () => WebAutomationDocument | null;
}
const failure =
  "Automatic 2FA stopped. Use 2FA Codes manually or review the saved Application settings.";
const sameDocument = (
  a: WebAutomationDocument | null,
  b: WebAutomationDocument,
) =>
  a !== null &&
  a.sessionId === b.sessionId &&
  a.generation === b.generation &&
  a.token === b.token &&
  a.sequence === b.sequence &&
  a.navigationToken === b.navigationToken &&
  a.url === b.url;
const receipt = (connection: Connection) =>
  JSON.stringify({
    id: connection.id,
    protocol: connection.protocol,
    hostname: connection.hostname,
    port: connection.port,
    mfa: connection.httpAutoMfa,
    profile: connection.httpApplication,
    authenticators: connection.totpConfigs,
  });

/** First-party, explicitly opted-in OTP only. Unsolicited page events never
 * compute codes. Codes remain transient; persisted consent is read twice. */
export function useWebAutoMfa(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const sent = useRef(new Set<string>());
  const revoked = useRef(false);
  const nativeListening = useRef(false);
  const [nativeReady, setNativeReady] = useState(false);
  const cancelPending = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const [status, setStatus] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [retry, setRetry] = useState(0);
  const retryRef = useRef(false);
  retryRef.current = canRetry;
  const identity = `${options.ownerDatabaseId ?? ""}:${options.availability?.generation ?? ""}:${options.navigationKey}:${options.settingsReady}:${options.blocked}`;
  const previous = useRef({ identity, connection: options.connection });
  if (
    previous.current.identity !== identity ||
    previous.current.connection !== options.connection
  ) {
    previous.current = { identity, connection: options.connection };
    generation.current++;
  }
  useEffect(() => {
    if (options.connection?.httpAutoMfa?.enabled !== true) return;
    let disposed = false,
      offNative: (() => void) | undefined;
    const revoke = () => {
      revoked.current = true;
      generation.current++;
      cancelPending.current?.();
      setStatus(failure);
      setCanRetry(false);
    };
    const off = onDatabaseAccessChange((event) => {
      if (
        event.databaseId === latest.current.ownerDatabaseId &&
        event.status === "suspended"
      )
        revoke();
    });
    const offCurrent = DatabaseManager.getInstance().onCurrentDatabaseChange(
      () => {
        if (
          DatabaseManager.getInstance().getCurrentDatabase()?.id !==
          latest.current.ownerDatabaseId
        )
          revoke();
      },
    );
    void listen(ENCRYPTION_EVENT_LOCKED, revoke)
      .then((unlisten) => {
        if (disposed) unlisten();
        else {
          offNative = unlisten;
          nativeListening.current = true;
          setNativeReady(true);
        }
      })
      .catch(() => {
        if (!disposed) revoke();
      });
    return () => {
      disposed = true;
      nativeListening.current = false;
      setNativeReady(false);
      // This is an operation counter, not a DOM ref captured by this effect.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      off();
      offCurrent();
      offNative?.();
    };
  }, [options.connection?.httpAutoMfa?.enabled]);

  useEffect(() => {
    const captured = generation.current,
      connection = options.connection;
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    setCanRetry(false);
    setStatus(null);
    if (
      !connection ||
      !nativeReady ||
      !nativeListening.current ||
      revoked.current ||
      !options.settingsReady ||
      options.blocked ||
      options.availability?.status !== "ready" ||
      options.availability.databaseId !== options.ownerDatabaseId
    )
      return;
    let config: ReturnType<typeof normalizeHttpAutoMfa>;
    try {
      config = normalizeHttpAutoMfa(connection.httpAutoMfa);
    } catch {
      setStatus(failure);
      return;
    }
    if (!config.enabled) return;
    const doc = options.getDocument();
    if (!doc) return;
    const attemptKey = `${options.ownerDatabaseId}:${connection.id}:${doc.sessionId}`;
    if (sent.current.has(attemptKey)) {
      setStatus(
        "Automatic 2FA was attempted once. Complete any further verification manually.",
      );
      return;
    }
    const challenge = getHttpApplicationProfile(
      connection.httpApplication?.id ?? "",
    )?.totpChallenges?.find((item) => item.id === config.challengeId);
    const entries =
      connection.totpConfigs?.filter(
        (item) => item.id === config.totpConfigId,
      ) ?? [];
    const authenticator = entries.length === 1 ? entries[0] : null;
    const manager = DatabaseManager.getInstance();
    let target: DatabaseDataTarget | null;
    try {
      target = manager.captureCurrentDatabaseDataTarget();
    } catch {
      setStatus(failure);
      return;
    }
    const expected = receipt(connection);
    const valid = () => {
      const live = latest.current;
      if (
        disposed ||
        !nativeListening.current ||
        connection.httpApplication?.invalid === true ||
        revoked.current ||
        generation.current !== captured ||
        live.connection !== connection ||
        !live.settingsReady ||
        live.blocked ||
        live.availability?.status !== "ready" ||
        live.availability.databaseId !== options.ownerDatabaseId ||
        live.availability.generation !== options.availability?.generation ||
        manager.getCurrentDatabase()?.id !== options.ownerDatabaseId ||
        !target ||
        target.databaseId !== options.ownerDatabaseId ||
        !target.assertAccessible ||
        !sameDocument(live.getDocument(), doc)
      )
        throw new Error(failure);
      target.assertAccessible();
      const upstream = new URL(live.currentUrl);
      const local = new URL(doc.url);
      if (
        getHttpAutoMfaOrigin(connection) !== config.origin ||
        upstream.origin !== config.origin ||
        upstream.username ||
        upstream.password ||
        upstream.pathname !== local.pathname ||
        !challenge?.paths.includes(upstream.pathname)
      )
        throw new Error(failure);
    };
    try {
      valid();
      if (
        !authenticator ||
        !challenge ||
        !target?.readCurrent ||
        !target.verifyCurrent ||
        typeof authenticator.secret !== "string" ||
        !authenticator.secret ||
        authenticator.secret.length > 4096 ||
        !["sha1", "sha256", "sha512"].includes(authenticator.algorithm) ||
        !Number.isInteger(authenticator.digits) ||
        authenticator.digits < 6 ||
        authenticator.digits > 8 ||
        !Number.isInteger(authenticator.period) ||
        authenticator.period < 1 ||
        authenticator.period > 3600
      )
        throw new Error(failure);
    } catch {
      setStatus(failure);
      return;
    }
    const persisted = async () => {
      valid();
      await target!.verifyCurrent!();
      valid();
      const data = await target!.readCurrent!();
      valid();
      const saved =
        data?.connections.filter((item) => item.id === connection.id) ?? [];
      if (saved.length !== 1 || receipt(saved[0]) !== expected)
        throw new Error(failure);
    };
    const bridge = new WebAutomationBridge(() => {
      try {
        valid();
        const frame = latest.current.iframe.current?.contentWindow;
        return frame ? { frame, document: doc } : null;
      } catch {
        return null;
      }
    });
    const onMessage = (event: MessageEvent) => bridge.handleMessage(event);
    const cancelAttempt = () => {
      if (timer) clearTimeout(timer);
      bridge.cancel(false, "totpCancel");
    };
    cancelPending.current = cancelAttempt;
    window.addEventListener("message", onMessage);
    const deadline = Date.now() + 30000;
    const probe = async () => {
      const nonce = Array.from(
        crypto.getRandomValues(new Uint8Array(16)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      try {
        valid();
        await bridge.request("totpProbe", {
          nonce,
          codeSelector: challenge.codeSelector,
          submitSelector: challenge.submitSelector,
          submission: challenge.submission,
        });
      } catch {
        try {
          valid();
        } catch {
          return;
        }
        if (Date.now() < deadline) timer = setTimeout(() => void probe(), 1000);
        else {
          setStatus(
            "No supported 2FA challenge detected. Use 2FA Codes or check again when the code field appears.",
          );
          setCanRetry(true);
        }
        return;
      }
      let code = "";
      try {
        await persisted();
        const started = Date.now();
        const expires =
          (Math.floor(started / (authenticator.period * 1000)) + 1) *
          authenticator.period *
          1000;
        // Avoid delivering a code at the end of its time window; explicit retry is safe before submission.
        if (expires - started < 3000) throw new Error(failure);
        code = await totpApi.computeCode(
          authenticator.secret,
          authenticator.algorithm.toUpperCase() as TotpAlgorithm,
          authenticator.digits,
          authenticator.period,
        );
        valid();
        await persisted();
        if (
          Date.now() >= expires - 1000 ||
          !new RegExp(`^\\d{${authenticator.digits}}$`).test(code)
        )
          throw new Error(failure);
        valid();
        sent.current.add(attemptKey);
        setCanRetry(false);
        await bridge.request("totpSubmit", { nonce, code, expires });
        valid();
        setStatus(
          "A 2FA code was submitted once. This does not confirm sign-in success.",
        );
      } catch {
        try {
          valid();
          setStatus(failure);
          setCanRetry(!sent.current.has(attemptKey));
        } catch {
          /* revoked results are discarded */
        }
      } finally {
        code = "";
      }
    };
    setStatus("Waiting for the selected 2FA challenge…");
    void probe();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      bridge.cancel(false, "totpCancel");
      if (cancelPending.current === cancelAttempt) cancelPending.current = null;
    };
    // Identity/connection snapshots intentionally fence one attempt; live options
    // are rechecked synchronously through latest before every sensitive step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, options.connection, retry, nativeReady]);
  return {
    status,
    canRetry,
    retry: () => {
      if (retryRef.current && !revoked.current) {
        setCanRetry(false);
        setRetry((value) => value + 1);
      }
    },
  };
}
