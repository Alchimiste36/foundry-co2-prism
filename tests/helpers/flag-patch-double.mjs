export class ForcedDeletion {}

export function mergeFlagPatch(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value instanceof ForcedDeletion) delete target[key];
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      const previous = target[key];
      if (!previous || typeof previous !== "object" || Array.isArray(previous)) target[key] = {};
      mergeFlagPatch(target[key], value);
    } else target[key] = structuredClone(value);
  }
}
