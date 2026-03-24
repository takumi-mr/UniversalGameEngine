/**
 * Interface for deep cloning a state object.
 */
export interface CloneStrategy<T> {
  clone(state: T): T;
}

/**
 * Strategy that clones an object using JSON.stringify and JSON.parse.
 * Note: This strategy loses functions, undefined values, and special types like Date or Map.
 */
export class JsonCloneStrategy<T> implements CloneStrategy<T> {
  clone(state: T): T {
    return JSON.parse(JSON.stringify(state));
  }
}

/**
 * Strategy that clones an object using the native structuredClone.
 * Requires a modern runtime (Node.js 17+, Deno, Bun, or modern browsers).
 */
export class StructuredCloneStrategy<T> implements CloneStrategy<T> {
  clone(state: T): T {
    return structuredClone(state);
  }
}
