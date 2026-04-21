import { WaMgr, WaTemplateInfo } from "./types";
import ErrorMsg from "./ErrorMsg";
import LoadingSpinner from "./LoadingSpinner";
import React, { useEffect, useState } from "react";
import { LayoutTemplate, RefreshCw, Trash2 } from "lucide-react";

const TemplatesTab: React.FC<{ wa: WaMgr }> = ({
  wa,
}) => {
  const [templates, setTemplates] = useState<WaTemplateInfo[]>([]);

  const loadTemplates = async () => {
    const resp = await wa.listTemplates.execute();
    if (resp) setTemplates(resp.data);
  };

  useEffect(() => {
    loadTemplates();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only: initial template load

  const handleDelete = async (name: string) => {
    await wa.deleteTemplate.execute(name);
    loadTemplates();
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[var(--color-text)] font-medium text-sm flex items-center space-x-2">
          <LayoutTemplate size={16} />
          <span>Message Templates</span>
        </h3>
        <button onClick={loadTemplates} className="sor-icon-btn-sm" title="Refresh">
          {wa.listTemplates.loading ? <LoadingSpinner /> : <RefreshCw size={14} />}
        </button>
      </div>
      <ErrorMsg msg={wa.listTemplates.error} />

      <div className="space-y-2">
        {templates.length === 0 && (
          <p className="text-xs text-[var(--color-textSecondary)]">
            No templates found. Create them in Meta Business Manager or via the API.
          </p>
        )}
        {templates.map((t) => (
          <div
            key={t.id}
            className="p-3 bg-[var(--color-border)] rounded flex items-center justify-between"
          >
            <div>
              <div className="text-sm text-[var(--color-text)] font-medium">
                {t.name}{" "}
                <span className="text-xs text-[var(--color-textSecondary)]">
                  ({t.language})
                </span>
              </div>
              <div className="flex items-center space-x-2 mt-1">
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    t.status === "APPROVED"
                      ? "bg-success text-success"
                      : t.status === "PENDING"
                        ? "bg-warning text-warning"
                        : t.status === "REJECTED"
                          ? "bg-error text-error"
                          : "bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
                  }`}
                >
                  {t.status}
                </span>
                <span className="text-xs text-[var(--color-textSecondary)]">
                  {t.category}
                </span>
              </div>
            </div>
            <button
              onClick={() => handleDelete(t.name)}
              className="sor-icon-btn-sm text-error hover:text-error"
              title="Delete template"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TemplatesTab;
