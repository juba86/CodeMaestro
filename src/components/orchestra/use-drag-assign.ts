"use client";

// Pointer-event drag and drop for model chips (§6.3.5): mouse and pen only —
// touch never starts a drag (it fights scrolling; tap-to-assign is the path
// there). Every drag has a non-drag alternative (slot activation, the
// „Zuweisen an …" menu), so this is a shortcut, never the only way.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface DragPayload {
  workerId: string;
  /** "palette", or the assignment target whose slot chip is dragged. */
  from: "palette" | { target: string };
}

export interface DropVerdict {
  valid: boolean;
  /** Why a drop is refused („Kann keine Dateien ändern"). */
  reason?: string;
}

export interface DragOver extends DropVerdict {
  key: string;
}

interface Session {
  payload: DragPayload;
  el: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  dragging: boolean;
  overKey: string | null;
  raf: number | null;
  cleanup: () => void;
}

const THRESHOLD = 5;
const EDGE = 56;
const MAX_SPEED = 18;
const GHOST_OFFSET = 12;

export interface UseDragAssignOptions {
  /** null = not a drop target for this payload (e.g. the slot it came from). */
  verdict: (payload: DragPayload, key: string) => DropVerdict | null;
  onDrop: (payload: DragPayload, key: string) => void;
  onStart?: (payload: DragPayload) => void;
  onCancel?: (payload: DragPayload) => void;
  /** Scroll container that auto-scrolls near its edges. */
  scrollRef: React.RefObject<HTMLElement | null>;
}

export function useDragAssign({ verdict, onDrop, onStart, onCancel, scrollRef }: UseDragAssignOptions) {
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [over, setOver] = useState<DragOver | null>(null);
  const session = useRef<Session | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const suppressClick = useRef(false);
  // Latest callbacks for the imperative listeners.
  const opts = useRef({ verdict, onDrop, onStart, onCancel });
  useEffect(() => {
    opts.current = { verdict, onDrop, onStart, onCancel };
  }, [verdict, onDrop, onStart, onCancel]);

  const placeGhost = useCallback((x: number, y: number) => {
    const g = ghostRef.current;
    if (g) g.style.transform = `translate3d(${Math.round(x + GHOST_OFFSET)}px, ${Math.round(y + GHOST_OFFSET)}px, 0)`;
  }, []);

  // The ghost mounts one render after the drag starts: put it in place before paint.
  useLayoutEffect(() => {
    const s = session.current;
    if (dragging && s) placeGhost(s.x, s.y);
  }, [dragging, placeGhost]);

  const hitTest = useCallback((s: Session) => {
    const el = document.elementFromPoint(s.x, s.y)?.closest<HTMLElement>("[data-drop-target]") ?? null;
    const key = el?.dataset.dropTarget ?? null;
    const v = key ? opts.current.verdict(s.payload, key) : null;
    const nextKey = v ? key : null;
    if (nextKey === s.overKey) return;
    s.overKey = nextKey;
    setOver(v && key ? { key, ...v } : null);
  }, []);

  const finish = useCallback((drop: boolean) => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    s.cleanup();
    if (s.raf !== null) cancelAnimationFrame(s.raf);
    if (!s.dragging) return;
    // The click that follows pointerup on the source must not open its menu/picker.
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");
    const key = s.overKey;
    const v = key ? opts.current.verdict(s.payload, key) : null;
    setDragging(null);
    setOver(null);
    if (drop && key && v?.valid) opts.current.onDrop(s.payload, key);
    else opts.current.onCancel?.(s.payload);
  }, []);

  // Esc cancels a drag (and must not also close other layers).
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dragging, finish]);

  useEffect(() => () => finish(false), [finish]);

  /**
   * Pointer-down handler for a drag source. `preventDefault` keeps a Radix
   * menu trigger from opening on mouse-down (it then opens on click instead).
   */
  const startProps = useCallback(
    (payload: DragPayload, { preventDefault = false, disabled = false }: { preventDefault?: boolean; disabled?: boolean } = {}) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (disabled || e.pointerType === "touch" || e.button !== 0 || e.ctrlKey || e.metaKey) return;
        if (session.current) finish(false);
        if (preventDefault) e.preventDefault();
        const el = e.currentTarget;
        const s: Session = {
          payload,
          el,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          x: e.clientX,
          y: e.clientY,
          dragging: false,
          overKey: null,
          raf: null,
          cleanup: () => {},
        };
        // Auto-scroll the canvas while the pointer rests near one of its edges.
        const tick = () => {
          s.raf = null;
          if (session.current !== s || !s.dragging) return;
          const box = scrollRef.current;
          if (!box) return;
          const r = box.getBoundingClientRect();
          const speed = (d: number) => Math.ceil(MAX_SPEED * (1 - Math.max(0, d) / EDGE));
          let dx = 0;
          let dy = 0;
          if (s.y < r.top + EDGE && s.y >= r.top - EDGE) dy = -speed(s.y - r.top);
          else if (s.y > r.bottom - EDGE && s.y <= r.bottom + EDGE) dy = speed(r.bottom - s.y);
          if (s.x < r.left + EDGE && s.x >= r.left) dx = -speed(s.x - r.left);
          else if (s.x > r.right - EDGE && s.x <= r.right + EDGE) dx = speed(r.right - s.x);
          if (!dx && !dy) return;
          const top = box.scrollTop;
          const left = box.scrollLeft;
          box.scrollBy({ left: dx, top: dy, behavior: "instant" as ScrollBehavior });
          if (box.scrollTop !== top || box.scrollLeft !== left) hitTest(s);
          s.raf = requestAnimationFrame(tick);
        };
        const onMove = (ev: PointerEvent) => {
          if (ev.pointerId !== s.pointerId) return;
          s.x = ev.clientX;
          s.y = ev.clientY;
          if (!s.dragging) {
            if (Math.hypot(s.x - s.startX, s.y - s.startY) < THRESHOLD) return;
            s.dragging = true;
            try {
              el.setPointerCapture(s.pointerId);
            } catch {
              /* pointer already gone */
            }
            document.body.style.setProperty("user-select", "none");
            document.body.style.setProperty("cursor", "grabbing");
            setDragging(payload);
            opts.current.onStart?.(payload);
          }
          ev.preventDefault();
          placeGhost(s.x, s.y);
          hitTest(s);
          if (s.raf === null) s.raf = requestAnimationFrame(tick);
        };
        const onUp = (ev: PointerEvent) => {
          if (ev.pointerId !== s.pointerId) return;
          finish(true);
        };
        const onCancelEv = (ev: PointerEvent) => {
          if (ev.pointerId !== s.pointerId) return;
          finish(false);
        };
        const onLost = () => {
          if (session.current === s && s.dragging) finish(false);
        };
        // Listen on window until capture kicks in (the pointer may leave the chip first).
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancelEv);
        el.addEventListener("lostpointercapture", onLost);
        s.cleanup = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onCancelEv);
          el.removeEventListener("lostpointercapture", onLost);
          try {
            if (el.hasPointerCapture(s.pointerId)) el.releasePointerCapture(s.pointerId);
          } catch {
            /* ignore */
          }
        };
        session.current = s;
      },
    }),
    [finish, hitTest, placeGhost, scrollRef]
  );

  /** Call first in a drag source's onClick: true when the click ends a drag and must be ignored. */
  const consumeClick = useCallback(() => suppressClick.current, []);

  return { dragging, over, ghostRef, startProps, consumeClick, cancel: () => finish(false) };
}
