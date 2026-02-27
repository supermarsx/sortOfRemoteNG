import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HTTPOptions } from "../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../src/types/connection";

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

describe("HTTPOptions", () => {
  it("adds a custom header via modal", async () => {
    render(<Wrapper />);

    fireEvent.click(screen.getByRole("button", { name: "Add Header" }));
    expect(await screen.findByText("Add HTTP Header")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("e.g. Authorization"), {
      target: { value: "X-Test" },
    });
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
});
