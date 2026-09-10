import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import HTTPOptions from "../../src/components/connectionEditor/HTTPOptions";
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";
import { normalizeHttpProxyPolicy } from "../../src/utils/connection/httpProxyPolicy";
import {
  anonymousRedirectConnection,
  parseHttpRedirectReview,
} from "../../src/utils/protocol/httpRedirectReview";

afterEach(cleanup);
function Editor({
  seed = {},
  advanced = false,
}: {
  seed?: Partial<Connection>;
  advanced?: boolean;
}) {
  const [data, setData] = useState<Partial<Connection>>({
    protocol: "https",
    hostname: "nas.example.test",
    port: 5001,
    httpApplication: { version: 1, id: "synology-dsm", loginMode: "manual" },
    ...seed,
  });
  return (
    <>
      <HTTPOptions
        formData={data}
        setFormData={setData}
        sections={advanced ? ["application", "advanced"] : ["application"]}
      />
      <output data-testid="saved-shape">{JSON.stringify(data)}</output>
    </>
  );
}
function selectMode(name: string) {
  fireEvent.click(
    screen.getByRole("combobox", { name: "Synology access mode" }),
  );
  fireEvent.mouseDown(screen.getByRole("option", { name }));
}
const savedShape = () =>
  JSON.parse(screen.getByTestId("saved-shape").textContent!);
