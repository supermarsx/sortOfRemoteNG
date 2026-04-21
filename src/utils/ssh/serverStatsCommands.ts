// ─── SSH Server Stats Commands ──────────────────────────────────────────────
// Shell commands with extensive fallbacks for:
//   Linux (Ubuntu, Debian, RHEL, CentOS, Fedora, Rocky, SUSE, Arch, Alpine, Amazon)
//   FreeBSD, OpenBSD, macOS/Darwin, BusyBox
//
// Every section is independently fenced so one failure doesn't break others.
// Each command tries multiple approaches and reports which method succeeded
// so the frontend can memorize the working method per host.

/**
 * Single "mega-script" that collects all server stats in one SSH round-trip.
 * Each section is wrapped in BEGIN/END markers and tries multiple detection
 * methods with clear "method:" tags so the frontend can cache what works.
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

  // Define a portable command timeout wrapper.
  // Wraps a single command with a time limit. Uses GNU `timeout` if
  // available, otherwise a background+kill POSIX fallback.
  sections.push(`
if command -v timeout >/dev/null 2>&1; then
  _t() { timeout "$@"; }
else
  _t() { local s="$1"; shift; eval "$@" & local p=$!; (sleep "$s" && kill "$p") 2>/dev/null & local w=$!; wait "$p" 2>/dev/null; kill "$w" 2>/dev/null; wait "$w" 2>/dev/null; }
fi
`);

  // ── Header marker ────────────────────────────────────────────────
  sections.push('echo "===SORNG_STATS_BEGIN==="');

  // ── CPU ──────────────────────────────────────────────────────────
  if (options.cpu) {
    sections.push(`
echo "===CPU_BEGIN==="
(
  # CPU model — try /proc first, then sysctl (BSD/macOS), then lscpu
  if [ -f /proc/cpuinfo ]; then
    echo "method:procfs"
    grep -m1 'model name' /proc/cpuinfo 2>/dev/null || echo "model name : unknown"
  elif command -v sysctl >/dev/null 2>&1; then
    echo "method:sysctl"
    model=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || sysctl -n hw.model 2>/dev/null || echo "unknown")
    echo "model name : $model"
  elif command -v lscpu >/dev/null 2>&1; then
    echo "method:lscpu"
    model=$(lscpu 2>/dev/null | grep -i 'model name' | sed 's/.*:\\s*//')
    echo "model name : $model"
  else
    echo "method:none"
    echo "model name : unknown"
  fi

  # Core count — extensive fallbacks
  cores=$(nproc 2>/dev/null \\
    || grep -c ^processor /proc/cpuinfo 2>/dev/null \\
    || sysctl -n hw.ncpu 2>/dev/null \\
    || sysctl -n hw.logicalcpu 2>/dev/null \\
    || getconf _NPROCESSORS_ONLN 2>/dev/null \\
    || echo 1)
  echo "cpu_cores:$cores"

  # Load averages
  if [ -f /proc/loadavg ]; then
    cat /proc/loadavg
  elif command -v sysctl >/dev/null 2>&1; then
    sysctl -n vm.loadavg 2>/dev/null | tr -d '{}'
  elif command -v uptime >/dev/null 2>&1; then
    uptime 2>/dev/null | awk -F'load average:' '{print $2}' | tr ',' ' '
  else
    echo "0 0 0 0 0"
  fi

  # CPU usage — /proc/stat (Linux) or top fallback
  if [ -f /proc/stat ]; then
    cpu1=$(head -1 /proc/stat); sleep 1; cpu2=$(head -1 /proc/stat)
    echo "cpu_stat_1:$cpu1"
    echo "cpu_stat_2:$cpu2"
  elif command -v top >/dev/null 2>&1; then
    # macOS/BSD top -l1 for one snapshot
    idle=$(top -l1 2>/dev/null | grep -i 'cpu usage' | awk '{print $7}' | tr -d '%' || echo "0")
    echo "cpu_top_idle:$idle"
  fi
) 2>/dev/null
echo "===CPU_END==="
`);
  }

  // ── Memory ───────────────────────────────────────────────────────
  if (options.memory) {
    sections.push(`
