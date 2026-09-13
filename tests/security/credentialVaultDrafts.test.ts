import { describe, expect, it } from "vitest";
import {
  getCredentialVaultDraft,
  hasPendingCredentialVaultDraft,
  registerCredentialVaultDraft,
} from "../../src/utils/security/credentialVaultDrafts";
describe("credential vault close metadata", () => {
  it("keeps only scoped non-secret metadata and rejects stale registration cleanup", () => {
    const state = {
      databaseId: "a",
      scopeKey: "a:1",
      dirty: true,
      busy: false,
      revision: 2,
    };
    const old = registerCredentialVaultDraft("tab", () => state);
    const snapshot = getCredentialVaultDraft("tab")!;
    expect(Object.keys(snapshot).sort()).toEqual([
      "busy",
      "databaseId",
      "dirty",
      "isCurrent",
      "revision",
      "scopeKey",
    ]);
    expect(hasPendingCredentialVaultDraft("a")).toBe(true);
    expect(hasPendingCredentialVaultDraft("b")).toBe(false);
    const current = registerCredentialVaultDraft("tab", () => ({
      ...state,
      scopeKey: "a:2",
      dirty: false,
      busy: true,
    }));
    old();
    expect(snapshot.isCurrent()).toBe(false);
    expect(getCredentialVaultDraft("tab")?.scopeKey).toBe("a:2");
    expect(hasPendingCredentialVaultDraft("a")).toBe(true);
    current();
    expect(getCredentialVaultDraft("tab")).toBeUndefined();
  });
});
