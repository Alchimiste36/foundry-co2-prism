import { movementThreshold } from "./movement-tracker.mjs";

/** Tas minimal ; à coût égal, conserver l'ordre de visite de l'ancienne file triée. */
class MovementZoneQueue {
  constructor(first) { this.items = []; this.serial = 0; this.push(first); }
  get length() { return this.items.length; }
  before(a, b) { return a.cost < b.cost || (a.cost === b.cost && a.queueOrder > b.queueOrder); }
  push(node) {
    node.queueOrder = this.serial++;
    const items = this.items;
    let index = items.length; items.push(node);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.before(node, items[parent])) break;
      items[index] = items[parent]; index = parent;
    }
    items[index] = node;
  }
  pop() {
    const items = this.items, first = items[0], last = items.pop();
    if (items.length) {
      let index = 0;
      while (index * 2 + 1 < items.length) {
        let child = index * 2 + 1;
        if (child + 1 < items.length && this.before(items[child + 1], items[child])) child++;
        if (!this.before(items[child], last)) break;
        items[index] = items[child]; index = child;
      }
      items[index] = last;
    }
    return first;
  }
}

/** Zone locale : exploration adjacente bornée par une M capturée au clic. */
export class MovementZones {
  constructor({ getCanvas = () => globalThis.canvas, getPIXI = () => globalThis.PIXI,
    getAction = action => globalThis.CONFIG?.Token?.movement?.actions?.[action],
    now = () => performance.now(), yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
    Object.assign(this, { getCanvas, getPIXI, getAction, now, yieldFrame });
    this.generation = 0; this.visible = false; this.busy = false; this.diagnostic = null;
  }

  supported(token, start) {
    try {
    const canvas = this.getCanvas(), object = token?.object, grid = canvas?.grid;
    if (!canvas?.ready || token?.parent !== canvas.scene || canvas.scene?.tokens?.get(token.id) !== token
      || !start || ![start.x, start.y, start.elevation].every(Number.isFinite)) return "Unavailable";
    if (canvas.scene.grid?.type !== 1 || start.width !== 1 || start.height !== 1 || canvas.scene.regions?.size > 0
      || (canvas.level?.id && start.level !== canvas.level.id)) return "Unsupported";
    if (!["constrainMovementPath", "measureMovementPath"].every(key => typeof object?.[key] === "function")
      || !["getOffset", "getTopLeftPoint", "getCenterPoint", "getAdjacentOffsets"].every(key => typeof grid?.[key] === "function")
      || !canvas.interface?.addChild || typeof canvas.dimensions?.rect?.contains !== "function"
      || !(Number.isFinite(grid.size) && grid.size > 0 && Number.isFinite(grid.distance) && grid.distance > 0)
      || !this.getPIXI()?.Container || !this.getPIXI()?.Text) return "Unavailable";
    const action = this.getAction(token.movementAction);
    if (!action?.walls || action.teleport || action.measure === false) return "Unsupported";
    const offset = grid.getOffset(start);
    if (![offset.i, offset.j].every(Number.isSafeInteger)) return "Unavailable";
    const corner = grid.getTopLeftPoint(offset);
    if (corner.x !== start.x || corner.y !== start.y) return "Unsupported";
    return null;
    } catch { return "Unavailable"; }
  }

  clear() {
    this.generation++; this.visible = false; this.busy = false;
    if (this.container && !this.container.destroyed) {
      this.container.parent?.removeChild(this.container); this.container.destroy({ children: true });
    }
    this.container = null; this.token = null; this.sessionId = null; this.diagnostic = null; this.stats = null; this.range = null;
  }

  sync(token, state, open) {
    if (this.token && (!open || this.token !== token || this.sessionId !== state?.sessionId
      || token?.parent !== this.getCanvas()?.scene)) this.clear();
  }

  async toggle(token, state, range, onUpdate = () => {}) {
    if (this.visible) { this.clear(); onUpdate(); return { success: true, visible: false }; }
    this.clear();
    const unsupported = this.supported(token, state?.start);
    if (unsupported) {
      this.token = token; this.sessionId = state?.sessionId;
      this.diagnostic = unsupported; onUpdate(); return { success: false, reason: unsupported };
    }
    const { cellsPerActionRaw, rounding } = range ?? {};
    if (!Number.isFinite(cellsPerActionRaw) || cellsPerActionRaw <= 0
      || !["nearest", "up", "down"].includes(rounding)) {
      this.token = token; this.sessionId = state.sessionId; this.diagnostic = "InvalidRange"; onUpdate();
      return { success: false, reason: "InvalidRange" };
    }
    const maxCost = movementThreshold(cellsPerActionRaw, 1, rounding);
    if (!Number.isSafeInteger(maxCost) || maxCost < 0) {
      this.token = token; this.sessionId = state.sessionId; this.diagnostic = "InvalidRange"; onUpdate();
      return { success: false, reason: "InvalidRange" };
    }
    this.range = { cellsPerActionRaw, rounding, maxCost };
    const canvas = this.getCanvas(), grid = canvas.grid, PIXI = this.getPIXI();
    const generation = this.generation;
    const start = { ...state.start, action: token.movementAction };
    this.token = token; this.sessionId = state.sessionId; this.visible = true; this.busy = true;
    try { this.container = canvas.interface.addChild(new PIXI.Container()); }
    catch { this.clear(); this.diagnostic = "Unavailable"; onUpdate(); return { success: false, reason: "Unavailable" }; }
    this.container.eventMode = "none"; this.container.interactiveChildren = false;
    this.container.visible = false;
    const container = this.container, scene = token.parent, sessionId = state.sessionId, began = this.now();
    const maximumStates = Math.max(4000, Math.min(50000, 18 * (2 * Math.ceil(maxCost) + 1) ** 2));
    const stats = this.stats = { examined: 0, states: 0, marked: 0, partial: 0, elapsedMs: 0, maxCost,
      maximumStates, maximumTransitions: maximumStates * 8, maximumMs: 15000, yields: 0,
      popped: 0, stale: 0, peakQueue: 1, stopReason: null };
    const active = () => generation === this.generation && this.visible && this.container === container
      && !container.destroyed && this.sessionId === sessionId && canvas === this.getCanvas() && canvas.ready
      && token.parent === scene && canvas.scene === scene && scene.tokens.get(token.id) === token;
    const cancelled = () => {
      const finalStats = { ...stats, elapsedMs: Math.round(this.now() - began), stopReason: "cancelled" };
      if (generation === this.generation && this.container === container) { this.clear(); onUpdate(); }
      return { success: false, reason: "cancelled", stats: finalStats };
    };
    const matches = (point, expected) => point && ["x", "y", "elevation"].every(key => point[key] === expected[key]);
    onUpdate();
    try {
      let sliceStarted = this.now(), lastYield = 0;
      const cooperate = count => {
        const time = this.now();
        if (time - began > stats.maximumMs) throw Error("Exploration time limit");
        if (count - lastYield >= 128 || time - sliceStarted >= 8) {
          stats.elapsedMs = Math.round(time - began); stats.yields++;
          return Promise.resolve(this.yieldFrame()).then(() => { lastYield = count; sliceStarted = this.now(); });
        }
      };
      const origin = grid.getOffset(start), epsilon = 1e-8;
      const stateKey = node => `${node.i},${node.j},${node.parity},${node.offsetX},${node.offsetY}`;
      const first = { ...origin, cost: 0, path: [start], parity: 0, offsetX: 0, offsetY: 0 };
      const queue = new MovementZoneQueue(first), bestStates = new Map([[stateKey(first), 0]]), bestCells = new Map();
      const options = { preview: false, history: false, ignoreWalls: false, ignoreCost: false };
      while (queue.length && maxCost > 0) {
        const current = queue.pop();
        stats.popped++;
        if (current.cost > bestStates.get(stateKey(current)) + epsilon) { stats.stale++; continue; }
        if (++stats.states > stats.maximumStates) throw Error("Exploration limit");
        for (const offset of grid.getAdjacentOffsets({ i: current.i, j: current.j })) {
          if (!active()) return cancelled();
          const { i, j } = offset, di = i - current.i, dj = j - current.j;
          if (![i, j].every(Number.isSafeInteger) || Math.max(Math.abs(di), Math.abs(dj)) !== 1) throw Error("Invalid adjacency");
          const corner = grid.getTopLeftPoint(offset), center = grid.getCenterPoint(offset);
          if (!canvas.dimensions?.rect?.contains(center.x, center.y)) continue;
          const destination = { ...start, x: corner.x, y: corner.y };
          if (++stats.examined > stats.maximumTransitions) throw Error("Exploration limit");
          const pause = cooperate(stats.examined);
          if (pause) await pause;
          if (!active()) return cancelled();
          // Le chemin entier conserve l'approche des angles et l'alternance native des diagonales.
          const path = [...current.path, destination];
          const constrained = token.object.constrainMovementPath(path, options);
          if (!Array.isArray(constrained) || !Array.isArray(constrained[0])) throw Error("Invalid constrained path");
          const checked = constrained[0];
          if (checked.length < 2 || !matches(checked[0], start) || !matches(checked.at(-1), destination)) { stats.partial++; continue; }
          if (checked.length !== path.length || checked.some((point, index) => !matches(point, path[index]))) throw Error("Unsupported transition");
          const measurement = token.object.measureMovementPath(checked, { preview: false });
          if (measurement?.cost === Infinity) { stats.partial++; continue; }
          if (!Number.isFinite(measurement?.cost) || !Number.isSafeInteger(measurement.diagonals) || measurement.diagonals < 0) throw Error("Invalid path measurement");
          const cost = measurement.cost / grid.distance;
          // Les terrains à coût nul/réduit restent hors du prototype ; aucune exploration non bornée.
          if (cost - current.cost < 1 - epsilon) throw Error("Unsupported movement cost");
          if (cost > maxCost + epsilon) continue;
          const next = { i, j, cost, path: checked, parity: measurement.diagonals % 2,
            offsetX: dj ? Math.sign(dj) : current.offsetX, offsetY: di ? Math.sign(di) : current.offsetY };
          const key = stateKey(next);
          if (cost + epsilon < (bestStates.get(key) ?? Infinity)) {
            bestStates.set(key, cost); queue.push(next);
            stats.peakQueue = Math.max(stats.peakQueue, queue.length);
          }
          if ((i !== origin.i || j !== origin.j) && cost + epsilon < (bestCells.get(`${i},${j}`)?.cost ?? Infinity)) bestCells.set(`${i},${j}`, { center, cost });
        }
      }
      if (!active()) return cancelled();
      for (const { center } of bestCells.values()) {
        const pause = cooperate(stats.examined + stats.marked);
        if (pause) await pause;
        if (!active()) return cancelled();
        const label = new PIXI.Text("1", { fontFamily: "Arial", fontSize: Math.max(14, grid.size * 0.3),
          fontWeight: "bold", fill: 0xffe100, stroke: 0x000000, strokeThickness: 3 });
        label.anchor.set(0.5); label.position.set(center.x, center.y); label.eventMode = "none";
        container.addChild(label); stats.marked++;
      }
      this.busy = false; container.visible = true; stats.elapsedMs = Math.round(this.now() - began); stats.stopReason = "Done"; this.diagnostic = "Done"; onUpdate();
      return { success: true, visible: true, stats: { ...stats } };
    } catch (error) {
      if (generation !== this.generation) return cancelled();
      const message = String(error?.message ?? error);
      const diagnostic = message === "Exploration time limit" ? "TimeLimit" : message === "Exploration limit" ? "Limit" : message.startsWith("Unsupported") ? "Unsupported" : "Unavailable";
      const finalStats = { ...stats, elapsedMs: Math.round(this.now() - began), stopReason: diagnostic };
      this.clear(); this.token = token; this.sessionId = state.sessionId; this.diagnostic = diagnostic; this.stats = finalStats; onUpdate();
      return { success: false, reason: diagnostic, stats: finalStats };
    }
  }
}
