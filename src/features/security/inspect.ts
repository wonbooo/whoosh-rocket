export function isInspectShortcut(event: KeyboardEvent): boolean {
  if (event.key === 'F12') {
    return true;
  }
  const key = event.key.toLowerCase();
  if (
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    (key === 'i' || key === 'j' || key === 'c' || key === 'k')
  ) {
    return true;
  }
  return (
    event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    key === 'u'
  );
}
