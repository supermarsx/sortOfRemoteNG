import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Layers,
  Search,
  Plus,
  Pencil,
  Palette,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Trash2,
  FolderMinus,
  ArrowUp,
  ArrowDown,
  GripVertical,
} from "lucide-react";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "../ui/overlays/Modal";
import { EmptyState } from "../ui/display";
import { useConnections } from "../../contexts/useConnections";
import type { ConnectionSession, TabGroup } from "../../types/connection/connection";

const GROUP_COLORS = [
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Yellow", value: "#eab308" },
  { name: "Green", value: "#22c55e" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Purple", value: "#a855f7" },
  { name: "Pink", value: "#ec4899" },
];

interface TabGroupManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TabGroupManager: React.FC<TabGroupManagerProps> = ({
  isOpen,
  onClose,
}) => {
  const { state, dispatch } = useConnections();
  const sessions = state.sessions.filter((s) => !s.layout?.isDetached);
  const tabGroups = state.tabGroups;

  const [searchFilter, setSearchFilter] = useState("");
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());

  // Inline rename state
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Inline color picker state
  const [colorPickerGroupId, setColorPickerGroupId] = useState<string | null>(null);

  // New group creation
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[5].value);
  const newGroupInputRef = useRef<HTMLInputElement>(null);

  // Drag reorder state
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);

  useEffect(() => {
    if (renamingGroupId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingGroupId]);

  useEffect(() => {
    if (showCreateForm && newGroupInputRef.current) {
      newGroupInputRef.current.focus();
    }
  }, [showCreateForm]);

  // ── Derived data ──────────────────────────────────────────────

  const groupsWithSessions = useMemo(() => {
    return tabGroups.map((group) => ({
      group,
      sessions: sessions.filter((s) => s.tabGroupId === group.id),
    }));
  }, [tabGroups, sessions]);

  const filteredGroups = useMemo(() => {
    if (!searchFilter.trim()) return groupsWithSessions;
    const q = searchFilter.toLowerCase();
    return groupsWithSessions.filter((g) =>
      g.group.name.toLowerCase().includes(q)
    );
  }, [groupsWithSessions, searchFilter]);

  const stats = useMemo(() => {
    const groupCount = tabGroups.length;
    const groupedTabCount = sessions.filter((s) => s.tabGroupId).length;
    const ungroupedTabCount = sessions.filter((s) => !s.tabGroupId).length;
    return { groupCount, groupedTabCount, ungroupedTabCount };
  }, [tabGroups, sessions]);

  // ── Actions ───────────────────────────────────────────────────

  const toggleExpand = useCallback((groupId: string) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const handleStartRename = useCallback((groupId: string) => {
    const group = tabGroups.find((g) => g.id === groupId);
    if (!group) return;
    setRenameValue(group.name);
    setRenamingGroupId(groupId);
  }, [tabGroups]);

  const handleCommitRename = useCallback(() => {
    if (renamingGroupId && renameValue.trim()) {
      const group = tabGroups.find((g) => g.id === renamingGroupId);
      if (group) {
        dispatch({
          type: "UPDATE_TAB_GROUP",
          payload: { ...group, name: renameValue.trim() },
        });
      }
    }
    setRenamingGroupId(null);
    setRenameValue("");
  }, [renamingGroupId, renameValue, tabGroups, dispatch]);

  const handleCancelRename = useCallback(() => {
    setRenamingGroupId(null);
    setRenameValue("");
  }, []);

  const handleChangeColor = useCallback(
    (groupId: string, color: string) => {
      const group = tabGroups.find((g) => g.id === groupId);
      if (group) {
        dispatch({
          type: "UPDATE_TAB_GROUP",
          payload: { ...group, color },
        });
      }
    },
    [tabGroups, dispatch]
  );

  const handleToggleCollapse = useCallback(
    (groupId: string) => {
      const group = tabGroups.find((g) => g.id === groupId);
      if (group) {
        dispatch({
          type: "UPDATE_TAB_GROUP",
          payload: { ...group, collapsed: !group.collapsed },
        });
      }
    },
    [tabGroups, dispatch]
  );

  const handleSelectAll = useCallback(
    (groupId: string) => {
      const groupSessions = sessions.filter((s) => s.tabGroupId === groupId);
      if (groupSessions.length > 0) {
        // Select the first session in the group (dispatches focus)
        window.dispatchEvent(
          new CustomEvent("select-session", {
            detail: { sessionId: groupSessions[0].id },
          })
        );
      }
    },
    [sessions]
  );

  const handleMoveGroup = useCallback(
    (groupId: string, direction: "up" | "down") => {
      const idx = tabGroups.findIndex((g) => g.id === groupId);
      if (idx === -1) return;
      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= tabGroups.length) return;

      // Remove the group, then re-add it at the new position.
      // We achieve this by removing and re-adding in sequence.
      const moving = tabGroups[idx];
      const neighbor = tabGroups[targetIdx];

      // Remove both, add back in swapped order
      dispatch({ type: "REMOVE_TAB_GROUP", payload: moving.id });
      dispatch({ type: "REMOVE_TAB_GROUP", payload: neighbor.id });

      if (direction === "up") {
        dispatch({ type: "ADD_TAB_GROUP", payload: moving });
        dispatch({ type: "ADD_TAB_GROUP", payload: neighbor });
      } else {
        dispatch({ type: "ADD_TAB_GROUP", payload: neighbor });
        dispatch({ type: "ADD_TAB_GROUP", payload: moving });
      }
    },
    [tabGroups, dispatch]
  );

  const handleUngroupAll = useCallback(
    (groupId: string) => {
      // Remove tabGroupId from all sessions in this group
      const groupSessions = sessions.filter((s) => s.tabGroupId === groupId);
      for (const session of groupSessions) {
        dispatch({
          type: "UPDATE_SESSION",
          payload: { ...session, tabGroupId: undefined },
        });
      }
      dispatch({ type: "REMOVE_TAB_GROUP", payload: groupId });
    },
    [sessions, dispatch]
  );

  const handleCloseAllInGroup = useCallback(
    (groupId: string) => {
      const groupSessions = sessions.filter((s) => s.tabGroupId === groupId);
      for (const session of groupSessions) {
        dispatch({ type: "REMOVE_SESSION", payload: session.id });
      }
      dispatch({ type: "REMOVE_TAB_GROUP", payload: groupId });
    },
    [sessions, dispatch]
  );

  const handleCreateGroup = useCallback(() => {
    const name = newGroupName.trim();
    if (!name) return;
    const newGroup: TabGroup = {
      id: crypto.randomUUID(),
      name,
      color: newGroupColor,
      collapsed: false,
    };
    dispatch({ type: "ADD_TAB_GROUP", payload: newGroup });
    setNewGroupName("");
    setNewGroupColor(GROUP_COLORS[5].value);
    setShowCreateForm(false);
  }, [newGroupName, newGroupColor, dispatch]);

  // ── Drag and drop for group reorder ───────────────────────────

  const handleGroupDragStart = useCallback(
    (e: React.DragEvent, groupId: string) => {
      setDraggedGroupId(groupId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", groupId);
    },
    []
  );

  const handleGroupDragOver = useCallback(
    (e: React.DragEvent, groupId: string) => {
      if (!draggedGroupId || draggedGroupId === groupId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverGroupId(groupId);
    },
    [draggedGroupId]
  );

  const handleGroupDrop = useCallback(
    (e: React.DragEvent, dropGroupId: string) => {
      e.preventDefault();
      if (!draggedGroupId || draggedGroupId === dropGroupId) {
        setDraggedGroupId(null);
        setDragOverGroupId(null);
        return;
      }

      const fromIdx = tabGroups.findIndex((g) => g.id === draggedGroupId);
      const toIdx = tabGroups.findIndex((g) => g.id === dropGroupId);
      if (fromIdx === -1 || toIdx === -1) return;

      // Rebuild groups array with the dragged group moved
      const newGroups = [...tabGroups];
      const [moved] = newGroups.splice(fromIdx, 1);
      newGroups.splice(toIdx, 0, moved);

      // Remove all groups and re-add in new order
      for (const g of tabGroups) {
        dispatch({ type: "REMOVE_TAB_GROUP", payload: g.id });
      }
      for (const g of newGroups) {
        dispatch({ type: "ADD_TAB_GROUP", payload: g });
      }

      setDraggedGroupId(null);
      setDragOverGroupId(null);
    },
    [draggedGroupId, tabGroups, dispatch]
  );

  const handleGroupDragEnd = useCallback(() => {
    setDraggedGroupId(null);
    setDragOverGroupId(null);
  }, []);

  // ── Keyboard navigation ───────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, groupId: string, index: number) => {
      if (e.key === "ArrowDown" && index < filteredGroups.length - 1) {
        e.preventDefault();
        const nextEl = document.querySelector(
          `[data-group-index="${index + 1}"]`
        ) as HTMLElement;
        nextEl?.focus();
      } else if (e.key === "ArrowUp" && index > 0) {
        e.preventDefault();
        const prevEl = document.querySelector(
          `[data-group-index="${index - 1}"]`
        ) as HTMLElement;
        prevEl?.focus();
      } else if (e.key === "Enter") {
        e.preventDefault();
        toggleExpand(groupId);
      }
    },
    [filteredGroups.length, toggleExpand]
  );

  if (!isOpen) return null;

  if (!isOpen) return null;

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-3xl mx-auto w-full p-6 space-y-6">
          {/* Heading */}
          <div>
            <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
              <Layers className="w-5 h-5 text-primary" />
              Tab Group Manager
            </h3>
            <p className="text-xs text-[var(--color-textSecondary)] mt-1">
              Organize open session tabs into color-coded groups.
            </p>
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)]" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="sor-form-input pl-9 text-sm w-full"
              placeholder="Search groups..."
            />
          </div>

          {/* Content */}
          <div>
            {filteredGroups.length === 0 && tabGroups.length === 0 ? (
              <EmptyState
                icon={Layers}
                iconSize={48}
                message="No tab groups yet"
                hint="Right-click a tab and select 'New Group from Tab' to get started."
                className="py-12"
              />
            ) : filteredGroups.length === 0 ? (
              <EmptyState
                icon={Search}
                iconSize={40}
                message="No groups match your search"
                hint="Try a different search term"
                className="py-8"
              />
            ) : (
              <div className="space-y-2">
                {filteredGroups.map(({ group, sessions: groupSessions }, index) => {
                  const isExpanded = expandedGroupIds.has(group.id);
                  const isFirst = index === 0;
                  const isLast = index === filteredGroups.length - 1;
                  const isDragOver = dragOverGroupId === group.id;
                  const isDragging = draggedGroupId === group.id;

                  return (
                    <div
                      key={group.id}
                      data-group-index={index}
                      tabIndex={0}
                      draggable
                      onDragStart={(e) => handleGroupDragStart(e, group.id)}
                      onDragOver={(e) => handleGroupDragOver(e, group.id)}
                      onDrop={(e) => handleGroupDrop(e, group.id)}
                      onDragEnd={handleGroupDragEnd}
                      onKeyDown={(e) => handleKeyDown(e, group.id, index)}
                      className={`rounded-lg border transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        isDragOver
                          ? "border-primary bg-primary/5"
                          : "border-[var(--color-border)] bg-[var(--color-border)]/30"
                      } ${isDragging ? "opacity-50" : ""}`}
                    >
                      {/* Group header row */}
                      <div className="flex items-center gap-2 p-3">
                        {/* Drag handle */}
                        <GripVertical
                          size={14}
                          className="text-[var(--color-textMuted)] cursor-grab flex-shrink-0"
                        />

                        {/* Color swatch (click to toggle color picker) */}
                        <button
                          onClick={() =>
                            setColorPickerGroupId(
                              colorPickerGroupId === group.id ? null : group.id
                            )
                          }
                          className="w-5 h-5 rounded-full border-2 border-[var(--color-border)] flex-shrink-0 hover:scale-110 transition-transform"
                          style={{ backgroundColor: group.color }}
                          title="Change color"
                        />

                        {/* Group name (editable) */}
                        {renamingGroupId === group.id ? (
                          <input
                            ref={renameInputRef}
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleCommitRename();
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                handleCancelRename();
                              }
                            }}
                            onBlur={handleCommitRename}
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm font-medium bg-[var(--color-bg)] border border-[var(--color-borderActive)] rounded px-2 py-0.5 outline-none text-[var(--color-text)] flex-1 min-w-0"
                          />
                        ) : (
                          <span
                            className="text-sm font-medium text-[var(--color-text)] truncate flex-1 min-w-0 cursor-pointer"
                            onDoubleClick={() => handleStartRename(group.id)}
                            title="Double-click to rename"
                          >
                            {group.name}
                          </span>
                        )}

                        {/* Member count badge */}
                        <span className="text-xs text-[var(--color-textSecondary)] bg-[var(--color-border)] px-1.5 py-0.5 rounded flex-shrink-0">
                          {groupSessions.length}{" "}
                          {groupSessions.length === 1 ? "tab" : "tabs"}
                        </span>

                        {/* Collapsed indicator */}
                        {group.collapsed && (
                          <span className="text-[10px] text-[var(--color-textMuted)] bg-[var(--color-border)] px-1 py-0.5 rounded flex-shrink-0">
                            collapsed
                          </span>
                        )}

                        {/* Action buttons */}
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <button
                            onClick={() => handleStartRename(group.id)}
                            className="sor-icon-btn-sm"
                            title="Rename"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() =>
                              setColorPickerGroupId(
                                colorPickerGroupId === group.id
                                  ? null
                                  : group.id
                              )
                            }
                            className="sor-icon-btn-sm"
                            title="Change color"
                          >
                            <Palette size={13} />
                          </button>
                          <button
                            onClick={() => handleToggleCollapse(group.id)}
                            className="sor-icon-btn-sm"
                            title={
                              group.collapsed
                                ? "Expand in tab bar"
                                : "Collapse in tab bar"
                            }
                          >
                            {group.collapsed ? (
                              <ChevronRight size={13} />
                            ) : (
                              <ChevronDown size={13} />
                            )}
                          </button>
                          <button
                            onClick={() => handleMoveGroup(group.id, "up")}
                            className={`sor-icon-btn-sm ${
                              isFirst
                                ? "opacity-30 pointer-events-none"
                                : ""
                            }`}
                            disabled={isFirst}
                            title="Move group up"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            onClick={() => handleMoveGroup(group.id, "down")}
                            className={`sor-icon-btn-sm ${
                              isLast
                                ? "opacity-30 pointer-events-none"
                                : ""
                            }`}
                            disabled={isLast}
                            title="Move group down"
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            onClick={() => handleUngroupAll(group.id)}
                            className="sor-icon-btn-sm"
                            title="Ungroup all (keeps tabs)"
                          >
                            <FolderMinus size={13} />
                          </button>
                          <button
                            onClick={() => handleCloseAllInGroup(group.id)}
                            className="sor-icon-btn-danger"
                            title="Close all tabs in group"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>

                        {/* Expand/collapse member list toggle */}
                        <button
                          onClick={() => toggleExpand(group.id)}
                          className="sor-icon-btn-sm flex-shrink-0"
                          title={
                            isExpanded ? "Hide member list" : "Show member list"
                          }
                        >
                          {isExpanded ? (
                            <ChevronUp size={14} />
                          ) : (
                            <ChevronDown size={14} />
                          )}
                        </button>
                      </div>

                      {/* Inline color picker */}
                      {colorPickerGroupId === group.id && (
                        <div className="px-3 pb-2 flex items-center gap-2">
                          <span className="text-[10px] text-[var(--color-textMuted)]">
                            Color:
                          </span>
                          <div className="flex gap-1.5 flex-wrap">
                            {GROUP_COLORS.map((c) => (
                              <button
                                key={c.value}
                                onClick={() => {
                                  handleChangeColor(group.id, c.value);
                                  setColorPickerGroupId(null);
                                }}
                                className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
                                  group.color === c.value
                                    ? "border-white"
                                    : "border-transparent"
                                }`}
                                style={{ backgroundColor: c.value }}
                                title={c.name}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Expanded member list */}
                      {isExpanded && (
                        <div className="border-t border-[var(--color-border)] px-3 py-2">
                          {groupSessions.length === 0 ? (
                            <div className="text-xs text-[var(--color-textMuted)] py-1 text-center">
                              No tabs in this group
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {groupSessions.map((session) => (
                                <div
                                  key={session.id}
                                  className="flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-[var(--color-border)]/50"
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: group.color }}
                                  />
                                  <span className="truncate text-[var(--color-text)] flex-1 min-w-0">
                                    {session.name}
                                  </span>
                                  <span className="text-[var(--color-textMuted)] flex-shrink-0">
                                    {session.protocol}
                                  </span>
                                  <span
                                    className={`flex-shrink-0 ${
                                      session.status === "connected"
                                        ? "text-success"
                                        : session.status === "connecting"
                                        ? "text-warning"
                                        : "text-[var(--color-textMuted)]"
                                    }`}
                                  >
                                    {session.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Compact member list (when collapsed) */}
                      {!isExpanded && groupSessions.length > 0 && (
                        <div className="px-3 pb-2">
                          <div className="text-[11px] text-[var(--color-textMuted)] truncate">
                            {groupSessions
                              .map((s) => s.name)
                              .join(", ")}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
        <div className="pt-4 border-t border-[var(--color-border)]">
          <div className="flex items-center justify-between w-full">
            {/* Stats */}
            <div className="text-xs text-[var(--color-textMuted)]">
              {stats.groupCount} {stats.groupCount === 1 ? "group" : "groups"},{" "}
              {stats.groupedTabCount} grouped{" "}
              {stats.groupedTabCount === 1 ? "tab" : "tabs"},{" "}
              {stats.ungroupedTabCount} ungrouped
            </div>

            {/* Create new group */}
            {showCreateForm ? (
              <div className="flex items-center gap-2">
                <input
                  ref={newGroupInputRef}
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleCreateGroup();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setShowCreateForm(false);
                      setNewGroupName("");
                    }
                  }}
                  placeholder="Group name"
                  className="text-sm bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1 outline-none focus:border-[var(--color-borderActive)] text-[var(--color-text)] w-32"
                />
                <div className="flex gap-1">
                  {GROUP_COLORS.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => setNewGroupColor(c.value)}
                      className={`w-4 h-4 rounded-full border-2 transition-transform hover:scale-110 ${
                        newGroupColor === c.value
                          ? "border-white scale-110"
                          : "border-transparent"
                      }`}
                      style={{ backgroundColor: c.value }}
                      title={c.name}
                    />
                  ))}
                </div>
                <button
                  onClick={handleCreateGroup}
                  disabled={!newGroupName.trim()}
                  className="sor-btn-primary-sm"
                  title="Create group"
                >
                  <Check size={14} />
                  <span>Create</span>
                </button>
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewGroupName("");
                  }}
                  className="sor-icon-btn-sm"
                  title="Cancel"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowCreateForm(true)}
                className="sor-btn-primary-sm"
              >
                <Plus size={14} />
                <span>Create New Group</span>
              </button>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};

export default TabGroupManager;
