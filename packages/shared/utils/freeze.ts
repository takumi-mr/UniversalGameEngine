/**
 * Recursively applies Object.freeze to an object and its properties.
 * This is used to ensure immutability of the game state during the transition.
 */
export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    for (const item of obj) {
      deepFreeze(item);
    }
  } else {
    // Handle objects
    const propNames = Object.getOwnPropertyNames(obj);
    for (const name of propNames) {
      const value = (obj as any)[name];
      deepFreeze(value);
    }
  }

  return Object.freeze(obj);
}
