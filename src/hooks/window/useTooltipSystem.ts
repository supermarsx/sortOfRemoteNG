import { useEffect, useRef } from "react";

/**
 * Global tooltip system that listens for mouseover/mouseout/focus/blur events
 * on elements with a `data-tooltip` attribute and renders a positioned tooltip.
 */
export function useTooltipSystem(): void {
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const tooltip = document.createElement("div");
    tooltip.className = "app-tooltip";
    tooltip.style.display = "none";
    document.body.appendChild(tooltip);
    tooltipRef.current = tooltip;

    let activeTarget: HTMLElement | null = null;

    const positionTooltip = (target: HTMLElement) => {
      const tooltipEl = tooltipRef.current;
      if (!tooltipEl) return;
      const rect = target.getBoundingClientRect();
      const tooltipRect = tooltipEl.getBoundingClientRect();
      const spacing = 8;

      let top = rect.top - tooltipRect.height - spacing;
      let left = rect.left + rect.width / 2 - tooltipRect.width / 2;

      if (top < spacing) {
        top = rect.bottom + spacing;
      }
      left = Math.min(
        Math.max(spacing, left),
        window.innerWidth - tooltipRect.width - spacing,
      );
      top = Math.min(
        Math.max(spacing, top),
        window.innerHeight - tooltipRect.height - spacing,
      );

      tooltipEl.style.left = `${left}px`;
      tooltipEl.style.top = `${top}px`;
    };

    const showTooltip = (target: HTMLElement) => {
      const tooltipEl = tooltipRef.current;
      if (!tooltipEl) return;
      const text = target.getAttribute("data-tooltip");
      if (!text) return;
      tooltipEl.textContent = text;
      tooltipEl.classList.add("is-visible");
      tooltipEl.style.display = "block";
      positionTooltip(target);
    };

    const hideTooltip = () => {
      const tooltipEl = tooltipRef.current;
      if (!tooltipEl) return;
      tooltipEl.classList.remove("is-visible");
      tooltipEl.style.display = "none";
    };

    // Watch only the active control, not the whole application. Its action can
    // change without another pointer event (for example Refresh / Stop loading).
    const activeObserver = new MutationObserver(() => {
      if (activeTarget?.getAttribute("data-tooltip")) {
        showTooltip(activeTarget);
      } else {
        hideTooltip();
      }
    });
    const activateTarget = (target: HTMLElement) => {
      activeObserver.disconnect();
      activeTarget = target;
      activeObserver.observe(target, {
        attributes: true,
        attributeFilter: ["data-tooltip"],
      });
      showTooltip(target);
    };

    const handlePointerOver = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-tooltip]",
      );
      if (!target) return;
      if (activeTarget === target) return;
      activateTarget(target);
    };

    const handlePointerOut = (event: MouseEvent) => {
      if (!activeTarget) return;
      const related = event.relatedTarget as HTMLElement | null;
      if (related && activeTarget.contains(related)) {
        return;
      }
      activeTarget = null;
      activeObserver.disconnect();
      hideTooltip();
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-tooltip]",
      );
      if (!target) return;
      activateTarget(target);
    };

    const handleFocusOut = () => {
      activeTarget = null;
      activeObserver.disconnect();
      hideTooltip();
    };

    const handleWindowChange = () => {
      if (activeTarget) {
        positionTooltip(activeTarget);
      }
    };

    document.addEventListener("mouseover", handlePointerOver);
    document.addEventListener("mouseout", handlePointerOut);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);

    return () => {
      activeObserver.disconnect();
      document.removeEventListener("mouseover", handlePointerOver);
      document.removeEventListener("mouseout", handlePointerOut);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
      tooltipRef.current?.remove();
      tooltipRef.current = null;
    };
  }, []);
}
