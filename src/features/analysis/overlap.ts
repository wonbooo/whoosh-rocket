import { collides } from 'react-grid-layout';
import type { Widget } from '@/features/analysis/types';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function overlaps(a: Rect, b: Rect): boolean {
  return collides({ ...a, i: 'a' }, { ...b, i: 'b' });
}

export function droppedOn(card: Rect, target: Rect): boolean {
  const centerX = card.x + card.w / 2;
  const centerY = card.y + card.h / 2;
  return (
    target.x <= centerX &&
    centerX <= target.x + target.w &&
    target.y <= centerY &&
    centerY <= target.y + target.h
  );
}

export interface WidgetGroup {
  anchor: Widget;
  members: Widget[];
}

export function groupOverlaps(widgets: Widget[]): WidgetGroup[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id);
    if (current == null || current === id) {
      parent.set(id, id);
      return id;
    }
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const unite = (a: string, b: string) => parent.set(find(a), find(b));

  for (const widget of widgets) {
    parent.set(widget.id, widget.id);
  }
  for (let index = 0; index < widgets.length; index += 1) {
    for (let other = index + 1; other < widgets.length; other += 1) {
      const left = widgets[index];
      const right = widgets[other];
      if (
        left &&
        right &&
        (droppedOn(left.layout, right.layout) ||
          droppedOn(right.layout, left.layout))
      ) {
        unite(left.id, right.id);
      }
    }
  }

  const groups = new Map<string, Widget[]>();
  for (const widget of widgets) {
    const root = find(widget.id);
    groups.set(root, [...(groups.get(root) ?? []), widget]);
  }
  return [...groups.values()].map((members) => {
    const anchor = members.reduce((top, widget) =>
      widget.layout.y < top.layout.y ||
      (widget.layout.y === top.layout.y && widget.layout.x < top.layout.x)
        ? widget
        : top,
    );
    return { anchor, members };
  });
}
