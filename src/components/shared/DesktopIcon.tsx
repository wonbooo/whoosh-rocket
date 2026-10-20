import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  dragDelta,
  isDoubleActivate,
} from '@/components/shared/desktopIconInput';
import { isTauriRuntime } from '@/apis/kingdee/transport';

export function isDesktopIconView() {
  return (
    new URLSearchParams(window.location.search).get('view') === 'desktop-icon'
  );
}

export function DesktopIcon() {
  const drag = useRef<{
    x: number;
    y: number;
    travel: number;
    moved: boolean;
  } | null>(null);
  const lastClick = useRef(0);
  const pending = useRef({ dx: 0, dy: 0 });
  const frame = useRef(0);

  useEffect(() => {
    document.documentElement.classList.add('desktop-icon-view');
    return () => {
      document.documentElement.classList.remove('desktop-icon-view');
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, []);

  const flushNudge = () => {
    frame.current = 0;
    const { dx, dy } = pending.current;
    pending.current = { dx: 0, dy: 0 };
    if (dx === 0 && dy === 0) return;
    if (!isTauriRuntime()) return;
    void invoke('desktop_icon_nudge', { dx, dy });
  };

  const queueNudge = (dx: number, dy: number) => {
    pending.current.dx += dx;
    pending.current.dy += dy;
    if (frame.current) return;
    frame.current = requestAnimationFrame(flushNudge);
  };

  return (
    <div
      className="desktop-icon"
      role="button"
      aria-label="咻咻小火箭"
      title="双击打开，右键可退出"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          x: event.screenX,
          y: event.screenY,
          travel: 0,
          moved: false,
        };
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state) return;
        const delta = dragDelta(
          { x: state.x, y: state.y },
          {
            x: event.screenX,
            y: event.screenY,
            movementX: event.movementX,
            movementY: event.movementY,
          },
        );
        state.x = event.screenX;
        state.y = event.screenY;
        state.travel += Math.hypot(delta.dx, delta.dy);
        if (!state.moved && state.travel < 3) return;
        state.moved = true;
        queueNudge(delta.dx, delta.dy);
      }}
      onPointerUp={(event) => {
        const state = drag.current;
        drag.current = null;
        flushNudge();
        if (!state || event.button !== 0) return;
        const now = Date.now();
        if (
          isDoubleActivate({
            moved: state.moved,
            elapsedMs: now - lastClick.current,
          })
        ) {
          lastClick.current = 0;
          if (isTauriRuntime()) void invoke('desktop_icon_open');
          return;
        }
        if (!state.moved) {
          lastClick.current = now;
        }
      }}
      onDoubleClick={() => {
        if (isTauriRuntime()) void invoke('desktop_icon_open');
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (isTauriRuntime()) void invoke('desktop_icon_menu');
      }}
    >
      <img src="/buzz-logo.gif" alt="" draggable={false} />
    </div>
  );
}
