import type { Connection } from "../../types/connection/connection";
import {
  migrateRawSocketProtocol,
  normalizeRawSocketSettings,
} from "../../types/protocols/rawSocket";
import { normalizeArdSettings } from "../../types/protocols/ard";
import { normalizeSerialSettings } from "../../types/protocols/serial";
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
  const protocol =
    rawMigration?.protocol ??
    (sourceProtocol === "postgres" ? "postgresql" : input.protocol);
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
    input.ardSettings !== undefined ||
    (canInitialize && protocol === "ard")
  ) {
    next.ardSettings = normalizeArdSettings(input.ardSettings);
    if (next.ardSettings.authMode === "appleAccountNative") {
      // Authentication is owned entirely by Screen Sharing.app. Never carry
      // an embedded credential through load/import/save normalization.
      next.username = undefined;
      next.password = undefined;
    } else if (next.ardSettings.authMode === "vncPassword") {
      next.username = undefined;
    }
  }

  if (
    input.serialSettings !== undefined ||
    (canInitialize && protocol === "serial")
  ) {
    next.serialSettings = normalizeSerialSettings(
      input.serialSettings ?? { portName: input.hostname },
    );
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

  if (canInitialize && protocol === "postgresql") {
    next.port = input.port && input.port > 0 ? input.port : 5432;
    next.username = input.username?.trim() || "postgres";
    next.database = input.database?.trim() || "postgres";
    next.postgresSslMode = input.postgresSslMode ?? "prefer";
    next.postgresConnectionTimeoutSecs =
      input.postgresConnectionTimeoutSecs ??
      (input.timeout && input.timeout > 0 ? input.timeout : 10);
  }

  if (canInitialize && protocol === "spice") {
    next.port = input.port && input.port > 0 ? input.port : 5900;
    next.spiceFullscreen = input.spiceFullscreen ?? false;
    next.spiceViewOnly = input.spiceViewOnly ?? false;
    // remote-viewer's connection-file contract cannot enforce clipboard-off;
    // keep the supported fixed-on setting instead of persisting a dead toggle.
    next.spiceShareClipboard = true;
    next.spiceUsbRedirection = input.spiceUsbRedirection ?? false;
    next.spiceAudioPlayback = input.spiceAudioPlayback ?? true;
    next.spiceRequireTls = input.spiceRequireTls ?? false;
    // Unverified certificates are intentionally unsupported by the native
    // handoff. Legacy unsafe values migrate back to verified trust.
    next.spiceAllowSelfSigned = false;
  }

  if (canInitialize && protocol === "xdmcp") {
    next.port = input.port && input.port > 0 ? input.port : 177;
    next.xdmcpQueryType = input.xdmcpQueryType ?? "Direct";
    next.xdmcpResolutionWidth = input.xdmcpResolutionWidth ?? 1024;
    next.xdmcpResolutionHeight = input.xdmcpResolutionHeight ?? 768;
    // The supported external X servers do not expose a portable depth switch
    // through this handoff; keep the backend's enforced 24-bit default.
    next.xdmcpColorDepth = 24;
    next.xdmcpFullscreen = input.xdmcpFullscreen ?? false;
    next.xdmcpAcknowledgeInsecureTransport =
      input.xdmcpAcknowledgeInsecureTransport ?? false;
  }

  if (canInitialize && protocol === "x2go") {
    next.port = input.port && input.port > 0 ? input.port : 22;
    next.x2goSessionType = input.x2goSessionType ?? "Xfce";
    next.x2goAuthMode = input.x2goAuthMode ?? "password";
    next.x2goFullscreen = input.x2goFullscreen ?? false;
    next.x2goWidth = input.x2goWidth ?? 1280;
    next.x2goHeight = input.x2goHeight ?? 800;
    next.x2goCompression = input.x2goCompression ?? "Adsl";
    next.x2goDpi = input.x2goDpi ?? 96;
    next.x2goKeyboardLayout = input.x2goKeyboardLayout ?? "us";
    next.x2goKeyboardModel = input.x2goKeyboardModel ?? "pc105/us";
    next.x2goAudioEnabled = input.x2goAudioEnabled ?? true;
    next.x2goPrintingEnabled = input.x2goPrintingEnabled ?? false;
    next.x2goClipboard = input.x2goClipboard ?? "Both";
    next.x2goRootless = input.x2goRootless ?? false;
    next.x2goPublishedApplications = input.x2goPublishedApplications ?? false;
    next.x2goSharedFolders = input.x2goSharedFolders ?? [];
    next.sshConnectTimeout = 30;
    next.ignoreSshSecurityErrors = false;
    next.sshKnownHostsPath = undefined;
    next.sshConnectionConfigOverride = undefined;
  }

  if (canInitialize && protocol === "nx") {
    const connectionService = input.nxConnectionService ?? "nx";
    next.nxConnectionService = connectionService;
    next.port =
      input.port && input.port > 0
        ? input.port
        : connectionService === "ssh"
          ? 22
          : 4000;
    next.nxSessionType = input.nxSessionType ?? "UnixDesktop";
    next.nxWidth = input.nxWidth ?? 1280;
    next.nxHeight = input.nxHeight ?? 800;
    next.nxFullscreen = input.nxFullscreen ?? false;
    next.nxAudioEnabled = input.nxAudioEnabled ?? true;
    next.nxClipboardEnabled = true;
    next.ignoreSshSecurityErrors = false;
    next.sshKnownHostsPath = undefined;
    next.sshConnectionConfigOverride = undefined;
  }

  if (protocol === "raw" || protocol === "rlogin" || protocol === "serial") {
    if (protocol === "serial" && next.serialSettings) {
      next.hostname = next.serialSettings.portName;
      next.port = 0;
    }
    next.username = undefined;
    next.password = undefined;
    next.domain = undefined;
    next.privateKey = undefined;
    next.passphrase = undefined;
    next.totpSecret = undefined;
    next.authType = undefined;
  }

  if (protocol === "xdmcp") {
    next.username = undefined;
    next.password = undefined;
    next.domain = undefined;
    next.privateKey = undefined;
    next.passphrase = undefined;
    next.authType = undefined;
  }

  if (protocol === "spice") {
    next.username = undefined;
    next.domain = undefined;
    next.privateKey = undefined;
    next.passphrase = undefined;
    next.authType = "password";
  }

  if (protocol === "x2go" || protocol === "nx") {
    // Authentication happens in the trusted native client prompt. Passwords
    // and key passphrases saved for another protocol must never ride along.
    next.password = undefined;
    next.passphrase = undefined;
    next.domain = undefined;
    if (protocol === "x2go" && next.x2goAuthMode !== "privateKey") {
      next.privateKey = undefined;
    }
  }

  return next as Partial<Connection>;
}
