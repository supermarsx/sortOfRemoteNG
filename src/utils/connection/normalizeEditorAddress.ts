import type { Connection } from "../../types/connection/connection";
import {
  parseCanonicalWebAuthority,
  resolveCanonicalWebPort,
} from "./sanitizeHostname";
import { isBrowserProtocol } from "./browserConnectionType";

export const EDITOR_WEB_ADDRESS_ERROR =
  "Enter a hostname, IP address with an optional port, or a complete HTTP/HTTPS URL. Put sign-in details in Authentication; the address cannot contain user information, control characters or backslashes.";
export const EDITOR_WEB_ADDRESS_CONFLICT =
  "The saved website address conflicts with Protocol or Port. Review the address field before saving; unrelated edits cannot change the destination.";

/** Keep an explicitly edited Port coherent with a valid embedded authority. */
export function changeEditorAddressPort(
  draft: Partial<Connection>,
  port: number,
): Partial<Connection> {
  const result = { ...draft, port };
  if (
    !isBrowserProtocol(draft.protocol) ||
    draft.isGroup ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    return result;
  try {
    const normalized = normalizeEditorAddress(draft);
    const hostname = normalized.hostname!;
    const address = parseCanonicalWebAuthority(hostname);
    if (!address.sourceScheme && address.port === undefined) return result;
    const prefix = hostname.match(/^https?:\/\//iu)?.[0] ?? "";
    const body = hostname.slice(prefix.length);
    const split = body.search(/[/?#]/u);
    const authority = split < 0 ? body : body.slice(0, split);
    const suffix = split < 0 ? "" : body.slice(split);
    const host =
      address.port === undefined ? authority : authority.replace(/:\d+$/u, "");
    return {
      ...result,
      protocol: normalized.protocol,
      hostname: `${prefix}${host}:${port}${suffix}`,
    };
  } catch {
    return result;
  }
}

/** Explicit editor input wins the separate web transport/port controls.
 * Keep the supplied URL intact: paths, query parameters and fragments belong
 * to the destination and must never be stripped like a transport hostname. */
export function normalizeEditorAddress(
  draft: Partial<Connection>,
  original?: Partial<Connection>,
): Partial<Connection> {
  if (draft.isGroup || !isBrowserProtocol(draft.protocol)) return draft;
  const raw = draft.hostname ?? "";
  try {
    if (
      Array.from(raw).some(
        (character) =>
          character.charCodeAt(0) < 32 ||
          character.charCodeAt(0) === 127 ||
          character === "\\",
      )
    )
      throw new Error();
    let hostname = raw.trim();
    // A bare IPv6 literal is one whole address, never a guessed host:port.
    if (hostname.split(":").length > 2 && !/[/?#@\[\]]/u.test(hostname))
      hostname = new URL(`http://[${hostname}]/`).hostname;
    const address = parseCanonicalWebAuthority(hostname);
    if (
      address.sourceScheme &&
      hostname
        .replace(/^https?:\/\//iu, "")
        .split(/[/?#]/u)[0]
        .endsWith(":")
    )
      throw new Error();
    const protocol = address.sourceScheme ?? draft.protocol;
    if (
      original &&
      draft.hostname === original.hostname &&
      draft.protocol === original.protocol &&
      draft.port === original.port
    ) {
      try {
        if (
          hostname !== raw ||
          (address.sourceScheme && address.sourceScheme !== draft.protocol)
        )
          throw new Error();
        resolveCanonicalWebPort(
          address.port,
          draft.port,
          draft.protocol === "https" ? 443 : 80,
        );
        return draft;
      } catch {
        throw new Error(EDITOR_WEB_ADDRESS_CONFLICT);
      }
    }
    const port =
      address.port ??
      (address.sourceScheme
        ? address.sourceScheme === "https"
          ? 443
          : 80
        : draft.port);
    if (
      hostname === draft.hostname &&
      protocol === draft.protocol &&
      port === draft.port
    )
      return draft;
    return { ...draft, hostname, protocol, port };
  } catch (error) {
    if (error instanceof Error && error.message === EDITOR_WEB_ADDRESS_CONFLICT)
      throw error;
    throw new Error(EDITOR_WEB_ADDRESS_ERROR);
  }
}
