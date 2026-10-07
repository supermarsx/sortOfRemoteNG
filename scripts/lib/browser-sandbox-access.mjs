// Windows CEF AppContainer/LPAC access is not implied by the current user's ACL.
// Only the packaged code/resource allowlist is repaired; never a profile tree.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const exec = promisify(execFile);
const script = fileURLToPath(
  new URL("../native/repair-browser-sandbox-access.ps1", import.meta.url),
);

export async function ensureBrowserSandboxAccess({
  bundle,
  appName,
  platform = process.platform,
}) {
  if (platform !== "win32") return { applicable: false, repaired: 0 };
  if (
    !path.isAbsolute(bundle) ||
    !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(appName) ||
    /[ .]$/.test(appName)
  )
    throw new Error(
      "Sandbox access repair requires an absolute browser bundle and a portable application name",
    );
  const powershell = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  try {
    const { stdout } = await exec(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        script,
        "-Bundle",
        bundle,
        "-AppName",
        appName,
      ],
      {
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 256 * 1024,
      },
    );
    const report = JSON.parse(stdout.trim());
    if (report.ok !== true)
      throw new Error("Permission verification did not pass");
    if (report.repaired > 0)
      console.info(
        `[browser-sandbox] Repaired read/execute access on ${report.repaired} runtime entries; sandbox remains enabled.`,
      );
    return report;
  } catch (error) {
    throw new Error(
      `Browser sandbox permissions could not be prepared. Repair or reinstall this browser bundle in a writable application directory, then retry. No sandbox protections were disabled. ${error.stderr?.trim() || error.message}`,
      { cause: error },
    );
  }
}
