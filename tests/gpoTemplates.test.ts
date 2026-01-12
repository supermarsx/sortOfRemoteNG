import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const repoRoot = resolve(__dirname, "..");
const templateDir = resolve(repoRoot, "templates", "gpo");

const readTemplate = (relativePath: string): string => {
  return readFileSync(resolve(templateDir, relativePath), "utf-8");
};

describe("GPO templates", () => {
  it("ships the ADMX template with required policies", () => {
    const admx = readTemplate("SortOfRemoteNG.admx");
    expect(admx).toContain("<policyDefinitions");
    expect(admx).toContain('name="AutoLockEnabled"');
    expect(admx).toContain('name="AutoLockTimeout"');
    expect(admx).toContain('name="RequirePassword"');
    expect(admx).toContain('name="MaxConnections"');
    expect(admx).toContain('name="AllowedProtocols"');
    expect(admx).toContain('key="SOFTWARE\\Policies\\SortOfRemoteNG\\Security"');
    expect(admx).toContain('key="SOFTWARE\\Policies\\SortOfRemoteNG\\Limits"');
    expect(admx).toContain('key="SOFTWARE\\Policies\\SortOfRemoteNG\\Access"');
  });

  it("ships localized ADML resources for en-US, pt-PT, and es-ES", () => {
    const locales = ["en-US", "pt-PT", "es-ES"];
    for (const locale of locales) {
      const adml = readTemplate(`${locale}/SortOfRemoteNG.adml`);
      expect(adml).toContain("<policyDefinitionResources");
      expect(adml).toContain("CategorySortOfRemoteNG");
      expect(adml).toContain("AutoLockEnabled");
      expect(adml).toContain("AutoLockTimeout");
      expect(adml).toContain("RequirePassword");
      expect(adml).toContain("MaxConnections");
      expect(adml).toContain("AllowedProtocols");
    }
  });

  it("ships HKCU and HKLM registry templates with expected defaults", () => {
    const hkcu = readTemplate("SortOfRemoteNG-HKCU.reg");
    expect(hkcu).toContain("[HKEY_CURRENT_USER\\SOFTWARE\\Policies\\SortOfRemoteNG\\Security]");
    expect(hkcu).toContain('"AutoLockEnabled"=dword:00000001');
    expect(hkcu).toContain('"AutoLockTimeout"=dword:0000001e');
    expect(hkcu).toContain('"RequirePassword"=dword:00000001');
    expect(hkcu).toContain("[HKEY_CURRENT_USER\\SOFTWARE\\Policies\\SortOfRemoteNG\\Limits]");
    expect(hkcu).toContain('"MaxConnections"=dword:0000000a');
    expect(hkcu).toContain("[HKEY_CURRENT_USER\\SOFTWARE\\Policies\\SortOfRemoteNG\\Access]");
    expect(hkcu).toContain('"AllowedProtocols"="ssh,rdp,vnc"');

    const hklm = readTemplate("SortOfRemoteNG-HKLM.reg");
    expect(hklm).toContain("[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\SortOfRemoteNG\\Security]");
    expect(hklm).toContain('"AutoLockEnabled"=dword:00000001');
    expect(hklm).toContain('"AutoLockTimeout"=dword:0000001e');
    expect(hklm).toContain('"RequirePassword"=dword:00000001');
    expect(hklm).toContain("[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\SortOfRemoteNG\\Limits]");
    expect(hklm).toContain('"MaxConnections"=dword:0000000a');
    expect(hklm).toContain("[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\SortOfRemoteNG\\Access]");
    expect(hklm).toContain('"AllowedProtocols"="ssh,rdp,vnc"');
  });
});
