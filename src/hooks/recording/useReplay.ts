import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ReplaySession,
  PlaybackState,
  PlaybackPosition,
  ReplayTimeline,
  TerminalFrame,
  VideoFrame,
  HarWaterfall,
  HarStats,
  ReplayAnnotation,
  ReplayBookmark,
  SearchResult,
  ReplayConfig,
  ReplayStats,
  ExportFormat,
} from "../../types/recording/replay";

export function useReplay() {
  const [session, setSession] = useState<ReplaySession | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [position, setPosition] = useState<PlaybackPosition | null>(null);
  const [timeline, setTimeline] = useState<ReplayTimeline | null>(null);
  const [terminalFrame, setTerminalFrame] = useState<TerminalFrame | null>(null);
  const [videoFrame, setVideoFrame] = useState<VideoFrame | null>(null);
  const [harWaterfall, setHarWaterfall] = useState<HarWaterfall | null>(null);
  const [harStats, setHarStats] = useState<HarStats | null>(null);
  const [annotations, setAnnotations] = useState<ReplayAnnotation[]>([]);
  const [bookmarks, setBookmarks] = useState<ReplayBookmark[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [speed, setSpeedState] = useState(1.0);
  const [config, setConfig] = useState<ReplayConfig>({
    defaultSpeed: 1.0, autoPlay: false, loopPlayback: false, showTimeline: true,
    showAnnotations: true, terminalFontSize: 14, maxSearchResults: 100,
  });
  const [error, setError] = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadTerminal = useCallback(async (recordingId: string) => {
    setPlaybackState("loading");
    try {
      const s = await invoke<ReplaySession>("replay_load_terminal", { recordingId });
      setSession(s);
      setPlaybackState("paused");
      const tl = await invoke<ReplayTimeline>("replay_get_timeline");
      setTimeline(tl);
      return s;
    } catch (e) { setError(String(e)); setPlaybackState("error"); return null; }
  }, []);

  const loadVideo = useCallback(async (recordingId: string) => {
    setPlaybackState("loading");
    try {
      const s = await invoke<ReplaySession>("replay_load_video", { recordingId });
      setSession(s);
      setPlaybackState("paused");
      const tl = await invoke<ReplayTimeline>("replay_get_timeline");
      setTimeline(tl);
      return s;
    } catch (e) { setError(String(e)); setPlaybackState("error"); return null; }
  }, []);

  const loadHar = useCallback(async (recordingId: string) => {
    setPlaybackState("loading");
    try {
      const s = await invoke<ReplaySession>("replay_load_har", { recordingId });
      setSession(s);
      setPlaybackState("paused");
      const wf = await invoke<HarWaterfall>("replay_get_har_waterfall");
      setHarWaterfall(wf);
      const hs = await invoke<HarStats>("replay_get_har_stats");
      setHarStats(hs);
      return s;
    } catch (e) { setError(String(e)); setPlaybackState("error"); return null; }
  }, []);

  const play = useCallback(async () => {
    try {
      await invoke("replay_play");
      setPlaybackState("playing");
    } catch (e) { setError(String(e)); }
  }, []);

  const pause = useCallback(async () => {
    try {
      await invoke("replay_pause");
      setPlaybackState("paused");
    } catch (e) { setError(String(e)); }
  }, []);

  const stop = useCallback(async () => {
    try {
      await invoke("replay_stop");
      setPlaybackState("stopped");
      setPosition(null);
    } catch (e) { setError(String(e)); }
  }, []);

  const seek = useCallback(async (timeMs: number) => {
    try {
      await invoke("replay_seek", { timeMs });
      const pos = await invoke<PlaybackPosition>("replay_get_position");
      setPosition(pos);
      if (session?.replayType === "terminal") {
        const f = await invoke<TerminalFrame>("replay_get_terminal_state_at", { timeMs });
        setTerminalFrame(f);
      } else if (session?.replayType === "video") {
        const f = await invoke<VideoFrame>("replay_get_frame_at", { timeMs });
        setVideoFrame(f);
      }
    } catch (e) { setError(String(e)); }
  }, [session]);

  const setSpeed = useCallback(async (s: number) => {
    try {
      await invoke("replay_set_speed", { speed: s });
      setSpeedState(s);
    } catch (e) { setError(String(e)); }
  }, []);

  const addAnnotation = useCallback(async (timeMs: number, text: string, color?: string) => {
    try {
      const id = await invoke<string>("replay_add_annotation", { timeMs, text, color: color ?? "#fbbf24" });
      const list = await invoke<ReplayAnnotation[]>("replay_list_annotations");
      setAnnotations(list);
      return id;
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const removeAnnotation = useCallback(async (annotationId: string) => {
    try {
      await invoke("replay_remove_annotation", { annotationId });
      setAnnotations(prev => prev.filter(a => a.id !== annotationId));
    } catch (e) { setError(String(e)); }
  }, []);

  const addBookmark = useCallback(async (timeMs: number, label: string) => {
    try {
      const id = await invoke<string>("replay_add_bookmark", { timeMs, label });
      const list = await invoke<ReplayBookmark[]>("replay_list_bookmarks");
      setBookmarks(list);
      return id;
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const removeBookmark = useCallback(async (bookmarkId: string) => {
    try {
      await invoke("replay_remove_bookmark", { bookmarkId });
      setBookmarks(prev => prev.filter(b => b.id !== bookmarkId));
    } catch (e) { setError(String(e)); }
  }, []);

  const search = useCallback(async (query: string) => {
    try {
      const results = await invoke<SearchResult[]>("replay_search", { query });
      setSearchResults(results);
      return results;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const exportRecording = useCallback(async (format: ExportFormat, outputPath: string) => {
    try {
      await invoke("replay_export", { format, outputPath });
    } catch (e) { setError(String(e)); }
  }, []);

  const loadAnnotations = useCallback(async () => {
    try {
      const list = await invoke<ReplayAnnotation[]>("replay_list_annotations");
      setAnnotations(list);
    } catch (e) { setError(String(e)); }
  }, []);

  const loadBookmarks = useCallback(async () => {
    try {
      const list = await invoke<ReplayBookmark[]>("replay_list_bookmarks");
      setBookmarks(list);
    } catch (e) { setError(String(e)); }
  }, []);

  // Position polling during playback
  useEffect(() => {
    if (playbackState === "playing") {
      tickRef.current = setInterval(async () => {
        try {
          const pos = await invoke<PlaybackPosition>("replay_get_position");
          setPosition(pos);
          if (pos.percent >= 100) {
            setPlaybackState("stopped");
          }
        } catch { /* ignore tick errors */ }
      }, 100);
      return () => { if (tickRef.current) clearInterval(tickRef.current); };
    } else {
      if (tickRef.current) clearInterval(tickRef.current);
    }
  }, [playbackState]);

  return {
    session, playbackState, position, timeline, terminalFrame, videoFrame,
    harWaterfall, harStats, annotations, bookmarks, searchResults, speed, config, error,
    loadTerminal, loadVideo, loadHar, play, pause, stop, seek, setSpeed,
    addAnnotation, removeAnnotation, addBookmark, removeBookmark,
    search, exportRecording, loadAnnotations, loadBookmarks,
  };
}