describe("Synology HTTP application views", () => {
  it("starts as a website and switches to an API explorer without inventing a protocol", () => {
    render(<Editor />);
    expect(
      screen.getByRole("combobox", { name: "Synology access mode" }),
    ).toHaveTextContent("Website");
    expect(screen.queryByLabelText("DSM API password")).not.toBeInTheDocument();
    selectMode("Synology NAS API");
    expect(
      screen.getByRole("combobox", { name: "Synology access mode" }),
    ).toHaveTextContent("Synology NAS API");
    expect(
      screen.getByText(
        /provides File Station and supported NAS administration/,
      ),
    ).toBeInTheDocument();
    expect(savedShape()).toMatchObject({
      protocol: "https",
      hostname: "nas.example.test",
      port: 5001,
      synologySettings: { accessMode: "native" },
      httpAutoLogin: false,
    });
    fireEvent.change(screen.getByLabelText("DSM API username"), {
      target: { value: "dsm-user" },
    });
    fireEvent.change(screen.getByLabelText("DSM API password"), {
      target: { value: "synthetic-secret" },
    });
    expect(savedShape()).toMatchObject({
      basicAuthUsername: "dsm-user",
      basicAuthPassword: "synthetic-secret",
    });
    selectMode("Website — DSM in browser");
    expect(savedShape()).toMatchObject({
      protocol: "https",
      port: 5001,
      synologySettings: { accessMode: "website" },
      httpApplication: { loginMode: "manual" },
      basicAuthPassword: "synthetic-secret",
    });
    expect(screen.queryByLabelText("DSM API password")).not.toBeInTheDocument();
  });
  it("follows the selected HTTP transport, retaining a custom NAS port", () => {
    render(
      <Editor
        seed={{
          protocol: "http",
          port: 5443,
          synologySettings: {
            version: 1,
            useHttps: true,
            accessMode: "native",
          },
        }}
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "Synology transport" }),
    ).toHaveTextContent("HTTP — unencrypted");
    fireEvent.click(
      screen.getByRole("combobox", { name: "Synology transport" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", {
        name: "HTTPS — verified system certificates",
      }),
    );
    expect(savedShape()).toMatchObject({
      protocol: "https",
      port: 5443,
      synologySettings: { useHttps: true, accessMode: "native" },
    });
  });
  it("defaults the website alias off and persists only the existing proxy-policy permissions", () => {
    const initial = {
      basicAuthUsername: "alice",
      basicAuthPassword: "synthetic-secret",
      httpVerifySsl: true,
      httpProxyPolicy: {
        ...DEFAULT_HTTP_PROXY_POLICY,
        pageScripts: "inline-only" as const,
        cacheMode: "bypass" as const,
        queryParameters: [{ name: "tenant", value: "example" }],
      },
    };
    const { unmount } = render(<Editor seed={initial} advanced />);
    const alias = screen.getByRole("checkbox", {
      name: "Allow insecure redirects",
    });
    expect(alias).not.toBeChecked();
    fireEvent.click(alias);
    const saved = savedShape();
    expect(saved).toMatchObject({
      ...initial,
      httpProxyPolicy: {
        ...initial.httpProxyPolicy,
        allowCrossOriginRedirects: true,
        allowHttpDowngradeRedirects: true,
      },
    });
    expect(
      screen.getByRole("checkbox", {
        name: /^Allow reviewed cross-origin redirects/,
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: /^Allow reviewed HTTPS-to-HTTP downgrades/,
      }),
    ).toBeChecked();
    expect(saved.synologySettings).toBeUndefined();
    expect(normalizeHttpProxyPolicy(saved.httpProxyPolicy)).toEqual(
      saved.httpProxyPolicy,
    );
    unmount();
    render(<Editor seed={JSON.parse(JSON.stringify(saved))} />);
    expect(
      screen.getByRole("checkbox", { name: "Allow insecure redirects" }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Allow insecure redirects" }),
    );
    expect(savedShape().httpProxyPolicy).toEqual({
      ...saved.httpProxyPolicy,
      allowHttpDowngradeRedirects: false,
    });
  });
  it("reflects the Advanced checkbox and never turns strict HTTPS protection off", () => {
    render(
      <Editor
        advanced
        seed={{
          httpProxyPolicy: {
            ...DEFAULT_HTTP_PROXY_POLICY,
            allowCrossOriginRedirects: true,
          },
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /^Allow reviewed HTTPS-to-HTTP downgrades/,
      }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Allow insecure redirects" }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /^Require HTTPS upstream/ }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Allow insecure redirects" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/takes precedence. This checkbox/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Allow insecure redirects" }),
    );
    expect(savedShape().httpProxyPolicy.httpsOnly).toBe(true);
  });
  it("keeps malformed saved policies blocked instead of resetting security through the alias", () => {
    const invalid = {
      ...DEFAULT_HTTP_PROXY_POLICY,
      httpsOnly: "invalid",
    } as unknown as Connection["httpProxyPolicy"];
    render(<Editor seed={{ httpProxyPolicy: invalid }} />);
    expect(
      screen.getByRole("checkbox", { name: "Allow insecure redirects" }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "saved proxy controls are invalid",
    );
    expect(savedShape().httpProxyPolicy).toEqual(invalid);
  });
  it.each([
    { protocol: "ssh" as const },
    { protocol: "synology" as const },
    {
      httpApplication: {
        version: 1 as const,
        id: "gitea",
        loginMode: "manual" as const,
      },
    },
    {
      synologySettings: {
        version: 1 as const,
        useHttps: true,
        accessMode: "native" as const,
      },
    },
  ])(
    "does not expose the website exception outside HTTP(S) DSM website mode: %j",
    (seed) => {
      render(<Editor seed={seed} />);
      expect(
        screen.queryByRole("checkbox", { name: "Allow insecure redirects" }),
      ).not.toBeInTheDocument();
    },
  );
  it("hides the website alias when switching to NAS API without altering the stored browser policy", () => {
    render(<Editor />);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Allow insecure redirects" }),
    );
    const policy = savedShape().httpProxyPolicy;
    selectMode("Synology NAS API");
    expect(
      screen.queryByRole("checkbox", { name: "Allow insecure redirects" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /website redirect exception does not apply to the NAS API/,
      ),
    ).toBeInTheDocument();
    expect(savedShape().httpProxyPolicy).toEqual(policy);
  });
  it("maps the explicit choice to the existing anonymous reviewed handoff, not credential forwarding", () => {
    render(
      <Editor
        seed={{
          basicAuthUsername: "alice",
          basicAuthPassword: "synthetic-secret",
          httpHeaders: { "X-Example": "private" },
        }}
      />,
    );
    const review = {
      receiptId: "12345678-1234-1234-1234-123456789abc",
      sessionId: "session-a",
      sourceOrigin: "https://nas.example.test:5001",
      destinationUrl: "http://nas.example.test:5000/",
      navigationToken: null,
      documentSequence: 1,
      removedQuery: false,
    };
    expect(
      parseHttpRedirectReview(
        review,
        review.sessionId,
        review.sourceOrigin,
        normalizeHttpProxyPolicy(savedShape().httpProxyPolicy),
      ),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Allow insecure redirects" }),
    );
    const source = savedShape() as Connection;
    expect(
      parseHttpRedirectReview(
        review,
        review.sessionId,
        review.sourceOrigin,
        source.httpProxyPolicy,
      ),
    ).toEqual(review);
    const target = anonymousRedirectConnection(source, review);
    expect(target).toMatchObject({
      protocol: "http",
      hostname: "nas.example.test",
      port: 5000,
      httpAutoLogin: false,
      httpVerifySsl: true,
      httpsTrustPolicy: "always-ask",
    });
    expect(target.basicAuthUsername).toBeUndefined();
    expect(target.basicAuthPassword).toBeUndefined();
    expect(target.httpHeaders).toBeUndefined();
    expect(target.httpApplication).toBeUndefined();
    expect(target.httpProxyPolicy?.queryParameters).toEqual([]);
    expect(
      parseHttpRedirectReview(review, review.sessionId, review.sourceOrigin, {
        ...source.httpProxyPolicy!,
        httpsOnly: true,
      }),
    ).toBeNull();
  });
});
