import { useCallback, useRef, useState, type ReactNode } from 'react';
import { PanResponder, View, type GestureResponderHandlers } from 'react-native';

import { dropIndex, shiftFor, type RowBox } from '@/utils/reorder';

interface DragHandle {
  /** Spread these onto the view the user grabs to drag the row. */
  handlers: GestureResponderHandlers;
  dragging: boolean;
}

interface ReorderableListProps<T extends { key: string }> {
  items: readonly T[];
  renderItem: (item: T, index: number, handle: DragHandle) => ReactNode;
  /** Called once when a drag ends on a different slot. */
  onReorder: (from: number, to: number) => void;
  /** The parent scroll view must stop scrolling while a row is dragged. */
  setScrollEnabled?: (enabled: boolean) => void;
  /** Painted behind the dragged row so rows under it do not show through. */
  background: string;
}

interface RowProps {
  rowKey: string;
  children: (handlers: GestureResponderHandlers) => ReactNode;
  onLayout: (key: string, box: RowBox) => void;
  onStart: (key: string) => void;
  onMove: (dy: number) => void;
  onEnd: () => void;
  translateY: number;
  dragging: boolean;
  background: string;
}

function Row({ rowKey, children, onLayout, onStart, onMove, onEnd, translateY, dragging, background }: RowProps) {
  // The responder is created once; it reads the latest callbacks through this ref.
  const latest = useRef({ onStart, onMove, onEnd });
  latest.current = { onStart, onMove, onEnd };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => latest.current.onStart(rowKey),
      onPanResponderMove: (_event, gesture) => latest.current.onMove(gesture.dy),
      onPanResponderRelease: () => latest.current.onEnd(),
      onPanResponderTerminate: () => latest.current.onEnd(),
    }),
  ).current;

  return (
    <View
      onLayout={(e) => onLayout(rowKey, { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height })}
      style={{
        transform: [{ translateY }],
        zIndex: dragging ? 10 : 0,
        elevation: dragging ? 6 : 0,
        backgroundColor: dragging ? background : 'transparent',
        opacity: dragging ? 0.95 : 1,
      }}>
      {children(responder.panHandlers)}
    </View>
  );
}

/**
 * A list whose rows are reordered by dragging a handle: the row follows the finger, the rows it
 * passes slide out of the way, and `onReorder(from, to)` fires on release.
 */
export function ReorderableList<T extends { key: string }>({
  items,
  renderItem,
  onReorder,
  setScrollEnabled,
  background,
}: ReorderableListProps<T>) {
  const layouts = useRef<Record<string, RowBox>>({});
  const [drag, setDrag] = useState<{ key: string; dy: number } | null>(null);
  const dragRef = useRef<{ key: string; dy: number } | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const boxes = (): RowBox[] => itemsRef.current.map((item) => layouts.current[item.key] ?? { y: 0, h: 0 });

  const handleLayout = useCallback((key: string, box: RowBox) => {
    // Layouts of the row being dragged are not updated: it is moving, not re-measured.
    if (dragRef.current?.key === key) return;
    layouts.current[key] = box;
  }, []);

  const handleStart = useCallback(
    (key: string) => {
      dragRef.current = { key, dy: 0 };
      setDrag({ key, dy: 0 });
      setScrollEnabled?.(false);
    },
    [setScrollEnabled],
  );

  const handleMove = useCallback((dy: number) => {
    if (!dragRef.current) return;
    dragRef.current = { ...dragRef.current, dy };
    setDrag(dragRef.current);
  }, []);

  const handleEnd = useCallback(() => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    setScrollEnabled?.(true);
    if (!current) return;
    const from = itemsRef.current.findIndex((item) => item.key === current.key);
    if (from < 0) return;
    const to = dropIndex(boxes(), from, current.dy);
    if (to !== from) onReorder(from, to);
  }, [onReorder, setScrollEnabled]);

  const from = drag ? items.findIndex((item) => item.key === drag.key) : -1;
  const to = drag && from >= 0 ? dropIndex(boxes(), from, drag.dy) : -1;
  const draggedHeight = from >= 0 ? (layouts.current[items[from].key]?.h ?? 0) : 0;

  return (
    <View>
      {items.map((item, index) => {
        const dragging = drag?.key === item.key;
        const translateY = dragging ? drag.dy : drag ? shiftFor(index, from, to, draggedHeight) : 0;
        return (
          <Row
            key={item.key}
            rowKey={item.key}
            onLayout={handleLayout}
            onStart={handleStart}
            onMove={handleMove}
            onEnd={handleEnd}
            translateY={translateY}
            dragging={dragging}
            background={background}>
            {(handlers) => renderItem(item, index, { handlers, dragging })}
          </Row>
        );
      })}
    </View>
  );
}
