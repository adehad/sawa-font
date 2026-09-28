/** How far down its scroll range an element is, from 0 to 1; 0 when it can't scroll. */
export function scrollRatio(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const range = scrollHeight - clientHeight;
  return range > 0 ? Math.min(1, Math.max(0, scrollTop / range)) : 0;
}

/** The scrollTop that puts an element at `ratio` of its own scroll range. */
export function scrollTopFor(ratio: number, scrollHeight: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - clientHeight) * ratio;
}

/**
 * Keeps `columns` scrolled to the same proportion of their own heights.
 * Scroll events caused by the sync itself are recognised by the position
 * they were sent to and ignored, so columns never echo each other. Returns
 * a function that removes the listeners.
 */
export function syncScroll(columns: readonly HTMLElement[]): () => void {
  const pending = new WeakMap<HTMLElement, number>();
  const handlers = columns.map((column) => {
    const handler = (): void => {
      const expected = pending.get(column);
      if (expected !== undefined) {
        pending.delete(column);
        if (Math.abs(column.scrollTop - expected) <= 1) {
          return;
        }
      }
      const ratio = scrollRatio(column.scrollTop, column.scrollHeight, column.clientHeight);
      for (const other of columns) {
        if (other === column) {
          continue;
        }
        const target = scrollTopFor(ratio, other.scrollHeight, other.clientHeight);
        if (Math.abs(other.scrollTop - target) > 1) {
          pending.set(other, target);
          other.scrollTop = target;
          // Scroll events fire before the next frame's callbacks, so an entry
          // still here then belongs to a scroll that never happened.
          requestAnimationFrame(() => {
            if (pending.get(other) === target) {
              pending.delete(other);
            }
          });
        }
      }
    };
    column.addEventListener("scroll", handler, { passive: true });
    return handler;
  });
  return () => {
    columns.forEach((column, index) => {
      const handler = handlers[index];
      if (handler) {
        column.removeEventListener("scroll", handler);
      }
    });
  };
}
