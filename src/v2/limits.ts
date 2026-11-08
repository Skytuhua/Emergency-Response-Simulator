/** Independent V2 import/export profile; legacy V1 limits remain unchanged. */
export const V2_LIMITS = Object.freeze({
  bytes: 32 * 1024 * 1024,
  commands: 20_000,
  traceEvents: 100_000,
  arrayLength: 100_000,
  nestingDepth: 40,
  nodes: 1_000_000,
  textLength: 262_144,
  ancestry: 32,
});
export const MAX_RUN_BYTES_V2 = V2_LIMITS.bytes;
export const MAX_COMMANDS_V2 = V2_LIMITS.commands;
export const MAX_TRACE_EVENTS_V2 = V2_LIMITS.traceEvents;

/** Checks counts and JSON primitives before canonicalization or replay expansion. */
export function assertV2Structure(value: unknown): void {
  let nodes = 0;
  const ancestors = new Set<object>();
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > V2_LIMITS.nodes || depth > V2_LIMITS.nestingDepth) throw new Error('V2 data structure exceeds supported limits.');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Error('V2 data requires finite numbers.');
      return;
    }
    if (typeof item === 'string') {
      if (item.length > V2_LIMITS.textLength) throw new Error('V2 text exceeds supported limits.');
      return;
    }
    if (typeof item !== 'object' || !Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) throw new Error('V2 data requires plain JSON values.');
    if (ancestors.has(item)) throw new Error('V2 data cannot contain cycles.');
    ancestors.add(item);
    if (Array.isArray(item)) {
      if (item.length > V2_LIMITS.arrayLength) throw new Error('V2 array exceeds supported limits.');
      for (const child of item) visit(child, depth + 1);
    } else {
      for (const [key, child] of Object.entries(item)) {
        if (key.length > V2_LIMITS.textLength) throw new Error('V2 key exceeds supported limits.');
        visit(child, depth + 1);
      }
    }
    ancestors.delete(item);
  };
  visit(value, 0);
}
