import { useState, useEffect, useRef, useCallback } from "react";
import { Connection } from "../../types/connection";

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useHTTPOptions(
  formData: Partial<Connection>,
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>,
) {
  const isHttpProtocol = ["http", "https"].includes(formData.protocol || "");
  const isHttps = formData.protocol === "https";

  const [showAddHeader, setShowAddHeader] = useState(false);
  const [headerName, setHeaderName] = useState("");
  const [headerValue, setHeaderValue] = useState("");
  const headerNameRef = useRef<HTMLInputElement>(null);

  // Bookmark management state
  const [showAddBookmark, setShowAddBookmark] = useState(false);
  const [bookmarkName, setBookmarkName] = useState("");
  const [bookmarkPath, setBookmarkPath] = useState("");
  const [editingBookmarkIdx, setEditingBookmarkIdx] = useState<number | null>(
    null,
  );
  const bookmarkNameRef = useRef<HTMLInputElement>(null);

  // Focus the header name input when the dialog opens
  useEffect(() => {
    if (showAddHeader) {
      setTimeout(() => headerNameRef.current?.focus(), 50);
    }
  }, [showAddHeader]);

  // Focus the bookmark name input when the dialog opens
  useEffect(() => {
    if (showAddBookmark) {
      setTimeout(() => bookmarkNameRef.current?.focus(), 50);
    }
  }, [showAddBookmark]);

  const handleAddHeader = useCallback(() => {
    const name = headerName.trim();
    if (!name) return;
    setFormData((prev) => ({
      ...prev,
      httpHeaders: {
        ...(prev.httpHeaders || {}),
        [name]: headerValue,
      },
    }));
    setHeaderName("");
    setHeaderValue("");
    setShowAddHeader(false);
  }, [headerName, headerValue, setFormData]);

  const removeHttpHeader = useCallback(
    (key: string) => {
      const headers = { ...(formData.httpHeaders || {}) } as Record<
        string,
        string
      >;
      delete headers[key];
      setFormData({ ...formData, httpHeaders: headers });
    },
    [formData, setFormData],
  );

  const handleSaveBookmark = useCallback(() => {
    const name = bookmarkName.trim();
    let path = bookmarkPath.trim();
    if (!name || !path) return;
    // Ensure path starts with /
    if (!path.startsWith("/")) path = "/" + path;
    const bookmarks = [...(formData.httpBookmarks || [])];
    if (editingBookmarkIdx !== null) {
      bookmarks[editingBookmarkIdx] = { name, path };
    } else {
      bookmarks.push({ name, path });
    }
    setFormData({ ...formData, httpBookmarks: bookmarks });
    setBookmarkName("");
    setBookmarkPath("");
    setEditingBookmarkIdx(null);
    setShowAddBookmark(false);
  }, [bookmarkName, bookmarkPath, editingBookmarkIdx, formData, setFormData]);

  const openAddBookmark = useCallback(() => {
    setBookmarkName("");
    setBookmarkPath("");
    setEditingBookmarkIdx(null);
    setShowAddBookmark(true);
  }, []);

  const openEditBookmark = useCallback((idx: number, name: string, path: string) => {
    setBookmarkName(name);
    setBookmarkPath(path);
    setEditingBookmarkIdx(idx);
    setShowAddBookmark(true);
  }, []);

  return {
    isHttpProtocol,
    isHttps,
    showAddHeader,
    setShowAddHeader,
    headerName,
    setHeaderName,
    headerValue,
    setHeaderValue,
    headerNameRef,
    showAddBookmark,
    setShowAddBookmark,
    bookmarkName,
    setBookmarkName,
    bookmarkPath,
    setBookmarkPath,
    editingBookmarkIdx,
    bookmarkNameRef,
    handleAddHeader,
    removeHttpHeader,
    handleSaveBookmark,
    openAddBookmark,
    openEditBookmark,
    formData,
    setFormData,
  };
}
