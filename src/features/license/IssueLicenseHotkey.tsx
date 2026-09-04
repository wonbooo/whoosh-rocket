import { useEffect, useState } from 'react';
import { IssueLicenseDialog } from '@/features/license/IssueLicenseDialog';

const DOUBLE_CTRL_MS = 400;

export function IssueLicenseHotkey() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let lastCtrlTapAt = 0;
    let chordBroken = false;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }
      if (event.key !== 'Control') {
        chordBroken = true;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Control') {
        return;
      }
      if (chordBroken) {
        chordBroken = false;
        lastCtrlTapAt = 0;
        return;
      }
      const now = event.timeStamp;
      if (lastCtrlTapAt > 0 && now - lastCtrlTapAt <= DOUBLE_CTRL_MS) {
        lastCtrlTapAt = 0;
        setOpen(true);
        return;
      }
      lastCtrlTapAt = now;
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);

  return <IssueLicenseDialog open={open} onOpenChange={setOpen} />;
}
