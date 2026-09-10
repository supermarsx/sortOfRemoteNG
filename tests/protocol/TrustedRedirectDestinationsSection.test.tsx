import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import HTTPOptions from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";

afterEach(cleanup);
function Editor({ seed = {} }: { seed?: Partial<Connection> }) {
  const [data, setData] = useState<Partial<Connection>>({
    protocol: "https",
    hostname: "source.example",
    ...seed,
  });
  return (
    <>
      <HTTPOptions
        formData={data}
        setFormData={setData}
        sections={["advanced"]}
      />
      <output data-testid="draft">{JSON.stringify(data)}</output>
    </>
  );
}
const draft = () => JSON.parse(screen.getByTestId("draft").textContent!);
const add = (value: string) => {
  fireEvent.change(screen.getByLabelText("Destination origin"), {
    target: { value },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add destination" }));
};
describe("trusted redirect destinations in Advanced settings", () => {
  it("adds, persists and removes canonical exact origins without changing permissions", () => {
    const seed = {
      httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY, httpsOnly: true },
      httpsTrustPolicy: "strict" as const,
    };
    const { unmount } = render(<Editor seed={seed} />);
    expect(screen.getByText("No trusted destinations.")).toBeInTheDocument();
    expect(draft()).not.toHaveProperty("httpTrustedRedirectDestinations");
    add("HTTPS://NAS.EXAMPLE:443/");
    const saved = draft();
    expect(saved).toMatchObject({
      ...seed,
      httpTrustedRedirectDestinations: {
        version: 1,
        origins: ["https://nas.example"],
      },
    });
    expect(saved).not.toHaveProperty("httpRedirectAuthentication");
    unmount();
    render(<Editor seed={JSON.parse(JSON.stringify(saved))} />);
    expect(
      screen.getByRole("list", { name: "Trusted redirect destination list" }),
    ).toHaveTextContent("https://nas.example");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove https://nas.example" }),
    );
    expect(draft().httpTrustedRedirectDestinations.origins).toEqual([]);
  });
  it("rejects path/credential input and duplicates without persisting them", () => {
    render(<Editor />);
    add("https://user:SECRET@nas.example/path");
    expect(screen.getByRole("alert")).not.toHaveTextContent("SECRET");
    expect(draft()).not.toHaveProperty("httpTrustedRedirectDestinations");
    add("https://nas.example");
    add("https://NAS.EXAMPLE:443/");
    expect(screen.getByRole("alert")).toHaveTextContent("already listed");
    expect(draft().httpTrustedRedirectDestinations.origins).toHaveLength(1);
  });
  it("bounds the list and permits removal at capacity", () => {
    render(
      <Editor
        seed={{
          httpTrustedRedirectDestinations: {
            version: 1,
            origins: Array.from(
              { length: 32 },
              (_, i) => `https://nas${i}.example`,
            ),
          },
        }}
      />,
    );
    expect(screen.getByLabelText("Destination origin")).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove https://nas0.example" }),
    );
    expect(screen.getByLabelText("Destination origin")).toBeEnabled();
  });
  it("keeps malformed lists blocked until explicit clearing", () => {
    render(
      <Editor
        seed={{
          httpTrustedRedirectDestinations: {
            version: 1,
            origins: ["https://user:SECRET@nas.example"],
          },
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("list is invalid");
    expect(
      screen.queryByLabelText("Destination origin"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveTextContent("SECRET");
    fireEvent.click(
      screen.getByRole("button", { name: "Clear invalid destination list" }),
    );
    expect(draft().httpTrustedRedirectDestinations).toEqual({
      version: 1,
      origins: [],
    });
  });
  it.each([false, true])(
    "has no extra opt-in and drops obsolete autoContinue=%s on list edits",
    (autoContinue) => {
      const view = render(
        <Editor
          seed={{
            httpTrustedRedirectDestinations: {
              version: 1,
              origins: [],
              autoContinue,
            },
          }}
        />,
      );
      expect(
        screen.queryByRole("checkbox", { name: /Automatically continue/ }),
      ).toBeNull();
      expect(
        screen.getByText(/Saved destinations skip repeat/),
      ).toHaveTextContent(
        "Certificate checks, HTTPS-only and downgrade restrictions still apply",
      );
      add("https://nas.example");
      expect(draft().httpTrustedRedirectDestinations).toEqual({
        version: 1,
        origins: ["https://nas.example"],
      });
      const saved = draft();
      view.unmount();
      render(<Editor seed={JSON.parse(JSON.stringify(saved))} />);
      expect(
        screen.queryByRole("checkbox", { name: /Automatically continue/ }),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Remove https://nas.example" }),
      );
      expect(draft().httpTrustedRedirectDestinations).toEqual({
        version: 1,
        origins: [],
      });
      expect(draft()).not.toHaveProperty("httpProxyPolicy");
      expect(draft()).not.toHaveProperty("httpRedirectAuthentication");
    },
  );
});
