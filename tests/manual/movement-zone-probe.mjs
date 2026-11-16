import { MovementTracker } from "../../module/movement/movement-tracker.mjs";

/** Sonde volontaire, limitée au prochain moveToken du token sélectionné. */
export function captureNextMovement() {
  const token = globalThis.canvas?.tokens?.controlled?.[0]?.document;
  if (!token?.object || canvas.tokens.controlled.length !== 1) throw Error("Sélectionner un seul token.");
  const tracker = new MovementTracker({ readMovement: () => ({ cells: 1 }) });
  if (!tracker.start(token).success) throw Error("Impossible de démarrer la sonde.");
  const history = token.movementHistory.map(point => ({ ...point }));
  const rows = path => path.map(point => ({ x: point.x, y: point.y, elevation: point.elevation,
    width: point.width, height: point.height, action: point.action, cost: point.cost,
    intermediate: point.intermediate, terrain: point.terrain?.toObject?.() ?? point.terrain ?? null }));
  const result = { report: null, stop: () => { Hooks.off("moveToken", listener); tracker.cancel(token); } };
  const listener = (document, movement) => {
    if (document !== token) return;
    const report = { scene: token.parent.id, token: token.id, action: token.movementAction,
      gridDistance: token.parent.grid.distance, history: rows(history), origin: movement.origin,
      actualPassed: rows(movement.passed.waypoints), actualPassedCost: movement.passed.cost };
    try {
      const tracked = tracker.update(token, movement);
      report.tracker = tracked.state;
      const path = [{ ...movement.origin, action: movement.passed.waypoints[0]?.action ?? token.movementAction },
        ...movement.passed.waypoints.filter(point => !point.intermediate).map(point => {
          const { cost, terrain, ...native } = point; return native;
        })];
      const regional = token.object.createTerrainMovementPath(path, { preview: false });
      const [checked] = token.object.constrainMovementPath(regional,
        { preview: false, history: false, ignoreWalls: false, ignoreCost: false });
      const completed = token.getCompleteMovementPath(checked);
      const final = completed.map(point => { const { cost, ...native } = point; return native; });
      const measurement = token.object.measureMovementPath(final, { preview: false });
      Object.assign(report, { path: rows(path), regional: rows(regional), checked: rows(checked), final: rows(final),
        zoneCandidateCost: measurement.cost, zoneCandidateCells: measurement.cost / report.gridDistance,
        measurement: { cost: measurement.cost, distance: measurement.distance, spaces: measurement.spaces,
          diagonals: measurement.diagonals, waypoints: measurement.waypoints.map(point => ({ cost: point.cost,
            backwardCost: point.backward?.cost ?? null })) },
        differenceFromTracker: measurement.cost - tracked.state?.cost });
    } catch (error) { report.error = String(error?.stack ?? error); }
    finally { result.report = report; result.stop(); console.log("CO2 Prism — comparaison native", report); }
  };
  Hooks.on("moveToken", listener);
  return result;
}
