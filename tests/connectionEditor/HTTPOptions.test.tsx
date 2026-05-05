import React from "react";
import { beforeEach, describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";

const makeFormData = (): Partial<Connection> => ({
  id: "http-1",
  name: "HTTP Conn",
  protocol: "http",
  hostname: "example.com",
  port: 80,
  authType: "header",
  httpHeaders: {},
  httpBookmarks: [],
});

const Wrapper = () => {
  const [formData, setFormData] =
    React.useState<Partial<Connection>>(makeFormData());
  return <HTTPOptions formData={formData} setFormData={setFormData} />;
};

const RecordingWrapper = ({ initial }: { initial: Partial<Connection> }) => {
  const [formData, setFormData] = React.useState<Partial<Connection>>(initial);
  return (
    <>
      <HTTPOptions formData={formData} setFormData={setFormData} />
      <output data-testid="form-data">{JSON.stringify(formData)}</output>
    </>
  );
};

describe("HTTPOptions", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("adds a custom header via modal", async () => {
    const { container } = render(<Wrapper />);

    expect(container.querySelector('[role="combobox"]')?.className).toContain(
      "sor-form-select",
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Header" }));
    expect(await screen.findByText("Add HTTP Header")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("e.g. Authorization"), {
      target: { value: "X-Test" },
    });
    expect(
      screen.getByPlaceholderText("e.g. Authorization").className,
    ).toContain("sor-form-input");
    fireEvent.change(screen.getByPlaceholderText("e.g. Bearer token123"), {
      target: { value: "abc123" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));

    await waitFor(() => {
      expect(screen.queryByText("Add HTTP Header")).not.toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("X-Test")).toBeInTheDocument();
    expect(screen.getByDisplayValue("abc123")).toBeInTheDocument();
  });

  it("adds a bookmark via modal and closes with escape", async () => {
    render(<Wrapper />);

    fireEvent.click(screen.getByRole("button", { name: /Add bookmark/i }));
    expect(await screen.findByText("Add Bookmark")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("e.g. Status Page"), {
      target: { value: "Status" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. /status-log.asp"), {
      target: { value: "/status" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));

    await waitFor(() => {
      expect(screen.getByText("Bookmarks (1)")).toBeInTheDocument();
    });
    expect(screen.getByText("Status")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Add bookmark/i }));
    await screen.findByText("Add Bookmark");
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("Add Bookmark")).not.toBeInTheDocument();
    });
  });

  it("writes HTTPS certificate policy to httpsTrustPolicy with legacy TLS display fallback", async () => {
    render(
      <RecordingWrapper
        initial={{
          ...makeFormData(),
          protocol: "https",
          port: 443,
          tlsTrustPolicy: "strict",
        }}
      />,
    );

    expect(screen.getByText("HTTPS Certificate Trust Policy")).toBeInTheDocument();
    const legacyFallback = screen.getByText("Strict (reject unless pre-approved)");
    expect(legacyFallback).toBeInTheDocument();

    fireEvent.click(legacyFallback.closest("button")!);
    fireEvent.mouseDown(await screen.findByRole("option", { name: "Always Ask" }));

    await waitFor(() => {
      const formData = JSON.parse(screen.getByTestId("form-data").textContent ?? "{}");
      expect(formData.httpsTrustPolicy).toBe("always-ask");
      expect(formData.tlsTrustPolicy).toBe("strict");
    });
  });

  it("shows only explicit HTTPS trust records in the HTTPS editor", () => {
    localStorage.setItem(
      "trustStore:http-1",
      JSON.stringify({
        "https:example.com:443": {
          host: "example.com:443",
          type: "https",
          identity: {
            fingerprint: "SHA256:https-cert",
            firstSeen: "2026-01-01T00:00:00.000Z",
            lastSeen: "2026-01-01T00:00:00.000Z",
          },
          userApproved: true,
        },
        "tls:legacy.example.com:443": {
          host: "legacy.example.com:443",
          type: "tls",
          identity: {
            fingerprint: "SHA256:legacy-cert",
            firstSeen: "2026-01-01T00:00:00.000Z",
            lastSeen: "2026-01-01T00:00:00.000Z",
          },
          userApproved: true,
        },
      }),
    );

    render(
      <RecordingWrapper
        initial={{
          ...makeFormData(),
          protocol: "https",
          port: 443,
        }}
      />,
    );

    expect(screen.getByText("Stored HTTPS Certificates (1)")).toBeInTheDocument();
    expect(screen.getByText("example.com:443")).toBeInTheDocument();
    expect(screen.queryByText("legacy.example.com:443")).not.toBeInTheDocument();
  });
});