echo "===MEM_BEGIN==="
(
  if [ -f /proc/meminfo ]; then
    echo "method:procfs"
    grep -E '^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree):' /proc/meminfo
  elif command -v sysctl >/dev/null 2>&1 && command -v vm_stat >/dev/null 2>&1; then
    # macOS
    echo "method:vm_stat"
    total=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
    echo "MemTotal:        $((total / 1024)) kB"
    # vm_stat gives pages; page size typically 4096
    pgsz=$(vm_stat 2>/dev/null | head -1 | grep -o '[0-9]*' || echo 4096)
    free_pages=$(vm_stat 2>/dev/null | grep 'Pages free' | awk '{print $3}' | tr -d '.')
    echo "MemFree:         $(( (free_pages * pgsz) / 1024 )) kB"
    echo "MemAvailable:    $(( (free_pages * pgsz) / 1024 )) kB"
    echo "SwapTotal:       0 kB"
    echo "SwapFree:        0 kB"
  elif command -v sysctl >/dev/null 2>&1; then
    # FreeBSD/OpenBSD
    echo "method:sysctl"
    pgsz=$(sysctl -n hw.pagesize 2>/dev/null || echo 4096)
    total=$(sysctl -n hw.physmem 2>/dev/null || echo 0)
    free_pg=$(sysctl -n vm.stats.vm.v_free_count 2>/dev/null || echo 0)
    echo "MemTotal:        $((total / 1024)) kB"
    echo "MemFree:         $(( (free_pg * pgsz) / 1024 )) kB"
    echo "MemAvailable:    $(( (free_pg * pgsz) / 1024 )) kB"
    echo "SwapTotal:       0 kB"
    echo "SwapFree:        0 kB"
  elif command -v free >/dev/null 2>&1; then
    echo "method:free"
    free -k 2>/dev/null | awk '/^Mem:/{printf "MemTotal: %d kB\\nMemFree: %d kB\\nMemAvailable: %d kB\\n",$2,$4,$7} /^Swap:/{printf "SwapTotal: %d kB\\nSwapFree: %d kB\\n",$2,$4}'
  else
    echo "method:none"
    echo "MemTotal:        0 kB"
    echo "MemFree:         0 kB"
  fi
) 2>/dev/null
echo "===MEM_END==="
`);
  }

  // ── Disk ─────────────────────────────────────────────────────────
  if (options.disk) {
    sections.push(`
echo "===DISK_BEGIN==="
(
  # df — works on all POSIX systems; -T for fstype may not work everywhere
  if _t 3 df -BK -T / >/dev/null 2>&1; then
    echo "method:df-BK-T"
    _t 5 df -BK -T 2>/dev/null | grep -vE '^Filesystem|tmpfs|devtmpfs|overlay|squashfs'
  elif _t 3 df -k / >/dev/null 2>&1; then
    echo "method:df-k"
    _t 5 df -k 2>/dev/null | grep -vE '^Filesystem|tmpfs|devtmpfs|overlay|squashfs'
  else
    echo "method:none"
  fi
  echo "---DISK_IO---"
  if [ -f /proc/diskstats ]; then
    cat /proc/diskstats 2>/dev/null | head -20
  elif command -v iostat >/dev/null 2>&1; then
    iostat -d 2>/dev/null | head -20
  fi
) 2>/dev/null
echo "===DISK_END==="
`);
  }

  // ── System info ──────────────────────────────────────────────────
  if (options.system) {
    sections.push(`
echo "===SYS_BEGIN==="
(
  echo "hostname:$(hostname 2>/dev/null || cat /etc/hostname 2>/dev/null || echo unknown)"
  echo "kernel:$(uname -r 2>/dev/null || echo unknown)"
  echo "arch:$(uname -m 2>/dev/null || echo unknown)"
  echo "server_time:$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"

  # Uptime — /proc first, then sysctl, then uptime command
  if [ -f /proc/uptime ]; then
    echo "uptime_s:$(awk '{print $1}' /proc/uptime)"
  elif command -v sysctl >/dev/null 2>&1; then
    boot=$(sysctl -n kern.boottime 2>/dev/null | grep -o 'sec = [0-9]*' | awk '{print $3}')
    now=$(date +%s)
    if [ -n "$boot" ] && [ -n "$now" ]; then
      echo "uptime_s:$((now - boot))"
    fi
  fi
  uptime 2>/dev/null | sed 's/^/uptime_raw:/'

  # Logged-in users
  echo "users:$(who 2>/dev/null | wc -l | tr -d ' ')"

  # OS detection — try every known method
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
  elif [ -f /etc/debian_version ]; then
    echo "os_name:Debian $(cat /etc/debian_version)"
    echo "os_version:$(cat /etc/debian_version)"
  elif command -v sw_vers >/dev/null 2>&1; then
    echo "os_name:$(sw_vers -productName 2>/dev/null) $(sw_vers -productVersion 2>/dev/null)"
    echo "os_version:$(sw_vers -productVersion 2>/dev/null)"
  elif command -v freebsd-version >/dev/null 2>&1; then
    echo "os_name:FreeBSD $(freebsd-version 2>/dev/null)"
    echo "os_version:$(freebsd-version 2>/dev/null)"
  else
    echo "os_name:$(uname -s 2>/dev/null) $(uname -r 2>/dev/null)"
    echo "os_version:unknown"
  fi
) 2>/dev/null
echo "===SYS_END==="
`);
  }

  // ── Firewall ─────────────────────────────────────────────────────
  if (options.firewall) {
    sections.push(`
