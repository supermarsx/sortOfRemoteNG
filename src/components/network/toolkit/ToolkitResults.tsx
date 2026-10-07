import React, { useState } from "react";
import type { ToolkitReport } from "../../../types/network/networkToolkit";
import { Select } from "../../ui/forms/Select";

const PREVIEW_LIMIT = 128 * 1024;
function text(value: unknown): string {
  return typeof value === "string"
    ? value
    : (JSON.stringify(value, null, 2) ?? "null");
}

function StructuredTable({ data }: { data: unknown }) {
  const items = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? Object.entries(data).map(([key, value]) => ({ field: key, value }))
      : [{ value: data }];
  const rows: Record<string, unknown>[] = items
    .slice(0, 100)
    .map((item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : { value: item },
    );
  const allColumns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const columns = allColumns.slice(0, 16);
  return (
    <>
      {(items.length > rows.length || allColumns.length > columns.length) && (
        <p className="text-xs text-[var(--color-textMuted)]">
          Table preview is bounded to 100 rows and 16 columns. Export JSON for
          the complete report.
        </p>
      )}
      {rows.length ? (
        <div className="overflow-auto">
          <table
            aria-label="Diagnostic result data"
            className="w-full text-left text-xs"
          >
            <thead className="sticky top-0 bg-[var(--color-surfaceHover)]">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="border-b border-[var(--color-border)] p-2 font-medium"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={index}
                  className="border-b border-[var(--color-border)]"
                >
                  {columns.map((column) => (
                    <td key={column} className="max-w-xl p-2 align-top">
                      <pre className="whitespace-pre-wrap break-all font-mono">
                        {text(row[column]).slice(0, 4096)}
                      </pre>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-3 text-sm">The report contains no rows.</p>
      )}
      {rows.some((row) =>
        Object.values(row).some((value) => text(value).length > 4096),
      ) && (
        <p className="text-xs text-[var(--color-textMuted)]">
          Long cells are truncated in this preview. Export JSON for complete
          values.
        </p>
      )}
    </>
  );
}

export function ToolkitResults({ report }: { report: ToolkitReport | null }) {
  const [format, setFormat] = useState("table");
  const [feedback, setFeedback] = useState("");
  const json = report ? JSON.stringify(report, null, 2) : "";
  const plain = report
    ? `${report.tool}\nStarted: ${report.startedAt}\nRoute: ${report.route}\nDuration: ${report.durationMs} ms\n\n${text(report.data)}`
    : "";
  const exported = format === "text" ? plain : json;
  const extension = format === "text" ? "txt" : "json";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exported);
      setFeedback("Copied report.");
    } catch {
      setFeedback("Copy failed. Use Download to save the report.");
    }
  };
  const download = () => {
    let url: string | undefined;
    const anchor = document.createElement("a");
    try {
      url = URL.createObjectURL(
        new Blob([exported], {
          type:
            extension === "json"
              ? "application/json;charset=utf-8"
              : "text/plain;charset=utf-8",
        }),
      );
      anchor.href = url;
      anchor.download = `network-toolkit-report.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      setFeedback("Download requested.");
    } catch {
      setFeedback("Download could not be started.");
    } finally {
      anchor.remove();
      if (url) {
        const created = url;
        setTimeout(() => URL.revokeObjectURL(created), 0);
      }
    }
  };
  return (
    <section
      aria-label="Toolkit results"
      className="min-h-0 space-y-2 border-t border-[var(--color-border)] pt-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-medium">Results</h3>
        <Select
          label="Result format"
          value={format}
          onChange={(value) => {
            setFormat(value);
            setFeedback("");
          }}
          variant="form-sm"
          options={[
            { value: "table", label: "Table" },
            { value: "json", label: "JSON" },
            { value: "text", label: "Text" },
          ]}
        />
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={!report}
          onClick={() => void copy()}
        >
          Copy {extension === "json" ? "JSON" : "text"}
        </button>
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={!report}
          onClick={download}
        >
          Download {extension === "json" ? "JSON" : "text"}
        </button>
      </div>
      {feedback && (
        <p role="status" className="text-xs text-[var(--color-textSecondary)]">
          {feedback}
        </p>
      )}
      {!report ? (
        <p className="py-6 text-sm text-[var(--color-textMuted)]">
          No report yet. Configure a tool and select Run. No diagnostic runs on
          open.
        </p>
      ) : (
        <>
          <p className="break-all text-xs text-[var(--color-textMuted)]">
            {report.tool} · {report.durationMs} ms · {report.route} ·{" "}
            {report.startedAt}
          </p>
          {format === "table" ? (
            <StructuredTable data={report.data} />
          ) : (
            <>
              {exported.length > PREVIEW_LIMIT && (
                <p className="text-xs text-[var(--color-textMuted)]">
                  Preview truncated; copy/download contains the complete report.
                </p>
              )}
              <pre
                aria-label={`${format === "json" ? "JSON" : "Text"} report`}
                className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded border border-[var(--color-border)] bg-[var(--color-background)] p-3 font-mono text-xs"
              >
                {exported.slice(0, PREVIEW_LIMIT)}
              </pre>
            </>
          )}
        </>
      )}
    </section>
  );
}
