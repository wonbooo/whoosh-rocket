import type { Widget } from '@/features/analysis/types';

export function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  margin = 0,
): boolean {
  const width = Math.min(a.w, b.w) * margin;
  const height = Math.min(a.h, b.h) * margin;
  return (
    a.x + width < b.x + b.w - width &&
    b.x + width < a.x + a.w - width &&
    a.y + height < b.y + b.h - height &&
    b.y + height < a.y + a.h - height
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
      if (left && right && overlaps(left.layout, right.layout, 0.3)) {
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
