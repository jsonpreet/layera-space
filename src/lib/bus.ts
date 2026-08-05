type OutputHandler = (b64: string) => void;

const handlers = new Map<string, Set<OutputHandler>>();
let tap: ((ptyId: string) => void) | null = null;

export function tapPtyOutput(fn: (ptyId: string) => void) {
  tap = fn;
}

export function subscribePtyOutput(id: string, h: OutputHandler): () => void {
  let set = handlers.get(id);
  if (!set) {
    set = new Set();
    handlers.set(id, set);
  }
  set.add(h);
  return () => {
    set!.delete(h);
    if (set!.size === 0) handlers.delete(id);
  };
}

export function publishPtyOutput(id: string, b64: string) {
  tap?.(id);
  handlers.get(id)?.forEach((h) => h(b64));
}
