import React, { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import type { TOTPConfig } from "../../src/types/settings/settings";
import { normalizeSynologySettings } from "../../src/types/protocols/synology";
import { resolveLocalSynologyAuthenticator } from "../../src/utils/synology/synologyAuthenticator";
import SynologyAuthenticatorSection from "../../src/components/connectionEditor/synologyOptions/SynologyAuthenticatorSection";
import SynologyOptions from "../../src/components/connectionEditor/SynologyOptions";

const boundary = vi.hoisted(() => ({
  compute: vi.fn(),
  reload: vi.fn(),
  vault: {
    entries: [] as { id: string; label: string }[],
    loading: false,
    error: "",
    available: true,
  },
}));
vi.mock("../../src/hooks/totp/useTOTP", () => ({
  totpApi: { computeCode: boundary.compute },
}));
vi.mock("../../src/hooks/security/useVaultTotpChoices", () => ({
  useVaultTotpChoices: () => ({ ...boundary.vault, reload: boundary.reload }),
}));

const SEED = "JBSWY3DPEHPK3PXP";
const credentialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const totpId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const native: Partial<Connection> = {
  protocol: "https",
  hostname: "nas.example.test",
  port: 5001,
  httpApplication: { version: 1, id: "synology-dsm", loginMode: "manual" },
  synologySettings: { version: 1, useHttps: true, accessMode: "native" },
  basicAuthUsername: "dsm-admin",
  basicAuthPassword: "synthetic-password",
};
const config = (patch: Partial<TOTPConfig> = {}): TOTPConfig => ({
  secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  issuer: "Recovery",
  account: "admin",
  digits: 6,
  period: 30,
  algorithm: "sha1",
  ...patch,
});

let latest: Partial<Connection>;
function Fixture({
  initial,
  options = false,
}: {
  initial: Partial<Connection>;
  options?: boolean;
}) {
  const [formData, setFormData] = useState(initial);
  latest = formData;
  return options ? (
    <SynologyOptions formData={formData} setFormData={setFormData} />
  ) : (
    <SynologyAuthenticatorSection
      formData={formData}
      setFormData={setFormData}
    />
  );
}
const authenticator = () =>
  screen.getByRole("combobox", { name: "NAS API authenticator" });
function choose(option: string) {
  fireEvent.click(authenticator());
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
}
function addSecret(value: string) {
  choose("Add authenticator secret");
  fireEvent.change(screen.getByLabelText("Authenticator secret"), {
    target: { value },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save authenticator" }));
}

beforeEach(() => {
  boundary.compute.mockReset();
  boundary.reload.mockReset();
  boundary.vault = { entries: [], loading: false, error: "", available: true };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("NAS API authenticator for connection-local credentials", () => {
  it("adds a Base32 secret to totpConfigs, saves only its id and clears the input", () => {
    render(<Fixture initial={native} />);
    addSecret("jbsw y3dp-ehpk 3pxp");
    const [saved] = latest.totpConfigs!;
    expect(saved).toMatchObject({
      secret: SEED,
      issuer: "Synology DSM",
      account: "dsm-admin",
      digits: 6,
      period: 30,
      algorithm: "sha1",
    });
    expect(saved.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(latest.synologySettings).toEqual({
      version: 1,
      useHttps: true,
      accessMode: "native",
      otpAuthenticatorId: saved.id,
    });
    expect(normalizeSynologySettings(latest.synologySettings)).toEqual(
      latest.synologySettings,
    );
    expect(JSON.stringify(latest.synologySettings)).not.toContain(SEED);
    expect(resolveLocalSynologyAuthenticator(latest)).toEqual({
      kind: "ready",
      config: saved,
    });
    // The form closes and no copy of the seed stays in the DOM.
    expect(screen.queryByLabelText("Authenticator secret")).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/JBSWY3DP|jbsw y3dp/i);
    expect(authenticator()).toHaveTextContent("Synology DSM — dsm-admin");
    choose("Add authenticator secret");
    expect(screen.getByLabelText("Authenticator secret")).toHaveValue("");
  });

  it("falls back to the host for the account and honours the advanced settings", () => {
    render(
      <Fixture
        initial={{
          ...native,
          basicAuthUsername: undefined,
          basicAuthPassword: undefined,
        }}
      />,
    );
    choose("Add authenticator secret");
    fireEvent.click(screen.getByText("Advanced settings"));
    for (const [label, option] of [
      ["Authenticator digits", "8 digits"],
      ["Authenticator period", "60 seconds"],
      ["Authenticator algorithm", "SHA-256"],
    ]) {
      fireEvent.click(screen.getByRole("combobox", { name: label }));
      fireEvent.mouseDown(screen.getByRole("option", { name: option }));
    }
    fireEvent.change(screen.getByLabelText("Authenticator secret"), {
      target: { value: SEED },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save authenticator" }));
    expect(latest.totpConfigs![0]).toMatchObject({
      account: "nas.example.test",
      digits: 8,
      period: 60,
      algorithm: "sha256",
    });
  });

  it("parses an otpauth://totp link with its own parameters and label", () => {
    render(<Fixture initial={{ ...native, totpConfigs: [config()] }} />);
    addSecret(
      `otpauth://totp/DSM%20NAS:ops%40example.test?secret=${SEED.toLowerCase()}&digits=8&period=60&algorithm=SHA512`,
    );
    expect(latest.totpConfigs).toHaveLength(2);
    const added = latest.totpConfigs![1];
    expect(added).toMatchObject({
      secret: SEED,
      issuer: "DSM NAS",
      account: "ops@example.test",
      digits: 8,
      period: 60,
      algorithm: "sha512",
    });
    expect(latest.totpConfigs![0]).toEqual(config());
    expect(latest.synologySettings?.otpAuthenticatorId).toBe(added.id);
  });

  it("accepts an upper-case otpauth scheme and keeps defaults for missing parameters", () => {
    render(<Fixture initial={native} />);
    addSecret(`OTPAUTH://totp/DSM:admin?secret=${SEED}`);
    expect(latest.totpConfigs).toEqual([
      expect.objectContaining({
        secret: SEED,
        issuer: "DSM",
        account: "admin",
        digits: 6,
        period: 30,
        algorithm: "sha1",
      }),
    ]);
  });

  it.each([
    [`otpauth://hotp/DSM:admin?secret=${SEED}&counter=1`, /HOTP and Steam/],
    [`otpauth://steam/Steam:admin?secret=${SEED}`, /HOTP and Steam/],
    [`otpauth://totp/DSM:admin?secret=${SEED}&digits=7`, /unsupported/],
    [`otpauth://totp/DSM:admin?secret=${SEED}&period=0`, /unsupported/],
    [`otpauth://totp/DSM:admin?secret=${SEED}&algorithm=MD5`, /unsupported/],
    [`otpauth://totp/DSM:admin?secret=NOT-BASE32-1890`, /unsupported/],
    ["JBSWY3DPEHPK3PX1", /Base32/],
    ["JBSWY3DP", /Base32/],
    ["123456", /Base32/],
  ])("rejects %s without changing the connection", (input, message) => {
    render(<Fixture initial={native} />);
    addSecret(input);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("alert").textContent).not.toContain(SEED);
    expect(latest).toEqual(native);
    // The typed value stays editable until it is fixed or cancelled.
    expect(screen.getByLabelText("Authenticator secret")).toHaveValue(input);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Authenticator secret")).toBeNull();
    expect(document.body.innerHTML).not.toContain(SEED);
  });

  it("assigns a unique stable id when selecting a legacy or duplicated authenticator, and None removes the reference", () => {
    const shared = "shared-id";
    render(
      <Fixture
        initial={{
          ...native,
          totpConfigs: [
            config({ issuer: "Legacy", account: "a" }),
            config({ id: shared, issuer: "First", account: "b" }),
            config({ id: shared, issuer: "Second", account: "c" }),
          ],
        }}
      />,
    );
    expect(authenticator()).toHaveTextContent("None — enter codes manually");
    choose("Legacy — a");
    const legacyId = latest.totpConfigs![0].id!;
    expect(legacyId).toMatch(/^[0-9a-f-]{36}$/);
    expect(latest.synologySettings?.otpAuthenticatorId).toBe(legacyId);
    choose("Second — c");
    const secondId = latest.totpConfigs![2].id!;
    expect(secondId).not.toBe(shared);
    expect(latest.totpConfigs![1].id).toBe(shared);
    expect(latest.synologySettings?.otpAuthenticatorId).toBe(secondId);
    expect(new Set(latest.totpConfigs!.map((item) => item.id)).size).toBe(3);
    // A unique existing id is reused as-is.
    const before = latest.totpConfigs;
    choose("Legacy — a");
    expect(latest.totpConfigs).toBe(before);
    expect(latest.synologySettings?.otpAuthenticatorId).toBe(legacyId);
    choose("None — enter codes manually");
    expect(latest.synologySettings).toEqual({
      version: 1,
      useHttps: true,
      accessMode: "native",
    });
    expect(latest.totpConfigs).toHaveLength(3);
  });

  it("leaves website consent alone for a unique id but disarms it when re-identifying a duplicated id it names", () => {
    const consent = {
      version: 1 as const,
      enabled: true,
      totpConfigId: "shared-id",
      challengeId: "synology-dsm-otp",
      origin: "https://nas.example.test:5001",
    };
    const { unmount } = render(
      <Fixture
        initial={{
          ...native,
          totpConfigs: [
            config({ id: "unique", issuer: "Unique" }),
            config({ id: "shared-id", issuer: "Website" }),
          ],
          httpAutoMfa: consent,
        }}
      />,
    );
    choose("Unique — admin");
    expect(latest.httpAutoMfa).toEqual(consent);
    unmount();
    render(
      <Fixture
        initial={{
          ...native,
          totpConfigs: [
            config({ id: "shared-id", issuer: "First" }),
            config({ id: "shared-id", issuer: "Second" }),
          ],
          httpAutoMfa: consent,
        }}
      />,
    );
    choose("Second — admin");
    expect(latest.totpConfigs![0].id).toBe("shared-id");
    expect(latest.synologySettings?.otpAuthenticatorId).toBe(
      latest.totpConfigs![1].id,
    );
    expect(latest.httpAutoMfa).toEqual({ version: 1, enabled: false });
  });

  it("offers the website's authenticator only while none is selected here", () => {
    const website = config({ id: "web-auth", issuer: "Website" });
    const { unmount } = render(
      <Fixture
        initial={{
          ...native,
          totpConfigs: [config({ id: "other" }), website],
          httpAutoMfa: {
            version: 1,
            enabled: true,
            totpConfigId: "web-auth",
            challengeId: "synology-dsm-otp",
            origin: "https://nas.example.test:5001",
          },
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Use the website's authenticator" }),
    );
    expect(latest.synologySettings?.otpAuthenticatorId).toBe("web-auth");
    expect(latest.httpAutoMfa).toMatchObject({
      enabled: true,
      totpConfigId: "web-auth",
    });
    expect(authenticator()).toHaveTextContent("Website — admin");
    expect(
      screen.queryByRole("button", { name: "Use the website's authenticator" }),
    ).toBeNull();
    unmount();
    // Vault references and unknown ids are never offered as local shortcuts.
    render(
      <Fixture
        initial={{
          ...native,
          totpConfigs: [website],
          httpAutoMfa: { version: 1, enabled: true, totpConfigId: totpId },
        }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Use the website's authenticator" }),
    ).toBeNull();
  });

  it("checks the current code locally and hides it when the window ends", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-09-15T10:00:20.000Z"));
    boundary.compute.mockResolvedValue("492039");
    render(
      <Fixture
        initial={{
          ...native,
          synologySettings: {
            version: 1,
            useHttps: true,
            accessMode: "native",
            otpAuthenticatorId: "saved",
          },
          totpConfigs: [config({ id: "saved", algorithm: "sha256" })],
        }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check code" }));
    });
    expect(boundary.compute).toHaveBeenCalledExactlyOnceWith(
      config().secret,
      "SHA256",
      6,
      30,
    );
    expect(screen.getByTestId("synology-authenticator-code")).toHaveTextContent(
      "492039",
    );
    expect(document.body.innerHTML).not.toContain(config().secret);
    act(() => vi.advanceTimersByTime(9_000));
    expect(
      screen.getByTestId("synology-authenticator-code"),
    ).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.queryByTestId("synology-authenticator-code")).toBeNull();
  });

  it("reports a failed check without echoing the secret", async () => {
    boundary.compute.mockRejectedValue(new Error(`bad ${config().secret}`));
    render(
      <Fixture
        initial={{
          ...native,
          synologySettings: {
            version: 1,
            useHttps: true,
            accessMode: "native",
            otpAuthenticatorId: "saved",
          },
          totpConfigs: [config({ id: "saved" })],
        }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check code" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "couldn't be generated",
    );
    expect(document.body.innerHTML).not.toContain(config().secret);
  });

  it.each([
    [[], /no longer on this connection/, "Saved authenticator unavailable"],
    // Export shape: the entry stays selected, without its secret.
    [[config({ id: "saved", secret: "" })], /no secret/, "Recovery — admin"],
    [
      [config({ id: "saved", period: 7 })],
      /settings can't generate DSM codes/,
      "Recovery — admin",
    ],
    [
      [config({ id: "saved" }), config({ id: "saved", issuer: "Copy" })],
      /More than one/,
      "Saved authenticator unavailable",
    ],
  ])(
    "warns about an unusable saved reference and offers no code check: %#",
    (totpConfigs, message, shown) => {
      const redacted = totpConfigs.map((item) => {
        const copy = { ...item } as Partial<TOTPConfig>;
        if (!copy.secret) delete copy.secret;
        return copy as TOTPConfig;
      });
      render(
        <Fixture
          initial={{
            ...native,
            synologySettings: {
              version: 1,
              useHttps: true,
              accessMode: "native",
              otpAuthenticatorId: "saved",
            },
            totpConfigs: redacted,
          }}
        />,
      );
      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(authenticator()).toHaveTextContent(shown);
      expect(screen.queryByRole("button", { name: "Check code" })).toBeNull();
    },
  );
});

describe("NAS API authenticator for vault credentials", () => {
  const vault: Partial<Connection> = {
    ...native,
    credentialSource: { kind: "vault", credentialId },
    httpAutoMfa: {
      version: 1,
      enabled: true,
      totpConfigId: totpId,
      challengeId: "synology-dsm-otp",
      origin: "https://nas.example.test:5001",
    },
    totpConfigs: [config({ id: "local", secret: "LOCALSEEDLOCALSEED" })],
  };

  it("writes credentialSource.totpId, disarms website consent and never offers local secrets", () => {
    boundary.vault.entries = [
      { id: totpId, label: "DSM authenticator" },
      { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", label: "Other" },
    ];
    render(<Fixture initial={vault} />);
    expect(screen.queryByLabelText("Authenticator secret")).toBeNull();
    fireEvent.click(authenticator());
    expect(
      screen.queryByRole("option", { name: "Add authenticator secret" }),
    ).toBeNull();
    expect(screen.queryByRole("option", { name: /Recovery/ })).toBeNull();
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "DSM authenticator" }),
    );
    expect(latest.credentialSource).toEqual({
      kind: "vault",
      credentialId,
      totpId,
    });
    expect(latest.httpAutoMfa).toEqual({ version: 1, enabled: false });
    expect(latest.synologySettings).toEqual(vault.synologySettings);
    choose("None — enter codes manually");
    expect(
      Object.prototype.hasOwnProperty.call(latest.credentialSource, "totpId"),
    ).toBe(false);
    expect(
      screen.queryByRole("button", { name: "Use the website's authenticator" }),
    ).toBeNull();
  });

  it("does not add website consent to a connection that has none", () => {
    boundary.vault.entries = [{ id: totpId, label: "DSM authenticator" }];
    render(
      <Fixture
        initial={{
          ...native,
          credentialSource: { kind: "vault", credentialId },
        }}
      />,
    );
    choose("DSM authenticator");
    expect(latest).not.toHaveProperty("httpAutoMfa");
  });

  it("guides an entry without authenticators to the vault editor", () => {
    render(<Fixture initial={vault} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Add the DSM authenticator's secret to this entry in Settings → Security → Database credential vault, then Reload.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reload authenticators" }),
    );
    expect(boundary.reload).toHaveBeenCalledOnce();
  });

  it("shows loading, error, locked and stale-reference states", () => {
    boundary.vault = { entries: [], loading: true, error: "", available: true };
    const { rerender } = render(
      <Fixture
        initial={{
          ...vault,
          credentialSource: { kind: "vault", credentialId, totpId },
        }}
      />,
    );
    expect(authenticator()).toBeDisabled();
    expect(authenticator()).toHaveTextContent("Loading vault authenticators…");
    expect(screen.queryByRole("status")).toBeNull();

    boundary.vault = {
      entries: [],
      loading: false,
      error: "Vault authenticators could not be read.",
      available: true,
    };
    rerender(<Fixture initial={vault} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Vault authenticators could not be read.",
    );

    boundary.vault = {
      entries: [],
      loading: false,
      error: "",
      available: false,
    };
    rerender(<Fixture initial={vault} />);
    expect(authenticator()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Open and unlock the owning database",
    );

    cleanup();
    boundary.vault = {
      entries: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", label: "Other" }],
      loading: false,
      error: "",
      available: true,
    };
    render(
      <Fixture
        initial={{
          ...vault,
          credentialSource: { kind: "vault", credentialId, totpId },
          synologySettings: {
            version: 1,
            useHttps: true,
            accessMode: "native",
            otpAuthenticatorId: "local",
          },
        }}
      />,
    );
    expect(authenticator()).toHaveTextContent(
      "Saved vault authenticator unavailable",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "no longer in this entry",
    );
    expect(
      screen.getByText(/ignored while vault credentials are selected/),
    ).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("LOCALSEEDLOCALSEED");
  });
});

describe("NAS API authenticator placement", () => {
  it("appears only in NAS API mode", () => {
    render(
      <Fixture
        options
        initial={{
          ...native,
          synologySettings: {
            version: 1,
            useHttps: true,
            accessMode: "website",
          },
        }}
      />,
    );
    expect(screen.queryByTestId("synology-authenticator-section")).toBeNull();
    fireEvent.click(
      screen.getByRole("combobox", { name: "Synology access mode" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Synology NAS API" }),
    );
    expect(
      screen.getByTestId("synology-authenticator-section"),
    ).toBeInTheDocument();
  });

  it("is available for legacy synology connections", () => {
    render(
      <Fixture
        options
        initial={{
          protocol: "synology",
          hostname: "nas.example.test",
          port: 5001,
          synologySettings: { version: 1, useHttps: true },
        }}
      />,
    );
    addSecret(SEED);
    expect(latest.synologySettings).toEqual({
      version: 1,
      useHttps: true,
      otpAuthenticatorId: latest.totpConfigs![0].id,
    });
  });
});
