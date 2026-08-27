import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../src/types/connection/connection";

const mocks = vi.hoisted(() => ({ hook: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallback?: string | Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => {
      const template = typeof fallback === "string" ? fallback : key;
      const values = (typeof fallback === "object" ? fallback : options) ?? {};
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(values[name] ?? ""),
      );
    },
  }),
}));

vi.mock("../../src/hooks/protocol/useMongoDBClient", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/hooks/protocol/useMongoDBClient")
    >();
  return {
    ...actual,
    useMongoDBClient: (...args: unknown[]) => mocks.hook(...args),
  };
});

import { MongoDBClient } from "../../src/components/protocol/MongoDBClient";
import {
  collectDocumentColumns,
  formatMongoCell,
} from "../../src/components/protocol/mongodb/MongoResultsGrid";

const session: ConnectionSession = {
  id: "frontend-mongo-1",
  connectionId: "connection-mongo-1",
  name: "Documents",
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00.000Z"),
  protocol: "mongodb" as ConnectionSession["protocol"],
  hostname: "mongo.example.test",
  backendSessionId: "backend-mongo-1",
};

const documents = [
  {
    _id: { $oid: "65a1" },
    name: "Ada",
    address: { city: "London", zip: "N1" },
  },
  { _id: { $oid: "65a2" }, name: "Margaret", tags: ["x", "y"], age: null },
];

const createModel = (patch: Record<string, unknown> = {}) => ({
  status: "connected" as const,
  error: null,
  backendSessionId: "backend-mongo-1",
  sessionInfo: {
    id: "backend-mongo-1",
    label: "Documents",
    hosts: ["mongo.example.test:27117"],
    database: "testdb",
    status: "Connected" as const,
    connected_at: "2026-01-01T00:00:00Z",
    server_version: "7.0.5",
    replica_set: "rs0",
  },
  databases: [{ name: "admin" }, { name: "testdb" }],
  collections: [
    { name: "people", collection_type: "collection" },
    { name: "orders", collection_type: "collection" },
  ],
  selectedDatabase: "testdb",
  selectedCollection: "people",
  collectionStats: {
    namespace: "testdb.people",
    count: 5,
    size: 2048,
    storage_size: 4096,
    num_indexes: 2,
    total_index_size: 512,
    capped: false,
  },
  documentCount: 5,
  form: { filter: "{}", projection: "", sort: "", limit: 50, skip: 0 },
  setFormField: vi.fn(),
  formErrors: {},
  results: { documents, returned: 2, has_more: true, elapsed_ms: 3 },
  pipelineText: "[]",
  setPipelineText: vi.fn(),
  aggregateResult: null,
  indexes: [
    {
      name: "_id_",
      keys: { _id: 1 },
      unique: false,
      sparse: false,
      options: {},
    },
    {
      name: "city_1",
      keys: { city: 1 },
      unique: true,
      sparse: false,
      options: { expireAfterSeconds: 60 },
    },
  ],
  isBusy: false,
  isExecuting: false,
  lastWrite: null,
  lastRunKind: "find" as const,
  refreshDatabases: vi.fn().mockResolvedValue([]),
  selectDatabase: vi.fn().mockResolvedValue([]),
  selectCollection: vi.fn().mockResolvedValue(undefined),
  runFind: vi.fn().mockResolvedValue(null),
  nextPage: vi.fn().mockResolvedValue(null),
  prevPage: vi.fn().mockResolvedValue(null),
  countDocuments: vi.fn().mockResolvedValue(0),
  runAggregate: vi.fn().mockResolvedValue(null),
  loadIndexes: vi.fn().mockResolvedValue([]),
  loadCollectionStats: vi.fn().mockResolvedValue(null),
  createIndex: vi.fn().mockResolvedValue("x"),
  dropIndex: vi.fn().mockResolvedValue(undefined),
  insertDocuments: vi.fn().mockResolvedValue(null),
  updateDocuments: vi.fn().mockResolvedValue(null),
  deleteDocuments: vi.fn().mockResolvedValue(null),
  reconnect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  ...patch,
});

let model = createModel();

beforeEach(() => {
  model = createModel();
  mocks.hook.mockReset();
  mocks.hook.mockImplementation(() => model);
});

const testIds = [
  "mongodb-client",
  "mongodb-status",
  "mongodb-databases",
  "mongodb-collections",
  "mongodb-filter",
  "mongodb-limit",
  "mongodb-skip",
  "mongodb-find",
  "mongodb-results",
  "mongodb-json-toggle",
  "mongodb-aggregate-editor",
  "mongodb-aggregate-run",
  "mongodb-indexes",
];

