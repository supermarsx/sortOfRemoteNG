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
    [401, "The DSM account is disabled."],
    [
      402,
      "DSM refused API sign-in for this account. The NAS API view signs in as a File Station session, so check the account's File Station application privilege and DSM login restrictions.",
    ],
    [
      406,
      "DSM requires this account to set up two-factor authentication before it can sign in. Complete setup once in DSM in your browser (the DSM website view works), then connect again.",
    ],
    [407, "blocked this client's IP"],
    [
      408,
      "The password has expired and this account cannot change it. Ask a DSM administrator to reset it.",
    ],
    [
      449,
      "DSM requires a sign-in method the NAS API can't complete. Approve-sign-in push and security keys can't complete an API sign-in; use the DSM website view for those.",
    ],
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
    { ...metadata, access: "administrator" },
    { ...metadata, category: "dsm_api", access: "administrator" },
    {
      ...metadata,
      category: "dsm_api",
      dsmCode: 106,
      access: "administrator",
    },
    { ...metadata, category: "dsm_api", dsmCode: 105, access: "private" },
    { ...metadata, category: "dsm_api", dsmCode: 105, access: "__proto__" },
    { ...metadata, category: "dsm_api", dsmCode: 105, access: 1 },
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

describe("DSM permission denials", () => {
  const denial = {
    stage: "api_response",
    category: "dsm_api",
    httpStatus: 200,
    contentType: "json",
    bytesRead: 38,
    dsmCode: 105,
  };
  it("preserves the classified native denial byte for byte through management redaction", () => {
    const native =
      'SYNO.Core.System.Utilization: requires a DSM administrator account (code 105)\nsynology-diagnostic:v1:{"stage":"api_response","category":"dsm_api","httpStatus":200,"contentType":"json","bytesRead":38,"dsmCode":105,"access":"administrator"}';
    expect(toSafeManagementError(native)).toBe(native);
    expect(parseSynologyApiFailure(native)).toEqual({
      ...denial,
      access: "administrator",
    });
  });
  it.each(["administrator", "application_privilege"] as const)(
    "accepts access with DSM code 105: %s",
    (access) => {
      expect(parseSynologyApiFailure(message({ ...denial, access }))).toEqual({
        ...denial,
        access,
      });
    },
  );
  it.each(["administrator", "application_privilege"] as const)(
    "refuses access %s with DSM code 120, which is an invalid parameter rather than a denial",
    (access) => {
      const error = message({ ...denial, dsmCode: 120, access });
      expect(parseSynologyApiFailure(error)).toBeNull();
      render(<SynologyApiFailure error={error} />);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The NAS API request failed; diagnostic metadata was unavailable.",
      );
      expect(screen.queryByText("Required access")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Copy diagnostics" }),
      ).not.toBeInTheDocument();
    },
  );
  it.each([
    [
      { ...denial, access: "administrator" },
      "DSM allows this API only for administrators or accounts with a matching delegated administration role. Sign in with such an account to use it.",
      "Administrator",
    ],
    [
      { ...denial, access: "application_privilege" },
      "The account lacks the DSM application privilege for this package. Grant it in Control Panel › Application Privileges, then recheck access.",
      "Application privilege",
    ],
    [
      { ...denial, stage: "authenticated_file_station" },
      "DSM denied File Station access for this API session. Grant the account the File Station application privilege in DSM, then reconnect.",
      null,
    ],
    [
      denial,
      "DSM denied this request for the signed-in account. Review the account's DSM permissions.",
      null,
    ],
    [
      { ...denial, stage: "api_login" },
      "DSM denied this request for the signed-in account. Review the account's DSM permissions.",
      null,
    ],
  ])(
    "explains %j with a permission summary and the required access row",
    async (value, summary, required) => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      render(<SynologyApiFailure error={message(value)} />);
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(summary);
      expect(alert).not.toHaveTextContent(
        /Check File Station application permissions in DSM|Safe native explanation|synology-diagnostic/,
      );
      if (required) {
        expect(screen.getByText("Required access")).toBeInTheDocument();
        expect(screen.getByText(required)).toBeInTheDocument();
      } else
        expect(screen.queryByText("Required access")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
      const copied = writeText.mock.calls[0][0] as string;
      expect(copied).toContain(summary);
      expect(copied).toContain(`DSM code: ${value.dsmCode}`);
      if (required) expect(copied).toContain(`Required access: ${required}`);
      else expect(copied).not.toContain("Required access");
      expect(copied).not.toMatch(/Safe native explanation|synology-diagnostic/);
    },
  );
  it.each(["api_response", "api_login", "authenticated_file_station"] as const)(
    "explains DSM code 120 at %s as a request DSM did not accept, not a permission denial",
    async (stage) => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      const value = { ...denial, stage, dsmCode: 120 };
      expect(parseSynologyApiFailure(message(value))).toEqual(value);
      render(<SynologyApiFailure error={message(value)} />);
      const alert = screen.getByRole("alert");
      const summary =
        "DSM did not accept this request's parameters (invalid or missing parameter). This is not a permission denial; the NAS may expect a different request for this DSM version. Update the desktop application, and copy the diagnostics if it persists.";
      expect(alert).toHaveTextContent(summary);
      expect(alert).not.toHaveTextContent(
        /denied|privilege|administrator|Safe native explanation/,
      );
      expect(screen.getByText("120")).toBeInTheDocument();
      expect(screen.queryByText("Required access")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
      const copied = writeText.mock.calls[0][0] as string;
      expect(copied).toContain(summary);
      expect(copied).toContain("DSM code: 120");
      expect(copied).not.toContain("Required access");
    },
  );
  it("omits the sign-in retry note for data reads only", () => {
    const view = render(
      <SynologyApiFailure error={message(denial)} alert={false} />,
    );
    expect(
      screen.getByText("No automatic sign-in retry was made."),
    ).toBeInTheDocument();
    view.rerender(
      <SynologyApiFailure
        error={message(denial)}
        alert={false}
        signInNote={false}
      />,
    );
    expect(
      screen.queryByText("No automatic sign-in retry was made."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
