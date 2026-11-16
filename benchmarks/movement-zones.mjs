import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { movementThreshold } from "../module/movement/movement-tracker.mjs";
import { movementScenario } from "../tests/helpers/movement-zones-scenarios.mjs";

// Comparer à portée égale d'une M ; l'ancien moteur reste une référence historique.
function compile(url) {
  let source = readFileSync(url, "utf8").replace(/import[^;]+;/g, "").replace("export class", "class");
  if (source.includes("queue.sort")) source = source.replace("queue.sort((a, b) => b.cost - a.cost);",
    "const queueStart = performance.now(); queue.sort((a, b) => b.cost - a.cost); this.queueMs = (this.queueMs ?? 0) + performance.now() - queueStart;");
  else source = source.replace("const current = queue.pop();", "const queueStart = performance.now(); const current = queue.pop(); this.queueMs = (this.queueMs ?? 0) + performance.now() - queueStart;")
    .replace("queue.push(next);", "const pushStart = performance.now(); queue.push(next); this.queueMs = (this.queueMs ?? 0) + performance.now() - pushStart;");
  const context = vm.createContext({ movementThreshold, performance });
  vm.runInContext(source + "\nglobalThis.Engine = MovementZones;", context);
  return context.Engine;
}
const ReferenceZones = compile(new URL("./reference/movement-zones-step1.mjs", import.meta.url));
const MovementZones = compile(new URL("../module/movement/movement-zones.mjs", import.meta.url));
const scenarios = [
  { name: "open-1M", kind: "open", cells: 5 },
  { name: "open-1M-10cells", kind: "open", cells: 10 },
  { name: "walls-1M", kind: "walls", cells: 5 },
  { name: "corridor-1M", kind: "corridor", cells: 5 },
  { name: "alternating-1M", kind: "walls", cells: 5, alternating: true },
  { name: "large-open-1M", kind: "open", cells: 24 }
];
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const result = [];
for (const spec of scenarios) {
  const row = { scenario: spec.name };
  for (const [name, Engine] of [["before", ReferenceZones], ["after", MovementZones]]) {
    const samples = [];
    for (let iteration = 0; iteration < 6; iteration++) {
      const env = movementScenario(Engine, spec), began = performance.now();
      const range = Engine === ReferenceZones ? { ...env.range, actions: 1 } : env.range;
      const outcome = await env.zones.toggle(env.token, env.state, range);
      const duration = performance.now() - began;
      if (iteration > 0) samples.push({ duration, nativeMs: env.profile.constrainMs + env.profile.measureMs, queueMs: env.zones.queueMs ?? null });
      if (iteration === 5) row[name] = { success: outcome.success, reason: outcome.reason ?? "Done", ...env.zones.stats,
        hash: createHash("sha256").update(JSON.stringify(env.markers())).digest("hex") };
      env.zones.clear();
    }
    Object.assign(row[name], { medianMs: median(samples.map(x => x.duration)), nativeMs: median(samples.map(x => x.nativeMs)), queueMs: samples[0].queueMs === null ? null : median(samples.map(x => x.queueMs)) });
  }
  if (row.before.reason === "Limit" && row.after.success) {
    const expanded = movementScenario(ReferenceZones, spec);
    await expanded.zones.toggle(expanded.token, expanded.state, { ...expanded.range, actions: 1 }, () => {
      if (expanded.zones.stats) { expanded.zones.stats.maximumStates = 50000; expanded.zones.stats.maximumTransitions = 400000; }
    });
    row.referenceExpanded = { ...expanded.zones.stats,
      hash: createHash("sha256").update(JSON.stringify(expanded.markers())).digest("hex") };
    expanded.zones.clear();
  }
  result.push(row);
}
const report = { scope: "Une action M ; référence historique à portée identique", environment: `Node ${process.version}; API et rendu simulés; une chauffe puis cinq mesures; aucune attente navigateur`, result };
writeFileSync(new URL("./movement-zones-single-action-results.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
for (const row of result) console.log(JSON.stringify({ scenario: row.scenario,
  beforeMs: Math.round(row.before.medianMs * 10) / 10, afterMs: Math.round(row.after.medianMs * 10) / 10,
  sortMs: Math.round(row.before.queueMs * 10) / 10, nativeMs: Math.round(row.before.nativeMs * 10) / 10,
  states: [row.before.states, row.after.states], transitions: [row.before.examined, row.after.examined], marked: [row.before.marked, row.after.marked],
  identical: (row.referenceExpanded?.hash ?? row.before.hash) === row.after.hash, afterReason: row.after.reason }));
