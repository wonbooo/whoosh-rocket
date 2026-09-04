import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BlockInspect } from '@/features/security/BlockInspect';
import { isInspectShortcut } from '@/features/security/inspect';

function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('isInspectShortcut', () => {
  it('blocks F12 and common inspect chords', () => {
    expect(isInspectShortcut(keyEvent({ key: 'F12' }))).toBe(true);
    expect(
      isInspectShortcut(keyEvent({ key: 'I', ctrlKey: true, shiftKey: true })),
    ).toBe(true);
    expect(
      isInspectShortcut(keyEvent({ key: 'j', ctrlKey: true, shiftKey: true })),
    ).toBe(true);
    expect(
      isInspectShortcut(keyEvent({ key: 'c', ctrlKey: true, shiftKey: true })),
    ).toBe(true);
    expect(isInspectShortcut(keyEvent({ key: 'u', ctrlKey: true }))).toBe(true);
  });

  it('does not block ordinary typing or copy', () => {
    expect(isInspectShortcut(keyEvent({ key: 'a' }))).toBe(false);
    expect(isInspectShortcut(keyEvent({ key: 'c', ctrlKey: true }))).toBe(
      false,
    );
    expect(isInspectShortcut(keyEvent({ key: 'Control' }))).toBe(false);
  });
});

describe('BlockInspect', () => {
  it('prevents inspect shortcuts and the context menu', () => {
    render(<BlockInspect />);
    const key = keyEvent({ key: 'F12', cancelable: true, bubbles: true });
    window.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);

    const menu = new Event('contextmenu', { cancelable: true, bubbles: true });
    window.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });
});
