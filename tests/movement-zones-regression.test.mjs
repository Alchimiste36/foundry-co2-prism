import test from "node:test";
import assert from "node:assert/strict";
import { MovementZones } from "../module/movement/movement-zones.mjs";
import { MovementZones as ReferenceZones } from "../benchmarks/reference/movement-zones-step1.mjs";
import { movementScenario } from "./helpers/movement-zones-scenarios.mjs";

for (const spec of [
  { kind: "open", cells: 5 }, { kind: "open", cells: 10 },
  { kind: "walls", cells: 5 }, { kind: "corridor", cells: 5 },
  { kind: "walls", cells: 5, alternating: true }, { kind: "open", cells: 24 }
]) {
  test(`zones identiques à la référence : ${JSON.stringify(spec)}`, async () => {
    const reference = movementScenario(ReferenceZones, spec), current = movementScenario(MovementZones, spec);
    // Pour la grande portée, comparer l'algorithme complet de référence, sans son ancien plafond trop bas.
    const before = await reference.zones.toggle(reference.token, reference.state, { ...reference.range, actions: 1 }, () => {
      if (reference.zones.stats) { reference.zones.stats.maximumStates = 50000; reference.zones.stats.maximumTransitions = 400000; }
    });
    const after = await current.zones.toggle(current.token, current.state, current.range);
    assert.equal(before.success, true); assert.equal(after.success, true);
    assert.deepEqual(current.markers().filter(marker => marker[3] === 0x357cbb).map(marker => marker.slice(0, 2)), reference.markers().map(marker => marker.slice(0, 2)));
    assert.equal(current.zones.stats.states, reference.zones.stats.states);
    assert.equal(current.zones.stats.examined, reference.zones.stats.examined);
    if (spec.cells === 24) assert.ok(current.zones.stats.states > 4000);
    reference.zones.clear(); current.zones.clear();
  });
}
