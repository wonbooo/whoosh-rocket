import { describe, expect, it } from 'vitest';
import {
  dragDelta,
  isDoubleActivate,
} from '@/components/shared/desktopIconInput';

describe('desktop icon pointer gestures', () => {
  it('uses screen movement and falls back when screen coordinates stay put', () => {
    expect(
      dragDelta({ x: 10, y: 20 }, { x: 14, y: 18, movementX: 1, movementY: 1 }),
    ).toEqual({ dx: 4, dy: -2 });
    expect(
      dragDelta(
        { x: 10, y: 20 },
        { x: 10, y: 20, movementX: 3, movementY: -4 },
      ),
    ).toEqual({ dx: 3, dy: -4 });
  });

  it('opens on a second click that did not drag', () => {
    expect(isDoubleActivate({ moved: false, elapsedMs: 200 })).toBe(true);
    expect(isDoubleActivate({ moved: true, elapsedMs: 200 })).toBe(false);
    expect(isDoubleActivate({ moved: false, elapsedMs: 800 })).toBe(false);
  });
});
