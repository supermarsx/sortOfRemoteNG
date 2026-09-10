import React, { useMemo, useState } from "react";
import type { Connection } from "../../types/connection/connection";
import type {
  DatabaseDocuments,
  DocumentReference,
} from "../../types/documents/document";
import {
  validateDocumentReference,
  documentCellCoordinates,
} from "../../utils/documents/validation";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "../ui/overlays/Modal";
import { Select } from "../ui/forms";

export default function DocumentReferencePicker({
  data,
  connections,
  databaseId,
  onClose,
}: {
  data: DatabaseDocuments;
  connections: Connection[];
  databaseId: string;
  onClose: (reference: DocumentReference | null) => void;
}) {
  const [kind, setKind] = useState<DocumentReference["kind"]>("connection");
  const [query, setQuery] = useState("");
  const [id, setId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [sheetId, setSheetId] = useState("");
  const [address, setAddress] = useState("A1");
  const [error, setError] = useState("");
  const items = useMemo(() => {
    const list =
      kind === "connection"
        ? connections
            .filter((item) => !item.isGroup)
            .map((item) => ({
              id: item.id,
              name: item.name,
              detail: item.protocol.toUpperCase(),
            }))
        : kind === "person"
          ? data.people.map((item) => ({
              id: item.id,
              name: item.name,
              detail: item.organization,
            }))
          : kind === "ticket"
            ? data.tickets.map((item) => ({
                id: item.id,
                name: item.title,
                detail: item.status,
              }))
            : data.documents
                .filter(
                  (item) =>
                    kind !== "cell" ||
                    item.blocks.some((block) => block.type === "spreadsheet"),
                )
                .map((item) => ({
                  id: item.id,
                  name: item.name,
                  detail: "Document",
                }));
    return list.filter((item) =>
      `${item.name} ${item.detail}`.toLowerCase().includes(query.toLowerCase()),
    );
  }, [connections, data, kind, query]);
  const sheets =
    data.documents
      .find((item) => item.id === id)
      ?.blocks.filter((block) => block.type === "spreadsheet") ?? [];
  const workbook = sheets.find((block) => block.id === blockId)?.workbook;
  const select = () => {
    try {
      if (!items.some((item) => item.id === id))
        throw new Error("Select a current record first.");
      const reference: DocumentReference =
        kind === "cell"
          ? {
              databaseId,
              kind,
              id,
              blockId,
              sheetId,
              address: address.trim().toUpperCase(),
            }
          : { databaseId, kind, id };
      validateDocumentReference(reference);
      if (reference.kind === "cell") {
        const sheet = workbook?.sheets.find((item) => item.id === sheetId);
        const position = documentCellCoordinates(reference.address);
        if (
          !sheet ||
          position.row >= sheet.rows ||
          position.column >= sheet.columns
        )
          throw new Error(
            "Select a spreadsheet, sheet and cell within its dimensions.",
          );
      }
      onClose(reference);
    } catch {
      setError(
        "Choose a record and, for a cell link, its spreadsheet, sheet and valid cell address.",
      );
    }
  };
  return (
    <Modal
      isOpen
      onClose={() => onClose(null)}
      panelClassName="max-w-xl w-full mx-4"
      ariaLabel="Link to a record"
    >
      <ModalHeader title="Link to a record" onClose={() => onClose(null)} />
      <ModalBody className="space-y-3">
        <p className="text-sm text-[var(--color-textSecondary)]">
          Links keep their owning database. Following a connection link is an
          explicit action; adding a link never connects or runs a command.
        </p>
        <div className="flex flex-wrap gap-2">
          <Select
            aria-label="Record type"
            value={kind}
            onChange={(value) => {
              setKind(value as DocumentReference["kind"]);
              setId("");
              setBlockId("");
              setSheetId("");
            }}
            options={[
              { value: "connection", label: "Connection" },
              { value: "document", label: "Document" },
              { value: "cell", label: "Spreadsheet cell" },
              { value: "person", label: "Person" },
              { value: "ticket", label: "Service desk ticket" },
            ]}
          />
          <input
            className="sor-form-input flex-1 min-w-40"
            aria-label="Search records"
            placeholder="Search records"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div
          role="listbox"
          aria-label="Records"
          className="max-h-64 overflow-auto rounded border border-[var(--color-border)]"
        >
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              role="option"
              aria-selected={id === item.id}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${id === item.id ? "bg-primary/15" : "hover:bg-[var(--color-surfaceHover)]"}`}
              onClick={() => {
                setId(item.id);
                setBlockId("");
                setSheetId("");
              }}
            >
              <span>{item.name}</span>
              <span className="text-xs text-[var(--color-textMuted)]">
                {item.detail}
              </span>
            </button>
          ))}
          {!items.length && (
            <p className="p-4 text-sm text-[var(--color-textMuted)]">
              No matching records.
            </p>
          )}
        </div>
        {kind === "cell" && id && (
          <div className="flex flex-wrap gap-2">
            <Select
              aria-label="Spreadsheet block"
              value={blockId}
              onChange={(value) => {
                setBlockId(value);
                setSheetId("");
              }}
              options={[
                { value: "", label: "Choose spreadsheet" },
                ...sheets.map((block, index) => ({
                  value: block.id,
                  label: `Spreadsheet ${index + 1}`,
                })),
              ]}
            />
            <Select
              aria-label="Sheet"
              value={sheetId}
              onChange={setSheetId}
              options={[
                { value: "", label: "Choose sheet" },
                ...(workbook?.sheets.map((sheet) => ({
                  value: sheet.id,
                  label: sheet.name,
                })) ?? []),
              ]}
            />
            <input
              className="sor-form-input w-24"
              aria-label="Cell address"
              placeholder="A1"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          onClick={() => onClose(null)}
        >
          Cancel
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-primary"
          disabled={!id}
          onClick={select}
        >
          Add link
        </button>
      </ModalFooter>
    </Modal>
  );
}
