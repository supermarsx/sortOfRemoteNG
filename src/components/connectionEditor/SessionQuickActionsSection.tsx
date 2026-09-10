import React, { useState } from "react";
import { ChevronUp, ChevronDown, Trash2 } from "lucide-react";
import type { Connection } from "../../types/connection/connection";
import type { QuickActionReference } from "../../types/connection/sessionQuickActions";
import {
  normalizeHttpAutomation,
  normalizeSshQuickActions,
  quickActionReferenceKey,
  quickActionScopeLabel,
} from "../../utils/connection/sessionQuickActions";
import { Checkbox } from "../ui/forms";

interface Props {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
  protocol: "ssh" | "http";
  view?: "all" | "favorites" | "permissions";
}

export function SessionQuickActionsSection({
  formData,
  setFormData,
  protocol,
  view = "all",
}: Props) {
  const [reviewReset, setReviewReset] = useState(false);
  let config;
  try {
    config =
      protocol === "ssh"
        ? normalizeSshQuickActions(formData.sshQuickActions)
        : normalizeHttpAutomation(formData.httpAutomation);
  } catch {
    return (
      <section className="space-y-3 rounded-lg border border-warning p-4">
        <p role="alert">
          This connection has invalid quick-action settings. Its actions are
          disabled; reset this optional configuration to repair it.
        </p>
        {reviewReset ? (
          <>
            <p className="text-sm">
              Reset this draft? All favorite references will be cleared and
              website automation and forced dark mode will be disabled. The
              database changes only when you save the connection.
            </p>
            <button
              type="button"
              className="sor-modal-cancel"
              onClick={() => setReviewReset(false)}
            >
              Cancel reset
            </button>
            <button
              type="button"
              className="sor-modal-primary"
              onClick={() => {
                setFormData((previous) =>
                  protocol === "ssh"
                    ? {
                        ...previous,
                        sshQuickActions: normalizeSshQuickActions(undefined),
                      }
                    : {
                        ...previous,
                        httpAutomation: normalizeHttpAutomation(undefined),
                      },
                );
                setReviewReset(false);
              }}
            >
              Reset and disable
            </button>
          </>
        ) : (
          <button
            type="button"
            className="sor-modal-cancel"
            onClick={() => setReviewReset(true)}
          >
            Reset quick-action settings
          </button>
        )}
      </section>
    );
  }
  const items = config.items;
  const updateItems = (next: QuickActionReference[]) =>
    setFormData((previous) =>
      previous.id !== formData.id ||
      (protocol === "ssh"
        ? previous.sshQuickActions !== formData.sshQuickActions
        : previous.httpAutomation !== formData.httpAutomation)
        ? previous
        : protocol === "ssh"
          ? {
              ...previous,
              sshQuickActions: {
                ...normalizeSshQuickActions(previous.sshQuickActions),
                items: next,
              },
            }
          : {
              ...previous,
              httpAutomation: {
                ...normalizeHttpAutomation(previous.httpAutomation),
                items: next,
              },
            },
    );
  const move = (index: number, offset: number) => {
    const next = [...items];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    updateItems(next);
  };
  const web =
    protocol === "http"
      ? normalizeHttpAutomation(formData.httpAutomation)
      : null;
  const setWeb = (
    key: "interactionMacrosEnabled" | "scriptInjectionEnabled" | "forceDark",
    value: boolean,
  ) =>
    setFormData((previous) => ({
      ...previous,
      httpAutomation: {
        ...normalizeHttpAutomation(previous.httpAutomation),
        [key]: value,
      },
    }));
  return (
    <section
      className="space-y-3 rounded-lg border border-[var(--color-border)] p-4"
      aria-label={
        view === "favorites"
          ? "Favorite scripts and macros"
          : protocol === "ssh"
            ? "SSH quick actions"
            : "Website automation and appearance"
      }
    >
      <h4 className="text-sm font-medium">
        {protocol === "ssh" || view === "favorites"
          ? "Favorite scripts and macros"
          : "Website automation and appearance"}
      </h4>
      {web && view !== "favorites" && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={web.interactionMacrosEnabled}
              onChange={(checked) =>
                setWeb("interactionMacrosEnabled", checked)
              }
            />
            Allow interaction macros for this connection
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={web.scriptInjectionEnabled}
              onChange={(checked) => setWeb("scriptInjectionEnabled", checked)}
            />
            Allow manual JavaScript injection for this connection
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={web.forceDark}
              onChange={(checked) => setWeb("forceDark", checked)}
            />
            Force dark appearance for this connection
          </label>
          <p className="text-xs text-[var(--color-textSecondary)]">
            Scripts can read and change this website, including signed-in
            content. Enable only for trusted scripts. Forced dark appearance may
            affect site colors. Global Macros settings can disable these
            capabilities; enabling a favorite never runs it automatically.
          </p>
        </div>
      )}
      {view !== "permissions" && (
        <>
          <p className="text-xs text-[var(--color-textSecondary)]">
            Add favorites from the session action bar. Only library IDs and
            their order are saved here; script bodies and credentials are not
            copied. Global visibility and confirmations are in Settings →
            Macros.
          </p>
          {items.length === 0 ? (
            <p className="text-sm text-[var(--color-textMuted)]">
              No favorites configured.
            </p>
          ) : (
            <ol className="space-y-2">
              {items.map((item, index) => (
                <li
                  key={quickActionReferenceKey(item)}
                  className="flex items-center gap-2 text-sm"
                >
                  <span className="min-w-0 flex-1 break-all">
                    <span
                      className="block truncate"
                      title={`${item.kind} ID: ${item.id}`}
                    >
                      {quickActionScopeLabel(item)} · {item.kind} ID: {item.id}
                    </span>
                    <span className="text-xs text-[var(--color-textMuted)]">
                      Library name unavailable here. Manage contents in the
                      session library.
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Move ${item.kind} ${item.id} up`}
                    data-tooltip="Move favorite up"
                    className="sor-icon-btn disabled:opacity-40"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${item.kind} ${item.id} down`}
                    data-tooltip="Move favorite down"
                    className="sor-icon-btn disabled:opacity-40"
                    disabled={index === items.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronDown size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${item.kind} ${item.id} favorite`}
                    data-tooltip="Remove favorite reference"
                    className="sor-icon-btn"
                    onClick={() =>
                      updateItems(items.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
