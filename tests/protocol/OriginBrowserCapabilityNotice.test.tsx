import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OriginBrowserCapabilityNotice from "../../src/components/protocol/webBrowser/OriginBrowserCapabilityNotice";

const transport = vi.hoisted(() => ({ status: vi.fn(), create: vi.fn() }));
vi.mock("../../src/hooks/protocol/useOriginBrowser", () => ({
  tauriOriginBrowserTransport: transport,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const owner = {
  ownerDatabaseId: "database",
  connectionId: "connection",
  sessionId: "tab",
};

describe("read-only native browser capability notice", () => {
  it.each([
    [
      { availability: "deferred" },
      "The native browser starts after access",
      false,
    ],
    [{ availability: "available" }, "Native runtime reports available", false],
    [
      { availability: "unavailable", reason: "runtime-missing" },
      "The packaged native browser runtime is missing\\..*\\[unavailable-runtime-missing\\]",
      true,
    ],
    // An unrecognized reason gets the generic detail, never its own text.
    [
      { availability: "unavailable", reason: "PRIVATE_NATIVE_ERROR" },
      "No supported structured cause was reported\\..*\\[unavailable-unknown\\]",
      true,
    ],
  ])(
    "distinguishes deferred startup from runtime readiness (%j)",
    async (capability, message, warning) => {
      transport.status.mockResolvedValueOnce({ capability });
      render(<OriginBrowserCapabilityNotice owner={owner} />);
      await screen.findByText(new RegExp(message as string));
      const notice = screen.getByRole("status");
      expect(notice.classList.contains("sor-alert-warning")).toBe(warning);
      expect(notice).not.toHaveTextContent("PRIVATE_NATIVE_ERROR");
      expect(transport.status).toHaveBeenCalledExactlyOnceWith({ owner });
      expect(transport.create).not.toHaveBeenCalled();
    },
  );
});
