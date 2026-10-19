import { useEffect, useRef, useState } from 'react';
import buzzSvg from '@/assets/buzz.svg?raw';

const KEYFRAMES = [
  'grid',
  'rev',
  'scan',
  'gr',
  'gc',
  'sl',
  'mainj',
  'holo',
  'up',
  'pA',
  'bB',
  'pulse',
  'sw',
  'tw',
  'fl',
  'bC',
  'wl',
  'wr',
  'fk',
  'down',
] as const;

function matchingBrace(css: string, open: number) {
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    const char = css[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return css.length - 1;
}

function prefixKeyframeNames(css: string) {
  let next = css;
  for (const name of KEYFRAMES) {
    next = next
      .replaceAll(`@keyframes ${name}{`, `@keyframes buzz-${name}{`)
      .replaceAll(`animation-name:${name}`, `animation-name:buzz-${name}`)
      .replaceAll(`animation:${name} `, `animation:buzz-${name} `);
  }
  return next;
}

function scopeSelectors(css: string) {
  let result = '';
  let index = 0;
  while (index < css.length) {
    if (css.startsWith('@keyframes', index)) {
      const open = css.indexOf('{', index);
      const end = matchingBrace(css, open);
      result += css.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    const open = css.indexOf('{', index);
    if (open === -1) {
      result += css.slice(index);
      break;
    }
    const selector = css.slice(index, open).trim();
    const end = matchingBrace(css, open);
    const body = css.slice(open, end + 1);
    const scoped = selector
      .split(',')
      .map((part) => {
        const trimmed = part.trim();
        return trimmed ? `.logo-mark ${trimmed}` : trimmed;
      })
      .join(',');
    result += `${scoped}${body}`;
    index = end + 1;
  }
  return result;
}

function scopeBuzzSvg(svg: string) {
  const scoped = svg.replace(
    /<style([^>]*)>([\s\S]*?)<\/style>/,
    (_match, attrs: string, css: string) =>
      `<style${attrs}>${scopeSelectors(prefixKeyframeNames(css))}</style>`,
  );
  return scoped.replaceAll(
    'style="animation-name:bC"',
    'style="animation-name:buzz-bC"',
  );
}

const scopedBuzzSvg = scopeBuzzSvg(buzzSvg);

export function LogoMark() {
  const rootRef = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const [playKey, setPlayKey] = useState(0);

  useEffect(() => {
    if (!playing) return;
    const main = rootRef.current?.querySelector('#main');
    if (!main) return;
    const handle = (event: Event) => {
      if (event.target !== main) return;
      setPlaying(false);
    };
    main.addEventListener('animationend', handle);
    return () => main.removeEventListener('animationend', handle);
  }, [playing, playKey]);

  const play = () => {
    if (playing) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setPlayKey((key) => key + 1);
    setPlaying(true);
  };

  return (
    <span
      ref={rootRef}
      className={playing ? 'logo-mark play' : 'logo-mark rest'}
      onMouseEnter={play}
      aria-hidden="true"
    >
      <span
        key={playing ? playKey : 'rest'}
        className="logo-mark-svg"
        dangerouslySetInnerHTML={{ __html: scopedBuzzSvg }}
      />
    </span>
  );
}
