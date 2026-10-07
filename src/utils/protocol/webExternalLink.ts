function localHost(hostname: string): boolean {
  return /^(?:localhost|.*\.localhost|127\..*|\[::1\]|\[::ffff:7f[0-9a-f]{2}:.*\]|0\.0\.0\.0)$/iu.test(
    hostname.replace(/\.$/u, ""),
  );
}

/** Only a public web address may cross from a website into the OS opener. */
export function externalWebLink(
  value: unknown,
  sourceOrigin: string,
): string | null {
  if (
    typeof value !== "string" ||
    value.length > 16_384 ||
    value !== value.trim() ||
    value.includes("\\") ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x20 || code === 0x7f;
    })
  )
    return null;
  try {
    const url = new URL(value);
    const source = new URL(sourceOrigin);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      !["https:", "http:"].includes(source.protocol) ||
      url.username ||
      url.password ||
      url.port === "0" ||
      url.origin === source.origin ||
      localHost(url.hostname)
    )
      return null;
    // Reject our routes/proofs even inside an encoded redirect parameter.
    // Do not strip/rebuild application query bytes: email links may be signed.
    let decoded = value;
    for (let depth = 0; depth < 5; depth++) {
      if (/__sorng_|__sortofremoteng/iu.test(decoded)) return null;
      // Inspect URL authorities, not innocent words in paths or search text.
      for (const nested of decoded.matchAll(
        /(?:https?:\/\/|(?:^|[=&#])\/\/)([^/?#\s<>"']+)/giu,
      )) {
        try {
          if (localHost(new URL(`https://${nested[1]}`).hostname)) return null;
        } catch {
          // A signed query is not necessarily a URL. Inspect the next decoded
          // form without changing or rejecting its original application bytes.
        }
      }
      // Decode ASCII escapes for inspection only. A literal '%' in a signed
      // application query must not cause that valid URL to be rejected.
      const next = decoded.replace(/%([0-9a-f]{2})/giu, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
      if (next === decoded) return url.href;
      decoded = next;
    }
    return null;
  } catch {
    return null;
  }
}
