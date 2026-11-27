/** Observed remote machine/boot/namespace identity; never infer from a host
 * alias, IP address or display name. Missing identity keeps sessions separate. */
export function parseServerStatsIdentity(section: string): string | null {
  const value = (key: string) =>
    section.match(new RegExp(`^${key}:([^\\r\\n]+)$`, "m"))?.[1]?.trim() ?? "";
  const uuid =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const machine = value("machine").toLowerCase();
  const boot = value("boot").toLowerCase();
  const namespace = value("namespace");
  if (!/[1-9a-f]/.test(machine) || !/[1-9a-f]/.test(boot)) return null;
  if (
    value("kind") === "linux" &&
    /^[a-f0-9]{32}$/.test(machine) &&
    uuid.test(boot) &&
    /^uts:\[\d+\],pid:\[\d+\]$/.test(namespace)
  ) {
    return `linux:${machine}:${boot}:${namespace}`;
  }
  if (
    value("kind") === "bsd" &&
    uuid.test(machine) &&
    /^[1-9]\d{0,11}$/.test(boot)
  ) {
    return `bsd:${machine}:${boot}`;
  }
  return null;
}
