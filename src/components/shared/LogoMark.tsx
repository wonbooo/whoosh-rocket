import { useEffect, useRef, useState } from 'react';

const REST = '/logo/rest.png';
const SEQUENCE = '/logo/sequence.mp4';
const CROP = { x: 0.1332, y: 0.1296, w: 0.7452, h: 0.7904 };
const PLAYBACK_RATE = 2.5;

function clearEdgeBlack(image: ImageData) {
  const { data, width, height } = image;
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  const dark = (index: number) =>
    data[index] <= 28 && data[index + 1] <= 28 && data[index + 2] <= 28;

  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixel = y * width + x;
    if (seen[pixel]) return;
    const index = pixel * 4;
    if (!dark(index)) return;
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
    context.putImageData(frame, 0, 0);
  };

  const stop = () => {
    cancelAnimationFrame(frameRef.current);
    setPlaying(false);
  };

  const tick = () => {
    const video = videoRef.current;
    if (!video || video.ended || video.paused) {
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
