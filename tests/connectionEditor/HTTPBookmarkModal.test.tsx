import React, { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useHTTPOptions } from "../../src/hooks/connection/useHTTPOptions";
import BookmarkModal from "../../src/components/connectionEditor/httpOptions/BookmarkModal";
import type { Connection } from "../../src/types/connection/connection";

afterEach(cleanup);

function Harness({ path }: { path: string }) {
  const [formData, setFormData] = useState<Partial<Connection>>({
    id: "existing-web",
    protocol: "https",
    httpBookmarks: [{ name: "Status", path }],
  });
  const mgr = useHTTPOptions(formData, setFormData);
  return (
    <>
      <button onClick={() => mgr.openEditBookmark(0, "Status", path)}>
        Edit existing
      </button>
      <button onClick={mgr.openAddBookmark}>New bookmark</button>
      <BookmarkModal mgr={mgr} />
      <output data-testid="draft">
        {JSON.stringify(formData.httpBookmarks)}
      </output>
    </>
  );
}

describe("HTTP options bookmark URL round trips", () => {
  it.each([
    [
      "https://Other.example:443/status?view=all#top",
      "https://Other.example:443/status?view=all#top",
    ],
    ["http://other.example/status", "http://other.example/status"],
    ["status?view=all#top", "/status?view=all#top"],
    ["/status", "/status"],
  ])("saves an existing bookmark without corrupting %s", (path, expected) => {
    render(<Harness path={path} />);
    fireEvent.click(screen.getByText("Edit existing"));
    expect(screen.getByLabelText("URL or path")).toHaveValue(path);
    expect(
      screen.getByText(
        "Use a path on this connection or a full HTTP or HTTPS URL.",
      ),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(JSON.parse(screen.getByTestId("draft").textContent!)).toEqual([
      { name: "Renamed", path: expected },
    ]);
  });

  it("adds an absolute URL and cancels subsequent changes safely", () => {
    render(<Harness path="/status" />);
    fireEvent.click(screen.getByText("New bookmark"));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Remote" },
    });
    fireEvent.change(screen.getByLabelText("URL or path"), {
      target: { value: "https://other.example/status" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const saved = screen.getByTestId("draft").textContent;
    expect(JSON.parse(saved!)[1]).toEqual({
      name: "Remote",
      path: "https://other.example/status",
    });
    fireEvent.click(screen.getByText("Edit existing"));
    fireEvent.change(screen.getByLabelText("URL or path"), {
      target: { value: "https://changed.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("draft").textContent).toBe(saved);
  });
});
