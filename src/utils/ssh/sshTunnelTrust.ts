import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  verifyIdentity,
  trustIdentity,
  getTrustStoreScope,
} from "../auth/trustStore";

interface HostKeyPrompt {
  session_id: string;
  host: string;
  port: number;
  username: string;
  status: "first_use" | "mismatch";
  fingerprint: string;
  key_type: string | null;
  key_bits: number | null;
  public_key: string | null;
}

// connect_ssh does not expose its native attempt id before the handshake.
// Never allow two tunnel policies to race for the same endpoint's prompt.
// This lease covers tunnel callers only; terminal/native attempt correlation
// must be supplied by the native API before endpoint matching can be removed.
const pendingEndpoints = new Set<string>();

/** Same event and Trust Center authority as the SSH terminal. Never silently accept a new key. */
export async function listenForTunnelTrust(
  host: string,
  port: number,
  username: string,
  connectionId: string | undefined,
  policy: string,
  assertCurrent: () => void,
): Promise<() => void> {
  const endpoint = JSON.stringify([host.toLowerCase(), port, username]);
  if (pendingEndpoints.has(endpoint))
    throw new Error(
      "An SSH tunnel is already awaiting host-key verification for this endpoint. Finish or cancel that attempt before retrying.",
    );
  pendingEndpoints.add(endpoint);
  let active = true;
  let claimed = false;
  let unlisten: (() => void) | undefined;
  const close = () => {
    if (!active) return;
    active = false;
    pendingEndpoints.delete(endpoint);
    unlisten?.();
  };
  try {
    const databaseId = getTrustStoreScope().databaseId;
    const check = () => {
      assertCurrent();
      if (!active || getTrustStoreScope().databaseId !== databaseId)
        throw new Error(
          "SSH tunnel trust scope changed. Reconnect after opening the owning database.",
        );
    };
    unlisten = await listen<HostKeyPrompt>(
      "ssh://host-key-prompt",
      async ({ payload }) => {
        if (
          !active ||
          claimed ||
          payload.host !== host ||
          payload.port !== port ||
          payload.username !== username
        )
          return;
        // Claim synchronously, before verification yields. A replay or a later
        // session at this endpoint must never receive this attempt's decision.
        claimed = true;
        let decision = "reject";
        try {
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
            host,
            port,
            "ssh",
            identity,
            connectionId,
          );
          check();
          const mismatch =
            payload.status === "mismatch" || verification.status === "mismatch";
          if (verification.status === "trusted" && !mismatch)
            decision = "accept_and_save";
          else if (
            policy !== "strict" &&
            window.confirm(
              `${mismatch ? "WARNING: SSH HOST KEY CHANGED" : "New SSH host key"}\n${host}:${port}\n${payload.key_type ?? "SSH"}\nSHA-256 fingerprint: ${payload.fingerprint}\n\nVerify this fingerprint with the server administrator. Trust and save this key for SSH tunnels?`,
            )
          ) {
            check();
            await trustIdentity(
              host,
              port,
              "ssh",
              identity,
              true,
              connectionId,
            );
            check();
            decision = "accept_and_save";
          }
        } catch {
          decision = "reject";
        }
        // A scope change or prompt failure must wake the native handshake with rejection.
        try {
          await invoke("ssh_respond_to_host_key_prompt", {
            sessionId: payload.session_id,
            decision,
          });
        } catch {
          /* The attempt may already have timed out; no trust fallback. */
        }
      },
    );
    return close;
  } catch (error) {
    close();
    throw error;
  }
}
