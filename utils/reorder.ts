/** Layout of one row inside the list, measured before a drag starts. */
export interface RowBox {
  y: number;
  h: number;
}

/**
 * Index the dragged row lands on. Its centre starts at the middle of its own row and moves with
 * the finger by `dy`; the target is the row under that centre, clamped to the list.
 */
export function dropIndex(rows: RowBox[], from: number, dy: number): number {
  if (rows.length === 0 || from < 0 || from >= rows.length) return Math.max(from, 0);
  const centre = rows[from].y + rows[from].h / 2 + dy;
  if (centre < rows[0].y) return 0;
  for (let i = 0; i < rows.length; i++) {
    if (centre < rows[i].y + rows[i].h) return i;
  }
  return rows.length - 1;
}

/** Vertical offset a row that is NOT being dragged takes while `from` is held over `to`. */
export function shiftFor(index: number, from: number, to: number, draggedHeight: number): number {
  if (index === from) return 0;
  if (from < to && index > from && index <= to) return -draggedHeight;
  if (from > to && index >= to && index < from) return draggedHeight;
  return 0;
}

/** A copy of `list` with the item at `from` moved to `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}