describe("MongoDBClient", () => {
  it("renders every test id the e2e spec relies on", () => {
    render(<MongoDBClient session={session} />);
    for (const id of testIds)
      expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getAllByTestId("mongodb-result-row")).toHaveLength(2);
    expect(screen.getAllByTestId("mongodb-result-cell").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByTestId("mongodb-status")).toHaveTextContent("connected");
    expect(screen.getByTestId("mongodb-status")).toHaveAttribute(
      "data-status",
      "connected",
    );
  });

  it("passes the session to the hook and shows server metadata", () => {
    render(<MongoDBClient session={session} />);
    expect(mocks.hook).toHaveBeenCalledWith(session);
    expect(screen.getByText(/7\.0\.5/)).toBeInTheDocument();
    expect(screen.getByTestId("mongodb-target")).toHaveTextContent(
      "testdb.people",
    );
  });

  it("lists databases and collections and browses on click", () => {
    render(<MongoDBClient session={session} />);
    expect(screen.getByTestId("mongodb-databases")).toHaveTextContent("testdb");
    expect(screen.getByTestId("mongodb-collections")).toHaveTextContent(
      "people",
    );
    fireEvent.click(screen.getByText("admin"));
    expect(model.selectDatabase).toHaveBeenCalledWith("admin");
    fireEvent.click(screen.getByText("orders"));
    expect(model.selectCollection).toHaveBeenCalledWith("orders");
  });

  it("renders a union-of-keys grid with _id first and nested values compacted", () => {
    render(<MongoDBClient session={session} />);
    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual(["#", "_id", "name", "address", "tags", "age"]);
    const firstRowCells = screen
      .getAllByTestId("mongodb-result-row")[0]
      .querySelectorAll("td");
    expect(firstRowCells[1]).toHaveTextContent("65a1");
    expect(firstRowCells[3]).toHaveTextContent('{"city":"London","zip":"N1"}');
    expect(firstRowCells[3]).toHaveAttribute(
      "title",
      JSON.stringify({ city: "London", zip: "N1" }, null, 2),
    );
    const secondRowCells = screen
      .getAllByTestId("mongodb-result-row")[1]
      .querySelectorAll("td");
    expect(secondRowCells[3]).toHaveTextContent("—");
    expect(secondRowCells[5]).toHaveTextContent("null");
  });

  it("edits the find form through the hook and runs Find, Count and Ctrl+Enter", () => {
    render(<MongoDBClient session={session} />);
    fireEvent.change(screen.getByTestId("mongodb-filter"), {
      target: { value: '{"city":"London"}' },
    });
    expect(model.setFormField).toHaveBeenCalledWith(
      "filter",
      '{"city":"London"}',
    );
    fireEvent.change(screen.getByTestId("mongodb-limit"), {
      target: { value: "10" },
    });
    expect(model.setFormField).toHaveBeenCalledWith("limit", 10);
    fireEvent.change(screen.getByTestId("mongodb-skip"), {
      target: { value: "1" },
    });
    expect(model.setFormField).toHaveBeenCalledWith("skip", 1);
    fireEvent.click(screen.getByTestId("mongodb-find"));
    expect(model.runFind).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByTestId("mongodb-filter"), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(model.runFind).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByTestId("mongodb-count"));
    expect(model.countDocuments).toHaveBeenCalledTimes(1);
  });

  it("shows inline JSON errors from the hook", () => {
    model = createModel({
      formErrors: { filter: "Filter: bad JSON. Use strict JSON" },
    });
    render(<MongoDBClient session={session} />);
    expect(screen.getByTestId("mongodb-filter-error")).toHaveTextContent(
      "bad JSON",
    );
    expect(screen.getByTestId("mongodb-filter")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("toggles the JSON view with extended-JSON _id inside the results container", () => {
    render(<MongoDBClient session={session} />);
    fireEvent.click(screen.getByTestId("mongodb-json-toggle"));
    const results = screen.getByTestId("mongodb-results");
    expect(results).toContainElement(screen.getByTestId("mongodb-json-view"));
    expect(results.textContent).toContain('"$oid": "65a1"');
    expect(results.textContent).toContain("address");
    expect(screen.queryAllByTestId("mongodb-result-row")).toHaveLength(0);
    fireEvent.click(screen.getByTestId("mongodb-json-toggle"));
    expect(screen.getAllByTestId("mongodb-result-row")).toHaveLength(2);
  });

  it("paginates with prev/next and shows the range", () => {
    render(<MongoDBClient session={session} />);
    expect(screen.getByTestId("mongodb-result-summary")).toHaveTextContent(
      "Showing 1–2 of 5",
    );
    expect(screen.getByTestId("mongodb-prev")).toBeDisabled();
    fireEvent.click(screen.getByTestId("mongodb-next"));
    expect(model.nextPage).toHaveBeenCalled();
    model = createModel({
      form: { filter: "{}", projection: "", sort: "", limit: 50, skip: 50 },
    });
    render(<MongoDBClient session={{ ...session, id: "second" }} />);
    const prevButtons = screen.getAllByTestId("mongodb-prev");
    fireEvent.click(prevButtons[prevButtons.length - 1]);
    expect(model.prevPage).toHaveBeenCalled();
  });

  it("opens the document viewer for a clicked row", () => {
    render(<MongoDBClient session={session} />);
    expect(screen.queryByTestId("mongodb-document-viewer")).toBeNull();
    fireEvent.click(screen.getAllByTestId("mongodb-result-row")[0]);
    const viewer = screen.getByTestId("mongodb-document-viewer");
    expect(viewer.textContent).toContain('"zip": "N1"');
    fireEvent.click(screen.getByLabelText("Close document viewer"));
    expect(screen.queryByTestId("mongodb-document-viewer")).toBeNull();
  });

  it("runs the aggregate editor and renders pipeline output in the shared results area", () => {
    model = createModel({
      lastRunKind: "aggregate",
      aggregateResult: {
        documents: [
          { _id: "London", n: 2 },
          { _id: "Paris", n: 1 },
        ],
        returned: 2,
        has_more: false,
        elapsed_ms: 1,
      },
    });
    render(<MongoDBClient session={session} />);
    fireEvent.change(screen.getByTestId("mongodb-aggregate-editor"), {
      target: { value: '[{"$match":{}}]' },
    });
    expect(model.setPipelineText).toHaveBeenCalledWith('[{"$match":{}}]');
    fireEvent.click(screen.getByTestId("mongodb-aggregate-run"));
    expect(model.runAggregate).toHaveBeenCalledTimes(1);
    const results = screen.getByTestId("mongodb-results");
    expect(results).toHaveAttribute("data-source", "aggregate");
    expect(screen.getAllByTestId("mongodb-result-row")).toHaveLength(2);
    expect(results.textContent).toContain("London");
    expect(screen.queryByTestId("mongodb-next")).toBeNull();
  });

  it("lists indexes with flags and refreshes on demand", () => {
    render(<MongoDBClient session={session} />);
    const indexes = screen.getByTestId("mongodb-indexes");
    expect(indexes).toHaveTextContent("city_1");
    expect(indexes).toHaveTextContent("unique");
    expect(indexes).toHaveTextContent("ttl 60s");
    expect(screen.getAllByTestId("mongodb-index-row")).toHaveLength(2);
    fireEvent.click(screen.getByTestId("mongodb-indexes-refresh"));
    expect(model.loadIndexes).toHaveBeenCalled();
    expect(screen.queryByTestId("mongodb-index-drop")).toBeNull();
  });

  it("shows collection statistics", () => {
    render(<MongoDBClient session={session} />);
    const stats = screen.getByTestId("mongodb-stats");
    expect(stats).toHaveTextContent("2.0 KB");
    expect(stats).toHaveTextContent("4.0 KB");
    fireEvent.click(screen.getByTestId("mongodb-stats-refresh"));
    expect(model.loadCollectionStats).toHaveBeenCalled();
  });

  it("gates writes behind edit mode and a confirm dialog", async () => {
    render(<MongoDBClient session={session} />);
    expect(screen.queryByTestId("mongodb-edit-panel")).toBeNull();
    fireEvent.click(screen.getByTestId("mongodb-edit-mode"));
    expect(screen.getByTestId("mongodb-edit-panel")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("mongodb-insert-editor"), {
      target: { value: '{"name":"Grace"}' },
    });
    fireEvent.click(screen.getByTestId("mongodb-insert"));
    expect(model.insertDocuments).not.toHaveBeenCalled();
    expect(screen.getByTestId("mongodb-confirm")).toHaveTextContent(
      "testdb.people",
    );
    fireEvent.click(screen.getByTestId("mongodb-confirm-cancel"));
    expect(screen.queryByTestId("mongodb-confirm")).toBeNull();
    expect(model.insertDocuments).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("mongodb-insert"));
    fireEvent.click(screen.getByTestId("mongodb-confirm-accept"));
    expect(model.insertDocuments).toHaveBeenCalledWith('{"name":"Grace"}');
    await waitFor(() => expect(model.runFind).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId("mongodb-update-filter"), {
      target: { value: '{"a":1}' },
    });
    fireEvent.change(screen.getByTestId("mongodb-update-editor"), {
      target: { value: '{"$set":{"b":2}}' },
    });
    fireEvent.click(screen.getByTestId("mongodb-update-multi"));
    fireEvent.click(screen.getByTestId("mongodb-update"));
    expect(screen.getByTestId("mongodb-confirm")).toHaveTextContent(
      "all matching documents",
    );
    fireEvent.click(screen.getByTestId("mongodb-confirm-accept"));
    expect(model.updateDocuments).toHaveBeenCalledWith(
      '{"a":1}',
      '{"$set":{"b":2}}',
      {
        multi: true,
        upsert: false,
      },
    );

    fireEvent.change(screen.getByTestId("mongodb-delete-filter"), {
      target: { value: '{"a":1}' },
    });
    fireEvent.click(screen.getByTestId("mongodb-delete"));
    expect(screen.getByTestId("mongodb-confirm")).toHaveTextContent(
      "cannot be undone",
    );
    fireEvent.click(screen.getByTestId("mongodb-confirm-accept"));
    expect(model.deleteDocuments).toHaveBeenCalledWith('{"a":1}', false);
  });

  it("allows index create/drop only in edit mode with drop confirmed", () => {
    render(<MongoDBClient session={session} />);
    fireEvent.click(screen.getByTestId("mongodb-edit-mode"));
    fireEvent.change(screen.getByTestId("mongodb-index-keys"), {
      target: { value: '{"name":1}' },
    });
    fireEvent.change(screen.getByTestId("mongodb-index-options"), {
      target: { value: '{"unique":true}' },
    });
    fireEvent.click(screen.getByTestId("mongodb-index-create"));
    expect(model.createIndex).toHaveBeenCalledWith(
      '{"name":1}',
      '{"unique":true}',
    );
    const drops = screen.getAllByTestId("mongodb-index-drop");
    expect(drops).toHaveLength(1);
    fireEvent.click(drops[0]);
    expect(model.dropIndex).not.toHaveBeenCalled();
    expect(screen.getByTestId("mongodb-confirm")).toHaveTextContent("city_1");
    fireEvent.click(screen.getByTestId("mongodb-confirm-accept"));
    expect(model.dropIndex).toHaveBeenCalledWith("city_1");
  });

  it("disables actions when nothing is selected and shows placeholders", () => {
    model = createModel({
      selectedCollection: null,
      results: null,
      lastRunKind: null,
      indexes: [],
      collectionStats: null,
    });
    render(<MongoDBClient session={session} />);
    expect(screen.getByTestId("mongodb-find")).toBeDisabled();
    expect(screen.getByTestId("mongodb-aggregate-run")).toBeDisabled();
    expect(screen.getByTestId("mongodb-results")).toHaveTextContent(
      "Pick a collection",
    );
    expect(screen.getByTestId("mongodb-indexes")).toHaveTextContent(
      "Select a collection",
    );
  });

  it("shows the redacted error banner and drives reconnect/disconnect", () => {
    model = createModel({
      status: "error",
      error: "auth failed for mongodb://[redacted]@host",
    });
    render(<MongoDBClient session={session} />);
    expect(screen.getByTestId("mongodb-error")).toHaveTextContent("[redacted]");
    expect(screen.getByTestId("mongodb-status")).toHaveTextContent("error");
    fireEvent.click(screen.getByTestId("mongodb-reconnect"));
    expect(model.reconnect).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("mongodb-disconnect"));
    expect(model.disconnect).toHaveBeenCalled();
  });

  it("exports the current documents as JSON", () => {
    const createObjectURL = vi.fn(() => "blob:mongo");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(<MongoDBClient session={session} />);
    fireEvent.click(screen.getByTestId("mongodb-export"));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mongo");
    click.mockRestore();
  });
});

describe("MongoResultsGrid helpers", () => {
  it("collects the union of keys with _id first", () => {
    expect(
      collectDocumentColumns([{ b: 1 }, { _id: 2, a: 3 }, { b: 4, c: 5 }]),
    ).toEqual(["_id", "b", "a", "c"]);
    expect(collectDocumentColumns([])).toEqual([]);
  });

  it("formats extended-JSON scalars and nested values compactly", () => {
    expect(formatMongoCell({ $oid: "65a1" })).toBe("65a1");
    expect(formatMongoCell({ $date: "2026-01-01T00:00:00Z" })).toBe(
      "2026-01-01T00:00:00Z",
    );
    expect(formatMongoCell({ $numberLong: "42" })).toBe("42");
    expect(formatMongoCell({ a: 1, b: [2] })).toBe('{"a":1,"b":[2]}');
    expect(formatMongoCell(null)).toBe("null");
    expect(formatMongoCell(undefined)).toBe("");
    expect(formatMongoCell(true)).toBe("true");
  });
});
