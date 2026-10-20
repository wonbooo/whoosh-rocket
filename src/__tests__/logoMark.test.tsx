import { act, fireEvent, render } from '@testing-library/react';
import { LogoMark, LOGO_PLAY_MS } from '@/components/shared/LogoMark';

describe('LogoMark', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays on the still pose, plays once on hover, then rests again', async () => {
    vi.useFakeTimers();
    const { container } = render(<LogoMark />);
    const mark = container.querySelector('.logo-mark') as HTMLElement;
    const img = () => mark.querySelector('img') as HTMLImageElement;

    expect(img().getAttribute('src')).toBe('/buzz-still.svg');

    fireEvent.mouseEnter(mark);
    expect(img().getAttribute('src')).toContain('/buzz-logo.gif?play=1');

    fireEvent.mouseEnter(mark);
    expect(img().getAttribute('src')).toContain('play=1');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGO_PLAY_MS);
    });
    expect(img().getAttribute('src')).toBe('/buzz-still.svg');

    fireEvent.mouseEnter(mark);
    expect(img().getAttribute('src')).toContain('/buzz-logo.gif?play=1');
  });
});
