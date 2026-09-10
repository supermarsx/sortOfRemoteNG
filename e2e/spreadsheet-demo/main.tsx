import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import SpreadsheetEditor from "../../src/components/documents/SpreadsheetEditor";
import type { DocumentWorkbook } from "../../src/types/documents/document";
const initial: DocumentWorkbook = {
  version: 1,
  styles: {},
  validations: {},
  sheets: [
    {
      id: "inventory",
      name: "Inventory",
      rows: 100,
      columns: 26,
      cells: {
        A1: { value: "Item" },
        B1: { value: "Count" },
        A2: { value: "Router" },
        B2: { value: 2 },
        B3: { value: null, formula: "=SUM(B2,B2)" },
      },
      merges: [],
      rowMetadata: {},
      columnMetadata: {},
    },
    {
      id: "notes",
      name: "Notes",
      rows: 100,
      columns: 26,
      cells: { A1: { value: "Synthetic test only" } },
      merges: [],
      rowMetadata: {},
      columnMetadata: {},
    },
  ],
};
function Fixture() {
  const [workbook, setWorkbook] = useState(initial),
    [locked, setLocked] = useState(false),
    [valid, setValid] = useState(true);
  return (
    <main>
      <h1>Offline protected-document spreadsheet</h1>
      <p>
        No application state, native IPC, saved databases or external hosts.
      </p>
      <button id="lock" onClick={() => setLocked(!locked)}>
        {locked ? "Unlock fixture" : "Lock fixture"}
      </button>
      <output id="valid">{String(valid)}</output>
      <SpreadsheetEditor
        documentKey={locked ? "locked" : "synthetic"}
        workbook={workbook}
        onChange={setWorkbook}
        readOnly={locked}
        onValidityChange={setValid}
        focusReference={{
          databaseId: "synthetic",
          kind: "cell",
          id: "doc",
          blockId: "sheet",
          sheetId: "inventory",
          address: "B2",
        }}
        onChooseReference={async () => ({
          databaseId: "synthetic",
          kind: "document",
          id: "linked",
        })}
        onReference={() => {}}
      />
      <output id="snapshot">{JSON.stringify(workbook)}</output>
    </main>
  );
}
const style = document.createElement("style");
style.textContent =
  "body{margin:20px;font-family:system-ui;background:#f5f6f8;color:#20242a}main{max-width:1320px;margin:auto}button{padding:6px 10px;margin:3px;border:1px solid #aab4c4;background:white;border-radius:5px}#snapshot{display:block;max-height:70px;overflow:auto;font-size:10px}#valid{margin-left:10px} [role=alert]{color:#b32424}";
document.head.appendChild(style);
createRoot(document.getElementById("root")!).render(<Fixture />);
window.addEventListener("error", (event) => {
  const output = document.createElement("pre");
  output.dataset.fixtureError = "true";
  output.textContent = event.message;
  document.body.append(output);
});
window.addEventListener("unhandledrejection", (event) => {
  const output = document.createElement("pre");
  output.dataset.fixtureError = "true";
  output.textContent = String(event.reason);
  document.body.append(output);
});
