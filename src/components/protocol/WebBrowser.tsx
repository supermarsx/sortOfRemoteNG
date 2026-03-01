import React from "react";
import { useWebBrowser } from "../../hooks/protocol/useWebBrowser";
import SecurityIcon from "./webBrowser/SecurityIcon";
import RecordingControls from "./webBrowser/RecordingControls";
import NavigationBar from "./webBrowser/NavigationBar";
import SecurityInfoBar from "./webBrowser/SecurityInfoBar";
import BookmarkChip from "./webBrowser/BookmarkChip";
import FolderChip from "./webBrowser/FolderChip";
import BookmarkContextMenu from "./webBrowser/BookmarkContextMenu";
import BarContextMenu from "./webBrowser/BarContextMenu";
import BookmarkBar from "./webBrowser/BookmarkBar";
import ERROR_BASE from "./webBrowser/ERROR_BASE";
import ContentArea from "./webBrowser/ContentArea";
import BrowserDialogs from "./webBrowser/BrowserDialogs";

export const WebBrowser: React.FC<WebBrowserProps> = ({ session }) => {
  const mgr = useWebBrowser(session);

  return (
    <div className="flex flex-col h-full bg-[var(--color-background)]">
      {/* Browser Header */}
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] p-3">
        <NavigationBar mgr={mgr} />
        <SecurityInfoBar mgr={mgr} />
      </div>

      <BookmarkBar mgr={mgr} />
      <ContentArea mgr={mgr} />
      <BrowserDialogs mgr={mgr} />
    </div>
  );
};
