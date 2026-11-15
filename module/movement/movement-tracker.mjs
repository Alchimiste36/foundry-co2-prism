const MODES = ["free", "exact"];
const POSITION_FIELDS = ["x", "y", "elevation", "width", "height", "depth", "shape", "level"];
const position = token => Object.fromEntries(POSITION_FIELDS.filter(key => token[key] !== undefined).map(key => [key, token[key]]));
const validPosition = point => [point?.x, point?.y, point?.elevation ?? 0].every(Number.isFinite);
const samePosition = (a, b) => POSITION_FIELDS.every(key => a[key] === b[key]);
const history = token => Array.from(token.movementHistory ?? [], point => ({ ...position(point),
  movementId: point.movementId, subpathId: point.subpathId, action: point.action, cost: point.cost }));
const keyOf = token => JSON.stringify([token?.parent?.id, token?.id]);
const inMotion = token => ["pending", "paused", "planned"].includes(token?.movement?.state);
const failure = reason => ({ success: false, reason });

/** Arrondi partagé avec l'affichage : les mesures brutes restent intactes. */
export function roundMovementCells(number, mode = "nearest") {
  if (!Number.isFinite(number) || number < 0) return null;
  const integer = Math.round(number);
  // Corriger seulement le bruit flottant autour d'un entier théorique.
  if (Math.abs(number - integer) <= Number.EPSILON * 8 * Math.max(1, number)) number = integer;
  return (mode === "up" ? Math.ceil : mode === "down" ? Math.floor : Math.round)(number);
}

/** Seuil cumulé, sans arrondir la vitesse d'une action isolée. */
export function movementThreshold(cellsPerActionRaw, count, rounding) {
  if (!Number.isFinite(cellsPerActionRaw) || cellsPerActionRaw <= 0 || !Number.isSafeInteger(count) || count < 0) return null;
  return roundMovementCells(count * cellsPerActionRaw, rounding);
}

function requiredMovementActions(cellsPerActionRaw, used, rounding) {
  if (!Number.isFinite(cellsPerActionRaw) || cellsPerActionRaw <= 0 || !Number.isSafeInteger(used) || used < 0) return null;
  if (used === 0) return 0;
  const reaches = count => {
    const product = count * cellsPerActionRaw;
    return product === Infinity || movementThreshold(cellsPerActionRaw, count, rounding) >= used;
  };
  let low = 0, high = Number.MAX_SAFE_INTEGER;
  if (!reaches(high)) return null;
  // Au plus 53 étapes, même si plusieurs actions ont un bloc de zéro case.
  while (low + 1 < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (reaches(middle)) high = middle;
    else low = middle;
  }
  return high;
}

/** Sessions locales par scène/token. Toutes les commandes renvoient {success, reason, state?}. */
export class MovementTracker {
  constructor({ getUser = () => globalThis.game?.user, readMovement = () => null,
    getRounding = () => globalThis.game?.settings?.get("co2prism", "movementRounding") } = {}) {
    this.sessions = new Map();
    this.serial = 0;
    this.getUser = getUser;
    this.readMovement = readMovement;
    this.getRounding = getRounding;
  }

