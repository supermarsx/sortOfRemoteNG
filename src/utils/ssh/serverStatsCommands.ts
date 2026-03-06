// ─── SSH Server Stats Commands ──────────────────────────────────────────────
// Shell commands that work across common Linux distros (Ubuntu/Debian,
// RHEL/CentOS/Fedora/Rocky, SUSE, Arch, Alpine, Amazon Linux).
//
// Every command is written defensively — uses fallbacks when a tool is
// unavailable, avoids non-POSIX syntax, and gracefully degrades.

/**
 * Single "mega-script" that collects all server stats in one SSH round-trip.
 * Output is a well-known JSON structure that can be parsed on the frontend.
 * The script uses `cat /proc/*`, standard coreutils, and ss/netstat
 * fallbacks so it works on virtually any modern Linux distribution.
 *
 * Each section is wrapped in a clearly delimited marker so we can parse
 * even if one section fails.
 */
export function buildStatsCollectionScript(options: {
  cpu: boolean;
  memory: boolean;
  disk: boolean;
  system: boolean;
  firewall: boolean;
  ports: boolean;
}): string {
  const sections: string[] = [];

  // ── Header marker ────────────────────────────────────────────────
  sections.push('echo "===SORNG_STATS_BEGIN==="');

  // ── CPU ──────────────────────────────────────────────────────────
  if (options.cpu) {
    sections.push(`
echo "===CPU_BEGIN==="
# CPU model
grep -m1 'model name' /proc/cpuinfo 2>/dev/null || echo "model name : unknown"
# Core count
echo "cpu_cores:$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 1)"
# Load averages
cat /proc/loadavg 2>/dev/null || echo "0 0 0 0 0"
# CPU usage snapshot from /proc/stat (two samples 1s apart)
cpu1=$(head -1 /proc/stat); sleep 1; cpu2=$(head -1 /proc/stat)
echo "cpu_stat_1:$cpu1"
echo "cpu_stat_2:$cpu2"
echo "===CPU_END==="
`);
  }

  // ── Memory ───────────────────────────────────────────────────────
  if (options.memory) {
    sections.push(`
echo "===MEM_BEGIN==="
cat /proc/meminfo 2>/dev/null | grep -E '^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree):'
echo "===MEM_END==="
`);
  }

  // ── Disk ─────────────────────────────────────────────────────────
  if (options.disk) {
    sections.push(`
echo "===DISK_BEGIN==="
df -BK -T 2>/dev/null | grep -vE '^Filesystem|tmpfs|devtmpfs|overlay|squashfs'
echo "---DISK_IO---"
cat /proc/diskstats 2>/dev/null | head -20
echo "===DISK_END==="
`);
  }

  // ── System info ──────────────────────────────────────────────────
  if (options.system) {
    sections.push(`
echo "===SYS_BEGIN==="
echo "hostname:$(hostname 2>/dev/null || cat /etc/hostname 2>/dev/null || echo unknown)"
echo "kernel:$(uname -r 2>/dev/null || echo unknown)"
echo "arch:$(uname -m 2>/dev/null || echo unknown)"
echo "server_time:$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
# Uptime
echo "uptime_s:$(cat /proc/uptime 2>/dev/null | awk '{print $1}')"
uptime 2>/dev/null | sed 's/^/uptime_raw:/'
# Logged in users count
echo "users:$(who 2>/dev/null | wc -l)"
# OS detection — try multiple locations
if [ -f /etc/os-release ]; then
  . /etc/os-release
  echo "os_name:$PRETTY_NAME"
  echo "os_version:$VERSION_ID"
elif [ -f /etc/redhat-release ]; then
  echo "os_name:$(cat /etc/redhat-release)"
  echo "os_version:unknown"
elif [ -f /etc/alpine-release ]; then
  echo "os_name:Alpine Linux $(cat /etc/alpine-release)"
  echo "os_version:$(cat /etc/alpine-release)"
else
  echo "os_name:$(uname -s) $(uname -r)"
  echo "os_version:unknown"
fi
echo "===SYS_END==="
`);
  }

  // ── Firewall ─────────────────────────────────────────────────────
  if (options.firewall) {
    sections.push(`
echo "===FW_BEGIN==="
# Detect firewall backend and dump rules
if command -v ufw >/dev/null 2>&1; then
  echo "fw_backend:ufw"
  ufw status verbose 2>/dev/null || echo "fw_error:permission denied"
elif command -v firewall-cmd >/dev/null 2>&1; then
  echo "fw_backend:firewalld"
  firewall-cmd --list-all 2>/dev/null || echo "fw_error:permission denied"
elif command -v nft >/dev/null 2>&1; then
  echo "fw_backend:nftables"
  nft list ruleset 2>/dev/null || echo "fw_error:permission denied"
elif command -v iptables >/dev/null 2>&1; then
  echo "fw_backend:iptables"
  iptables -L -n --line-numbers 2>/dev/null || echo "fw_error:permission denied"
else
  echo "fw_backend:none"
fi
echo "===FW_END==="
`);
  }

  // ── Port monitor ─────────────────────────────────────────────────
  if (options.ports) {
    sections.push(`
echo "===PORTS_BEGIN==="
# Prefer ss, fall back to netstat
if command -v ss >/dev/null 2>&1; then
  echo "port_tool:ss"
  ss -tulnp 2>/dev/null || ss -tuln 2>/dev/null
  echo "---PORT_COUNTS---"
  echo "established:$(ss -t state established 2>/dev/null | tail -n +2 | wc -l)"
  echo "time_wait:$(ss -t state time-wait 2>/dev/null | tail -n +2 | wc -l)"
elif command -v netstat >/dev/null 2>&1; then
  echo "port_tool:netstat"
  netstat -tulnp 2>/dev/null || netstat -tuln 2>/dev/null
  echo "---PORT_COUNTS---"
  echo "established:$(netstat -ant 2>/dev/null | grep ESTABLISHED | wc -l)"
  echo "time_wait:$(netstat -ant 2>/dev/null | grep TIME_WAIT | wc -l)"
else
  echo "port_tool:none"
fi
echo "===PORTS_END==="
`);
  }

  sections.push('echo "===SORNG_STATS_END==="');

  return sections.join("\n");
}
