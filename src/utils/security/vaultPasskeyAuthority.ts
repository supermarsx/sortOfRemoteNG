import { parse } from "tldts";

function canonicalHost(value: string): string | null {
  try {
    if (
      !value ||
      value.length > 253 ||
      /[\s/?#@%\\]/u.test(value) ||
      value.endsWith(".") ||
      (value.includes(":") && !(value.startsWith("[") && value.endsWith("]")))
    )
      return null;
    const url = new URL(`https://${value}`);
    return url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
      ? null
      : url.hostname;
  } catch {
    return null;
  }
}

/** Handoff eligibility only; the original-origin browser enforces WebAuthn. */
export function vaultPasskeyMatchesHost(
  rpId: string,
  hostname: string,
): boolean {
  const rp = canonicalHost(rpId),
    host = canonicalHost(hostname);
  if (!rp || !host) return false;
  const options = { allowPrivateDomains: true };
  const relyingParty = parse(rp, options),
    website = parse(host, options);
  if ((relyingParty.isIcann || relyingParty.isPrivate) && !relyingParty.domain)
    return false;
  if (rp === host) return true;
  return (
    !relyingParty.isIp &&
    !website.isIp &&
    host.endsWith(`.${rp}`) &&
    !!relyingParty.domain &&
    relyingParty.publicSuffix !== rp &&
    (relyingParty.isIcann === true || relyingParty.isPrivate === true) &&
    relyingParty.domain === website.domain
  );
}
