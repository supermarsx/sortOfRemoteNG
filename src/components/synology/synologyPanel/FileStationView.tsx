import React from "react";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  File,
  Folder,
  ArrowLeft,
  ChevronRight,
} from "lucide-react";
import type { SubProps } from "./types";

const formatBytes = (bytes: number) => {
  if (!bytes) return "—";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

const FileStationView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const items = mgr.fileList?.files ?? [];
  const pathParts = mgr.currentPath.split("/").filter(Boolean);

  const goUp = () => {
    const parts = mgr.currentPath.split("/").filter(Boolean);
    parts.pop();
    mgr.navigateToFolder("/" + parts.join("/"));
  };

  return (
    <div className="p-6 space-y-4 overflow-y-auto flex-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-teal-500" />
          {t("synology.fileStation.title", "File Station")}
        </h3>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] flex-wrap">
        <button
          onClick={() => mgr.navigateToFolder("/")}
          className="hover:text-[var(--color-text)] transition-colors"
        >
          /
        </button>
        {pathParts.map((part, i) => (
          <React.Fragment key={i}>
            <ChevronRight className="w-3 h-3" />
            <button
              onClick={() =>
                mgr.navigateToFolder(
                  "/" + pathParts.slice(0, i + 1).join("/"),
                )
              }
              className="hover:text-[var(--color-text)] transition-colors"
            >
              {part}
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* Back button */}
      {mgr.currentPath !== "/" && (
        <button
          onClick={goUp}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          {t("synology.fileStation.back", "Back")}
        </button>
      )}

      {/* File list */}
      {items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
                <th className="pb-2 pr-3">Name</th>
                <th className="pb-2 pr-3">Type</th>
                <th className="pb-2 pr-3">Size</th>
                <th className="pb-2 pr-3">Modified</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isDir = item.isdir;
                return (
                  <tr
                    key={item.path}
                    className="border-b border-[var(--color-border)]/50 hover:bg-[var(--color-bg-hover)] cursor-pointer"
                    onClick={() => {
                      if (isDir) {
                        mgr.navigateToFolder(item.path);
                      }
                    }}
                  >
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        {isDir ? (
                          <Folder className="w-4 h-4 text-amber-400" />
                        ) : (
                          <File className="w-4 h-4 text-[var(--color-text-secondary)]" />
                        )}
                        <span
                          className={`font-medium ${isDir ? "text-teal-400" : "text-[var(--color-text)]"}`}
                        >
                          {item.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-[var(--color-text-secondary)]">
                      {isDir ? "Folder" : item.additional?.type ?? "File"}
                    </td>
                    <td className="py-2 pr-3 text-[var(--color-text-secondary)]">
                      {!isDir && item.additional?.size
                        ? formatBytes(item.additional.size)
                        : "—"}
                    </td>
                    <td className="py-2 pr-3 text-[var(--color-text-secondary)]">
                      {item.additional?.time?.mtime
                        ? new Date(
                            item.additional.time.mtime * 1000,
                          ).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-16 text-sm text-[var(--color-text-secondary)]">
          <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
          {t("synology.fileStation.empty", "This folder is empty")}
        </div>
      )}

      {/* Total */}
      {mgr.fileList && (
        <div className="text-[10px] text-[var(--color-text-secondary)]">
          {mgr.fileList.total} {t("synology.fileStation.items", "items")}
        </div>
      )}
    </div>
  );
};

export default FileStationView;
