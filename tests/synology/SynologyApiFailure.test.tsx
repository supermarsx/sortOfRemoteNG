import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SynologyApiFailure from "../../src/components/synology/synologyPanel/SynologyApiFailure";
import {
  parseSynologyApiFailure,
  SYNOLOGY_DIAGNOSTIC_MARKER,
} from "../../src/utils/synology/apiFailureDiagnostic";
import { toSafeManagementError } from "../../src/utils/security/managementInvoke";
const metadata = {
  stage: "api_login",
  category: "html",
  httpStatus: 200,
  contentType: "html",
  bytesRead: 1234,
};
const message = (value: unknown = metadata) =>
  `Safe native explanation.${SYNOLOGY_DIAGNOSTIC_MARKER}${JSON.stringify(value)}`;
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
});
describe("bounded Synology API failure details", () => {
  it.each([
    [400, "did not accept the credentials"],
    [401, "account is disabled"],
    [407, "blocked this client's IP"],
    [119, "rejected the API session ID"],
  ])(
    "explains DSM code %s without displaying arbitrary native text",
    (dsmCode, expected) => {
      render(
        <SynologyApiFailure
          error={message({ ...metadata, category: "dsm_api", dsmCode })}
        />,
      );
      expect(screen.getByRole("alert")).toHaveTextContent(String(expected));
    },
  );
  it("survives management error redaction and copies only closed diagnostic data", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const error = toSafeManagementError(
      `private upstream body https://private.invalid/?secret=hidden${SYNOLOGY_DIAGNOSTIC_MARKER}${JSON.stringify(metadata)}`,
    );
    expect(parseSynologyApiFailure(error)).toEqual(metadata);
    render(<SynologyApiFailure error={error} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "web page instead of API JSON",
    );
    expect(screen.getByText("Signing in to DSM API")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.queryByText(/private upstream/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Diagnostics copied",
      ),
    );
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain("HTTP status: 200");
    expect(writeText.mock.calls[0][0]).not.toMatch(
      /private|hidden|https:|synology-diagnostic/,
    );
  });
  it.each([
    { ...metadata, stage: "private" },
    { ...metadata, category: "private" },
    { ...metadata, contentType: "private" },
    { ...metadata, httpStatus: 600 },
    { ...metadata, bytesRead: 8388609 },
    { ...metadata, bytesRead: -1 },
    { ...metadata, bytesRead: 1.5 },
    { ...metadata, dsmCode: 1 },
    { ...metadata, body: "private" },
    { ...metadata, category: "dsm_api", dsmCode: 65536 },
    { ...metadata, category: "__proto__" },
    [],
    null,
  ])("refuses malformed or expanded metadata %j", (value) => {
    expect(parseSynologyApiFailure(message(value))).toBeNull();
    render(<SynologyApiFailure error={message(value)} />);
    expect(
      screen.queryByRole("button", { name: "Copy diagnostics" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      /private|synology-diagnostic/,
    );
  });
  it("refuses trailing data and oversized or malformed JSON", () => {
    for (const error of [
      message() + "\nprivate",
      message() + "bad",
      message() + message(),
      message().replace(":v1:", ":v2:"),
      "Failure" + SYNOLOGY_DIAGNOSTIC_MARKER + "x".repeat(513),
    ]) {
      expect(parseSynologyApiFailure(error)).toBeNull();
      const view = render(<SynologyApiFailure error={error} />);
      expect(
        screen.queryByRole("button", { name: "Copy diagnostics" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("alert")).not.toHaveTextContent(
        /private|synology-diagnostic/,
      );
      view.unmount();
    }
  });
  it("shows bounded DSM codes and keeps legacy errors actionable without a copy dump", () => {
    const view = render(
      <SynologyApiFailure
        error={message({ ...metadata, category: "dsm_api", dsmCode: 105 })}
      />,
    );
    expect(screen.getByText("DSM code")).toBeInTheDocument();
    expect(screen.getByText("105")).toBeInTheDocument();
    view.rerender(
      <SynologyApiFailure error="Certificate verification failed." />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Certificate verification failed.",
    );
    expect(
      screen.queryByRole("button", { name: "Copy diagnostics" }),
    ).not.toBeInTheDocument();
  });
});
