import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./HelpDisclosure.css";

export function useHelpDisclosure(label) {
  const ref = useRef(null);
  const tooltipRef = useRef(null);
  const focusFrame = useRef(null);
  const leaveTimer = useRef(null);
  const visible = useRef(false);
  const [position, setPosition] = useState(null);
  const open = position !== null;
  const id = useId();
  const cancelFocus = () => {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = null;
  };
  const cancelLeave = () => clearTimeout(leaveTimer.current);
  const close = () => {
    visible.current = false;
    cancelFocus();
    cancelLeave();
    setPosition(null);
  };
  const show = () => {
    cancelLeave();
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    visible.current = true;
    setPosition({
      left: Math.min(Math.max(12, box.left), Math.max(12, window.innerWidth - 292)),
      top: Math.max(8, box.top - 44),
    });
  };
  const leave = () => {
    cancelLeave();
    leaveTimer.current = setTimeout(() => {
      if (document.activeElement !== ref.current) close();
    }, 120);
  };
  useEffect(() => {
    return () => { cancelFocus(); cancelLeave(); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const key = (event) => { if (event.key === "Escape") close(); };
    const outside = (event) => {
      if (!ref.current?.contains(event.target) && !tooltipRef.current?.contains(event.target)) close();
    };
    const scroll = (event) => {
      if (!visible.current || (event.target instanceof Node && tooltipRef.current?.contains(event.target))) return;
      const box = ref.current?.getBoundingClientRect();
      // Focusing an offscreen trigger scrolls it into view after the focus frame.
      if (document.activeElement === ref.current && box && box.bottom > 0 && box.top < window.innerHeight &&
          box.right > 0 && box.left < window.innerWidth) show();
      else close();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!position) return;
    const box = ref.current?.getBoundingClientRect();
    const tip = tooltipRef.current?.getBoundingClientRect();
    if (!box || !tip) return;
    const above = box.top - tip.height - 8;
    const top = Math.max(8, Math.min(above >= 8 ? above : box.bottom + 8, window.innerHeight - tip.height - 8));
    const left = Math.max(12, Math.min(box.left, window.innerWidth - tip.width - 12));
    if (position.top !== top || position.left !== left) setPosition({ top, left });
  }, [position, label]);
  const triggerProps = {
    ref,
    "aria-describedby": position ? id : undefined,
    onMouseEnter: show,
    onMouseLeave: leave,
    onFocus: () => {
      cancelFocus();
      focusFrame.current = requestAnimationFrame(() => {
        focusFrame.current = null;
        if (document.activeElement === ref.current) show();
      });
    },
    onBlur: close,
    onKeyDown: (event) => {
      if (event.key === "Escape") { event.stopPropagation(); close(); }
    },
  };
  const tooltip = position && createPortal(
    <span ref={tooltipRef} id={id} role="tooltip" className="number-tooltip help-tooltip"
      style={position} onMouseEnter={cancelLeave} onMouseLeave={leave}>{label}</span>,
    document.body,
  );
  return { triggerProps, tooltip, show };
}

export default function HelpDisclosure({ label, children = "?", className = "" }) {
  const { triggerProps, tooltip, show } = useHelpDisclosure(label);
  return <>
    <button {...triggerProps} type="button" className={`help-disclosure ${className}`.trim()} aria-label={label}
      onClick={(event) => { event.stopPropagation(); show(); }}>{children}</button>
    {tooltip}
  </>;
}
