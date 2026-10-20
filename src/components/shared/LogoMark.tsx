import { useEffect, useState } from 'react';

const STILL = '/buzz-still.svg';
const MOTION = '/buzz-logo.gif';
export const LOGO_PLAY_MS = 4000;

export function LogoMark() {
  const [play, setPlay] = useState(0);

  useEffect(() => {
    if (play === 0) {
      return;
    }
    const timer = window.setTimeout(() => setPlay(0), LOGO_PLAY_MS);
    return () => window.clearTimeout(timer);
  }, [play]);

  return (
    <span
      className="logo-mark"
      aria-hidden="true"
      onMouseEnter={() => {
        if (play !== 0) {
          return;
        }
        if (
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ) {
          return;
        }
        setPlay((current) => current + 1);
      }}
    >
      <img
        src={play === 0 ? STILL : `${MOTION}?play=${play}`}
        alt=""
        draggable={false}
      />
    </span>
  );
}
