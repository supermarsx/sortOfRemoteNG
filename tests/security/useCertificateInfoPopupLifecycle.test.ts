import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCertificateInfoPopup } from "../../src/hooks/security/useCertificateInfoPopup";
import type { TrustRecord } from "../../src/utils/auth/trustStore";
const save = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/auth/trustStore", async (original) => ({
  ...(await original<typeof import("../../src/utils/auth/trustStore")>()),
  updateTrustRecordNickname: save,
}));
const record: TrustRecord = {
  host: "fixture.test:443",
  type: "https",
  nickname: "First label",
  userApproved: true,
  identity: {
    fingerprint: "AA",
    firstSeen: "2026-01-01",
    lastSeen: "2026-01-01",
  },
};
describe("certificate popup identity lifecycle", () => {
  beforeEach(() => {
    save.mockReset();
  });
  it("shows revoked and expired trust rather than Trusted or Remembered", () => {
    const { result, rerender } = renderHook(
      ({ value }) =>
        useCertificateInfoPopup(
          "https",
          "fixture.test",
          443,
          record.identity,
          value,
          "c1",
        ),
      { initialProps: { value: { ...record, revoked: true } as TrustRecord } },
    );
    expect(result.current.getTrustStatus().label).toBe("Revoked");
    rerender({
      value: { ...record, revoked: false, trustExpires: "2000-01-01" },
    });
    expect(result.current.getTrustStatus().label).toBe("Trust expired");
  });
  it("resets nickname editing on scope change and ignores a delayed former-scope save", async () => {
    let finish!: () => void;
    save.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const initialProps: {
      host: string;
      connectionId?: string;
      value: TrustRecord;
    } = { host: "fixture.test", connectionId: "c1", value: record };
    const { result, rerender } = renderHook(
      ({ host, connectionId, value }) =>
        useCertificateInfoPopup(
          "https",
          host,
          443,
          value.identity,
          value,
          connectionId,
        ),
      { initialProps },
    );
    act(() => {
      result.current.startEditing();
      result.current.setNickDraft("Pending label");
      void result.current.saveNickname("Pending label");
    });
    rerender({
      host: "other.test",
      connectionId: undefined,
      value: { ...record, host: "other.test:443", nickname: "Second label" },
    });
    expect(result.current.editingNick).toBe(false);
    expect(result.current.savedNick).toBe("Second label");
    await act(async () => {
      finish();
    });
    expect(result.current.savedNick).toBe("Second label");
    expect(save).toHaveBeenCalledWith(
      "fixture.test",
      443,
      "https",
      "Pending label",
      "c1",
    );
  });
});
