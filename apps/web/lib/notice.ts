/**
 * A one-line notice that outlives the button that raised it: confirming a matured deposit removes its row, so the sentence
 * saying what happened cannot live in the row. A tiny store read by <NoticeHost/>; nothing here touches the server.
 */
export interface Notice {
  id: number;
  text: string;
}

let current: Notice | null = null;
let seq = 0;
const listeners = new Set<() => void>();

export function showNotice(text: string): void {
  current = { id: ++seq, text };
  listeners.forEach((l) => l());
}

export function clearNotice(): void {
  current = null;
  listeners.forEach((l) => l());
}

export function subscribeNotice(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export const getNotice = (): Notice | null => current;