echo "===FW_BEGIN==="
(
  if command -v ufw >/dev/null 2>&1; then
    echo "fw_backend:ufw"
    _t 5 sudo -n ufw status verbose 2>/dev/null || _t 5 ufw status verbose 2>/dev/null || echo "fw_error:permission denied or timeout"
  elif command -v firewall-cmd >/dev/null 2>&1; then
    echo "fw_backend:firewalld"
    _t 5 sudo -n firewall-cmd --list-all 2>/dev/null || _t 5 firewall-cmd --list-all 2>/dev/null || echo "fw_error:permission denied or timeout"
  elif command -v nft >/dev/null 2>&1; then
    echo "fw_backend:nftables"
    _t 5 sudo -n nft list ruleset 2>/dev/null || _t 5 nft list ruleset 2>/dev/null || echo "fw_error:permission denied or timeout"
  elif command -v iptables >/dev/null 2>&1; then
    echo "fw_backend:iptables"
    _t 5 sudo -n iptables -L -n --line-numbers 2>/dev/null || _t 5 iptables -L -n --line-numbers 2>/dev/null || echo "fw_error:permission denied or timeout"
  elif command -v pfctl >/dev/null 2>&1; then
    echo "fw_backend:pf"
    _t 5 sudo -n pfctl -sr 2>/dev/null || _t 5 pfctl -sr 2>/dev/null || echo "fw_error:permission denied or timeout"
  elif command -v ipfw >/dev/null 2>&1; then
    echo "fw_backend:ipfw"
    _t 5 sudo -n ipfw list 2>/dev/null || _t 5 ipfw list 2>/dev/null || echo "fw_error:permission denied or timeout"
  else
    echo "fw_backend:none"
  fi
) 2>/dev/null
echo "===FW_END==="
`);
  }

  // ── Port monitor ─────────────────────────────────────────────────
  if (options.ports) {
    sections.push(`
echo "===PORTS_BEGIN==="
(
  if command -v ss >/dev/null 2>&1; then
    echo "port_tool:ss"
    _t 5 ss -tulnp 2>/dev/null || _t 5 ss -tuln 2>/dev/null
    echo "---PORT_COUNTS---"
    echo "established:$(_t 3 ss -t state established 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
    echo "time_wait:$(_t 3 ss -t state time-wait 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
  elif command -v netstat >/dev/null 2>&1; then
    echo "port_tool:netstat"
    _t 5 netstat -tulnp 2>/dev/null || _t 5 netstat -tuln 2>/dev/null || _t 5 netstat -an 2>/dev/null | head -60
    echo "---PORT_COUNTS---"
    echo "established:$(_t 3 netstat -ant 2>/dev/null | grep -c ESTABLISHED || echo 0)"
    echo "time_wait:$(_t 3 netstat -ant 2>/dev/null | grep -c TIME_WAIT || echo 0)"
  elif command -v sockstat >/dev/null 2>&1; then
    echo "port_tool:sockstat"
    _t 5 sockstat -4 -l 2>/dev/null
    echo "---PORT_COUNTS---"
    echo "established:$(_t 3 sockstat -4 -c 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
    echo "time_wait:0"
  elif command -v lsof >/dev/null 2>&1; then
    echo "port_tool:lsof"
    _t 5 lsof -i -P -n 2>/dev/null | grep LISTEN | head -40
    echo "---PORT_COUNTS---"
    echo "established:$(_t 3 lsof -i -P -n 2>/dev/null | grep -c ESTABLISHED || echo 0)"
    echo "time_wait:0"
  else
    echo "port_tool:none"
  fi
) 2>/dev/null
echo "===PORTS_END==="
`);
  }

  sections.push('echo "===SORNG_STATS_END==="');

  return sections.join("\n");
}
