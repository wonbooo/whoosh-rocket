import { useEffect } from 'react';
import { isInspectShortcut } from '@/features/security/inspect';

export function BlockInspect() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isInspectShortcut(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    const onContextMenu = (event: Event) => {
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, []);

  return null;
}
