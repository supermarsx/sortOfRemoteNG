import { useState, useEffect, useMemo, useCallback } from "react";
import {
  SavedRecording,
  SavedRdpRecording,
  SavedWebRecording,
  SavedWebVideoRecording,
} from "../../types/macroTypes";
import * as macroService from "../../utils/macroService";

export type RecordingTab = "ssh" | "rdp" | "web" | "webVideo";

export function useRecordingManager(isOpen: boolean) {
  const [activeTab, setActiveTab] = useState<RecordingTab>("ssh");
  const [sshRecordings, setSshRecordings] = useState<SavedRecording[]>([]);
  const [rdpRecordings, setRdpRecordings] = useState<SavedRdpRecording[]>([]);
  const [webRecordings, setWebRecordings] = useState<SavedWebRecording[]>([]);
  const [webVideoRecordings, setWebVideoRecordings] = useState<
    SavedWebVideoRecording[]
  >([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /* ---- data loading ---- */
  const loadData = useCallback(async () => {
    const [ssh, rdp, web, webVideo] = await Promise.all([
      macroService.loadRecordings(),
      macroService.loadRdpRecordings(),
      macroService.loadWebRecordings(),
      macroService.loadWebVideoRecordings(),
    ]);
    setSshRecordings(ssh);
    setRdpRecordings(rdp);
    setWebRecordings(web);
    setWebVideoRecordings(webVideo);
  }, []);

  useEffect(() => {
    if (isOpen) loadData();
  }, [isOpen, loadData]);

  /* ---- filtered lists ---- */
  const filteredSsh = useMemo(() => {
    if (!searchQuery.trim()) return sshRecordings;
    const q = searchQuery.toLowerCase();
    return sshRecordings.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.recording.metadata.host.toLowerCase().includes(q) ||
        r.tags?.some((t) => t.toLowerCase().includes(q)),
    );
  }, [sshRecordings, searchQuery]);

  const filteredRdp = useMemo(() => {
    if (!searchQuery.trim()) return rdpRecordings;
    const q = searchQuery.toLowerCase();
    return rdpRecordings.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.host?.toLowerCase().includes(q) ||
        r.connectionName?.toLowerCase().includes(q) ||
        r.tags?.some((t) => t.toLowerCase().includes(q)),
    );
  }, [rdpRecordings, searchQuery]);

  const filteredWeb = useMemo(() => {
    if (!searchQuery.trim()) return webRecordings;
    const q = searchQuery.toLowerCase();
    return webRecordings.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.host?.toLowerCase().includes(q) ||
        r.connectionName?.toLowerCase().includes(q) ||
        r.recording.metadata.target_url.toLowerCase().includes(q),
    );
  }, [webRecordings, searchQuery]);

  const filteredWebVideo = useMemo(() => {
    if (!searchQuery.trim()) return webVideoRecordings;
    const q = searchQuery.toLowerCase();
    return webVideoRecordings.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.host?.toLowerCase().includes(q) ||
        r.connectionName?.toLowerCase().includes(q),
    );
  }, [webVideoRecordings, searchQuery]);

  /* ---- SSH actions ---- */
  const handleRenameSsh = useCallback(
    async (rec: SavedRecording, name: string) => {
      rec.name = name;
      await macroService.saveRecording(rec);
      await loadData();
    },
    [loadData],
  );

  const handleDeleteSsh = useCallback(
    async (id: string) => {
      await macroService.deleteRecording(id);
      if (expandedId === id) setExpandedId(null);
      await loadData();
    },
    [expandedId, loadData],
  );

  const handleExportSsh = useCallback(
    async (
      rec: SavedRecording,
      format: "json" | "asciicast" | "script" | "gif",
    ) => {
      const data = await macroService.exportRecording(rec.recording, format);
      if (format === "gif") {
        const blob = data as Blob;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${rec.name.replace(/[^a-zA-Z0-9-_]/g, "_")}.gif`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const ext =
          format === "asciicast"
            ? "cast"
            : format === "script"
              ? "txt"
              : "json";
        const blob = new Blob([data as string], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${rec.name.replace(/[^a-zA-Z0-9-_]/g, "_")}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
      }
    },
    [],
  );

  const handleDeleteAllSsh = useCallback(async () => {
    await macroService.saveRecordings([]);
    setExpandedId(null);
    await loadData();
  }, [loadData]);

  /* ---- RDP actions ---- */
  const handleRenameRdp = useCallback(
    async (rec: SavedRdpRecording, name: string) => {
      rec.name = name;
      await macroService.saveRdpRecording(rec);
      await loadData();
    },
    [loadData],
  );

  const handleDeleteRdp = useCallback(
    async (id: string) => {
      await macroService.deleteRdpRecording(id);
      if (expandedId === id) setExpandedId(null);
      await loadData();
    },
    [expandedId, loadData],
  );

  const handleExportRdp = useCallback((rec: SavedRdpRecording) => {
    const blob = macroService.rdpRecordingToBlob(rec);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ext = rec.format === "gif" ? "gif" : rec.format || "webm";
    a.download = `${rec.name.replace(/[^a-zA-Z0-9-_]/g, "_")}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handlePlayRdp = useCallback((rec: SavedRdpRecording) => {
    const blob = macroService.rdpRecordingToBlob(rec);
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  }, []);

  const handleDeleteAllRdp = useCallback(async () => {
    await macroService.saveRdpRecordings([]);
    setExpandedId(null);
    await loadData();
  }, [loadData]);

  /* ---- Web HAR actions ---- */
  const handleRenameWeb = useCallback(
    async (id: string, name: string) => {
      const rec = webRecordings.find((r) => r.id === id);
      if (!rec) return;
      await macroService.saveWebRecording({ ...rec, name });
      loadData();
    },
    [webRecordings, loadData],
  );

  const handleDeleteWeb = useCallback(
    async (id: string) => {
      await macroService.deleteWebRecording(id);
      loadData();
    },
    [loadData],
  );

  const handleExportWeb = useCallback(
    async (rec: SavedWebRecording, format: "json" | "har") => {
      const content = await macroService.exportWebRecording(
        rec.recording,
        format,
      );
      const ext = format === "har" ? ".har" : ".json";
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${rec.name}${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [],
  );

  const handleClearAllWeb = useCallback(async () => {
    await macroService.saveWebRecordings([]);
    loadData();
  }, [loadData]);

  /* ---- Web Video actions ---- */
  const handleRenameWebVideo = useCallback(
    async (id: string, name: string) => {
      const rec = webVideoRecordings.find((r) => r.id === id);
      if (!rec) return;
      await macroService.saveWebVideoRecording({ ...rec, name });
      loadData();
    },
    [webVideoRecordings, loadData],
  );

  const handleDeleteWebVideo = useCallback(
    async (id: string) => {
      await macroService.deleteWebVideoRecording(id);
      loadData();
    },
    [loadData],
  );

  const handleExportWebVideo = useCallback((rec: SavedWebVideoRecording) => {
    const blob = macroService.webVideoRecordingToBlob(rec);
    const ext = rec.format === "mp4" ? ".mp4" : ".webm";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${rec.name}${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleClearAllWebVideo = useCallback(async () => {
    await macroService.saveWebVideoRecordings([]);
    loadData();
  }, [loadData]);

  /* ---- stats ---- */
  const sshTotalDuration = useMemo(
    () =>
      sshRecordings.reduce((s, r) => s + r.recording.metadata.duration_ms, 0),
    [sshRecordings],
  );

  const rdpTotalSize = useMemo(
    () => rdpRecordings.reduce((s, r) => s + r.sizeBytes, 0),
    [rdpRecordings],
  );

  const rdpTotalDuration = useMemo(
    () => rdpRecordings.reduce((s, r) => s + r.durationMs, 0),
    [rdpRecordings],
  );

  /* ---- tab helpers ---- */
  const switchTab = useCallback((tab: RecordingTab) => {
    setActiveTab(tab);
    setExpandedId(null);
  }, []);

  return {
    /* tab */
    activeTab,
    switchTab,

    /* search */
    searchQuery,
    setSearchQuery,
    expandedId,
    setExpandedId,

    /* raw counts */
    sshRecordings,
    rdpRecordings,
    webRecordings,
    webVideoRecordings,

    /* filtered */
    filteredSsh,
    filteredRdp,
    filteredWeb,
    filteredWebVideo,

    /* SSH actions */
    handleRenameSsh,
    handleDeleteSsh,
    handleExportSsh,
    handleDeleteAllSsh,

    /* RDP actions */
    handleRenameRdp,
    handleDeleteRdp,
    handleExportRdp,
    handlePlayRdp,
    handleDeleteAllRdp,

    /* Web actions */
    handleRenameWeb,
    handleDeleteWeb,
    handleExportWeb,
    handleClearAllWeb,

    /* Web Video actions */
    handleRenameWebVideo,
    handleDeleteWebVideo,
    handleExportWebVideo,
    handleClearAllWebVideo,

    /* stats */
    sshTotalDuration,
    rdpTotalSize,
    rdpTotalDuration,
  };
}
