import { useEffect, useRef, useState } from 'react';

const REST = '/logo/rest.png';
const SEQUENCE = '/logo/sequence.mp4';
const CROP = { x: 0.1332, y: 0.1296, w: 0.7452, h: 0.7904 };
const PLAYBACK_RATE = 2.5;
const LANDING_AT = 10.55;

function darkPlate(image: ImageData) {
  const { data } = image;
  let dark = 0;
  const total = data.length / 4;
  for (let index = 0; index < data.length; index += 4) {
    const max = Math.max(data[index], data[index + 1], data[index + 2]);
    if (data[index + 3] > 180 && max <= 28) dark += 1;
  }
  return dark / total > 0.12;
}

function clearEdgeBlack(image: ImageData) {
  const { data, width, height } = image;
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  const maxOf = (index: number) =>
    Math.max(data[index], data[index + 1], data[index + 2]);
  const minOf = (index: number) =>
    Math.min(data[index], data[index + 1], data[index + 2]);
  const backgroundLike = (index: number) => {
    const max = maxOf(index);
    return max <= 64 && max - minOf(index) <= 30;
  };

  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixel = y * width + x;
    if (seen[pixel]) return;
    const index = pixel * 4;
    if (data[index + 3] === 0 || !backgroundLike(index)) return;
    seen[pixel] = 1;
    data[index + 3] = 0;
    stack.push(pixel);
  };

  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length > 0) {
    const pixel = stack.pop() as number;
    const x = pixel % width;
    const y = (pixel - x) / width;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  const holeSeen = new Uint8Array(width * height);
  const collectHole = (startX: number, startY: number) => {
    const region: number[] = [];
    const pending: number[] = [startY * width + startX];
    holeSeen[startY * width + startX] = 1;
    while (pending.length > 0) {
      const pixel = pending.pop() as number;
      const index = pixel * 4;
      const max = maxOf(index);
      if (data[index + 3] === 0 || max > 48 || max - minOf(index) > 24)
        continue;
      region.push(pixel);
      const x = pixel % width;
      const y = (pixel - x) / width;
      const next: Array<[number, number]> = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];
      for (const [nx, ny] of next) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (holeSeen[neighbor]) continue;
        holeSeen[neighbor] = 1;
        pending.push(neighbor);
      }
    }
    return region;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (holeSeen[y * width + x]) continue;
      const region = collectHole(x, y);
      if (region.length >= 8) {
        for (const pixel of region) data[pixel * 4 + 3] = 0;
      }
    }
  }
}

export function LogoMark() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  const paint = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.drawImage(
      video,
      video.videoWidth * CROP.x,
      video.videoHeight * CROP.y,
      video.videoWidth * CROP.w,
      video.videoHeight * CROP.h,
      0,
      0,
      width,
      height,
    );
    const frame = context.getImageData(0, 0, width, height);
    clearEdgeBlack(frame);
    if (darkPlate(frame)) {
      video.pause();
      stop();
      return;
    }
    context.putImageData(frame, 0, 0);
  };

  const stop = () => {
    cancelAnimationFrame(frameRef.current);
    setPlaying(false);
  };

  const tick = () => {
    const video = videoRef.current;
    if (
      !video ||
      video.ended ||
      video.paused ||
      video.currentTime >= LANDING_AT
    ) {
      video?.pause();
      stop();
      return;
    }
    paint();
    frameRef.current = requestAnimationFrame(tick);
  };

  const play = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = PLAYBACK_RATE;
    video.currentTime = 0;
    setPlaying(true);
    void video
      .play()
      .then(() => {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(tick);
      })
      .catch(() => {
        stop();
      });
  };

  return (
    <span className="logo-mark" onMouseEnter={play} aria-hidden="true">
      <img src={REST} alt="" className={playing ? 'opacity-0' : undefined} />
      <canvas ref={canvasRef} className={playing ? undefined : 'opacity-0'} />
      <video
        ref={videoRef}
        src={SEQUENCE}
        muted
        playsInline
        preload="auto"
        onEnded={stop}
      />
    </span>
  );
}
