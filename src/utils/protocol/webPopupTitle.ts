/** TacticalRMM TakeControl.vue: `${hostname} - ${client} - ${site} | Take Control`.
 * Never infer a computer name from a route, opaque agent id, or a partial title.
 */
export function webPopupTitle(title: string): string {
  const fallback = "Take Control";
  if (title.length > 2048 || !title.endsWith(" | Take Control"))
    return fallback;
  const parts = title.slice(0, -" | Take Control".length).split(" - ");
  // More separators are ambiguous: a client/site may itself contain " - ".
  if (parts.length !== 3 || parts.some((part) => !part.trim())) return fallback;
  const hostname = parts[0]
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  // Do not turn a URL, markup, or credential-shaped value into session metadata.
  if (!hostname || /[<>|/\\?&#=:@]/u.test(hostname)) return fallback;
  const chars = Array.from(hostname);
  const display =
    chars.length > 100 ? `${chars.slice(0, 99).join("")}…` : hostname;
  return `${display} — Take Control`;
}