  #exists(token) {
    return Boolean(token?.id && token.parent?.id && token.parent.tokens?.get(token.id) === token);
  }

  #session(token) {
    const session = this.sessions.get(keyOf(token));
    return session?.token === token ? session : null;
  }

  start(token, mode = "exact") {
    if (!this.#exists(token) || !validPosition(token)) return failure("invalid-token");
    const user = this.getUser();
    if (!user || !(user.isGM || token.testUserPermission?.(user, "OBSERVER"))) return failure("forbidden");
    if (!MODES.includes(mode)) return failure("invalid-mode");
    if (this.#session(token)) return failure("already-active");
    if (inMotion(token)) return failure("movement-in-progress");
    this.sessions.set(keyOf(token), { id: ++this.serial, token, scene: token.parent, mode, start: position(token),
      reference: history(token), segments: [], seen: new Set(), distance: 0, spaces: 0, cost: 0,
      measureReason: null, resetting: false });
    return this.getSnapshot(token);
  }

  getSnapshot(token) {
    const session = this.#session(token);
    if (!session) return failure("no-session");
    const grid = session.scene.grid;
    const reason = !this.#exists(token) ? "invalid-token" : session.measureReason
      ?? (!(Number.isInteger(grid?.type) && grid.type > 0 && Number.isFinite(grid.distance) && grid.distance > 0)
        ? "grid-unavailable" : null);
    let movement = null;
    try { movement = this.readMovement(token); } catch { /* Donnée native indisponible. */ }
    const rounding = this.getRounding();
    const cellsUsed = reason ? null : roundMovementCells(session.spaces, rounding);
    const cellsPerActionRaw = movement?.cells ?? null;
    const cellsPerAction = movementThreshold(cellsPerActionRaw, 1, rounding);
    const theoreticalActions = requiredMovementActions(cellsPerActionRaw, cellsUsed, rounding);
    const gridSignature = JSON.stringify([grid?.type, grid?.distance, grid?.units, grid?.size, grid?.diagonals, grid?.orientation]);
    return { success: true, reason: null, state: {
      active: true, sessionId: session.id, sceneId: session.scene.id, tokenId: token.id, mode: session.mode,
      start: { ...session.start }, current: position(token), reference: structuredClone(session.reference),
      distance: session.distance, spaces: session.spaces, cost: session.cost,
      units: grid?.units ?? null, measurementValid: reason === null, measurementReason: reason,
      cellsUsed, cellsPerActionRaw, cellsPerAction, rounding, gridSignature,
      theoreticalActions, segmentCount: session.segments.length,
      resetting: session.resetting
    } };
  }

  setMode(token, mode) {
    const session = this.#session(token);
    if (!session) return failure("no-session");
    if (!MODES.includes(mode)) return failure("invalid-mode");
    session.mode = mode;
    return this.getSnapshot(token);
  }

  /** moveToken(document, movement, operation, user) : uniquement les sections déjà passées. */
  update(token, movement) {
    const session = this.#session(token);
    if (!session) return failure("no-session");
    if (session.resetting) return { success: true, reason: "reset-movement-ignored" };
    if (!this.#exists(token)) return failure("invalid-token");
    const passed = movement?.passed;
    if (!movement?.id || !Array.isArray(passed?.waypoints) || !validPosition(movement.origin)
      || !passed.waypoints.every(validPosition)) {
      session.measureReason = "invalid-movement"; return failure("invalid-movement");
    }
    if (!passed.waypoints.length) return { success: true, reason: "no-passed-section" };
    const signature = JSON.stringify([movement.id, position(movement.origin), passed.waypoints.map(position),
      movement.history?.distance, movement.history?.spaces, movement.pending?.waypoints?.map(position)]);
    if (session.seen.has(signature)) return { success: true, reason: "already-counted" };
    session.seen.add(signature);
    // Distance et espaces natifs tiennent compte des diagonales, tailles et actions de téléportation.
    const valid = [passed.distance, passed.spaces].every(value => Number.isFinite(value) && value >= 0);
    if (!valid) session.measureReason = "measurement-unavailable";
    else {
      session.distance += passed.distance;
      session.spaces += passed.spaces;
      session.cost = Number.isFinite(passed.cost) && passed.cost >= 0 && session.cost !== null ? session.cost + passed.cost : null;
      if (![session.distance, session.spaces].every(Number.isFinite)) session.measureReason = "measurement-unavailable";
    }
    session.segments.push({ id: movement.id, method: movement.method, origin: position(movement.origin),
      waypoints: passed.waypoints.map(position), distance: passed.distance, spaces: passed.spaces, cost: passed.cost });
    return this.getSnapshot(token);
  }

  /** recordToken ne débite aucun trajet : ce hook précède moveToken et peut seulement effacer l'historique. */
  refresh(token) { return this.getSnapshot(token); }

  async reset(token) {
    const session = this.#session(token);
    if (!session) return failure("no-session");
    if (session.resetting || inMotion(token)) return failure("movement-in-progress");
    if (!this.#exists(token)) return failure("invalid-token");
    if (!this.getUser() || !token.canUserModify?.(this.getUser(), "update")) return failure("forbidden");
    session.resetting = true;
    try {
      const recorded = history(token), reference = session.reference;
      const prefixMatches = JSON.stringify(recorded.slice(0, reference.length)) === JSON.stringify(reference);
      const index = reference.length;
      const first = recorded[index];
      const before = recorded[Math.max(0, index - 1)];
      // Revert ne doit retirer que les mouvements postérieurs au point de départ.
      const safe = prefixMatches && first?.movementId && before && samePosition(position(before), session.start)
        && !reference.some(point => point.movementId === first.movementId);
      let returned;
      if (safe && typeof token.revertRecordedMovement === "function") returned = await token.revertRecordedMovement(first.movementId);
      else returned = await token.update({ ...session.start, action: "displace" }, { animate: false });
      if (!returned || !samePosition(position(token), session.start) || this.#session(token) !== session) return failure("return-failed");
      session.reference = history(token);
      session.segments = []; session.seen.clear();
      session.distance = session.spaces = session.cost = 0; session.measureReason = null;
      session.resetting = false;
      return this.getSnapshot(token);
    } catch { return failure("return-failed"); }
    finally { session.resetting = false; }
  }

  finish(token) {
    const session = this.#session(token);
    if (!session) return failure("no-session");
    if (session.resetting || inMotion(token)) return failure("movement-in-progress");
    const result = this.getSnapshot(token);
    result.state.active = false;
    this.sessions.delete(keyOf(token));
    return result;
  }

  cancel(token) {
    const session = this.#session(token);
    if (!session) return failure("no-session");
    if (session.resetting) return failure("movement-in-progress");
    this.sessions.delete(keyOf(token));
    return { success: true, reason: null };
  }

  deleteToken(token) { if (this.#session(token)) this.sessions.delete(keyOf(token)); }
  closeScene(scene) {
    for (const [key, session] of this.sessions) if (session.scene === scene) this.sessions.delete(key);
  }
}
