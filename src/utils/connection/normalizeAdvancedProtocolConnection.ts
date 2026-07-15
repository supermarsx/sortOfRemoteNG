import type { Connection } from "../../types/connection/connection";
import {
  migrateRawSocketProtocol,
  normalizeRawSocketSettings,
} from "../../types/protocols/rawSocket";
import { normalizePowerShellRemotingSettings } from "../powershell/normalizePowerShellRemoting";
import { normalizeRloginSettings } from "../rlogin/rloginSettings";

export type AdvancedProtocolConnectionInput = Omit<
  Partial<Connection>,
  "protocol"
> & {
  /** Persisted databases may contain a legacy Raw Socket alias. */
  protocol?: string;
};

/**
 * Canonicalize versioned protocol settings at every connection persistence
 * boundary. The function is intentionally pure and idempotent so loading,
 * editing, adding, and updating a connection all produce the same shape.
 */
export function normalizeAdvancedProtocolConnection(
  input: Connection,
): Connection;
export function normalizeAdvancedProtocolConnection(
  input: AdvancedProtocolConnectionInput,
): Partial<Connection>;
export function normalizeAdvancedProtocolConnection(
  input: AdvancedProtocolConnectionInput,
): Partial<Connection> {
  const sourceProtocol = String(input.protocol ?? "")
    .trim()
    .toLowerCase();
  const rawMigration = migrateRawSocketProtocol(
    sourceProtocol,
    input.rawSocketSettings,
  );
  const protocol = rawMigration?.protocol ?? input.protocol;
  const next: AdvancedProtocolConnectionInput = { ...input, protocol };
  const canInitialize = input.isGroup !== true;

  if (
    rawMigration ||
    input.rawSocketSettings !== undefined ||
    (canInitialize && protocol === "raw")
  ) {
    next.rawSocketSettings =
      rawMigration?.settings ??
      normalizeRawSocketSettings(input.rawSocketSettings);
  }

  if (
    input.rloginSettings !== undefined ||
    (canInitialize && protocol === "rlogin")
  ) {
    next.rloginSettings = normalizeRloginSettings(
      input.rloginSettings ?? { remoteUsername: input.username },
    );
  }

  if (
    input.powerShellRemoting !== undefined ||
    (canInitialize && protocol === "winrm")
  ) {
    const legacySeed =
      input.powerShellRemoting ??
      ({
        ...(input.winrmSettings ?? {}),
        username: input.username,
        domain: input.domain,
      } as Record<string, unknown>);
    next.powerShellRemoting =
      normalizePowerShellRemotingSettings(legacySeed).settings;
  }

  if (protocol === "raw" || protocol === "rlogin") {
    next.username = undefined;
    next.password = undefined;
    next.domain = undefined;
    next.privateKey = undefined;
    next.passphrase = undefined;
    next.totpSecret = undefined;
    next.authType = undefined;
  }

  return next as Partial<Connection>;
}
