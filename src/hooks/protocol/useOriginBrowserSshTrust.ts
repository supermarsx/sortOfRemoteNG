import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { Connection } from "../../types/connection/connection";
import type { GlobalSettings } from "../../types/settings/settings";
import {
  getTrustStoreScope,
  ensureTrustStoreReady,
  resolveEffectiveTrustPolicy,
  trustIdentity,
  verifyIdentity,
} from "../../utils/auth/trustStore";
import { tunnelSourceIdentity } from "../../utils/ssh/sshTunnelSourceIdentity";
import { stableJsonStringify } from "../../utils/core/stableJsonStringify";
import { connectionEndpointHost } from "../../utils/connection/connectionEndpointHost";
import { requestPrompt } from "../../utils/prompts/promptQueue";

export interface NativeBrowserSshTrustOptions {
  sessionId: string;
  ownerDatabaseId: string;
  proof: { assertCurrent(): void } | null;
  connection: Connection | undefined;
  connections: readonly Connection[];
  settings: Pick<GlobalSettings, "sshTrustPolicy" | "trustPolicy"> &
    Partial<Pick<GlobalSettings, "sshConnection">>;
  enabled: boolean;
  /** Read current native-create progress without restarting the listener. */
  isPending?: () => boolean;
  getPendingCreateRequestId?: () => string | null;
}

interface Prompt {
  session_id: string;
  host_key_prompt_id: string;
  host: string;
  port: number;
  status: "first_use" | "mismatch";
  fingerprint: string;
  key_type?: string | null;
  key_bits?: number | null;
  public_key?: string | null;
}
const listeners = new Map<string, object>();
const text = (value: unknown, maximum: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximum &&
  !Array.from(value).some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );

