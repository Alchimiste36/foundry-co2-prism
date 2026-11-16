import { movementThreshold } from "../../module/movement/movement-tracker.mjs";

/** Zone locale : exploration adjacente bornée par les seuils M capturés au clic. */
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
    const { cellsPerActionRaw, rounding, actions } = range ?? {};
    if (!Number.isFinite(cellsPerActionRaw) || cellsPerActionRaw <= 0 || !Number.isSafeInteger(actions) || actions < 0
      || !["nearest", "up", "down"].includes(rounding)) {
      this.token = token; this.sessionId = state.sessionId; this.diagnostic = "InvalidRange"; onUpdate();
      return { success: false, reason: "InvalidRange" };
    }
    // Borner aussi la préparation des seuils avant l'étape dédiée aux grandes portées.
    if (actions > 4000) {
      this.token = token; this.sessionId = state.sessionId; this.diagnostic = "Limit"; onUpdate();
      return { success: false, reason: "Limit" };
    }
    const thresholds = Array.from({ length: actions }, (_, index) => movementThreshold(cellsPerActionRaw, index + 1, rounding));
    if (thresholds.some((value, index) => !Number.isSafeInteger(value) || value < 0 || (index > 0 && value < thresholds[index - 1]))) {
      this.token = token; this.sessionId = state.sessionId; this.diagnostic = "InvalidRange"; onUpdate();
      return { success: false, reason: "InvalidRange" };
    }
    const maxCost = thresholds.at(-1) ?? 0;
    this.range = { cellsPerActionRaw, rounding, actions, thresholds: [...thresholds], maxCost };
    const canvas = this.getCanvas(), grid = canvas.grid, PIXI = this.getPIXI();
    const generation = this.generation;
    const start = { ...state.start, action: token.movementAction };
    this.token = token; this.sessionId = state.sessionId; this.visible = true; this.busy = true;
    try { this.container = canvas.interface.addChild(new PIXI.Container()); }
    catch { this.clear(); this.diagnostic = "Unavailable"; onUpdate(); return { success: false, reason: "Unavailable" }; }
    this.container.eventMode = "none"; this.container.interactiveChildren = false;
    const container = this.container, began = this.now();
    const stats = this.stats = { examined: 0, states: 0, marked: 0, partial: 0, elapsedMs: 0, maxCost, actions,
      maximumStates: 4000, maximumTransitions: 32000 };
    const active = () => generation === this.generation && this.visible && this.container === container
      && canvas === this.getCanvas() && token.parent === canvas.scene && canvas.scene.tokens.get(token.id) === token;
    const matches = (point, expected) => point && ["x", "y", "elevation"].every(key => point[key] === expected[key]);
    onUpdate();
    try {
      const origin = grid.getOffset(start), epsilon = 1e-8;
      const stateKey = node => `${node.i},${node.j},${node.parity},${node.offsetX},${node.offsetY}`;
      const first = { ...origin, cost: 0, path: [start], parity: 0, offsetX: 0, offsetY: 0 };
      const queue = [first], bestStates = new Map([[stateKey(first), 0]]), bestCells = new Map();
      const options = { preview: false, history: false, ignoreWalls: false, ignoreCost: false };
      while (queue.length && maxCost > 0) {
        queue.sort((a, b) => b.cost - a.cost);
        const current = queue.pop();
        if (current.cost > bestStates.get(stateKey(current)) + epsilon) continue;
        if (++stats.states > stats.maximumStates) throw Error("Exploration limit");
        for (const offset of grid.getAdjacentOffsets({ i: current.i, j: current.j })) {
          if (!active()) return { success: false, reason: "cancelled" };
          const { i, j } = offset, di = i - current.i, dj = j - current.j;
          if (![i, j].every(Number.isSafeInteger) || Math.max(Math.abs(di), Math.abs(dj)) !== 1) throw Error("Invalid adjacency");
          const corner = grid.getTopLeftPoint(offset), center = grid.getCenterPoint(offset);
          if (!canvas.dimensions?.rect?.contains(center.x, center.y)) continue;
          const destination = { ...start, x: corner.x, y: corner.y };
          if (++stats.examined > stats.maximumTransitions) throw Error("Exploration limit");
          if (stats.examined % 32 === 0) await this.yieldFrame();
          if (!active()) return { success: false, reason: "cancelled" };
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
          }
          if ((i !== origin.i || j !== origin.j) && cost + epsilon < (bestCells.get(`${i},${j}`)?.cost ?? Infinity)) bestCells.set(`${i},${j}`, { center, cost });
          stats.elapsedMs = Math.round(this.now() - began);
        }
      }
      if (!active()) return { success: false, reason: "cancelled" };
      for (const { center, cost } of bestCells.values()) {
        const number = thresholds.findIndex(threshold => cost <= threshold + epsilon) + 1;
        const label = new PIXI.Text(String(number), { fontFamily: "Arial", fontSize: Math.max(14, grid.size * 0.3),
          fontWeight: "bold", fill: number === 1 ? 0xffe100 : 0xff2438, stroke: 0x000000, strokeThickness: 3 });
        label.anchor.set(0.5); label.position.set(center.x, center.y); label.eventMode = "none";
        container.addChild(label); stats.marked++;
      }
      this.busy = false; stats.elapsedMs = Math.round(this.now() - began); this.diagnostic = "Done"; onUpdate();
      return { success: true, visible: true, stats: { ...stats } };
    } catch (error) {
      if (generation !== this.generation) return { success: false, reason: "cancelled" };
      const diagnostic = error.message === "Exploration limit" ? "Limit" : error.message.startsWith("Unsupported") ? "Unsupported" : "Unavailable";
      const finalStats = { ...stats, elapsedMs: Math.round(this.now() - began) };
      this.clear(); this.token = token; this.sessionId = state.sessionId; this.diagnostic = diagnostic; this.stats = finalStats; onUpdate();
      return { success: false, reason: diagnostic, stats: finalStats };
    }
  }
}
