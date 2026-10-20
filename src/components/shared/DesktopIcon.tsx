import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';
import { isTauriRuntime } from '@/apis/kingdee/transport';

export function isDesktopIconView() {
  return (
    new URLSearchParams(window.location.search).get('view') === 'desktop-icon'
  );
}

export function DesktopIcon() {
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
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
        drag.current = { x: event.screenX, y: event.screenY, moved: false };
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state) return;
        const dx = event.screenX - state.x;
        const dy = event.screenY - state.y;
        if (!state.moved && Math.hypot(dx, dy) < 3) return;
        state.moved = true;
        state.x = event.screenX;
        state.y = event.screenY;
        queueNudge(dx, dy);
      }}
      onPointerUp={() => {
        drag.current = null;
        flushNudge();
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
