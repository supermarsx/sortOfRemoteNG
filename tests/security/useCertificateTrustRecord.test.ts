import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCertificateTrustRecord } from "../../src/hooks/security/useCertificateTrustRecord";
import type { TrustRecord } from "../../src/utils/auth/trustStore";
const read = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/auth/trustStore", () => ({
  getEffectiveStoredIdentity: read,
}));
const record: TrustRecord = {
  host: "fixture.test:443",
  type: "https",
  userApproved: false,
  identity: {
    fingerprint: "AA",
    firstSeen: "2026-01-01",
    lastSeen: "2026-01-01",
  },
};
describe("live effective certificate trust display", () => {
  beforeEach(() => {
    read.mockReset();
  });
  it("uses the returned exact record scope and removes remembered display immediately after Forget", async () => {
    read.mockResolvedValue({ record });
    const { result } = renderHook(() =>
      useCertificateTrustRecord(
        true,
        "fixture.test",
        443,
        "https",
        "connection-1",
      ),
    );
    await waitFor(() => expect(result.current.record).toEqual(record));
    expect(result.current.connectionId).toBeUndefined();
    expect(read).toHaveBeenCalledWith(
      "fixture.test",
      443,
      "https",
      "connection-1",
    );
    read.mockResolvedValue(undefined);
    act(() => {
      window.dispatchEvent(new Event("trustStoreChanged"));
    });
    expect(result.current.record).toBeUndefined();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.record).toBeUndefined();
  });
  it("never publishes a prior endpoint response after changing target", async () => {
    let finish!: (value: { record: TrustRecord }) => void;
    read
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({
        record: { ...record, host: "other.test:443" },
        connectionId: "connection-2",
      });
    const { result, rerender } = renderHook(
      ({ host }) =>
        useCertificateTrustRecord(true, host, 443, "https", "connection-2"),
      { initialProps: { host: "fixture.test" } },
    );
    rerender({ host: "other.test" });
    await waitFor(() =>
      expect(result.current.record?.host).toBe("other.test:443"),
    );
    await act(async () => {
      finish({ record });
    });
    expect(result.current.record?.host).toBe("other.test:443");
    expect(result.current.connectionId).toBe("connection-2");
  });
  it("does not loop when a failed read itself reports trust-store unavailability", async () => {
    read.mockImplementation(async () => {
      window.dispatchEvent(new Event("trustStoreChanged"));
      throw new Error("unavailable");
    });
    const { result } = renderHook(() =>
      useCertificateTrustRecord(true, "fixture.test", 443, "https"),
    );
    await waitFor(() =>
      expect(result.current.error).toContain("could not be inspected"),
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.record).toBeUndefined();
  });
  it("does not query until the inspector is open", () => {
    renderHook(() =>
      useCertificateTrustRecord(false, "fixture.test", 443, "https"),
    );
    expect(read).not.toHaveBeenCalled();
  });
});
