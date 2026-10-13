param([Parameter(Mandatory=$true)][string]$Executable,
      [Parameter(Mandatory=$true)][string]$WorkingDirectory,
      [Parameter(Mandatory=$true)][string]$Desktop,
      [Parameter(Mandatory=$true)][int]$TimeoutMs,
      [Parameter(Mandatory=$true)][string]$StdoutPath,
      [Parameter(Mandatory=$true)][string]$StderrPath,
      [Parameter(Mandatory=$true)][string]$Result,
      [string]$Arguments = '')
$ErrorActionPreference = 'Stop'
# Starts one program, and with it every process it starts, on a Win32 desktop
# created for this run, so that nothing it shows, focuses or activates can reach
# the desktop a person is working on. This script only creates the desktop,
# starts the program on it, waits and closes its handles. It never changes which
# desktop is shown or receives input, sends no input and activates no window.
# While it waits it reads, on the desktop it was started from, which process owns
# the foreground window and the clipboard sequence number; if a process of the
# program ever owns that foreground window, everything is killed at once.
function Refuse([string]$reason) {
    [Console]::Error.WriteLine("launch-on-private-desktop: $reason")
    exit 2
}
if ($Desktop -cnotmatch '^[A-Za-z0-9][A-Za-z0-9-]{0,63}$') { Refuse 'desktop name must be 1-64 letters, digits or hyphens' }
if ($TimeoutMs -lt 1000 -or $TimeoutMs -gt 600000) { Refuse 'timeout must be 1000..600000 ms' }
if ($Arguments -match '[\r\n\0]') { Refuse 'arguments must be one line' }
if ($Executable -notmatch '\.exe$' -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) { Refuse 'executable not found' }
if (-not (Test-Path -LiteralPath $WorkingDirectory -PathType Container)) { Refuse 'working directory not found' }
foreach ($path in @($StdoutPath, $StderrPath, $Result)) {
    if (-not [IO.Path]::IsPathRooted($path)) { Refuse 'output paths must be absolute' }
    if (-not (Test-Path -LiteralPath (Split-Path -Parent $path) -PathType Container)) { Refuse 'output directory not found' }
    if (Test-Path -LiteralPath $path) { Refuse 'an output file already exists' }
}
if (@($StdoutPath, $StderrPath, $Result | Sort-Object -Unique).Count -ne 3) { Refuse 'output paths must differ' }
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class SorngPrivateDesktop {
  const uint GENERIC_ALL = 0x10000000, GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000;
  const uint DACL_SECURITY_INFORMATION = 0x4, LABEL_SECURITY_INFORMATION = 0x10;
  const uint CREATE_SUSPENDED = 0x4, CREATE_UNICODE_ENVIRONMENT = 0x400, EXTENDED_STARTUPINFO_PRESENT = 0x80000, CREATE_NO_WINDOW = 0x08000000;
  const int STARTF_USESHOWWINDOW = 0x1, STARTF_USESTDHANDLES = 0x100, PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x20002;
  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000, DESKTOP_READOBJECTS = 0x1;
  const int MAX_LISTED = 1024;
  static readonly IntPtr INVALID = new IntPtr(-1);
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMITS {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit;
    public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMITS {
    public BASIC_LIMITS Basic; public IO_COUNTERS Io;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
  [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING {
    public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
    public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses; }
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr mode, uint flags, uint access, IntPtr attributes);
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr OpenDesktopW(string name, uint flags, bool inherit, uint access);
  [DllImport("user32.dll", SetLastError=true)] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformationW(IntPtr handle, int index, StringBuilder information, uint length, out uint needed);
  [DllImport("user32.dll", SetLastError=true)] static extern bool GetUserObjectSecurity(IntPtr handle, ref uint requested, IntPtr descriptor, uint length, out uint needed);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr window, StringBuilder name, int length);
  [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr information, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr information, uint length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref STARTUPINFOEX startup, out PROCESS_INFORMATION information);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateFileW(string name, uint access, uint share, ref SECURITY_ATTRIBUTES attributes, uint disposition, uint flags, IntPtr template);

  public sealed class Outcome {
    public int schema = 1; public string desktop; public string windowStation; public string desktopSecurity = "default";
    public bool started; public string error; public int pid;
    public int exitCode = -1; public bool timedOut; public bool foregroundViolation; public string foregroundViolationWindowClass;
    public int samples; public int clientForegroundSamples; public int clientForegroundOwnerChanges; public int foregroundOwnerChanges;
    public long clipboardSequenceBefore = -1, clipboardSequenceAfter = -1; public int clipboardChanges;
    public int peakProcessesInJob; public int processesLeftInJob = -1; public bool leftoversTerminated;
    public bool desktopClosed; public bool desktopGone; public long elapsedMs;
  }

  // The new desktop gets the access list and integrity label of the desktop
  // this launcher runs on, so the program's own sandboxed children can use it
  // exactly as they use that one. No right is added that they lack there.
  static IntPtr CreateLikeCurrent(string name, Outcome outcome, out IntPtr descriptor) {
    descriptor = IntPtr.Zero;
    IntPtr current = GetThreadDesktop(GetCurrentThreadId());
    foreach (uint wanted in new uint[] { DACL_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION, DACL_SECURITY_INFORMATION }) {
      uint requested = wanted, needed = 0;
      GetUserObjectSecurity(current, ref requested, IntPtr.Zero, 0, out needed);
      if (needed == 0 || needed > 65536) continue;
      IntPtr block = Marshal.AllocHGlobal((int)needed);
      if (!GetUserObjectSecurity(current, ref requested, block, needed, out needed)) { Marshal.FreeHGlobal(block); continue; }
      var attributes = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), lpSecurityDescriptor = block, bInheritHandle = 0 };
      IntPtr pointer = Marshal.AllocHGlobal(attributes.nLength);
      Marshal.StructureToPtr(attributes, pointer, false);
      IntPtr created = CreateDesktopW(name, IntPtr.Zero, IntPtr.Zero, 0, GENERIC_ALL, pointer);
      Marshal.FreeHGlobal(pointer);
      if (created != IntPtr.Zero) {
        descriptor = block;
        outcome.desktopSecurity = wanted == DACL_SECURITY_INFORMATION ? "access-list-of-current-desktop" : "access-list-and-label-of-current-desktop";
        return created;
      }
      Marshal.FreeHGlobal(block);
    }
    return CreateDesktopW(name, IntPtr.Zero, IntPtr.Zero, 0, GENERIC_ALL, IntPtr.Zero);
  }

  static int Active(IntPtr job) {
    int size = Marshal.SizeOf(typeof(ACCOUNTING));
    IntPtr block = Marshal.AllocHGlobal(size);
    try {
      if (!QueryInformationJobObject(job, 1, block, (uint)size, IntPtr.Zero)) return -1;
      return (int)((ACCOUNTING)Marshal.PtrToStructure(block, typeof(ACCOUNTING))).ActiveProcesses;
    } finally { Marshal.FreeHGlobal(block); }
  }

  // Asked of the job itself, so no process has to be opened to find out.
  static bool InJob(uint pid, IntPtr job) {
    if (pid == 0) return false;
    int size = 8 + IntPtr.Size * MAX_LISTED;
    IntPtr block = Marshal.AllocHGlobal(size);
    try {
      // A longer list than fits still fills what fits and reports "more data".
      if (!QueryInformationJobObject(job, 3, block, (uint)size, IntPtr.Zero) && Marshal.GetLastWin32Error() != 234) return false;
      int listed = Math.Min(Marshal.ReadInt32(block, 4), MAX_LISTED);
      for (int index = 0; index < listed; index++)
        if ((uint)(long)Marshal.ReadIntPtr(block, 8 + IntPtr.Size * index) == pid) return true;
      return false;
    } finally { Marshal.FreeHGlobal(block); }
  }

  public static Outcome Run(string executable, string arguments, string directory, string name, int timeoutMs, string stdoutPath, string stderrPath) {
    var outcome = new Outcome { desktop = name };
    var clock = Stopwatch.StartNew();
    IntPtr desktop = IntPtr.Zero, job = IntPtr.Zero, descriptor = IntPtr.Zero, list = IntPtr.Zero, handles = IntPtr.Zero;
    IntPtr output = INVALID, errors = INVALID, input = INVALID;
    var process = new PROCESS_INFORMATION();
    try {
      var station = new StringBuilder(256);
      uint stationLength;
      if (!GetUserObjectInformationW(GetProcessWindowStation(), 2, station, 512, out stationLength) || station.Length == 0) { outcome.error = "window-station-unknown"; return outcome; }
      outcome.windowStation = station.ToString();
      // A name already in use would hand back somebody else's desktop.
      IntPtr existing = OpenDesktopW(name, 0, false, DESKTOP_READOBJECTS);
      if (existing != IntPtr.Zero) { CloseDesktop(existing); outcome.error = "desktop-name-in-use"; return outcome; }
      desktop = CreateLikeCurrent(name, outcome, out descriptor);
      if (desktop == IntPtr.Zero) { outcome.error = "create-desktop-failed-" + Marshal.GetLastWin32Error(); return outcome; }
      // Everything on that desktop dies with this launcher, however it ends.
      job = CreateJobObjectW(IntPtr.Zero, null);
      var limits = new EXTENDED_LIMITS();
      limits.Basic.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      int size = Marshal.SizeOf(typeof(EXTENDED_LIMITS));
      IntPtr block = Marshal.AllocHGlobal(size);
      bool limited;
      try { Marshal.StructureToPtr(limits, block, false); limited = job != IntPtr.Zero && SetInformationJobObject(job, 9, block, (uint)size); }
      finally { Marshal.FreeHGlobal(block); }
      if (!limited) { outcome.error = "job-failed-" + Marshal.GetLastWin32Error(); return outcome; }
      var inheritable = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), bInheritHandle = 1 };
      output = CreateFileW(stdoutPath, GENERIC_WRITE, 1, ref inheritable, 1, 0x80, IntPtr.Zero);
      errors = CreateFileW(stderrPath, GENERIC_WRITE, 1, ref inheritable, 1, 0x80, IntPtr.Zero);
      input = CreateFileW("NUL", GENERIC_READ, 3, ref inheritable, 3, 0, IntPtr.Zero);
      if (output == INVALID || errors == INVALID || input == INVALID) { outcome.error = "output-files-failed-" + Marshal.GetLastWin32Error(); return outcome; }
      // The program inherits these three handles and no other handle of this launcher.
      IntPtr listSize = IntPtr.Zero;
      InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref listSize);
      list = Marshal.AllocHGlobal(listSize);
      handles = Marshal.AllocHGlobal(IntPtr.Size * 3);
      Marshal.WriteIntPtr(handles, 0, input);
      Marshal.WriteIntPtr(handles, IntPtr.Size, output);
      Marshal.WriteIntPtr(handles, IntPtr.Size * 2, errors);
      if (!InitializeProcThreadAttributeList(list, 1, 0, ref listSize)) { Marshal.FreeHGlobal(list); list = IntPtr.Zero; outcome.error = "handle-list-failed-" + Marshal.GetLastWin32Error(); return outcome; }
      if (!UpdateProcThreadAttribute(list, 0, (IntPtr)PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handles, (IntPtr)(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero)) { outcome.error = "handle-list-failed-" + Marshal.GetLastWin32Error(); return outcome; }
      var startup = new STARTUPINFOEX();
      startup.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
      startup.StartupInfo.lpDesktop = outcome.windowStation + "\\" + name;
      // Hidden at start, as the runner starts it on any desktop.
      startup.StartupInfo.dwFlags = STARTF_USESHOWWINDOW | STARTF_USESTDHANDLES;
      startup.StartupInfo.wShowWindow = 0;
      startup.StartupInfo.hStdInput = input; startup.StartupInfo.hStdOutput = output; startup.StartupInfo.hStdError = errors;
      startup.lpAttributeList = list;
      var command = new StringBuilder("\"" + executable + "\"" + (string.IsNullOrEmpty(arguments) ? "" : " " + arguments));
      if (!CreateProcessW(null, command, IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT, IntPtr.Zero, directory, ref startup, out process)) {
        outcome.error = "create-process-failed-" + Marshal.GetLastWin32Error(); return outcome;
      }
      if (!AssignProcessToJobObject(job, process.hProcess)) {
        int failure = Marshal.GetLastWin32Error();
        TerminateProcess(process.hProcess, 0xF2);
        outcome.error = "assign-job-failed-" + failure; return outcome;
      }
      outcome.started = true;
      outcome.pid = process.dwProcessId;
      Console.Out.WriteLine("{\"started\":true,\"pid\":" + outcome.pid + "}");
      Console.Out.Flush();
      uint clipboard = GetClipboardSequenceNumber();
      outcome.clipboardSequenceBefore = clipboard;
      uint owner = 0;
      IntPtr first = GetForegroundWindow();
      if (first != IntPtr.Zero) GetWindowThreadProcessId(first, out owner);
      ResumeThread(process.hThread);
      bool ownerIsClient = false, exited = false; long exitedAt = 0;
      while (true) {
        if (WaitForSingleObject(process.hProcess, 50) == 0 && !exited) {
          exited = true; exitedAt = clock.ElapsedMilliseconds;
          uint code; GetExitCodeProcess(process.hProcess, out code); outcome.exitCode = unchecked((int)code);
        }
        // Read-only view of the desktop this launcher was started from.
        uint now = 0;
        IntPtr foreground = GetForegroundWindow();
        if (foreground != IntPtr.Zero) GetWindowThreadProcessId(foreground, out now);
        outcome.samples++;
        if (now != owner) {
          bool nowIsClient = InJob(now, job);
          outcome.foregroundOwnerChanges++;
          if (nowIsClient || ownerIsClient) outcome.clientForegroundOwnerChanges++;
          owner = now; ownerIsClient = nowIsClient;
        }
        if (ownerIsClient) {
          outcome.clientForegroundSamples++;
          if (!outcome.foregroundViolation) {
            outcome.foregroundViolation = true;
            // A window of the program itself: its class says which one it was.
            var kind = new StringBuilder(128);
            GetClassNameW(foreground, kind, 128);
            outcome.foregroundViolationWindowClass = kind.ToString();
            TerminateJobObject(job, 0xF1);
          }
        }
        uint sequence = GetClipboardSequenceNumber();
        if (sequence != clipboard) { outcome.clipboardChanges++; clipboard = sequence; }
        int active = Active(job);
        if (active > outcome.peakProcessesInJob) outcome.peakProcessesInJob = active;
        if (!exited && !outcome.timedOut && clock.ElapsedMilliseconds > timeoutMs) { outcome.timedOut = true; TerminateJobObject(job, 0xF0); }
        if (!exited) {
          if (clock.ElapsedMilliseconds > (long)timeoutMs + 15000) { outcome.error = "did-not-end"; TerminateProcess(process.hProcess, 0xF4); break; }
          continue;
        }
        if (active == 0) { outcome.processesLeftInJob = 0; break; }
        if (clock.ElapsedMilliseconds - exitedAt > 5000) {
          outcome.processesLeftInJob = active; outcome.leftoversTerminated = true;
          TerminateJobObject(job, 0xF3); Thread.Sleep(300); break;
        }
        Thread.Sleep(50);
      }
      outcome.clipboardSequenceAfter = GetClipboardSequenceNumber();
    } finally {
      if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
      if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
      foreach (IntPtr file in new IntPtr[] { output, errors, input }) if (file != INVALID) CloseHandle(file);
      if (list != IntPtr.Zero) { DeleteProcThreadAttributeList(list); Marshal.FreeHGlobal(list); }
      if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
      if (job != IntPtr.Zero) CloseHandle(job);
      if (descriptor != IntPtr.Zero) Marshal.FreeHGlobal(descriptor);
      if (desktop != IntPtr.Zero) {
        outcome.desktopClosed = CloseDesktop(desktop);
        // The desktop goes away with its last process; give them a moment.
        for (int attempt = 0; attempt < 40 && !outcome.desktopGone; attempt++) {
          IntPtr probe = OpenDesktopW(name, 0, false, DESKTOP_READOBJECTS);
          if (probe == IntPtr.Zero) outcome.desktopGone = true; else { CloseDesktop(probe); Thread.Sleep(50); }
        }
      }
      outcome.elapsedMs = clock.ElapsedMilliseconds;
    }
    return outcome;
  }
}
'@
$outcome = [SorngPrivateDesktop]::Run($Executable, $Arguments, $WorkingDirectory, $Desktop, $TimeoutMs, $StdoutPath, $StderrPath)
$outcome | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $Result -Encoding utf8NoBOM
if (-not $outcome.started) {
    [Console]::Error.WriteLine("launch-on-private-desktop: $($outcome.error)")
    exit 3
}
if ($outcome.foregroundViolation) { exit 11 }
if ($outcome.timedOut) { exit 10 }
exit 0
