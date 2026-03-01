import { useState, useCallback, useEffect } from "react";

export function useResizeHandlers(
  sidebarPosition: "left" | "right",
  setSidebarWidth: React.Dispatch<React.SetStateAction<number>>,
  setRdpPanelWidth: React.Dispatch<React.SetStateAction<number>>,
  layoutRef: React.RefObject<HTMLDivElement | null>,
) {
  const [isResizing, setIsResizing] = useState(false);
  const [isRdpPanelResizing, setIsRdpPanelResizing] = useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsResizing(true);
    e.preventDefault();
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;
      const layoutRect = layoutRef.current?.getBoundingClientRect();
      const layoutLeft = layoutRect?.left ?? 0;
      const layoutWidth = layoutRect?.width ?? window.innerWidth;
      const newWidth =
        sidebarPosition === "left"
          ? Math.max(200, Math.min(600, e.clientX - layoutLeft))
          : Math.max(200, Math.min(600, layoutLeft + layoutWidth - e.clientX));
      setSidebarWidth(newWidth);
    },
    [isResizing, sidebarPosition],
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    } else {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handleRdpPanelMouseDown = (e: React.MouseEvent) => {
    setIsRdpPanelResizing(true);
    e.preventDefault();
  };

  const handleRdpPanelMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isRdpPanelResizing) return;
      const layoutRect = layoutRef.current?.getBoundingClientRect();
      const layoutRight = (layoutRect?.left ?? 0) + (layoutRect?.width ?? window.innerWidth);
      const newWidth = Math.max(280, Math.min(600, layoutRight - e.clientX));
      setRdpPanelWidth(newWidth);
    },
    [isRdpPanelResizing],
  );

  const handleRdpPanelMouseUp = useCallback(() => {
    setIsRdpPanelResizing(false);
  }, []);

  useEffect(() => {
    if (isRdpPanelResizing) {
      document.addEventListener("mousemove", handleRdpPanelMouseMove);
      document.addEventListener("mouseup", handleRdpPanelMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    } else {
      document.removeEventListener("mousemove", handleRdpPanelMouseMove);
      document.removeEventListener("mouseup", handleRdpPanelMouseUp);
      if (!isResizing) {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    }
    return () => {
      document.removeEventListener("mousemove", handleRdpPanelMouseMove);
      document.removeEventListener("mouseup", handleRdpPanelMouseUp);
    };
  }, [isRdpPanelResizing, handleRdpPanelMouseMove, handleRdpPanelMouseUp, isResizing]);

  return {
    handleMouseDown,
    handleRdpPanelMouseDown,
  };
}
