import React, { useMemo } from "react";
import { CircleOff, Container, Monitor, Server, Trash2 } from "lucide-react";
import type { Connection } from "../../../types/connection/connection";
import {
  MACHINE_ASSIGNMENT_TEXT_LIMIT,
  normalizeMachineAssignment,
  type ConnectionMachineAssignment,
} from "../../../types/connection/machineAssignment";
import { FormField, Select, TextInput } from "../../ui/forms";
import type { SelectOption } from "../../ui/forms";

const TYPE_OPTIONS: SelectOption[] = [
  { value: "none", label: "None", icon: CircleOff },
  { value: "server", label: "Server", icon: Server },
  { value: "container", label: "Container", icon: Container },
  { value: "vm", label: "VM", icon: Monitor },
];

interface MachineAssignmentSectionProps {
  assignment?: ConnectionMachineAssignment;
  connections?: readonly Connection[];
  databaseId?: string;
  currentConnectionId?: string;
  onChange: (assignment: ConnectionMachineAssignment | undefined) => void;
}

function savedHostname(value: string): string {
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname;
  } catch {
    return "";
  }
}

export const MachineAssignmentSection: React.FC<
  MachineAssignmentSectionProps
> = ({
  assignment,
  connections = [],
  databaseId,
  currentConnectionId,
  onChange,
}) => {
  const suggestions = useMemo(
    () =>
      connections.filter(
        (connection) =>
          Boolean(databaseId) &&
          !connection.isGroup &&
          connection.id !== currentConnectionId,
      ),
    [connections, currentConnectionId, databaseId],
  );
  const reference = assignment?.connectionRef;
  const linkedConnection =
    reference?.databaseId === databaseId
      ? suggestions.find(
          (connection) => connection.id === reference?.connectionId,
        )
      : undefined;
  const suggestionOptions = useMemo(
    () =>
      suggestions.map((connection) => ({
        value: connection.id,
        label: connection.name,
        description: savedHostname(connection.hostname),
      })),
    [suggestions],
  );

  const changeType = (type: string) => {
    if (type === "none") {
      onChange(undefined);
    } else if (type === "server" || type === "container" || type === "vm") {
      onChange({ version: 1, name: "", ...assignment, type });
    }
  };

  const linkConnection = (id: string) => {
    const connection = suggestions.find((candidate) => candidate.id === id);
    if (!connection || !databaseId) return;
    // The exact scoped identity is the link; labels are only a fallback when
    // its target is unavailable. Never copy credentials or follow other links.
    onChange(
      normalizeMachineAssignment({
        version: 1,
        type: assignment?.type ?? "server",
        name: connection.name,
        host: savedHostname(connection.hostname),
        connectionRef: { databaseId, connectionId: connection.id },
      }),
    );
  };

  return (
    <section
      aria-labelledby="editor-machine-assignment-heading"
      data-editor-search-section="notes-machine-assignment"
      className="space-y-4 rounded-xl border border-[var(--color-border)] p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Server
          size={16}
          aria-hidden="true"
          className="text-[var(--color-textSecondary)]"
        />
        <h3
          id="editor-machine-assignment-heading"
          className="text-sm font-medium text-[var(--color-text)]"
        >
          Machine assignment
        </h3>
        <span className="text-xs text-[var(--color-textMuted)]">Optional</span>
        {assignment && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Trash2 size={14} aria-hidden="true" />
            Remove assignment
          </button>
        )}
      </div>
      <p className="text-xs text-[var(--color-textMuted)]">
        Link the server, container or VM this connection belongs to using a
        saved connection in this database. Its current name and hostname are
        shown here. This does not change routing or share credentials.
      </p>
      <FormField
        label="Linked saved connection"
        htmlFor="editor-machine-connection"
        hint="Only saved connections in the owning database are listed; folders and this connection are excluded."
      >
        <div data-editor-search-field="machine-connection">
          <Select
            id="editor-machine-connection"
            label="Linked saved connection"
            value={linkedConnection?.id ?? ""}
            onChange={linkConnection}
            options={suggestionOptions}
            placeholder={
              reference
                ? `${assignment?.name || "Linked connection"} (unavailable)`
                : suggestions.length
                  ? "Choose a saved connection"
                  : "No saved connections available"
            }
            searchable
            searchPlaceholder="Search saved connections by name or hostname"
            disabled={suggestions.length === 0}
            variant="form"
            className="w-full"
          />
        </div>
      </FormField>
      {!databaseId && (
        <p role="status" className="text-xs text-[var(--color-textMuted)]">
          Open and unlock the owning database, then reopen this editor to choose
          a saved connection.
        </p>
      )}
      {reference && !linkedConnection && databaseId && (
        <p role="status" className="text-xs text-[var(--color-textMuted)]">
          {reference.databaseId !== databaseId
            ? "The linked connection belongs to another database."
            : "The linked connection is no longer available in this database."}{" "}
          The reference has been kept. Select a replacement or remove the
          assignment.
        </p>
      )}
      {assignment && !reference && (
        <p className="text-xs text-[var(--color-textMuted)]">
          These are previously saved machine details. Choose a saved connection
          above to turn them into a link.
        </p>
      )}
      {assignment && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Machine type"
            htmlFor="editor-machine-type"
            className="sm:col-span-2"
          >
            <div data-editor-search-field="machine-type">
              <Select
                id="editor-machine-type"
                label="Machine type"
                value={assignment.type}
                onChange={changeType}
                options={TYPE_OPTIONS}
                variant="form"
                className="w-full"
              />
            </div>
          </FormField>
          <FormField
            label="Machine name"
            htmlFor="editor-machine-name"
            className="sm:col-span-2"
          >
            <TextInput
              id="editor-machine-name"
              data-editor-search-field="machine-name"
              value={linkedConnection?.name ?? assignment.name}
              readOnly={Boolean(reference)}
              maxLength={MACHINE_ASSIGNMENT_TEXT_LIMIT}
              onChange={(name) =>
                onChange({
                  ...assignment,
                  name: name.slice(0, MACHINE_ASSIGNMENT_TEXT_LIMIT),
                })
              }
              className="w-full"
            />
          </FormField>
          <FormField
            label="Resource ID (optional)"
            htmlFor="editor-machine-resource-id"
          >
            <TextInput
              id="editor-machine-resource-id"
              data-editor-search-field="machine-resource-id"
              value={assignment.resourceId ?? ""}
              maxLength={MACHINE_ASSIGNMENT_TEXT_LIMIT}
              onChange={(resourceId) =>
                onChange({
                  ...assignment,
                  resourceId:
                    resourceId.slice(0, MACHINE_ASSIGNMENT_TEXT_LIMIT) ||
                    undefined,
                })
              }
              className="w-full"
            />
          </FormField>
          <FormField label="Host (optional)" htmlFor="editor-machine-host">
            <TextInput
              id="editor-machine-host"
              data-editor-search-field="machine-host"
              value={
                linkedConnection
                  ? savedHostname(linkedConnection.hostname)
                  : (assignment.host ?? "")
              }
              readOnly={Boolean(reference)}
              maxLength={MACHINE_ASSIGNMENT_TEXT_LIMIT}
              onChange={(host) =>
                onChange({
                  ...assignment,
                  host:
                    host.slice(0, MACHINE_ASSIGNMENT_TEXT_LIMIT) || undefined,
                })
              }
              className="w-full"
            />
          </FormField>
        </div>
      )}
    </section>
  );
};
