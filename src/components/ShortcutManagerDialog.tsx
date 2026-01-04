import React, { useEffect, useState } from "react";
import { X, Link, Plus } from "lucide-react";
import { useConnections } from "../contexts/useConnections";
import { CollectionManager } from "../utils/collectionManager";
import { invoke } from "@tauri-apps/api/core";

interface ShortcutManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutManagerDialog: React.FC<ShortcutManagerDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { state } = useConnections();
  const collectionManager = CollectionManager.getInstance();
  const [collections, setCollections] = useState<Array<{ id: string; name: string }>>([]);
  const [shortcutName, setShortcutName] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    collectionManager
      .getAllCollections()
      .then(setCollections)
      .catch(() => setCollections([]));
  }, [collectionManager, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleCreateShortcut = async () => {
    const isTauri =
      typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    if (!isTauri) {
      setErrorMessage("Desktop shortcuts are only available in the Tauri app.");
      return;
    }
    if (!shortcutName.trim()) {
      setErrorMessage("Shortcut name is required.");
      return;
    }

    setErrorMessage("");
    setStatusMessage("Creating shortcut...");
    try {
      const path = await invoke<string>("create_desktop_shortcut", {
        name: shortcutName.trim(),
        collectionId: selectedCollectionId || null,
        connectionId: selectedConnectionId || null,
        description: selectedConnectionId
          ? `Open connection ${shortcutName.trim()}`
          : "Launch sortOfRemoteNG",
      });
      setStatusMessage(`Shortcut created at: ${path}`);
    } catch (error) {
      console.error("Failed to create shortcut:", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to create shortcut.",
      );
      setStatusMessage("");
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 h-[80vh] overflow-hidden flex flex-col">
        <div className="sticky top-0 z-10 bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Link size={18} className="text-blue-400" />
            Shortcut Manager
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
            data-tooltip="Close"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="bg-gray-700/60 border border-gray-600 rounded-lg p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-200 mb-4">
              Create Shortcut
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Shortcut Name
                </label>
                <input
                  type="text"
                  value={shortcutName}
                  onChange={(e) => setShortcutName(e.target.value)}
                  placeholder="My Server Connection"
                  className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Collection (Optional)
                </label>
                <select
                  value={selectedCollectionId}
                  onChange={(e) => setSelectedCollectionId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select a collection...</option>
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Connection (Optional)
                </label>
                <select
                  value={selectedConnectionId}
                  onChange={(e) => setSelectedConnectionId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select a connection...</option>
                  {state.connections
                    .filter((conn) => !conn.isGroup)
                    .map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={handleCreateShortcut}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
              >
                <Plus size={14} />
                Create Shortcut
              </button>
            </div>
            {errorMessage && (
              <div className="mt-4 rounded-md border border-red-600/60 bg-red-900/20 px-3 py-2 text-sm text-red-200">
                {errorMessage}
              </div>
            )}
            {statusMessage && (
              <div className="mt-4 rounded-md border border-blue-600/60 bg-blue-900/20 px-3 py-2 text-sm text-blue-200">
                {statusMessage}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-700/60 bg-gray-900/40 p-5 text-sm text-gray-400">
            Shortcuts can open a collection or a specific connection when the app starts.
          </div>
        </div>
      </div>
    </div>
  );
};