function endpointHost(value: unknown): string | undefined {
  if (!text(value, 253) || /[\s/\\@?#]/u.test(value)) return;
  let host = value;
  if (host.startsWith("[") || host.endsWith("]")) {
    if (!host.startsWith("[") || !host.endsWith("]")) return;
    host = host.slice(1, -1);
    if (!host.includes(":")) return;
  }
  if (host.includes(":")) {
    try {
      // Validate IPv6 without canonicalizing the native prompt's literal.
      new URL(`http://[${host}]/`);
    } catch {
      return;
    }
  }
  return host;
}

function source(options: NativeBrowserSshTrustOptions) {
  const row = options.connection;
  const legacy = row?.security?.sshTunnel;
  const layers =
    row?.security?.tunnelChain?.filter((layer) => layer.enabled !== false) ??
    [];
  const modern = layers.filter((layer) =>
    ["ssh-tunnel", "local-forward", "ssh-jump"].includes(layer.type),
  );
  const needed = legacy?.enabled === true || modern.length > 0;
  const spec =
    legacy?.enabled === true && layers.length === 0
      ? legacy
      : !legacy?.enabled &&
          layers.length === 1 &&
          modern.length === 1 &&
          modern[0].enabled === true &&
          modern[0].sshTunnel?.forwardType === "local"
        ? modern[0].sshTunnel
        : undefined;
  if (!needed) return { needed: false };
  if (
    !spec ||
    ("ownerDatabaseId" in spec &&
      spec.ownerDatabaseId !== undefined &&
      spec.ownerDatabaseId !== options.ownerDatabaseId)
  )
    return { needed: true };
  let selected: Connection | undefined;
  if (spec.connectionId) {
    const matches = options.connections.filter(
      (item) => item.id === spec.connectionId,
    );
    selected =
      matches.length === 1 &&
      matches[0].protocol === "ssh" &&
      !matches[0].isGroup
        ? matches[0]
        : undefined;
  } else if ("host" in spec && text(spec.host, 255)) {
    selected = {
      protocol: "ssh",
      hostname: spec.host,
      port: "port" in spec ? (spec.port ?? 22) : 22,
    } as Connection;
  }
  const host = endpointHost(
    selected ? connectionEndpointHost(selected) : undefined,
  );
  if (
    !selected ||
    !host ||
    !Number.isInteger(selected.port ?? 22) ||
    (selected.port ?? 22) < 1 ||
    (selected.port ?? 22) > 65535
  )
    return { needed: true };
  return {
    needed: true,
    host,
    port: selected.port ?? 22,
    connectionId: spec.connectionId,
    identity: stableJsonStringify([
      tunnelSourceIdentity(row),
      tunnelSourceIdentity(selected),
      host,
    ]),
    commandSettingsIdentity: stableJsonStringify(
      options.settings.sshConnection ?? null,
    ),
    policy: resolveEffectiveTrustPolicy(
      selected.sshTrustPolicy,
      options.settings.sshTrustPolicy,
      options.settings.trustPolicy,
    ),
  };
}

/** Native correlation is mandatory. No endpoint-only matching or credential reads. */
export function useOriginBrowserSshTrust(
  options: NativeBrowserSshTrustOptions,
) {
  const current = useRef(options);
  current.current = options;
  const selected = source(options);
  const correlation = `native-browser:${options.sessionId}`;
  const binding = stableJsonStringify(selected);
  const [registered, setRegistered] = useState<{
    token: object;
    binding: string;
    proof: NativeBrowserSshTrustOptions["proof"];
    correlation: string;
  } | null>(null);
  const [failure, setFailure] = useState<{
    token: object;
    binding: string;
    proof: NativeBrowserSshTrustOptions["proof"];
    correlation: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const token = useRef<object | null>(null);
  const seen = useRef(new Set<string>());

  useLayoutEffect(() => {
    const selected = source(current.current);
    if (
      !selected.needed ||
      !options.enabled ||
      !options.proof ||
      !options.ownerDatabaseId
    )
      return;
    if (listeners.has(correlation)) return;
    const owner = {};
    token.current = owner;
    listeners.set(correlation, owner);
    let active = true;
    const unlisteners: Array<() => void> = [];
    let registrationFailed = false;
    const retain = (promise: Promise<() => void>) =>
      promise.then((off) => {
        let listening = true;
        const once = () => {
          if (listening) {
            listening = false;
            off();
          }
        };
        if (!active || registrationFailed) once();
        else unlisteners.push(once);
        return once;
      });
    const commandPrompts = new Map<
      string,
      { controller: AbortController; requestId: string }
    >();
    const answeredCommands = new Set<string>();
    const seenCommands = new Set<string>();
    const respondCommand = async (nonce: string, accepted: boolean) => {
      if (answeredCommands.has(nonce)) return;
      answeredCommands.add(nonce);
      commandPrompts.delete(nonce);
      try {
        await invoke("origin_browser_ssh_respond_to_command_review", {
          nonce,
          accepted,
        });
      } catch {
        /* Native expiry/cancellation has no execution fallback. */
      }
    };
    const pending = new Set<string>();
    const answered = new Set<string>();
    const respond = async (
      sessionId: string,
      decision: "reject" | "accept_and_save",
    ) => {
      if (answered.has(sessionId)) return;
      answered.add(sessionId);
      pending.delete(sessionId);
      try {
        await invoke("ssh_respond_to_host_key_prompt", { sessionId, decision });
      } catch {
        /* A cancelled/timed-out native attempt has no trust fallback. */
      }
    };
    const check = (requireResolved = true) => {
      const live = current.current;
      const scope = getTrustStoreScope();
      if (
        !active ||
        listeners.get(correlation) !== owner ||
        !live.enabled ||
        live.sessionId !== options.sessionId ||
        live.ownerDatabaseId !== options.ownerDatabaseId ||
        !live.proof ||
        live.proof !== options.proof ||
        (requireResolved && !scope.resolved) ||
        (scope.databaseId !== options.ownerDatabaseId &&
          (requireResolved || scope.resolved || scope.databaseId !== null)) ||
        (live.isPending && !live.isPending()) ||
        stableJsonStringify(source(live)) !== binding
      )
        throw new Error("Native browser SSH trust authority changed.");
      live.proof.assertCurrent();
    };
    const hostListening = retain(
      listen<Prompt>("ssh://host-key-prompt", async ({ payload }) => {
        if (
          !active ||
          payload?.host_key_prompt_id !== correlation ||
          !text(payload.session_id, 256)
        )
          return;
        if (seen.current.has(payload.session_id)) return;
        if (seen.current.size >= 256) {
          await respond(payload.session_id, "reject");
          return;
        }
        seen.current.add(payload.session_id);
        pending.add(payload.session_id);
        let decision: "reject" | "accept_and_save" = "reject";
        try {
          check(false);
          if (
            !selected.host ||
            payload.host !== selected.host ||
            payload.port !== selected.port ||
            !["first_use", "mismatch"].includes(payload.status) ||
            !text(payload.fingerprint, 512) ||
            (payload.key_type != null && !text(payload.key_type, 128)) ||
            (payload.key_bits != null &&
              (!Number.isSafeInteger(payload.key_bits) ||
                payload.key_bits < 1)) ||
            (payload.public_key != null && !text(payload.public_key, 16384))
          )
            throw new Error(
              "Native SSH prompt is not bound to the selected source.",
            );
          await ensureTrustStoreReady();
          check();
          const identity = {
            fingerprint: payload.fingerprint,
            keyType: payload.key_type ?? undefined,
            keyBits: payload.key_bits ?? undefined,
            publicKey: payload.public_key ?? undefined,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
          };
          const verification = await verifyIdentity(
            selected.host,
            selected.port,
            "ssh",
            identity,
            selected.connectionId,
          );
          check();
          const mismatch =
            payload.status === "mismatch" || verification.status === "mismatch";
          if (verification.status === "trusted" && !mismatch)
            decision = "accept_and_save";
          else if (
            selected.policy !== "strict" &&
            window.confirm(
              `${mismatch ? "WARNING: SSH HOST KEY CHANGED" : "New SSH host key"}\n${selected.host}:${selected.port}\n${payload.key_type ?? "SSH"}\nSHA-256 fingerprint: ${payload.fingerprint}\n\nVerify this fingerprint with the server administrator. Trust and save this key for this browser's SSH tunnel?`,
            )
          ) {
            check();
            await trustIdentity(
              selected.host,
              selected.port,
              "ssh",
              identity,
              true,
              selected.connectionId,
            );
            check();
            decision = "accept_and_save";
          }
        } catch {
          decision = "reject";
        }
        if (decision !== "reject") {
          try {
            check();
          } catch {
            decision = "reject";
          }
        }
        await respond(payload.session_id, decision);
      }),
    );
    const commandListening = retain(
      listen<{
        nonce: string;
        createRequestId: string;
        hostKeyPromptId: string;
        commandPreview?: string;
        closed?: boolean;
      }>("ssh://native-browser-command-review", async ({ payload }) => {
        if (
          !active ||
          payload?.hostKeyPromptId !== correlation ||
          !text(payload.nonce, 256)
        )
          return;
        if (payload.closed === true) {
          commandPrompts.get(payload.nonce)?.controller.abort();
          return;
        }
        if (seenCommands.has(payload.nonce)) return;
        if (seenCommands.size >= 256) {
          await respondCommand(payload.nonce, false);
          return;
        }
        seenCommands.add(payload.nonce);
        const controller = new AbortController();
        commandPrompts.set(payload.nonce, {
          controller,
          requestId: payload.createRequestId,
        });
        let accepted = false;
        const checkRequest = (resolved = false) => {
          check(resolved);
          if (
            !text(payload.createRequestId, 256) ||
            current.current.getPendingCreateRequestId?.() !==
              payload.createRequestId ||
            controller.signal.aborted
          )
            throw new Error("The SSH command request changed.");
        };
        try {
          checkRequest();
          if (
            typeof payload.commandPreview !== "string" ||
            payload.commandPreview.length === 0 ||
            payload.commandPreview.length > 16384 ||
            payload.commandPreview.includes("\0")
          )
            throw new Error("The SSH command preview is unavailable.");
          await ensureTrustStoreReady();
          checkRequest(true);
          const decision = await requestPrompt(
            {
              title: "Run this browser's SSH ProxyCommand?",
              message:
                "This command establishes the saved SSH route. Review it before continuing; credential values in the preview are masked.",
              confirmLabel: "Run command",
              defaultAction: "cancel",
              preview: {
                label: "SSH ProxyCommand",
                text: payload.commandPreview,
              },
            },
            { signal: controller.signal },
          );
          checkRequest(true);
          accepted = decision.confirmed;
        } catch {
          accepted = false;
        }
        await respondCommand(payload.nonce, accepted);
      }),
    );
    void Promise.all([hostListening, commandListening])
      .then((offs) => {
        const off = () => offs.forEach((close) => close());
        if (!active) {
          off();
          return;
        }
        setRegistered({
          token: owner,
          binding,
          proof: options.proof,
          correlation,
        });
      })
      .catch(() => {
        registrationFailed = true;
        unlisteners.forEach((off) => off());
        if (active)
          setFailure({
            token: owner,
            binding,
            proof: options.proof,
            correlation,
          });
      });
    return () => {
      active = false;
      if (token.current === owner) token.current = null;
      if (listeners.get(correlation) === owner) listeners.delete(correlation);
      unlisteners.forEach((off) => off());
      for (const [nonce, prompt] of commandPrompts) {
        prompt.controller.abort();
        void respondCommand(nonce, false);
      }
      for (const sessionId of pending) void respond(sessionId, "reject");
    };
  }, [
    binding,
    correlation,
    options.enabled,
    options.ownerDatabaseId,
    options.proof,
    options.sessionId,
    selected.needed,
    attempt,
  ]);
  const failed = !!(
    selected.needed &&
    options.enabled &&
    failure &&
    failure.token === token.current &&
    failure.binding === binding &&
    failure.proof === options.proof &&
    failure.correlation === correlation
  );
  return {
    ready:
      !selected.needed ||
      (!!options.enabled &&
        !!options.proof &&
        registered !== null &&
        registered.token === token.current &&
        registered.binding === binding &&
        registered.proof === options.proof &&
        registered.correlation === correlation),
    failed,
    retry,
    error: failed
      ? "SSH host-key verification could not start. Retry the browser connection; no host key was accepted."
      : undefined,
  };
}
