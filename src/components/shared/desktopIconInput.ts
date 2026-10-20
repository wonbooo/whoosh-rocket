export function dragDelta(
  previous: { x: number; y: number },
  next: { x: number; y: number; movementX: number; movementY: number },
): { dx: number; dy: number } {
  const dx = next.x - previous.x;
  const dy = next.y - previous.y;
  if (dx !== 0 || dy !== 0) {
    return { dx, dy };
  }
  return { dx: next.movementX, dy: next.movementY };
}

export function isDoubleActivate(input: {
  moved: boolean;
  elapsedMs: number;
  thresholdMs?: number;
}): boolean {
  const threshold = input.thresholdMs ?? 500;
  return !input.moved && input.elapsedMs >= 0 && input.elapsedMs <= threshold;
}
