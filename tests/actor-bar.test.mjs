import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import { measureRecordedPath } from "./helpers/native-movement-double.mjs";

const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]);

// Simuler les documents préparés, sans dépendre d'un monde Foundry lancé.
function setup() {
  const hooks = new Map();
  const context = vm.createContext({
    structuredClone,
    foundry: { utils: { escapeHTML, cleanHTML: value => value }, applications: { api: { DialogV2: { wait: async () => "validate" } } } },
    Hooks: { once(name, fn) { hooks.set(name, fn); }, on(name, fn) { hooks.set(name, fn); }, off(name, fn) { if (hooks.get(name) === fn) hooks.delete(name); } },
    game: { combats: { active: { started: true } }, user: {}, i18n: { localize: key => key === "CO2PRISM.Unavailable" ? "—" : key } },
    canvas: { ready: true, tokens: { controlled: [] } }
  });
  vm.runInContext('globalThis.ActionEconomy = (() => {' + readFileSync(new URL('../module/combat/action-economy.mjs', import.meta.url), 'utf8').replace('export class ActionEconomy', 'class ActionEconomy') + '; return ActionEconomy; })()', context);
  vm.runInContext(readFileSync(new URL("../module/movement/movement-tracker.mjs", import.meta.url), "utf8").replace(/export /g, ""), context);
  vm.runInContext(readFileSync(new URL("../module/movement/movement-notifications.mjs", import.meta.url), "utf8").replace(/export /g, ""), context);
  vm.runInContext(readFileSync(new URL("../module/movement/movement-zones.mjs", import.meta.url), "utf8").replace(/import[^;]+;/g, "").replace(/export /g, ""), context);
  vm.runInContext(readFileSync(new URL("../module/combat/defense.mjs", import.meta.url), "utf8").replace(/export /g, ""), context);
  vm.runInContext(readFileSync(new URL("../module/applications/_module.mjs", import.meta.url), "utf8").replace(/import \{[^}]+\} from [^;]+;/g, "")
    + "\nglobalThis.PrismBar = PrismBar;", context);
  const bar = new context.PrismBar();
  const node = () => ({ textContent: "", dataset: {}, style: { setProperty(key, value) { this[key] = value; } } });
  bar.gauges = Object.fromEntries(["recovery", "fortune", "mana", "hp"].map(key => [key, { fill: node(), text: node() }]));
  bar.portrait = { getAttribute(key) { return this[key]; }, setAttribute(key, value) { this[key] = value; } };
  bar.art = { setAttribute(key, value) { this[key] = value; } };
  bar.name = node();
  bar.actions = [];
  bar.presetButtons = [];
  bar.connectActor();
  const actor = (id, resources = {}) => ({
    uuid: `Actor.${id}`, type: "character", name: id, img: `${id}.webp`, testUserPermission: () => true,
    system: { attributes: { hp: { value: 12, max: 30 } }, resources }
  });
  const token = actor => ({ actor, document: { baseActor: actor, object: { measureMovementPath: measureRecordedPath } } });
  return { bar, context, hooks, actor, token };
}

test("sélection unique, changement d'acteur et états neutres", () => {
  const { bar, context, hooks, actor, token } = setup();
  assert.equal(bar.gauges.hp.text.textContent, "—");
  const a = token(actor("a", { mana: { value: 6, max: 8 } }));
  context.canvas.tokens.controlled = [a];
  hooks.get("controlToken")(a, true);
  assert.equal(bar.portrait.src, "a.webp");
  assert.equal(bar.name.textContent, "a");
  assert.equal(bar.gauges.hp.text.textContent, "12 / 30");
  assert.equal(bar.gauges.mana.fill.style["--fill"], "75%");
  const b = token(actor("b"));
  context.canvas.tokens.controlled = [b]; hooks.get("controlToken")(b, true);
  assert.equal(bar.portrait.src, "b.webp");
  assert.equal(bar.name.textContent, "b");
  assert.equal(bar.gauges.mana.text.textContent, "—");
  context.canvas.tokens.controlled = [a, b]; bar.refreshActor();
  assert.equal(bar.gauges.hp.text.textContent, "—");
  assert.equal(bar.portrait.src, "icons/svg/mystery-man.svg");
  context.canvas = undefined;
  assert.doesNotThrow(() => bar.refreshActor());
});

test("15B raccordement : sélection conservée, hooks natifs uniques et nettoyage ciblé", () => {
  const { bar, context, actor, token, hooks } = setup();
  const a = actor("movement"), t = token(a);
  const scene = { id: "scene", tokens: new Map(), grid: { type: 1, distance: 2, units: "m" } };
  a.system.attributes.movement = { value: 10, unit: "m" };
  Object.assign(t.document, { id: "token", parent: scene, actor: a, x: 0, y: 0, elevation: 0,
    testUserPermission: () => true, movementHistory: [] });
  scene.tokens.set(t.document.id, t.document);
  context.canvas.scene = scene; context.canvas.tokens.controlled = [t];
  bar.refreshActor();
  const count = hooks.size;
  assert.equal(bar.movementTracker.start(t.document).success, true);
  assert.equal(bar.movementTracker.getSnapshot(t.document).state.cellsPerAction, 5);
  context.canvas.tokens.controlled = []; hooks.get("controlToken")();
  assert.equal(bar.movementTracker.getSnapshot(t.document).state.active, true);
  hooks.get("recordToken")(t.document);
  hooks.get("moveToken")(t.document, { id: "native", origin: { x: 0, y: 0 },
    passed: { waypoints: [{ x: 100, y: 0, terrain: { testCost: 4, testDistance: 2, testSpaces: 1 } }], distance: 2, spaces: 1, cost: 4 } });
  assert.equal(bar.movementTracker.getSnapshot(t.document).state.spaces, 1);
  assert.equal(hooks.size, count);
  hooks.get("deleteToken")(t.document);
  assert.equal(bar.movementTracker.getSnapshot(t.document).success, false);
  bar.movementTracker.start(t.document); hooks.get("canvasTearDown")();
  assert.equal(bar.movementTracker.getSnapshot(t.document).success, false);
});

test("15C prévisions : tranches 0/1/5/6/10/11, droits et clôture informative sans écriture", async () => {
  const { bar, context, actor, token } = setup();
  const a = actor("panel"), t = token(a);
  a.system.attributes.movement = { value: 10, unit: "m" };
  const scene = { id: "scene", tokens: new Map(), grid: { type: 1, distance: 2, units: "m" } };
  Object.assign(t.document, { id: "token", parent: scene, actor: a, x: 0, y: 0, elevation: 0,
    testUserPermission: () => true, canUserModify: () => true, movementHistory: [] });
  scene.tokens.set(t.document.id, t.document);
  context.canvas.scene = scene; context.canvas.tokens.controlled = [t];
  let mode = "always";
  context.game.settings = { get: (_, key) => key === "economyMode" ? mode : "nearest" };
  a.getFlag = () => undefined; a.update = a.setFlag = () => assert.fail("Aucune écriture d'acteur");
  for (const method of ["spend", "grant", "reset"]) {
    context.ActionEconomy.prototype[method] = () => assert.fail(`Le panneau ne doit jamais appeler ${method}`);
  }
  bar.refreshActor(); bar.configuration.panels.combat = true;
  // Le test ne persiste pas l'ouverture de Combat pour isoler les commandes du panneau.
  const read = bar.readConfiguration.bind(bar);
  bar.readConfiguration = actor => { const config = read(actor); config.panels.combat = true; return config; };
  for (const used of [0, 1, 5, 6, 10, 11]) {
    assert.equal(await bar.toggleMovement(), true);
    bar.movementTracker.update(t.document, { id: String(used), origin: { x: 0, y: 0 },
      passed: { waypoints: [{ x: 100, y: 0, terrain: { testCost: used * 2, testDistance: used * 2, testSpaces: used } }], spaces: used, distance: used * 2, cost: used * 2 } });
    const view = bar.movementView(t.document);
    assert.equal(view.available, 2);
    assert.equal(view.capacity, 5); assert.equal(view.remaining, Math.max(0, 5 - used));
    assert.equal(view.excess, Math.max(0, used - 5));
    mode = "off";
    assert.equal(bar.movementView(t.document).capacity, view.capacity);
    assert.equal(bar.movementView(t.document).excess, Math.max(0, used - 5));
    mode = "always";
    mode = "off";
    assert.equal(await bar.toggleMovement(), true);
    mode = "always";
    assert.equal(bar.movementTracker.getSnapshot(t.document).success, false);
  }
  t.document.canUserModify = () => false;
  assert.equal(await bar.toggleMovement(), false);
});

function setupMovementValidation() {
  const env = setupConfiguration();
  const { bar, context, configuredActor, token, hooks } = env;
  const scene = { id: "validation-scene", tokens: new Map(), grid: { type: 1, distance: 2, units: "m" } };
  context.canvas.scene = scene; context.game.scenes = new Map([[scene.id, scene]]);
  let mode = "always", serial = 0;
  context.game.settings = { get: (_, key) => key === "economyMode" ? mode : "nearest" };
  const warnings = [];
  bar.movementNotifications = { broadcast: (token, excess) => { warnings.push({ token, excess }); return true; } };
  const a = configuredActor("movement-budget", { co2prism: { panels: { combat: true } } });
  a.system.attributes.movement = { value: 10, unit: "m" };
  const create = (actor = a) => {
    const t = token(actor);
    Object.assign(t.document, { id: String(++serial), parent: scene, actor, x: 0, y: 0, elevation: 0,
      testUserPermission: () => true, canUserModify: () => true, movementHistory: [] });
    scene.tokens.set(t.document.id, t.document); return t;
  };
  const t = create();
  const select = t => { context.canvas.tokens.controlled = t ? [t] : []; hooks.get("controlToken")(); };
  select(t);
  const start = (used, selected = t, costCells = used) => {
    select(selected); void bar.toggleMovement(); assert.equal(bar.movementTracker.getSnapshot(selected.document).success, true);
    hooks.get("moveToken")(selected.document, { id: "move-" + (++serial), origin: { x: 0, y: 0 },
      passed: { waypoints: [{ x: 100, y: 0, terrain: { testCost: costCells * 2, testDistance: used * 2, testSpaces: used } }], distance: used * 2, spaces: used, cost: costCells * 2 } });
  };
  return { ...env, a, t, scene, create, select, start, warnings,
    economy: new context.ActionEconomy(a), setMode: value => { mode = value; } };
}

test("Validation : segment réel à coût nul inclus, budget inactif gratuit", async () => {
  for (const used of [0, 1, 5, 6, 10, 11]) {
    const { bar, t, start, economy, warnings } = setupMovementValidation();
    start(used);
    assert.equal(await bar.validateMovement(bar.movementToken()), true);
    assert.equal(economy.getSnapshot().movementsRemaining, 1);
    assert.equal(bar.movementResults.get(t.document).consumedCount, 1);
    assert.equal(bar.movementResults.get(t.document).missingCount, 0);
    assert.equal(warnings.length, used > 5 ? 1 : 0);
    assert.equal(bar.movementTracker.getSnapshot(t.document).success, true);
  }
  for (const [mode, active] of [["off", true], ["combat", false]]) {
    const { bar, context, start, economy, warnings, setMode } = setupMovementValidation();
    setMode(mode); context.game.combats.active.started = active; start(99);
    assert.equal(await bar.validateMovement(bar.movementToken()), true);
    assert.equal(economy.getSnapshot().movementsRemaining, 2); assert.equal(warnings.length, 0);
  }
});

test("Sessions : enchaînement, fermeture sans débit et reset", async () => {
  const { bar, t, start, economy, hooks } = setupMovementValidation();
  start(3); t.document.x = 100;
  assert.equal(await bar.validateMovement(t.document), true);
  assert.equal(economy.getSnapshot().movementsRemaining, 1);
  assert.equal(bar.movementView(t.document).state.start.x, 100);
  assert.equal(bar.movementView(t.document).state.segmentCount, 0);
  assert.equal(await bar.validateMovement(t.document), false);
  assert.equal(await bar.resetMovement(), false);
  assert.equal(await bar.toggleMovement(), true);
  t.document.x = 200;
  assert.equal(await bar.toggleMovement(), true);
  hooks.get("moveToken")(t.document, { id: "second", origin: { x: 200, y: 0 },
    passed: { waypoints: [{ x: 300, y: 0, terrain: { testCost: 14, testDistance: 14, testSpaces: 7 } }] } });
  t.document.x = 300;
  t.document.update = async data => { Object.assign(t.document, data); return t.document; };
  assert.equal(await bar.resetMovement(), true);
  assert.equal(t.document.x, 200);
  assert.equal(await bar.validateMovement(t.document), false);
  assert.equal(economy.getSnapshot().movementsRemaining, 1);
});

test("Budget épuisé : ouverture informative et aucun débit", async () => {
  const { bar, context, t, start, economy, warnings } = setupMovementValidation();
  start(7);
  await economy.spendMovements(2);
  assert.equal(await bar.validateMovement(t.document), false);
  assert.equal(economy.getSnapshot().movementsRemaining, 0);
  assert.equal(warnings.length, 0);
  context.foundry.applications.api.DialogV2.wait = async () => "reset";
  t.document.update = async data => { Object.assign(t.document, data); return t.document; };
  assert.equal(await bar.toggleMovement(), true);
  assert.equal(await bar.toggleMovement(), true);
  assert.equal(bar.movementView(t.document), null);
  assert.equal(await bar.validateMovement(t.document), false);
});

test("Aucun trajet, événement immobile et aller-retour à coût arrondi nul", async () => {
  const { bar, t, economy, hooks } = setupMovementValidation();
  bar.toggleMovement();
  assert.equal(await bar.validateMovement(t.document), false);
  hooks.get("moveToken")(t.document, { id: "still", origin: { x: 0, y: 0 },
    passed: { waypoints: [{ x: 0, y: 0 }] } });
  assert.equal(bar.movementView(t.document).state.segmentCount, 0);
  for (const [id, from, to] of [["out", 0, 100], ["back", 100, 0]]) {
    hooks.get("moveToken")(t.document, { id, origin: { x: from, y: 0 },
      passed: { waypoints: [{ x: to, y: 0, terrain: { testCost: 0, testDistance: 0, testSpaces: 0 } }] } });
  }
  assert.equal(bar.movementView(t.document).state.segmentCount, 2);
  assert.equal(bar.movementView(t.document).state.cellsUsed, 0);
  assert.equal(await bar.validateMovement(t.document), true);
  assert.equal(economy.getSnapshot().movementsRemaining, 1);
});

test("Fermeture validée : position conservée et nouvelle origine", async () => {
  const { bar, t, start, economy } = setupMovementValidation();
  start(3); t.document.x = 100;
  assert.equal(await bar.toggleMovement(), true);
  assert.equal(t.document.x, 100);
  assert.equal(economy.getSnapshot().movementsRemaining, 1);
  assert.equal(await bar.toggleMovement(), true);
  assert.equal(bar.movementView(t.document).state.start.x, 100);
  assert.equal(bar.movementView(t.document).state.segmentCount, 0);
});

test("Confirmation : textes FR exacts, validation unique et fermeture après redémarrage", async () => {
  const { bar, context, t, start, economy } = setupMovementValidation();
  const texts = JSON.parse(readFileSync(new URL("../lang/fr.json", import.meta.url), "utf8")).CO2PRISM.Movement;
  context.game.i18n.localize = key => texts[key.split(".").at(-1)] ?? key;
  let config;
  context.foundry.applications.api.DialogV2.wait = async value => { config = value; return "validate"; };
  start(2); t.document.x = 100;
  assert.equal(await bar.toggleMovement(), true);
  assert.equal(config.window.title, "Déplacement en cours");
  assert.equal(config.content, "<p>Que voulez-vous faire ?</p>");
  assert.deepEqual(Array.from(config.buttons, button => button.label), ["Valider le mouvement", "Annuler le mouvement"]);
  assert.equal(config.rejectClose, false);
  assert.equal(economy.getSnapshot().movementsRemaining, 1);
  assert.equal(t.document.x, 100);
  assert.equal(bar.movementOpenToken, null);
  assert.equal(bar.movementOpenActor, null);
  assert.equal(bar.movementTracker.getSnapshot(t.document).success, false);
});

test("Confirmation : annulation remet le token au départ sans débit", async () => {
  const { bar, context, t, start, economy } = setupMovementValidation();
  context.foundry.applications.api.DialogV2.wait = async () => "reset";
  t.document.update = async data => { Object.assign(t.document, data); return t.document; };
  start(2); t.document.x = 100;
  assert.equal(await bar.toggleMovement(), true);
  assert.equal(t.document.x, 0);
  assert.equal(economy.getSnapshot().movementsRemaining, 2);
  assert.equal(bar.movementOpenToken, null);
  assert.equal(bar.movementTracker.getSnapshot(t.document).success, false);
});

test("Confirmation : X ou Échap conserve le trajet ; aller-retour confirmé", async () => {
  const { bar, context, t, start, economy } = setupMovementValidation();
  let calls = 0;
  context.foundry.applications.api.DialogV2.wait = async () => { calls++; return null; };
  start(0); // Segment réel, coût nul et position finale identique au départ.
  const session = bar.movementView(t.document).state.sessionId;
  for (let i = 0; i < 2; i++) {
    assert.equal(await bar.toggleMovement(), false);
    assert.equal(bar.movementView(t.document).state.sessionId, session);
    assert.equal(bar.movementView(t.document).state.segmentCount, 1);
    assert.equal(t.document.x, 0);
    assert.equal(economy.getSnapshot().movementsRemaining, 2);
  }
  assert.equal(calls, 2);
});

test("Confirmation : aucun dialogue sans trajet ou après reset", async () => {
  const { bar, context, t, start, economy } = setupMovementValidation();
  context.foundry.applications.api.DialogV2.wait = () => assert.fail("Dialogue inattendu");
  assert.equal(await bar.toggleMovement(), true);
  assert.equal(await bar.toggleMovement(), true);
  start(2);
  t.document.update = async data => { Object.assign(t.document, data); return t.document; };
  assert.equal(await bar.resetMovement(), true);
  assert.equal(await bar.toggleMovement(), true);
  assert.equal(bar.movementOpenToken, null);
  assert.equal(economy.getSnapshot().movementsRemaining, 2);
});

test("Confirmation : verrou pendant attente et exécution du choix", async () => {
  const { bar, context, a, t, start, economy } = setupMovementValidation();
  let answer, save;
  context.foundry.applications.api.DialogV2.wait = () => new Promise(resolve => { answer = resolve; });
  start(2);
  const pending = bar.toggleMovement();
  assert.equal(await bar.toggleMovement(), false);
  assert.equal(await bar.validateMovement(t.document), false);
  assert.equal(await bar.resetMovement(), false);
  assert.equal(await bar.toggleMovementZones(), false);
  const setFlag = a.setFlag;
  a.setFlag = (...args) => new Promise(resolve => { save = async () => resolve(await setFlag(...args)); });
  answer("validate");
  while (!save) await Promise.resolve();
  assert.equal(await bar.toggleMovement(), false);
  assert.equal(await bar.validateMovement(t.document), false);
  await save();
  assert.equal(await pending, true);
  assert.equal(economy.getSnapshot().movementsRemaining, 1);
  assert.equal(bar.movementClosures.has(t.document), false);
});

test("Confirmation : réponse tardive sans effet si le contexte change", async () => {
  for (const mutate of [
    env => env.select(env.create()),
    env => { env.t.document.actor = env.configuredActor("replacement"); },
    env => { env.context.canvas.scene = {}; },
    env => { env.bar.movementTracker.cancel(env.t.document); env.bar.movementTracker.start(env.t.document); },
    env => env.bar.destroy(),
    env => { env.bar.element = { isConnected: false }; },
    env => env.hooks.get("deleteCombat")({})
  ]) {
    const env = setupMovementValidation(), { bar, context, t, start, economy } = env;
    let answer;
    context.foundry.applications.api.DialogV2.wait = () => new Promise(resolve => { answer = resolve; });
    start(2); const pending = bar.toggleMovement();
    mutate(env); answer("reset");
    assert.equal(await pending, false);
    assert.equal(economy.getSnapshot().movementsRemaining, 2);
    assert.equal(bar.movementClosures.has(t.document), false);
  }
});

test("Confirmation : erreurs de validation et de retour conservent la session", async () => {
  for (const choice of ["validate", "reset"]) {
    const { bar, context, a, t, start, economy } = setupMovementValidation();
    context.foundry.applications.api.DialogV2.wait = async () => choice;
    a.setFlag = async () => { throw Error("offline"); };
    t.document.update = async () => { throw Error("return failed"); };
    start(2);
    const session = bar.movementView(t.document).state.sessionId;
    assert.equal(await bar.toggleMovement(), false);
    assert.equal(bar.movementView(t.document).state.sessionId, session);
    assert.equal(bar.movementView(t.document).state.segmentCount, 1);
    assert.equal(bar.movementOpenToken, t.document);
    assert.ok(bar.movementErrors.get(t.document));
    assert.equal(economy.getSnapshot().movementsRemaining, 2);
  }
});

test("Confirmation : finish échoue après débit, reprise sans seconde dépense", async () => {
  const { bar, context, t, start, economy } = setupMovementValidation();
  context.foundry.applications.api.DialogV2.wait = async () => "validate";
  start(2);
  const finish = bar.movementTracker.finish.bind(bar.movementTracker);
  bar.movementTracker.finish = () => ({ success: false });
  assert.equal(await bar.toggleMovement(), false);
  assert.equal(economy.getSnapshot().movementsRemaining, 1);
  assert.equal(bar.movementOpenToken, t.document);
  bar.movementTracker.finish = finish;
  assert.equal(await bar.toggleMovement(), true);
  assert.equal(economy.getSnapshot().movementsRemaining, 1);
  assert.equal(bar.movementOpenToken, null);
});

test("Confirmation : ne pas fermer une session nouvelle déplacée ou remplacée", async () => {
  for (const replace of [false, true]) {
    const { bar, context, t, start, economy, hooks } = setupMovementValidation();
    context.foundry.applications.api.DialogV2.wait = async () => "validate";
    start(2); t.document.x = 100;
    const validate = bar.validateMovement.bind(bar);
    bar.validateMovement = async (...args) => {
      const result = await validate(...args);
      if (replace) { bar.movementTracker.cancel(t.document); bar.movementTracker.start(t.document); }
      else hooks.get("moveToken")(t.document, { id: "new-path", origin: { x: 100, y: 0 },
        passed: { waypoints: [{ x: 200, y: 0, terrain: { testCost: 2, testDistance: 2, testSpaces: 1 } }] } });
      return result;
    };
    assert.equal(await bar.toggleMovement(), false);
    assert.equal(bar.movementTracker.getSnapshot(t.document).success, true);
    assert.equal(bar.movementOpenToken, t.document);
    assert.equal(economy.getSnapshot().movementsRemaining, 1);
  }
});

test("Confirmation : changement pendant sauvegarde sans fermer une session étrangère", async () => {
  const { bar, context, a, t, start, economy } = setupMovementValidation();
  context.foundry.applications.api.DialogV2.wait = async () => "validate";
  let save;
  const setFlag = a.setFlag;
  a.setFlag = (...args) => new Promise(resolve => { save = async () => resolve(await setFlag(...args)); });
  start(2);
  const pending = bar.toggleMovement();
  while (!save) await Promise.resolve();
  bar.movementTracker.cancel(t.document); bar.movementTracker.start(t.document);
  const session = bar.movementView(t.document).state.sessionId;
  await save();
  assert.equal(await pending, false);
  assert.equal(bar.movementView(t.document).state.sessionId, session);
  assert.equal(economy.getSnapshot().movementsRemaining, 1);
  assert.equal(bar.movementResults.get(t.document).consumedCount, 1);
});

test("15D bonus et dépenses externes : réserve courante et un seul avertissement final", async () => {
  const { bar, t, start, economy, warnings } = setupMovementValidation();
  start(16); assert.equal(warnings.length, 0);
  await economy.grant("m"); await economy.grant("am"); await economy.spend("a");
  assert.equal(await bar.validateMovement(bar.movementToken()), true);
  const result = bar.movementResults.get(t.document);
  assert.equal(result.availableBefore, 3); assert.equal(result.consumedCount, 1); assert.equal(result.missingCount, 0);
  assert.equal(warnings.length, 1); assert.equal(warnings[0].excess, 11);
  assert.equal(economy.getSnapshot().movementsRemaining, 2);
});

test("15D erreur atomique et mesure invalide : session ouverte, réessai sans double débit", async () => {
  const { bar, a, t, start, economy, warnings, scene } = setupMovementValidation();
  start(6); scene.grid.type = 0;
  assert.equal(await bar.validateMovement(bar.movementToken()), false);
  assert.equal(bar.movementErrors.get(t.document), "invalid-measurement");
  scene.grid.type = 1;
  const save = a.setFlag; a.setFlag = async () => { throw Error("offline"); };
  assert.equal(await bar.validateMovement(bar.movementToken()), false);
  assert.equal(bar.movementTracker.getSnapshot(t.document).success, true);
  assert.equal(economy.getSnapshot().movementsRemaining, 2);
  assert.equal(bar.movementResults.get(t.document).consumedCount, 0);
  a.setFlag = save;
  assert.equal(await bar.validateMovement(bar.movementToken()), true); assert.equal(economy.getSnapshot().movementsRemaining, 1);
  assert.equal(warnings.length, 1);
});

test("15D sélection pendant sauvegarde et double clic : acteur initial uniquement", async () => {
  const { bar, a, t, start, economy, create, select, configuredActor } = setupMovementValidation();
  start(6);
  const save = a.setFlag; let release;
  a.setFlag = (...args) => new Promise(resolve => { release = async () => resolve(await save(...args)); });
  const pending = bar.validateMovement(bar.movementToken()); await Promise.resolve(); await Promise.resolve();
  assert.equal(await bar.validateMovement(bar.movementToken()), false);
  assert.equal(await bar.resetMovement(), false);
  const b = configuredActor("other", { co2prism: { panels: { combat: true } } });
  select(create(b)); await release();
  assert.equal(await pending, true); assert.equal(economy.getSnapshot().movementsRemaining, 1);
  assert.equal(new economy.constructor(b).getSnapshot().movementsRemaining, 2);
  assert.equal(bar.movementTracker.getSnapshot(t.document).success, false);
});

test("15D contexte invalidé dans la file : reset, suppression et arrêt de combat", async () => {
  for (const mutation of [env => env.economy.reset(), env => env.scene.tokens.delete(env.t.document.id),
    env => env.hooks.get("deleteCombat")({}), env => { env.t.document.canUserModify = () => false; },
    env => { env.bar.movementTracker.cancel(env.t.document); env.bar.movementTracker.start(env.t.document); }]) {
    const env = setupMovementValidation(); const { bar, start, economy } = env;
    start(6); const pending = bar.validateMovement(bar.movementToken()); mutation(env);
    assert.equal(await pending, false); assert.equal(economy.getSnapshot().movementsRemaining, 2);
  }
});

test("15D clôture différée après succès : résultat conservé et aucun redébit", async () => {
  const { bar, t, start, economy } = setupMovementValidation();
  start(6);
  const finish = bar.movementTracker.finish.bind(bar.movementTracker);
  bar.movementTracker.finish = () => ({ success: false, reason: "movement-in-progress" });
  assert.equal(await bar.validateMovement(bar.movementToken()), false); assert.equal(economy.getSnapshot().movementsRemaining, 1);
  assert.equal(bar.movementErrors.get(t.document), "closure-pending");
  bar.movementTracker.finish = finish;
  assert.equal(await bar.validateMovement(bar.movementToken()), true); assert.equal(economy.getSnapshot().movementsRemaining, 1);
});

test("15D deux tokens d'un acteur : réserve partagée à chaque validation", async () => {
  const { bar, start, economy, create, warnings } = setupMovementValidation();
  start(5); assert.equal(await bar.validateMovement(bar.movementToken()), true);
  start(6, create()); assert.equal(await bar.validateMovement(bar.movementToken()), true);
  assert.equal(economy.getSnapshot().movementsRemaining, 0);
  assert.equal(warnings.length, 1); assert.equal(warnings[0].excess, 1);
});

test("15D validations simultanées de deux tokens : file acteur, réserve actualisée", async () => {
  const { bar, t, start, economy, create, warnings } = setupMovementValidation();
  start(5); const first = bar.validateMovement(bar.movementToken());
  const secondToken = create(); start(6, secondToken); const second = bar.validateMovement(bar.movementToken());
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(bar.movementResults.get(t.document).consumedCount, 1);
  assert.equal(bar.movementResults.get(secondToken.document).consumedCount, 1);
  assert.equal(economy.getSnapshot().movementsRemaining, 0); assert.equal(warnings.length, 1);
});

test("Capacité d’une M fractionnaire : seuil 4, débit fixe et dépassement", async () => {
  for (const [used, excess] of [[4, 0], [5, 1], [7, 3], [8, 4]]) {
    const { bar, a, t, start, economy, warnings } = setupMovementValidation();
    a.system.attributes.movement.value = 7.2;
    start(used);
    const view = bar.movementView(t.document);
    assert.equal(view.capacity, 4); assert.equal(view.excess, excess);
    assert.equal(await bar.validateMovement(bar.movementToken()), true);
    assert.equal(bar.movementResults.get(t.document).consumedCount, 1);
    assert.equal(warnings.length, excess ? 1 : 0);
    if (excess) assert.equal(warnings[0].excess, excess);
    assert.equal(economy.getSnapshot().movementsRemaining, 1);
  }
});

test("Archive6 garde asynchrone : vitesse brute, grille et arrondi modifiés", async () => {
  for (const mutate of [env => { env.a.system.attributes.movement.value = 7.4; },
    env => { env.scene.grid.size = 200; }, env => { env.context.game.settings.get = (_, key) => key === "economyMode" ? "always" : "up"; }]) {
    const env = setupMovementValidation(); const { bar, a, start, economy } = env;
    a.system.attributes.movement.value = 7.2; start(7);
    const pending = bar.validateMovement(bar.movementToken()); mutate(env);
    assert.equal(await pending, false); assert.equal(economy.getSnapshot().movementsRemaining, 2);
  }
});

test("Archive6 seuil nul : budget inactif informatif et coût positif réalisable", async () => {
  const { bar, a, t, start, economy, setMode } = setupMovementValidation();
  a.system.attributes.movement.value = 0.2; // Capacité arrondie à zéro.
  start(1);
  assert.equal(bar.movementView(t.document).capacity, 0);
  setMode("off");
  assert.equal(bar.movementView(t.document).capacity, 0); assert.equal(bar.movementView(t.document).excess, 1);
  assert.equal(await bar.validateMovement(bar.movementToken()), true); assert.equal(economy.getSnapshot().movementsRemaining, 2);
});

test("Zone Tactique : instantané M/AM et vitesse brute, une action hors budget sans débit", async () => {
  const { bar, a, t, start, economy, setMode, writes } = setupMovementValidation();
  a.system.attributes.movement.value = 7;
  start(0);
  const captured = [];
  bar.movementZones.toggle = async (token, state, range) => {
    captured.push({ token, state, range }); return { success: true };
  };
  let count = writes.length;
  assert.equal(await bar.toggleMovementZones(), true);
  assert.equal(writes.length, count);
  assert.equal(captured[0].token, t.document); assert.equal(captured[0].range.cellsPerActionRaw, 3.5);
  assert.equal(captured[0].range.rounding, "nearest"); assert.deepEqual(Object.keys(captured[0].range).sort(), ["cellsPerActionRaw", "rounding"]);
  assert.notEqual(captured[0].state.start, bar.movementTracker.getSnapshot(t.document).state.start);
  await economy.grant("am");
  await bar.toggleMovementZones(); assert.equal(captured.at(-1).range.cellsPerActionRaw, 3.5);
  await economy.spend("m");
  await bar.toggleMovementZones(); assert.equal(captured.at(-1).range.cellsPerActionRaw, 3.5);
  await economy.spendMovements(2); count = writes.length;
  await bar.toggleMovementZones(); assert.equal(captured.at(-1).range.cellsPerActionRaw, 3.5);
  assert.equal(writes.length, count);
  setMode("off");
  await bar.toggleMovementZones(); assert.equal(captured.at(-1).range.cellsPerActionRaw, 3.5);
  assert.equal(writes.length, count); assert.equal(economy.getSnapshot().movementsRemaining, 0);
});

test("coût natif : panneau et validation débitent le coût réel, pas les espaces traversés", async () => {
  const { bar, t, start, economy, warnings } = setupMovementValidation();
  start(2, t, 11);
  const view = bar.movementView(t.document);
  assert.equal(view.state.spaces, 2); assert.equal(view.state.cost, 22);
  assert.equal(view.state.cellsUsed, 11);
  assert.equal(view.excess, 6);
  assert.equal(await bar.validateMovement(bar.movementToken()), true);
  assert.equal(economy.getSnapshot().movementsRemaining, 1);
  assert.equal(bar.movementResults.get(t.document).consumedCount, 1);
  assert.equal(warnings.length, 1); assert.equal(warnings[0].excess, 6);
});

test("bornage du remplissage et maxima non exploitables", () => {
  const { bar, context, actor, token } = setup();
  const a = actor("a"); context.canvas.tokens.controlled = [token(a)];
  for (const [value, max, text, fill] of [
    [0, 10, "0 / 10", "0%"], [10, 10, "10 / 10", "100%"],
    [25, 10, "25 / 10", "100%"], [-5, 10, "-5 / 10", "0%"],
    [4, null, "4 / —", "0%"], [0, 0, "0 / —", "0%"],
    [4, -1, "4 / —", "0%"], [4, Infinity, "4 / —", "0%"],
    [NaN, 10, "— / 10", "0%"]
  ]) {
    a.system.resources.mana = { value, max }; bar.refreshActor();
    assert.equal(bar.gauges.mana.text.textContent, text);
    assert.equal(bar.gauges.mana.fill.style["--fill"], fill);
  }
});

test("acteur synthétique, mises à jour ciblées et changement de scène", () => {
  const { bar, context, hooks, actor, token } = setup();
  const base = actor("base"), synthetic = actor("synthetic");
  const t = token(synthetic); t.document.baseActor = base;
  context.canvas.tokens.controlled = [t]; bar.refreshActor();
  synthetic.name = "Nouveau nom";
  hooks.get("updateActor")(synthetic, { name: synthetic.name });
  assert.equal(bar.name.textContent, "Nouveau nom");
  synthetic.system.attributes.hp.value = 3;
  hooks.get("updateActor")(synthetic, { system: { attributes: { hp: { value: 3 } } } });
  assert.equal(bar.gauges.hp.text.textContent, "3 / 30");
  let refreshes = 0;
  const refresh = bar.refreshActor.bind(bar);
  bar.refreshActor = (...args) => { refreshes++; refresh(...args); };
  hooks.get("updateActor")(actor("other"), { system: {} });
  hooks.get("updateToken")(t.document, { x: 50 });
  assert.equal(refreshes, 0);
  hooks.get("updateActor")(base, { system: {} });
  hooks.get("updateItem")({ parent: base });
  hooks.get("updateActiveEffect")({ parent: { documentName: "Item", parent: base } });
  assert.equal(refreshes, 3);
  hooks.get("canvasTearDown")();
  assert.equal(bar.gauges.hp.text.textContent, "—");
  context.canvas.tokens.controlled = []; hooks.get("canvasReady")();
  assert.equal(bar.gauges.hp.text.textContent, "—");
});

test("rencontre sans ressources et permissions insuffisantes", () => {
  const { bar, context, actor, token, hooks } = setup();
  const encounter = actor("encounter"); delete encounter.system.resources;
  context.canvas.tokens.controlled = [token(encounter)]; bar.refreshActor();
  assert.equal(bar.gauges.hp.text.textContent, "12 / 30");
  assert.equal(bar.gauges.recovery.text.textContent, "—");
  encounter.testUserPermission = () => false;
  hooks.get("updateActor")(encounter, { ownership: {} });
  assert.equal(bar.gauges.hp.text.textContent, "—");
  assert.equal(bar.portrait.src, "icons/svg/mystery-man.svg");
  encounter.testUserPermission = () => true;
  hooks.get("updateActor")(encounter, { ownership: {} });
  assert.equal(bar.gauges.hp.text.textContent, "12 / 30");
});

test("déplacement depuis le portrait, verrouillage et position utilisateur", () => {
  const { bar, context } = setup();
  let locked = true;
  const saved = [];
  context.game.settings = {
    get: (_module, key) => key === "locked" ? locked : "M",
    set: (module, key, value) => saved.push({ module, key, value })
  };
  context.window = { innerWidth: 1000, innerHeight: 800 };
  const capture = new Set();
  bar.handle = { dataset: {}, setPointerCapture: id => capture.add(id), hasPointerCapture: id => capture.has(id),
    releasePointerCapture: id => capture.delete(id), classList: { toggle() {} } };
  bar.lock = { dataset: {}, setAttribute() {} };
  bar.element = { style: { left: "40px", top: "400px", setProperty(key, value) { this[key] = value; } }, getBoundingClientRect() {
    return { left: parseFloat(this.style.left), top: parseFloat(this.style.top), width: 430, height: 306 };
  } };
  const event = { button: 0, pointerId: 1, clientX: 50, clientY: 420, preventDefault() {}, stopPropagation() {} };
  bar.startDrag(event);
  assert.equal(bar.drag, undefined);
  locked = false; bar.updateLock(); bar.startDrag(event);
  assert.equal(capture.has(1), true);
  bar.moveDrag({ pointerId: 1, clientX: 100, clientY: 450 });
  assert.equal(saved.length, 0);
  bar.endDrag({ pointerId: 2 });
  assert.equal(capture.has(1), true);
  bar.startDrag({ ...event, pointerId: 2 });
  assert.equal(bar.drag.id, 1);
  bar.endDrag();
  assert.equal(bar.element.style.left, "90px");
  assert.equal(bar.element.style.top, "430px");
  assert.equal(saved[0].module, "co2prism");
  assert.equal(saved[0].key, "position");
  assert.equal(saved[0].value.x, 90);
  assert.equal(capture.size, 0);
  bar.anchor = bar.element;
  bar.layout();
  assert.equal(bar.element.style.left, "90px");
  locked = true; bar.updateLock(); bar.startDrag(event);
  assert.equal(bar.drag, null);
});

test("redimensionnement, bornage et restauration dans une petite fenêtre", () => {
  const { bar, context } = setup();
  const settings = { size: "XL", position: { x: 950, y: 750 } };
  const writes = [];
  context.game.settings = {
    get: (_module, key) => settings[key],
    set: (_module, key, value) => { settings[key] = value; writes.push(key); }
  };
  context.window = { innerWidth: 420, innerHeight: 300 };
  bar.position = settings.position;
  bar.element = { style: { setProperty(key, value) { this[key] = value; } }, getBoundingClientRect() {
    return { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0,
      width: 508 * parseFloat(this.style["--co2prism-unit"]), height: 276 * parseFloat(this.style["--co2prism-unit"]) };
  } };
  bar.anchor = bar.element;
  bar.layout();
  const rect = bar.element.getBoundingClientRect();
  assert.ok(rect.width <= 412 && rect.height <= 292);
  assert.ok(rect.left + rect.width <= 420 && rect.top + rect.height <= 300);
  assert.equal(settings.position.x, rect.left);
  assert.equal(settings.position.y, rect.top);
  assert.equal(writes.length, 1);
  bar.position = settings.position;
  bar.layout();
  assert.equal(writes.length, 1);
  context.window.innerWidth = 1300;
  context.window.innerHeight = 800;
  bar.layout();
  const enlarged = bar.element.getBoundingClientRect();
  assert.ok(Math.abs(enlarged.width - 780 * 508 / 724) < 0.01);
  assert.ok(enlarged.left + enlarged.width <= 1300);
  assert.ok(enlarged.top + enlarged.height <= 800);
});

function setupActions() {
  const env = setup();
  const { bar, context, actor, token } = env;
  const calls = [], warnings = [], errors = [];
  const a = actor("selected", {
    fortune: { value: 2, max: 4 }, mana: { value: 8, max: 18 }, recovery: { value: 1, max: 3 }
  });
  a.sheet = { render: options => calls.push({ sheet: a.uuid, options }) };
  a.system.rollFortune = function () { calls.push({ fortune: this }); };
  a.system.useRecovery = () => {};
  a.update = async update => calls.push({ update });
  context.game.system = { CONST: { restActions: [] } };
  context.ui = { notifications: { warn: message => warnings.push(message), error: message => errors.push(message) } };
  context.foundry = { utils: { escapeHTML }, applications: { api: { DialogV2: { wait: async () => "validate" } } } };
  bar.actions = ["sheet", "fortune", "hp", "mana", "fastRest", "fullRest"].map(action => ({
    dataset: { co2prismAction: action }, setAttribute(key, value) { this[key] = value; }
  }));
  context.canvas.tokens.controlled = [token(a)];
  bar.refreshActor();
  return { ...env, a, calls, warnings, errors,
    dialog: fn => context.foundry.applications.api.DialogV2.prompt = fn,
    button: action => bar.actions.find(node => node.dataset.co2prismAction === action) };
}

test("feuille et chance ciblent uniquement token.actor avec les droits adaptés", async () => {
  const { bar, context, a, calls, actor, token, button } = setupActions();
  await bar.performAction("sheet");
  assert.equal(calls[0].sheet, a.uuid);
  assert.equal(calls[0].options.force, true);
  await bar.performAction("fortune");
  assert.equal(calls[1].fortune, a.system);
  const b = actor("synthetic", { fortune: { value: 0, max: 4 } });
  b.system.rollFortune = () => calls.push("synthetic fortune");
  context.canvas.tokens.controlled = [token(b)];
  await bar.performAction("fortune");
  assert.equal(calls.at(-1), "synthetic fortune");
  b.testUserPermission = (_user, level) => level === "OBSERVER";
  await bar.performAction("fortune");
  assert.equal(calls.length, 3);
  assert.equal(button("fortune").disabled, true);
  context.game.user.isGM = true;
  await bar.performAction("fortune");
  assert.equal(calls.length, 4);
  context.game.user.isGM = false;
  b.sheet = a.sheet;
  await bar.performAction("sheet");
  assert.equal(calls.length, 5);
  b.type = "encounter";
  b.testUserPermission = () => true;
  await bar.performAction("fortune");
  assert.equal(calls.length, 5);
  context.canvas.tokens.controlled = [];
  await bar.performAction("sheet");
  assert.ok(bar.actions.every(node => node.disabled));
});

test("PV et PM : seules les valeurs actuelles valides passent par Actor.update", async () => {
  const { bar, context, a, calls, warnings, dialog, hooks } = setupActions();
  let answer = "0";
  dialog(async options => {
    assert.equal(options.modal, false);
    assert.equal(options.rejectClose, false);
    return options.ok.callback(null, { form: { elements: { namedItem: name => {
      assert.equal(name, "co2prism-current"); return { value: answer };
    } } } });
  });
  await bar.performAction("hp");
  assert.deepEqual({ ...calls[0].update }, { "system.attributes.hp.value": 0 });
  answer = "18";
  await bar.performAction("mana");
  assert.deepEqual({ ...calls[1].update }, { "system.resources.mana.value": 18 });
  for (answer of ["", " ", "abc", "-1", "19", "1.5", "Infinity", "NaN", "9007199254740993"]) {
    await bar.performAction("mana");
  }
  assert.equal(calls.length, 2);
  assert.equal(warnings.length, 9);
  dialog(async () => null);
  await bar.performAction("hp");
  assert.equal(calls.length, 2);
  a.system.attributes.hp.value = 1;
  hooks.get("updateActor")(a, { "system.attributes.hp.value": 1 });
  assert.equal(bar.gauges.hp.text.textContent, "1 / 30");
  delete a.system.resources.mana;
  let prompts = 0;
  dialog(async () => { prompts++; return "2"; });
  await bar.performAction("mana");
  assert.equal(prompts, 0);
  assert.equal(calls.length, 2);
  context.canvas.tokens.controlled[0].actor.type = "encounter";
  await bar.performAction("hp");
  assert.deepEqual({ ...calls.at(-1).update }, { "system.attributes.hp.value": 2 });
});

test("un dialogue revérifie sélection, droits, ressource et maximum au moment de valider", async () => {
  for (const change of ["token", "permissions", "maximum", "missing", "scene"]) {
    const { bar, context, a, calls, dialog, actor, token } = setupActions();
    dialog(async () => {
      if (change === "token") context.canvas.tokens.controlled = [token(actor("other"))];
      if (change === "permissions") a.testUserPermission = (_user, level) => level === "OBSERVER";
      if (change === "maximum") a.system.attributes.hp.max = 3;
      if (change === "missing") delete a.system.attributes.hp;
      if (change === "scene") context.canvas.ready = false;
      return "5";
    });
    await bar.performAction("hp");
    assert.equal(calls.length, 0, change);
  }
});

test("repos : handlers du registre, absence, ambiguïté et garde des doubles clics", async () => {
  const { bar, context, a, calls, button } = setupActions();
  await bar.performAction("fastRest");
  assert.equal(button("fastRest").disabled, true);
  assert.equal(button("fastRest").dataset.co2prismTooltipText, "CO2PRISM.RestUnavailable");
  const rest = { id: "fastRest", handler: actor => calls.push({ rest: actor }) };
  context.game.system.CONST.restActions = [rest, { id: "fullRest", handler: actor => calls.push({ full: actor }) }];
  bar.refreshActor();
  assert.equal(button("fastRest").disabled, false);
  await bar.performAction("fastRest");
  assert.equal(calls[0].rest, a);
  await bar.performAction("fastRest");
  await bar.performAction("fullRest");
  assert.equal(calls.length, 1);
  bar.lastRest.at -= 1000;
  await bar.performAction("fullRest");
  assert.equal(calls[1].full, a);
  context.game.system.CONST.restActions.push(rest);
  bar.refreshActor();
  assert.equal(button("fastRest").disabled, true);
  context.game.system.CONST.restActions = [rest];
  a.type = "encounter";
  await bar.performAction("fastRest");
  assert.equal(calls.length, 2);
  a.type = "character";
  delete a.system.resources.recovery;
  bar.refreshActor();
  assert.equal(button("fastRest").disabled, true);
});

test("action en cours : aucune exécution concurrente, même si le token change", async () => {
  const { bar, context, a, calls, token, actor } = setupActions();
  let release;
  a.system.rollFortune = () => new Promise(resolve => { release = resolve; calls.push("start"); });
  const pending = bar.performAction("fortune");
  assert.ok(bar.actions.every(node => node.disabled));
  context.canvas.tokens.controlled = [token(actor("b"))];
  await bar.performAction("fortune");
  assert.equal(calls.length, 1);
  release(); await pending;
  assert.equal(bar.busyAction, null);
  assert.equal(bar.actor.name, "b");
});

function setupConfiguration() {
  const env = setup();
  const { bar, context, actor, token, hooks } = env;
  const writes = [], errors = [];
  context.foundry = { utils: { deepClone: structuredClone, escapeHTML, cleanHTML: value => value }, applications: { api: { DialogV2: { wait: async () => "validate" } } } };
  context.game.settings ??= { get: () => false };
  context.ui = { notifications: { error: message => errors.push(message), warn: message => errors.push(message) } };
  context.console = { error() {} };
  bar.presetButtons = [1, 2, 3].map(number => ({ dataset: { co2prismPreset: String(number) },
    setAttribute(key, value) { this[key] = value; } }));
  const configuredActor = (id, flags = {}) => {
    const a = actor(id);
    a.flags = structuredClone(flags);
    a.getFlag = (scope, key) => {
      const root = a.flags[scope];
      // Reproduire le contrôle initial de getProperty dans Foundry.
      if (root && key in root) return root[key];
      return key.split(".").reduce((value, part) => value?.[part], root);
    };
    a.setFlag = async (scope, key, value) => {
      writes.push({ actor: a, scope, key, value });
      if (!a.flags[scope] || typeof a.flags[scope] !== "object" || Array.isArray(a.flags[scope])) a.flags[scope] = {};
      const parts = key.split(".");
      let target = a.flags[scope];
      for (const part of parts.slice(0, -1)) {
        if (!target[part] || typeof target[part] !== "object" || Array.isArray(target[part])) target[part] = {};
        target = target[part];
      }
      if (value && typeof value === "object") {
        value = structuredClone(value);
        for (const key of Object.keys(value)) if (key.startsWith("-=")) { delete value[key.slice(2)]; delete value[key]; }
      }
      target[parts.at(-1)] = value;
      hooks.get("updateActor")(a, { [`flags.${scope}.${key}`]: value });
      return a;
    };
    return a;
  };
  const select = a => {
    context.canvas.tokens.controlled = a ? [token(a)] : [];
    hooks.get("controlToken")();
  };
  return { ...env, configuredActor, select, writes, errors };
}

test("configuration : défauts en lecture, trois presets isolés et flags mal formés", async () => {
  const { bar, configuredActor, select, writes } = setupConfiguration();
  const a = configuredActor("a"); select(a);
  assert.equal(bar.configuration.activePreset, 1);
  assert.deepEqual(Object.keys(bar.configuration.handPresets), ["1", "2", "3"]);
  assert.ok(Object.values(bar.configuration.panels).every(value => value === false));
  assert.notEqual(bar.configuration.handPresets[1], bar.configuration.handPresets[2]);
  bar.configuration.handPresets[1].example = "temporary";
  assert.equal(bar.configuration.handPresets[2].example, undefined);
  bar.refreshActor();
  assert.equal(bar.configuration.handPresets[1].example, undefined);
  await bar.setActivePreset(1);
  await bar.setPanelState("combat", false);
  assert.equal(writes.length, 0);
  for (const malformed of [null, "old", [], { activePreset: 9, panels: { combat: "true" }, presets: [] }]) {
    const b = configuredActor("malformed", { co2prism: malformed }); select(b);
    assert.equal(bar.configuration.activePreset, 1);
    assert.equal(bar.configuration.panels.combat, false);
    assert.deepEqual(Object.keys(bar.configuration.handPresets[1]), []);
  }
  assert.equal(writes.length, 0);
});

test("presets A/B : persistance et restauration, sans écraser slots ou champs inconnus", async () => {
  const { bar, context, configuredActor, select, writes } = setupConfiguration();
  const a = configuredActor("a", { other: { saved: true }, co2prism: {
    extra: { saved: true }, shortcuts: { x: { uuid: "existing" } }, hands: { presets: { future: { saved: true } } }
  } });
  const before = structuredClone(a.flags);
  const b = configuredActor("b");
  select(a); await bar.setActivePreset(2);
  select(b); await bar.setActivePreset(3);
  select(a);
  assert.equal(bar.configuration.activePreset, 2);
  assert.equal(bar.presetButtons[1]["aria-pressed"], "true");
  assert.equal(bar.presetButtons[0]["aria-pressed"], "false");
  assert.deepEqual(a.flags.co2prism.hands.presets, before.co2prism.hands.presets);
  assert.deepEqual(a.flags.other, before.other);
  assert.deepEqual(a.flags.co2prism.extra, before.co2prism.extra);
  bar.configuration.shortcuts.x.uuid = "local-only";
  assert.equal(a.flags.co2prism.shortcuts.x.uuid, "existing");
  select(b); assert.equal(bar.configuration.activePreset, 3);
  const reloaded = setup();
  reloaded.context.canvas.tokens.controlled = context.canvas.tokens.controlled;
  reloaded.bar.refreshActor();
  assert.equal(reloaded.bar.configuration.activePreset, 3);
  assert.equal(writes.length, 2);
  assert.ok(writes.every(write => write.scope === "co2prism" && write.key === "hands.active"));
});

test("volets indépendants, mises à jour distantes et aucune sauvegarde en boucle", async () => {
  const { bar, configuredActor, select, writes, hooks } = setupConfiguration();
  const a = configuredActor("a", { co2prism: { panels: { future: true } } }); select(a);
  await Promise.all([bar.setPanelState("combat", true), bar.setPanelState("competences", true),
    bar.setPanelState("equipements", true)]);
  assert.deepEqual({ ...bar.configuration.panels }, { combat: true, competences: true, equipements: true, voies: false });
  await bar.setPanelState("combat", false);
  assert.equal(bar.configuration.panels.competences, true);
  assert.equal(bar.configuration.panels.equipements, true);
  assert.equal(a.flags.co2prism.panels.future, true);
  assert.deepEqual(writes.map(write => write.key), ["panels.combat", "panels.competences", "panels.equipements", "panels.combat"]);
  const count = writes.length;
  a.flags.co2prism.hands = { active: 3 };
  a.flags.co2prism.panels.competences = false;
  hooks.get("updateActor")(a, { flags: { co2prism: a.flags.co2prism } });
  assert.equal(bar.configuration.activePreset, 3);
  assert.equal(bar.configuration.panels.competences, false);
  a.flags.co2prism.hands.active = 2;
  hooks.get("updateActor")(a, { "flags.co2prism.activePreset": 2 });
  assert.equal(bar.configuration.activePreset, 2);
  assert.equal(writes.length, count);
});

test("écritures rapides : ordre par acteur, permissions revérifiées et erreurs récupérables", async () => {
  const { bar, configuredActor, select, writes, errors } = setupConfiguration();
  const a = configuredActor("a"), b = configuredActor("b");
  const save = a.setFlag;
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  a.setFlag = async (...args) => { await blocked; return save(...args); };
  select(a);
  const p2 = bar.setActivePreset(2), p3 = bar.setActivePreset(3), p1 = bar.setActivePreset(1);
  await Promise.resolve();
  select(b); await bar.setActivePreset(3);
  assert.equal(bar.configuration.activePreset, 3);
  release(); await Promise.all([p2, p3, p1]);
  assert.equal(a.flags.co2prism.hands.active, 2);
  assert.equal(b.flags.co2prism.hands.active, 3);
  assert.deepEqual(writes.filter(write => write.actor === a).map(write => write.value), [2]);
  select(a);
  const denied = bar.setActivePreset(2);
  a.testUserPermission = (_user, level) => level === "OBSERVER";
  assert.equal(await denied, false);
  a.testUserPermission = () => true;
  a.setFlag = async () => { throw Error("Persistence unavailable"); };
  assert.equal(await bar.setActivePreset(1), false);
  assert.equal(errors.length, 1);
  a.setFlag = save;
  assert.equal(await bar.setActivePreset(1), true);
});

test("configuration : droits Owner/MJ, sélection neutre et entrées refusées", async () => {
  const { bar, context, configuredActor, select, writes, hooks } = setupConfiguration();
  const a = configuredActor("a", { co2prism: { hands: { active: 2 } } });
  a.testUserPermission = (_user, level) => level === "OBSERVER";
  select(a);
  assert.ok(bar.presetButtons.every(button => button.disabled));
  assert.equal(bar.configuration.activePreset, 2);
  assert.equal(await bar.setActivePreset(3), false);
  assert.equal(await bar.setPanelState("combat", true), false);
  context.game.user.isGM = true;
  assert.equal(await bar.setActivePreset(3), true);
  for (const invalid of [0, 4, "2", true, NaN]) assert.equal(await bar.setActivePreset(invalid), false);
  assert.equal(await bar.setPanelState("other", true), false);
  assert.equal(await bar.setPanelState("combat", "true"), false);
  assert.equal(writes.length, 1);
  a.testUserPermission = () => false;
  hooks.get("updateActor")(a, { ownership: {} });
  assert.equal(bar.actor, null);
  assert.ok(bar.presetButtons.every(button => button["aria-pressed"] === "false"));
  select(null);
  assert.equal(await bar.setActivePreset(1), false);
  assert.equal(writes.length, 1);
});

test("tokens liés et synthétiques : écrire sur token.actor, jamais sur baseActor", async () => {
  const { bar, context, configuredActor, select, token, hooks, writes } = setupConfiguration();
  const base = configuredActor("base", { co2prism: { hands: { active: 2 } } });
  select(base); await bar.setActivePreset(3);
  const synthetic = configuredActor("synthetic", { co2prism: { hands: { active: 3 } } });
  synthetic.uuid = "Scene.s.Token.t.Actor.base";
  const unlinked = token(synthetic); unlinked.document.baseActor = base;
  context.canvas.tokens.controlled = [unlinked]; hooks.get("controlToken")();
  await bar.setActivePreset(1);
  assert.equal(writes.at(-1).actor, synthetic);
  assert.equal(base.flags.co2prism.hands.active, 3);
  assert.equal(synthetic.flags.co2prism.hands.active, 1);
  hooks.get("updateToken")(unlinked.document, { "delta.flags.co2prism.hands.active": 1 });
  assert.equal(bar.configuration.activePreset, 1);
  hooks.get("canvasTearDown")();
  assert.ok(bar.presetButtons.every(button => button.disabled));
});

function setupSkills() {
  const env = setupConfiguration();
  const { bar, context, configuredActor, select } = env;
  context.window = { innerWidth: 1600, innerHeight: 1200 };
  bar.element = { style: { setProperty(key, value) { this[key] = value; } }, getBoundingClientRect() {
    return { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0,
      width: parseFloat(this.style.width) || 0, height: parseFloat(this.style.height) || 0 };
  } };
  context.game.settings = { get: () => "M", set() {} };
  bar.anchor = bar.element;
  bar.layout();
  context.game.i18n.format = (_, { value }) => "Base : " + value;
  bar.skillsPanel = { hidden: true };
  bar.skillsToggle = { dataset: {}, setAttribute(key, value) { this[key] = value; } };
  const node = () => ({ textContent: "", style: { setProperty(key, value) { this[key] = value; } } });
  bar.skillNodes = ["for", "agi", "con", "cha", "int", "vol", "per"].map(key => ({ key,
    value: node(), count: node(), button: { dataset: {}, setAttribute(key, value) { this[key] = value; } } }));
  // L'extraction HTML réelle est vérifiée dans Edge.
  context.document = { createElement: () => {
    const template = { innerHTML: "" };
    template.content = { querySelectorAll: () => [], get textContent() { return template.innerHTML; } };
    return template;
  } };
  const a = configuredActor("skills", { co2prism: { panels: { combat: true, equipements: true } } });
  a.system.abilities = Object.fromEntries(["for", "agi", "con", "cha", "int", "vol", "per"].map((key, index) =>
    [key, { value: [3, -1, 1, 2, 1, 0, 1][index] }]));
  const bonuses = {}, reads = [], rolls = [];
  a.getSkillBonuses = key => { reads.push(key); return bonuses[key] ?? []; };
  a.rollSkill = function (key, options) { rolls.push({ actor: this, key, options }); };
  select(a);
  bar.position = { x: 300, y: 350 }; bar.layout();
  return { ...env, a, bonuses, reads, rolls };
}

test("Compétences : état persistant, géométrie ancrée et aucun calcul du volet fermé", async () => {
  const { bar, a, reads, hooks } = setupSkills();
  assert.equal(reads.length, 0);
  const base = () => {
    const r = bar.element.getBoundingClientRect();
    return [r.left + bar.panelOffset.x, r.top + bar.panelOffset.y];
  };
  const before = base();
  await bar.setPanelState("competences", true);
  assert.equal(bar.skillsPanel.hidden, false);
  assert.equal(a.flags.co2prism.panels.competences, true);
  assert.equal(a.flags.co2prism.panels.combat, true);
  assert.equal(a.flags.co2prism.panels.equipements, true);
  assert.deepEqual(base(), before);
  assert.ok(reads.length >= 7);
  await bar.setPanelState("equipements", false);
  assert.equal(bar.skillsPanel.hidden, false);
  await bar.setPanelState("equipements", true);
  assert.equal(bar.skillsPanel.hidden, false);
  await bar.setPanelState("competences", false);
  assert.deepEqual(base(), before);
  const count = reads.length;
  hooks.get("updateActor")(a, { system: {} });
  hooks.get("updateItem")({ parent: a });
  assert.equal(reads.length, count);
  await Promise.all([bar.writeConfiguration("panels.competences", value => !value),
    bar.writeConfiguration("panels.competences", value => !value)]);
  assert.equal(bar.skillsPanel.hidden, true);
});

test("Compétences : valeurs signées, compte des bonus et actualisations natives", async () => {
  const { bar, a, bonuses, hooks } = setupSkills();
  bonuses.for = [{ name: "Métier", value: 4, description: "Long description", pathName: "Voie du métier", additionalInfos: "Seulement en montagne" },
    { name: "Capacité libre", sourceType: "capacity", value: 2 }];
  await bar.setPanelState("competences", true);
  assert.equal(bar.skillNodes[0].value.textContent, "+3");
  assert.equal(bar.skillNodes[1].value.textContent, "-1");
  assert.equal(bar.skillNodes[5].value.textContent, "+0");
  assert.equal(bar.skillNodes[0].count.textContent, "(2)");
  assert.equal(bar.skillNodes[1].count.textContent, "(0)");
  assert.match(bar.skillNodes[0].button.dataset.co2prismDescription, /\+4 — Seulement en montagne — Métier — Voie du métier/);
  assert.match(bar.skillNodes[0].button.dataset.co2prismDescription, /\+2 — Capacité libre — CO2PRISM.Paths.OffPaths/);
  assert.match(bar.skillNodes[0].button.dataset.co2prismDescription, /Base : \+3/);
  assert.doesNotMatch(bar.skillNodes[0].button.dataset.co2prismDescription, /Long description/);
  assert.equal(bar.skillNodes[1].button.dataset.co2prismDescription, "CO.abilities.long.agi\nBase : -1");
  a.system.abilities.for.value = -2;
  bonuses.for.push({ name: "Nouvelle capacité", value: 9 });
  hooks.get("updateActiveEffect")({ parent: a });
  assert.equal(bar.skillNodes[0].value.textContent, "-2");
  assert.equal(bar.skillNodes[0].count.textContent, "(3)");
  delete a.system.abilities.for;
  hooks.get("updateActor")(a, { "system.abilities.for": null });
  assert.equal(bar.skillNodes[0].value.textContent, "—");
  assert.equal(bar.skillNodes[0].button.disabled, true);
  delete a.getSkillBonuses;
  bar.refreshActor();
  assert.equal(bar.skillNodes[1].count.textContent, "(—)");
});

test("Compétences : sept jets CO2, rencontres, changement d'acteur et permissions", async () => {
  const { bar, a, rolls, configuredActor, select, context, token, hooks } = setupSkills();
  await bar.setPanelState("competences", true);
  a.type = "encounter";
  for (const { key } of bar.skillNodes) await bar.performAction(`skill:${key}`);
  assert.equal(rolls.length, 7);
  assert.deepEqual(rolls.map(roll => roll.key), ["for", "agi", "con", "cha", "int", "vol", "per"]);
  assert.ok(rolls.every(roll => roll.actor === a && roll.options.withDialog === true));
  a.testUserPermission = (_user, level) => level === "OBSERVER";
  await bar.performAction("skill:for");
  assert.equal(rolls.length, 7);
  assert.equal(bar.skillsToggle.disabled, true);
  assert.ok(bar.skillNodes.every(node => node.button.disabled));
  context.game.user.isGM = true;
  await bar.performAction("skill:for");
  assert.equal(rolls.length, 8);
  const b = configuredActor("b"); select(b);
  assert.equal(bar.skillsPanel.hidden, true);
  await bar.performAction("skill:for");
  assert.equal(rolls.length, 8);
  const synthetic = token(a); synthetic.document.baseActor = b;
  context.canvas.tokens.controlled = [synthetic]; hooks.get("controlToken")();
  assert.equal(bar.skillsPanel.hidden, false);
  await bar.performAction("skill:agi");
  assert.equal(rolls.at(-1).actor, a);
  await bar.performAction("skill:other");
  assert.equal(rolls.length, 9);
  hooks.get("canvasTearDown")();
  assert.equal(bar.skillsPanel.hidden, true);
});

function setupMovementDisplay() {
  const env = setup();
  const { bar, context, actor, hooks } = env;
  const a = actor("rounding");
  a.system.attributes.movement = { value: 10, unit: "m" };
  context.canvas.scene = { grid: { type: 1, distance: 3, units: "m" } };
  const settings = { movementRounding: "nearest", economyMode: "off" }, registrations = new Map();
  context.game.system = { id: "co2" };
  context.game.settings = { get: (_, key) => settings[key], register: (_, key, config) => registrations.set(key, config) };
  hooks.get("init")();
  bar.actor = a;
  bar.configuration = { panels: { combat: true }, activePreset: 1 };
  bar.combatPanel = { hidden: false, dataset: {} };
  bar.combatValues = Object.fromEntries(["meters", "cells", "def", "dr"].map(key => [key,
    { textContent: "", style: { setProperty() {} } }]));
  bar.combatEffects = { children: [], scrollLeft: 0 };
  bar.readCombatEffects = () => [];
  bar.renderEconomy = bar.renderCombatSlots = () => false;
  bar.refreshActor = () => bar.updateCombat();
  vm.runInContext("bar = globalThis.movementBar", Object.assign(context, { movementBar: bar }));
  const display = () => {
    bar.updateCombat();
    return [bar.combatValues.meters.textContent, bar.combatValues.cells.textContent];
  };
  return { ...env, a, settings, registrations, display };
}

test("14 affichage : arrondis entiers après conversion, mètres inchangés", () => {
  const { context, settings, display, bar } = setupMovementDisplay();
  for (const [distance, expected] of [[3, [3, 4, 3]], [2, [5, 5, 5]], [4, [3, 3, 2]]]) {
    context.canvas.scene.grid.distance = distance;
    for (const [index, mode] of ["nearest", "up", "down"].entries()) {
      settings.movementRounding = mode;
      assert.deepEqual(display(), ["10", String(expected[index])]);
      assert.equal(bar.readCombatData().cells, 10 / distance);
    }
  }
});

test("14 budget : arrondir les totaux disponibles en metres et cases, bonus puis consommation", async () => {
  const { settings, display, a, context } = setupMovementDisplay();
  let state;
  a.getFlag = () => state;
  a.setFlag = async (_, key, value) => { state = structuredClone(value); };
  const economy = new context.ActionEconomy(a);
  settings.economyMode = "always";
  await economy.grant("m"); await economy.spend("m");
  for (const [mode, expected] of [["nearest", "7"], ["up", "7"], ["down", "6"]]) {
    settings.movementRounding = mode;
    assert.deepEqual(display(), ["20", expected]);
  }
  await economy.spend("m");
  assert.deepEqual(display(), ["10", "3"]);
  await economy.reset(); settings.movementRounding = "nearest";
  assert.deepEqual(display(), ["20", "7"]);
});

test("14 conversions pieds, repli et précision flottante", () => {
  const { context, a, settings, display } = setupMovementDisplay();
  context.canvas.scene.grid = { type: 1, distance: 5, units: "ft" };
  settings.movementRounding = "up";
  assert.deepEqual(display(), ["10", "7"]);
  a.system.attributes.movement = { value: 30, unit: "ft" };
  context.canvas.scene.grid = { type: 1, distance: 2, units: "m" };
  assert.deepEqual(display(), ["9.14", "5"]);
  a.system.attributes.movement = { value: 10, unit: "m" };
  for (const mode of ["up", "down"]) {
    settings.movementRounding = mode;
    for (const distance of [2 + Number.EPSILON * 2, 2 - Number.EPSILON]) {
      context.canvas.scene.grid.distance = distance;
      assert.equal(display()[1], "5");
    }
  }
  for (const grid of [undefined, { type: 0, distance: 2, units: "m" }, { type: 1, distance: 0, units: "m" },
    { type: 1, distance: 2, units: "unknown" }]) {
    context.canvas.scene.grid = grid;
    assert.equal(display()[1], "—");
  }
  context.canvas.scene = undefined;
  assert.equal(display()[1], "—");
});

test("14 réglage monde : rafraîchissement immédiat local/distant sans écriture", () => {
  const { settings, registrations, a, display, bar, context } = setupMovementDisplay();
  const config = registrations.get("movementRounding");
  assert.equal(config.scope, "world"); assert.equal(config.config, true); assert.equal(config.default, "nearest");
  assert.deepEqual(Object.keys(config.choices), ["nearest", "up", "down"]);
  a.setFlag = a.update = () => assert.fail("Aucune écriture attendue");
  assert.deepEqual(display(), ["10", "3"]);
  for (const userId of ["local-gm", "remote-gm"]) {
    settings.movementRounding = "up";
    config.onChange("up", {}, userId);
    assert.equal(bar.combatValues.cells.textContent, "4");
    settings.movementRounding = "down";
    config.onChange("down", {}, userId);
    assert.equal(bar.combatValues.cells.textContent, "3");
  }
  settings.economyMode = "combat";
  assert.deepEqual(display(), ["20", "6"]);
  context.game.combats.active.started = false;
  assert.deepEqual(display(), ["10", "3"]);
});

test("Combat : mouvement réel, conversion mètres/cases et données DEF/RD préparées", () => {
  const { bar, context, actor, hooks, token } = setup();
  const a = actor("combat");
  a.system.attributes.movement = { value: 10, unit: "m" };
  a.system.combat = { def: { value: 15 }, dr: { value: 4 } };
  context.canvas.scene = { grid: { type: 1, distance: 2, units: "mètres" } };
  const read = () => ({ ...bar.readCombatData(a) });
  assert.deepEqual(read(), { meters: 10, cells: 5, def: 15, dr: 4 });
  context.canvas.tokens.controlled = [token(a)];
  let refreshed = 0;
  const refresh = bar.refreshActor.bind(bar);
  bar.refreshActor = (...args) => { refreshed++; refresh(...args); };
  hooks.get("updateScene")({}, { grid: {} });
  hooks.get("updateScene")(context.canvas.scene, { name: "changed" });
  assert.equal(refreshed, 0);
  context.canvas.scene.grid.distance = 1.5;
  hooks.get("updateScene")(context.canvas.scene, { "grid.distance": 1.5 });
  assert.equal(refreshed, 1);
  assert.equal(read().cells, 10 / 1.5);
  a.type = "encounter";
  a.system.attributes.movement = { value: 30, unit: "ft" };
  context.canvas.scene.grid = { type: 2, distance: 5, units: "ft" };
  assert.ok(Math.abs(read().meters - 9.144) < 0.0001);
  assert.ok(Math.abs(read().cells - 6) < 0.0001);
  for (const grid of [{ type: 0, distance: 5, units: "ft" }, { type: 1, distance: 0, units: "m" },
    { type: 1, distance: 1, units: "unknown" }, null]) {
    context.canvas.scene.grid = grid;
    assert.equal(read().cells, null);
  }
  a.system.attributes.movement = { value: 10, unit: "unknown" };
  assert.equal(read().meters, null);
  delete a.system.attributes.movement;
  delete a.system.combat.dr;
  assert.deepEqual(read(), { meters: null, cells: null, def: 15, dr: null });
  context.canvas.ready = false;
  assert.equal(read().cells, null);
});

test("Les presets de mains sont ind?pendants du volet Combat et des raccourcis", async () => {
  const { bar, configuredActor, select, writes } = setupConfiguration();
  const a = configuredActor("a", { co2prism: { panels: { competences: true, equipements: true },
    shortcuts: { untouched: { source: "Item.source", indice: 0, row: 2, order: 0 } } } });
  select(a);
  for (const number of [2, 3, 1]) {
    assert.equal(await bar.setActivePreset(number), true);
    assert.equal(bar.configuration.activePreset, number);
    assert.equal(bar.configuration.panels.combat, false);
    assert.equal(bar.configuration.panels.competences, true);
    assert.equal(bar.configuration.panels.equipements, true);
  }
  assert.ok(writes.every(write => write.key === "hands.active"));
  assert.equal(bar.configuration.shortcuts.untouched.row, 2);
});

test("Combat : effets natifs, effets CO2 et statuts sans doublons ni effet fictif", () => {
  const { bar, context, actor } = setup();
  const a = actor("effects");
  context.CONFIG = { statusEffects: [{ id: "dead", name: "Dead", img: "dead.svg" },
    { id: "weakened", name: "Weakened", img: "weakened.svg" }] };
  a.appliedEffects = [{ name: "Weakness", img: "weakness.svg", statuses: new Set(["weakened"]) }];
  a.system.currentEffects = [{ name: "Active capacity", sourceParts: { item: { img: "capacity.webp" } } },
    { name: "Missing source", get sourceParts() { throw Error("Deleted"); } }];
  a.statuses = new Set(["weakened", "dead", "unknown-status"]);
  const result = bar.readCombatEffects(a);
  assert.equal(result.length, 5);
  assert.deepEqual(Array.from(result, effect => effect.name), ["Weakness", "Active capacity", "Missing source", "Dead", "unknown-status"]);
  assert.equal(result[1].img, "capacity.webp");
  assert.equal(result[2].img, undefined);
  assert.equal(result[3].img, "dead.svg");
  assert.equal(bar.readCombatEffects(actor("empty")).length, 0);
  assert.equal(bar.readCombatEffects(null).length, 0);
});

test("Infobulles : getter CO2 complet lu une fois, source et tooltip défectueux isolés", () => {
  const { bar, actor } = setup(), a = actor("co2-tooltip");
  const html = "Durée : 3 rounds<br />Restant : 2<br />Dégâts : 1d6 feu<br />Statuts : Étourdi<br />Défense : -2<br />par Bâton de Mage";
  let calls = 0;
  a.system.currentEffects = [
    { name: "Flamme", sourceParts: { item: { img: "flame.svg" } }, get tooltip() { calls++; return html; } },
    { name: "Source perdue", get sourceParts() { throw Error("deleted"); }, get tooltip() { throw Error("deleted"); } },
    { name: "Soin", tooltip: "Soins : 1d4<br />", sourceParts: {} }
  ];
  const effects = bar.readCombatEffects(a);
  assert.equal(calls, 1);
  assert.equal(effects[0].tooltip, "<strong>Flamme</strong><br>" + html);
  assert.equal(effects[0].img, "flame.svg");
  assert.equal(effects[1].tooltip, "<strong>Source perdue</strong>");
  assert.equal(effects[1].img, undefined);
  assert.equal(effects[2].tooltip, "<strong>Soin</strong><br>Soins : 1d4<br />");
});

test("Infobulles : statuts configurés, traductions FR/EN et statut inconnu", () => {
  for (const language of ["fr", "en"]) {
    const { bar, context, actor } = setup(), a = actor("status-tooltips");
    const dictionary = language === "fr"
      ? { "status.stunned": "Étourdi", "status.stunned.description": "Ne peut pas agir." }
      : { "status.stunned": "Stunned", "status.stunned.description": "Cannot act." };
    context.game.i18n = { has: key => key in dictionary, localize: key => dictionary[key] ?? key };
    context.CONFIG = { statusEffects: [
      { id: "stunned", name: "status.stunned", description: "status.stunned.description", img: "stun.svg" },
      { id: "paralyzed", name: "Paralysé", description: "<p>Immobile.</p>" },
      { id: "unconscious", name: "Inconscient", description: "Sans réaction." },
      { id: "module-status", name: "Module", description: "Bonus < 3 & repos" },
      { id: "broken", name: "Cassé", get description() { throw Error("module"); } }
    ] };
    a.statuses = new Set(["stunned", "paralyzed", "unconscious", "module-status", "broken", "unknown"]);
    const effects = bar.readCombatEffects(a);
    assert.equal(effects[0].tooltip, "<strong>" + dictionary["status.stunned"] + "</strong><br>" + dictionary["status.stunned.description"]);
    assert.ok(effects[1].tooltip.includes("<p>Immobile.</p>"));
    assert.ok(effects[2].tooltip.includes("Sans réaction."));
    assert.ok(effects[3].tooltip.includes("Bonus &lt; 3 &amp; repos"));
    assert.equal(effects[4].tooltip, "<strong>Cassé</strong>");
    assert.equal(effects[5].tooltip, "<strong>unknown</strong>");
  }
});

test("Infobulles : ActiveEffect natif, durée préparée et repli sans durée inventée", () => {
  const { bar, context, actor } = setup(), a = actor("active-tooltips");
  context.game.i18n.localize = key => key === "DURATION.Label" ? "Durée" : key;
  a.appliedEffects = [
    { name: "Protection", description: "<p>Protection</p><p>+2 DEF</p>", duration: { label: "2 rounds", remaining: 2 } },
    { name: "Protection", description: "Autre effet distinct.", duration: { seconds: 42 } },
    { name: "<Mage & Ami>", get description() { throw Error("missing"); }, get duration() { throw Error("missing"); } }
  ];
  const effects = bar.readCombatEffects(a);
  assert.equal(effects.length, 3);
  assert.equal(effects[0].tooltip, "<p>Protection</p><p>+2 DEF</p><br>Durée : 2 rounds");
  assert.equal(effects[1].tooltip, "<strong>Protection</strong><br>Autre effet distinct.");
  assert.equal(effects[2].tooltip, "<strong>&lt;Mage &amp; Ami&gt;</strong>");
});

test("Statuts : durée absente ou indéfinie omise, durée réelle traduite en FR/EN", () => {
  for (const language of ["fr", "en"]) {
    const { bar, context, actor } = setup(), a = actor("status-duration");
    const none = language === "fr" ? "Aucun" : "None", title = language === "fr" ? "Durée" : "Duration";
    context.game.i18n.localize = key => ({ "COMMON.None": none, "EFFECT.DURATION.Label": title })[key] ?? key;
    context.CONFIG = { statusEffects: [{ id: "stunned", name: "Stunned", description: "Description native." }] };
    a.statuses = new Set(["stunned"]);
    for (const duration of [undefined, {}, { label: none }, { label: none, value: Infinity, remaining: Infinity },
      { label: "placeholder", value: null }, { label: "placeholder", remaining: Infinity }]) {
      a.appliedEffects = [{ name: "Stunned", description: "Description native.", statuses: new Set(["stunned"]), duration }];
      const effects = bar.readCombatEffects(a);
      assert.equal(effects.length, 1);
      assert.equal(effects[0].tooltip, "<strong>Stunned</strong><br>Description native.");
    }
    a.appliedEffects[0].duration = { label: "2 rounds", value: 3, remaining: 2 };
    assert.equal(bar.readCombatEffects(a)[0].tooltip,
      "<strong>Stunned</strong><br>Description native.<br>" + title + " : 2 rounds");
    context.game.i18n.localize = key => key === "COMMON.None" ? none : key;
    assert.ok(!bar.readCombatEffects(a)[0].tooltip.includes("DURATION.Label"));
  }
});

test("Statuts : correction isolée, effets natifs ordinaires et HTML CO2 inchangés", () => {
  const { bar, context, actor } = setup(), a = actor("mixed-duration");
  context.game.i18n.localize = key => key === "COMMON.None" ? "Aucun" : key;
  const co2 = "Durée : 3 rounds<br />Restant : 2<br />Soins : 1d6<br />";
  a.system.currentEffects = [{ name: "Soin CO2", tooltip: co2 }];
  a.appliedEffects = [
    { name: "Effet natif", description: "Distinct.", duration: { label: "Aucun", value: Infinity } },
    { name: "Paralysé", description: "Immobile.", statuses: new Set(["paralyzed"]), duration: { label: "Aucun", value: Infinity } }
  ];
  a.statuses = new Set(["paralyzed", "unconscious"]);
  context.CONFIG = { statusEffects: [{ id: "unconscious", name: "Inconscient", description: "Sans réaction." }] };
  const effects = bar.readCombatEffects(a);
  assert.equal(effects.length, 4);
  assert.equal(effects[0].tooltip, "<strong>Effet natif</strong><br>Distinct.<br>DURATION.Label : Aucun");
  assert.equal(effects[1].tooltip, "<strong>Paralysé</strong><br>Immobile.");
  assert.equal(effects[2].tooltip, "<strong>Soin CO2</strong><br>" + co2);
  assert.equal(effects[3].tooltip, "<strong>Inconscient</strong><br>Sans réaction.");
});

test("Infobulles : échec du nettoyage conserve le nom et les autres effets", () => {
  const { bar, context, actor } = setup(), a = actor("sanitize-failure");
  context.foundry.utils.cleanHTML = () => { throw Error("unavailable"); };
  a.appliedEffects = [{ name: "Effet sûr", description: "<p>Texte</p>" }, { name: "Autre" }];
  assert.deepEqual(Array.from(bar.readCombatEffects(a), effect => effect.tooltip),
    ["<strong>Effet sûr</strong>", "<strong>Autre</strong>"]);
});

function makeHandWeapon(item, twoHand = false) {
  item.type = "equipment";
  Object.assign(item.system, { isWeapon: true, useHands: true, equipped: false,
    properties: { equipable: true }, usage: { oneHand: !twoHand, twoHand } });
  return item;
}

function setupShortcuts() {
  const env = setupConfiguration();
  const { bar, context, configuredActor, select } = env;
  let sequence = 0;
  const warnings = [];
  context.foundry.utils.randomID = () => `test${++sequence}`;
  context.ui.notifications.warn = text => warnings.push(text);
  const create = id => {
    const actor = configuredActor(id, { co2prism: { panels: { combat: true } } });
    const item = { id: "item", uuid: `${actor.uuid}.Item.item`, type: "capacity", name: "Capacity", parent: actor,
      system: { description: "Description" }, testUserPermission: () => true };
    actor.toggleEquipmentEquipped = async itemId => { const model = actor.items.get(itemId).system; model.equipped = !model.equipped; };
    item.actions = [{ source: item.uuid, indice: 0, actionName: "Native action", actionImg: "native.webp",
      iconFA: "fas fa-sword", actionTypeFinal: "a", hasCharges: true, charges: 3, manaCost: 2 }];
    actor.items = new Map([[item.id, item]]);
    Object.defineProperty(actor, "actions", { configurable: true, get: () => [...actor.items.values()].flatMap(owned => owned.actions) });
    return { actor, item };
  };
  const { actor: a, item } = create("shortcuts"); makeHandWeapon(item, true); select(a);
  const payload = () => ({ type: "co.action", source: item.uuid, indice: 0, name: "Ignored copy", img: "ignored.webp" });
  const event = (data = payload()) => ({ dataTransfer: { types: ["text/plain"], getData: () => JSON.stringify(data) },
    preventDefault() {}, stopPropagation() {} });
  const node = { classList: { add() {}, remove() {} } };
  return { ...env, a, item, create, warnings, payload, event, node };
}

test("presets de mains : équipement, restauration, raccourcis communs et modifications externes", async () => {
  const { bar, a, item, warnings } = setupShortcuts();
  const add = (id, twoHand = false) => {
    const equipment = makeHandWeapon({ id, type: "equipment", parent: a, system: {},
      actions: [{ source: `${a.uuid}.Item.${id}`, indice: 0 }] }, twoHand);
    a.items.set(id, equipment);
    return equipment;
  };
  const sword = add("sword"), shield = add("shield");
  Object.assign(shield.system, { isWeapon: false, isShield: true });
  const reference = item => ({ itemId: item.id, indice: 0, source: item.actions[0].source });
  const calls = [];
  let refused;
  a.toggleEquipmentEquipped = async (id, bypass) => {
    assert.equal(bypass, false);
    calls.push(id);
    if (id === refused) return;
    const model = a.items.get(id).system;
    model.equipped = !model.equipped;
  };
  await bar.saveShortcut(a, 1, bar.slotRows()[0].at(-1), reference(item));
  await bar.saveShortcut(a, 1, bar.slotRows()[1].at(-1), reference(sword));
  const shortcuts = JSON.stringify(a.flags.co2prism.shortcuts);
  for (const [index, weapon] of [sword, shield].entries()) {
    assert.equal(await bar.saveShortcut(a, 1, bar.slotRows()[0][index], reference(weapon)), true);
  }
  a.flags.co2prism.hands.presets[2] = { "left-hand": reference(item), "right-hand": reference(item) };
  a.flags.co2prism.hands.presets[3] = { "left-hand": reference(sword) };
  assert.deepEqual(calls.splice(0), ["sword", "shield"]);
  refused = item.id;
  assert.equal(await bar.setActivePreset(2), false);
  assert.equal(bar.configuration.activePreset, 1);
  assert.ok(sword.system.equipped && shield.system.equipped && !item.system.equipped);
  assert.deepEqual(calls.splice(0), ["sword", "shield", item.id, "shield", "sword"]);
  refused = undefined;
  assert.equal(await bar.setActivePreset(3), true);
  assert.deepEqual(calls.splice(0), ["shield"]);
  assert.equal(await bar.setActivePreset(2), true);
  assert.deepEqual(calls.splice(0), ["sword", item.id]);
  assert.ok(item.system.equipped && !sword.system.equipped);
  assert.equal(await bar.saveShortcut(a, 2, bar.slotRows()[0][1], reference(shield)), false);
  item.system.equipped = false;
  assert.equal(await bar.setActivePreset(2), true);
  assert.deepEqual(calls.splice(0), []);
  assert.equal(item.system.equipped, false);
  assert.equal(await bar.setActivePreset(2), true);
  assert.deepEqual(calls, []);
  item.system.equipped = true;
  a.items.delete(shield.id);
  assert.equal(await bar.setActivePreset(1), false);
  assert.equal(bar.configuration.activePreset, 2);
  assert.ok(item.system.equipped && warnings.length >= 3);
  a.flags.co2prism.hands.presets[3] = {};
  assert.equal(await bar.setActivePreset(3), true);
  assert.equal(item.system.equipped, false);
  assert.equal(JSON.stringify(a.flags.co2prism.shortcuts), shortcuts);
});

test("presets de mains : MAJ délègue la politique des mains libres à CO2", async t => {
  let source;
  try {
    source = readFileSync(new URL("../../../systems/co2/module/documents/actor.mjs", import.meta.url), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("Source du système CO2 installé indisponible");
    return;
  }
  const { bar, a, item, context } = setupShortcuts();
  const method = signature => {
    const start = source.indexOf(signature);
    assert.ok(start >= 0);
    return source.slice(start, source.indexOf("\n  }", start) + 4);
  };
  context.SYSTEM = { EQUIPMENT_SUBTYPES: Object.fromEntries(["weapon", "shield", "misc"].map(id => [id, { id }])) };
  const native = vm.runInContext(`({
    ${method("async toggleEquipmentEquipped(itemId, bypassChecks)")},
    ${method("canEquipItem(item, bypassChecks) {")},
    ${method("_hasEnoughFreeHands(item, bypassChecks) {")}
  })`, context);
  const calls = [];
  Object.assign(a, native, {
    toggleEquipmentEquipped(id, bypass) {
      calls.push([id, bypass]);
      return native.toggleEquipmentEquipped.call(this, id, bypass);
    },
    async _toggleItemFieldAndActions(item, field, value) { item.system[field] = value; }
  });
  a.items.filter = predicate => [...a.items.values()].filter(predicate);
  const outside = makeHandWeapon({ id: "outside", type: "equipment", parent: a, system: {}, actions: [] });
  outside.system.equipped = true;
  outside.system.subtype = item.system.subtype = "weapon";
  a.items.set(outside.id, outside);
  a.flags.co2prism.hands = { presets: { 2: { "right-hand": { kind: "equipment", itemId: item.id } } } };
  let mode, locked = false;
  context.game.settings.get = (scope, key) => scope === "co2" ? mode : key === "locked" && locked;
  for (const setting of ["none", "all", "gm"]) for (const gm of [false, true]) for (const shift of [false, true]) {
    mode = setting; context.game.user.isGM = gm; locked = shift;
    const expected = setting === "none" || (shift && (setting === "all" || gm));
    assert.equal(await bar.setActivePreset(2, shift), expected);
    assert.equal(item.system.equipped, expected);
    assert.equal(bar.configuration.activePreset, expected ? 2 : 1);
    assert.equal(outside.system.equipped, true);
    assert.deepEqual(calls.splice(0), [[item.id, shift]]);
    if (expected) {
      assert.equal(await bar.setActivePreset(1), true);
      assert.deepEqual(calls.splice(0), [[item.id, false]]);
    }
  }
  a.flags.co2prism.hands.presets[2]["left-hand"] = { kind: "equipment", itemId: outside.id };
  assert.equal(await bar.setActivePreset(2, true), false);
  assert.deepEqual(calls, []);
  assert.equal(outside.system.equipped, true);
});

test("raccourcis : 3/1 initiaux, mains permanentes et croissance indépendante", async () => {
  const { bar, a, payload } = setupShortcuts();
  const ref = bar.shortcutFromDrop(a, payload());
  assert.deepEqual(Array.from(bar.slotRows(), row => row.length), [3, 1, 1]);
  await bar.saveShortcut(a, 1, bar.slotRows()[0][0], ref);
  await bar.saveShortcut(a, 1, bar.slotRows()[0][1], ref);
  assert.deepEqual(Array.from(bar.slotRows(), row => row.length), [3, 1, 1]);
  const empty = bar.slotRows()[0].at(-1);
  await Promise.all([bar.saveShortcut(a, 1, empty, ref), bar.saveShortcut(a, 1, empty, ref)]);
  assert.deepEqual(Array.from(bar.slotRows(), row => row.length), [5, 1, 1]);
  assert.deepEqual(Array.from(bar.slotRows()[0].filter(slot => !slot.hand && !slot.terminal), slot => slot.order), [0, 1]);
  await bar.saveShortcut(a, 1, bar.slotRows()[1].at(-1), ref);
  assert.deepEqual(Array.from(bar.slotRows(), row => row.length), [5, 2, 1]);
  assert.ok(bar.slotRows().every(row => row.filter(slot => slot.terminal).length === 1));
  assert.equal(bar.slotRows()[0][0].hand, "left");
  assert.equal(bar.slotRows()[0][1].hand, "right");
});

test("groupes de raccourcis : capacité, persistance, déplacement et nettoyage individuel", async () => {
  const { bar, a, item, event, node, create, select, context, writes, warnings } = setupShortcuts();
  item.actions = Array.from({ length: 5 }, (_, indice) => ({ source: item.uuid, indice }));
  item.system.actions = item.actions;
  const payload = indice => ({ type: "co.action", source: item.uuid, indice });
  let locked = false;
  context.game.settings.get = () => locked;
  const getSlot = () => bar.slotRows().flat().find(slot => slot.key === key);
  const capture = actionIndex => ({ actor: a, token: bar.token, key, reference: getSlot().reference, actionIndex });
  const indices = () => Array.from(bar.shortcutReferences(getSlot().reference), reference => reference.indice);
  assert.equal(await bar.dropSlot(event(payload(0)), bar.slotRows()[0].at(-1), node), true);
  const key = bar.slotRows()[0][2].key;
  assert.deepEqual(indices(), [0]);
  for (const index of [1, 2, 3]) assert.equal(await bar.dropSlot(event(payload(index)), getSlot(), node), true);
  assert.deepEqual(indices(), [0, 1, 2, 3]);
  assert.deepEqual(Object.keys(getSlot().reference).sort(), ["actions", "order", "row"]);
  const saved = JSON.parse(JSON.stringify(a.flags));
  const reloaded = setupShortcuts();
  const restored = reloaded.configuredActor("restored", saved); reloaded.select(restored);
  assert.deepEqual(Array.from(reloaded.bar.slotRows()[0][2].reference.actions, entry => entry.indice), [0, 1, 2, 3]);
  const count = writes.length;
  assert.equal(await bar.dropSlot(event(payload(4)), getSlot(), node), false);
  assert.equal(warnings.at(-1), "CO2PRISM.Combat.ShortcutGroupFull");
  assert.equal(await bar.manageShortcut(capture()), false);
  assert.equal(writes.length, count);
  assert.equal(await bar.manageShortcut(capture(), bar.slotRows()[1].at(-1)), true);
  assert.equal(getSlot().row, 2);
  assert.deepEqual(indices(), [0, 1, 2, 3]);
  assert.equal(await bar.manageShortcut(capture(0), { ...bar.slotRows()[0].at(-1), actionIndex: 1 }), false);
  assert.equal(await bar.manageShortcut(capture(0), { ...getSlot(), actionIndex: 2 }), true);
  assert.deepEqual(indices(), [1, 2, 0, 3]);
  const stale = capture(0);
  select(create("other").actor);
  assert.equal(await bar.manageShortcut(stale, { row: 2, key, actionIndex: 1 }), false);
  select(a);
  locked = true;
  assert.equal(await bar.dropSlot(event(payload(4)), getSlot(), node), false);
  locked = false;
  a.testUserPermission = (_, level) => level === "OBSERVER";
  assert.equal(await bar.dropSlot(event(payload(4)), getSlot(), node), false);
  a.testUserPermission = () => true;
  assert.equal(await bar.manageShortcut(capture(3)), true);
  assert.deepEqual(indices(), [1, 2, 0]);
  const beforeDuplicate = writes.length;
  assert.equal(await bar.dropSlot(event(payload(1)), getSlot(), node), false);
  assert.equal(warnings.at(-1), "CO2PRISM.Combat.ShortcutGroupDuplicate");
  assert.equal(writes.length, beforeDuplicate);
  item.actions.length = 2;
  bar.pruneShortcuts(bar.slotRows());
  await bar.configWrites.get(a);
  assert.deepEqual(indices(), [1, 0]);
  assert.equal(await bar.manageShortcut(capture(0)), true);
  assert.deepEqual(indices(), [0]);
  assert.equal(getSlot().reference.actions, undefined);
  assert.equal(bar.resolveShortcut(a, getSlot().reference).action, item.actions[0]);
  assert.equal(await bar.manageShortcut(capture()), true);
  assert.equal(getSlot(), undefined);
});

test("actions temporaires : les deux propriétés CO2 sont nécessaires indépendamment de l'état actif", () => {
  const { bar } = setup();
  for (const activable of [true, false, undefined]) {
    for (const temporary of [true, false, undefined]) {
      for (const enabled of [true, false]) {
        const action = { properties: { activable, temporary, enabled } };
        const eligible = activable === true && temporary === true;
        assert.equal(bar.shortcutCanToggle(action), eligible);
        assert.equal(bar.shortcutActive(action), eligible && enabled);
      }
    }
  }
  assert.equal(bar.shortcutCanToggle(null), false);
});

test("règles de preset : défauts, isolation, identité CO2 et invalidation prudente", async () => {
  const { bar, a, item, create, select, writes } = setupShortcuts();
  const installAction = (support, label) => {
    const action = { source: support.uuid, indice: 0, label,
      properties: { activable: true, temporary: true, enabled: false },
      toObject() { return { source: this.source, indice: this.indice, label: this.label, properties: { ...this.properties } }; } };
    support.actions = [action];
    return action;
  };
  const action = installAction(item, "Posture");
  const reference = { itemId: item.id, indice: 0, source: item.uuid };
  const rule = (preset, actor = a, ref = reference) => bar.getPresetActionRule(actor, ref, preset);
  const save = (preset, value) => bar.setPresetActionRule(a, reference, preset, value);
  const original = JSON.stringify(a.flags);
  assert.deepEqual([1, 2, 3].map(preset => rule(preset)), ["unchanged", "unchanged", "unchanged"]);
  assert.equal(JSON.stringify(a.flags), original);
  assert.equal(await save(1, "activate"), true);
  assert.equal(await save(2, "deactivate"), true);
  assert.equal(await save(3, "unchanged"), false);
  assert.equal(await save(3, "invalid"), false);
  assert.deepEqual([1, 2, 3].map(preset => rule(preset)), ["activate", "deactivate", "unchanged"]);
  const entry = a.flags.co2prism.presetActionRules["item:0"];
  assert.deepEqual(Object.keys(entry).sort(), ["1", "2", "fingerprint"]);
  entry[3] = "invalid";
  assert.equal(rule(3), "unchanged");
  action.properties.enabled = true;
  assert.equal(rule(1, a, { ...reference, source: "Scene.s.Token.t.Actor.a.Item.item" }), "activate");
  await bar.saveShortcut(a, 1, bar.slotRows()[0].at(-1), reference);
  const slot = bar.slotRows()[0].at(-2);
  await bar.manageShortcut({ actor: a, token: bar.token, ...slot }, bar.slotRows()[1].at(-1));
  assert.equal(rule(1, a, bar.slotRows()[1][0].reference), "activate");
  item.actions.push({ ...action, indice: 1, label: "Deuxième posture" });
  assert.equal(await bar.saveShortcut(a, 1, bar.slotRows()[1][0], { ...reference, indice: 1 }), true);
  const [first, second] = bar.slotRows()[1][0].reference.actions;
  assert.equal(rule(1, a, first), "activate");
  assert.equal(rule(1, a, second), "unchanged");
  assert.equal(setupShortcuts().bar.getPresetActionRule(a, first, 2), "deactivate");
  const { actor: other, item: otherItem } = create("other-rules");
  installAction(otherItem, "Posture"); select(other);
  assert.equal(rule(1, other, { ...reference, source: otherItem.uuid }), "unchanged");
  select(a);
  action.properties.temporary = false;
  assert.equal(rule(1), "unchanged");
  assert.equal(await save(1, "deactivate"), false);
  action.properties.temporary = true;
  a.items.delete(item.id);
  const writesBeforeMissing = writes.length;
  assert.equal(rule(1), "unchanged");
  assert.equal(writes.length, writesBeforeMissing);
  a.items.set(item.id, item);
  const replacement = installAction(item, "Autre posture");
  assert.deepEqual([1, 2, 3].map(preset => rule(preset)), ["unchanged", "unchanged", "unchanged"]);
  a.testUserPermission = (_, permission) => permission !== "OWNER";
  assert.equal(await save(1, "activate"), false);
  a.testUserPermission = () => true;
  a.unsetFlag = async (scope, path) => delete a.flags[scope].presetActionRules[path.split(".")[1]];
  assert.equal(await save(2, "activate"), true);
  assert.equal(rule(1), "unchanged");
  assert.equal(rule(2), "activate");
  assert.equal(await save(2, "unchanged"), true);
  assert.equal(a.flags.co2prism.presetActionRules["item:0"], undefined);
  a.activateAction = () => assert.fail("Le preset déjà actif ne doit pas exécuter d'action");
  await save(1, "activate");
  assert.equal(await bar.setActivePreset(1), true);
  assert.equal(replacement.properties.enabled, false);
});

test("automatisation : preset entrant validé, transitions natives séquentielles et no-op strict", async () => {
  const { bar, a, item, create, select, context, hooks, writes } = setupShortcuts();
  let locked = false, blockEquipment = true, blockedCondition = true;
  context.game.settings.get = (_scope, key) => key === "locked" ? locked : key === "economyMode" ? "always" : undefined;
  const action = (indice, enabled, time = "f") => ({
    indice, source: item.uuid, type: "heal", actionTypeFinal: time,
    properties: { activable: true, temporary: true, enabled },
    toObject() { return { source: this.source, indice: this.indice, type: this.type, properties: { ...this.properties } }; }
  });
  item.actions = [action(0, false, "m"), action(1, true), action(2, true), action(3, false), action(4, false), action(5, false)];
  item.system.actions = item.actions;
  item.actions[3].isVisible = async () => !blockedCondition;
  const reference = indice => ({ itemId: item.id, source: item.uuid, indice });
  a.flags.co2prism.hands = { presets: { 2: { "left-hand": { kind: "equipment", itemId: item.id } } } };
  for (const [indice, preset, rule] of [[0, 2, "activate"], [0, 1, "deactivate"], [1, 2, "deactivate"],
    [3, 2, "activate"], [4, 2, "activate"], [5, 2, "activate"]]) {
    assert.equal(await bar.setPresetActionRule(a, reference(indice), preset, rule), true);
  }
  item.actions[5].properties.temporary = false;
  const { actor: other } = create("observer");
  const operations = [];
  a.toggleEquipmentEquipped = async (id, shift) => {
    operations.push(["equip", id, shift]);
    if (!blockEquipment) item.system.equipped = !item.system.equipped;
  };
  a.activateAction = async ({ source, indice, state, type }) => {
    operations.push(["action", indice, state]);
    assert.equal(source, item.uuid);
    assert.equal(type, undefined);
    assert.equal(item.system.equipped, a.flags.co2prism.hands.active === 2);
    const guards = [];
    const details = { item, indice, state, type, guard: promise => guards.push(promise) };
    hooks.get("co2.preActivateAction")?.(a, details);
    if ((await Promise.all(guards)).includes(false) || indice === 4) return false;
    item.actions[indice].properties.enabled = state;
    hooks.get("co2.postActivateAction")?.(a, { ...details, success: true });
    hooks.get("updateItem")(item);
    return true;
  };
  assert.equal(await bar.setActivePreset(2), false);
  assert.deepEqual(operations.splice(0), [["equip", item.id, false]]);
  assert.equal(bar.configuration.activePreset, 1);
  blockEquipment = false;
  await bar.setPanelState("combat", false);
  locked = true;
  assert.equal(await bar.setActivePreset(2), true);
  assert.deepEqual(operations.splice(0), [["equip", item.id, false], ["action", 0, true], ["action", 1, false], ["action", 4, true]]);
  assert.deepEqual(item.actions.map(entry => entry.properties.enabled), [true, false, true, false, false, false]);
  assert.equal(context.game.settings.get("co2prism", "locked"), true);
  assert.equal(a.flags.co2prism.actionEconomy.normal.m, false);
  item.actions[0].properties.enabled = false;
  item.system.equipped = false;
  const beforeSamePreset = writes.length;
  assert.equal(await bar.setActivePreset(2), true);
  bar.refreshActor();
  select(other); select(a);
  assert.deepEqual(operations, []);
  assert.equal(writes.length, beforeSamePreset);
  item.system.equipped = true;
  item.actions[0].properties.enabled = true;
  assert.equal(await bar.setActivePreset(1), true);
  assert.deepEqual(operations.splice(0), [["equip", item.id, false], ["action", 0, false]]);
  item.actions[0].properties.enabled = true;
  blockedCondition = false;
  item.actions.pop();
  assert.equal(await bar.setActivePreset(2), true);
  assert.deepEqual(operations.splice(0), [["equip", item.id, false], ["action", 3, true], ["action", 4, true]]);
  assert.equal(item.actions[3].properties.enabled, true);
});

test("actions conditionnelles : index CO2, visibilité native, ordre et origines multiples", async () => {
  const { bar, a, item, create, writes } = setupShortcuts();
  const linked = object => ({ predicate: "isLinkedActionActivated", object });
  const checks = [];
  const add = (indice, conditions = [], visible = true) => ({
    indice, source: item.uuid, conditions, properties: { enabled: false },
    async isVisible(source, actor) {
      assert.equal(source, item);
      assert.equal(actor, a);
      checks.push(indice);
      return visible && conditions.every(condition => condition.predicate !== "isLinkedActionActivated"
        || source.system.actions[condition.object]?.properties.enabled);
    }
  });
  item.actions = item.system.actions = [add(0), add(1, [linked("0")]), add(2, [{ predicate: "isEquipped" }, linked("0")]),
    add(3, [linked("0")]), add(4), add(5, [linked(4)]), add(6, [linked("99")])];
  const ref = indice => ({ source: item.uuid, itemId: item.id, indice });
  const rows = [[{ key: "group", row: 1, reference: { actions: [ref(4), ref(0)] } },
    { key: "manual", row: 1, reference: ref(2) }], [{ key: "repeat", row: 2, reference: ref(0) }]];
  const collect = actor => bar.collectConditionalActions(actor, rows, { visibility: new Map() });
  const bySource = (groups, index) => groups.find(group => group.source.indice === index);
  const indices = refs => Array.from(refs, ref => ref.indice);
  const inactive = await collect(a);
  assert.deepEqual(indices(bySource(inactive, 0).dependencies), [1, 2, 3]);
  assert.deepEqual(indices(bySource(inactive, 0).available), []);
  assert.deepEqual(checks, []);
  item.actions[0].properties.enabled = item.actions[4].properties.enabled = true;
  const active = await collect(a);
  assert.equal(active.length, 2);
  assert.deepEqual(indices(bySource(active, 0).available), [1, 2, 3]);
  assert.deepEqual(indices(bySource(active, 4).available), [5]);
  assert.deepEqual(Array.from(bySource(active, 0).origins, origin => [origin.key, origin.row, origin.actionIndex]),
    [["group", 1, 1], ["repeat", 2, undefined]]);
  item.actions[2] = add(2, [{ predicate: "isEquipped" }, linked("0")], false);
  item.actions[3].conditions.push(linked("4"));
  item.actions[4].properties.enabled = false;
  const restricted = bySource(await collect(a), 0);
  assert.deepEqual(indices(restricted.dependencies), [1, 2, 3]);
  assert.deepEqual(indices(restricted.available), [1]);
  a.items.delete(item.id);
  assert.equal((await collect(a)).length, 0);
  const other = create("other-context").actor;
  assert.equal((await collect(other)).length, 0);
  assert.equal(writes.length, 0);
});

test("raccourcis : références natives seules, restauration, isolation et disparition", async () => {
  const { bar, context, a, item, payload, create, select, writes } = setupShortcuts();
  const original = structuredClone(a.system);
  const ref = bar.shortcutFromDrop(a, payload());
  await bar.saveShortcut(a, 1, bar.slotRows()[0].at(-1), ref);
  const slots = a.flags.co2prism.shortcuts;
  const stored = Object.values(slots)[0];
  assert.deepEqual(Object.keys(stored).sort(), ["source", "indice", "itemId", "row", "order"].sort());
  assert.equal(stored.itemId, item.id);
  assert.equal(bar.resolveShortcut(a, stored).action, item.actions[0]);
  item.actions[0].manaCost = 7;
  assert.equal(bar.resolveShortcut(a, stored).action.manaCost, 7);
  a.items.delete(item.id);
  assert.equal(bar.resolveShortcut(a, stored), null);
  assert.equal(bar.slotRows()[0].length, 4);
  assert.deepEqual(a.flags.co2prism.shortcuts, slots);
  a.items.set(item.id, item);
  await bar.setActivePreset(2);
  assert.deepEqual(Array.from(bar.slotRows(), row => row.length), [4, 1, 1]);
  const { actor: b } = create("other"); select(b);
  assert.deepEqual(Array.from(bar.slotRows(), row => row.length), [3, 1, 1]);
  select(a); await bar.setActivePreset(1);
  assert.equal(bar.slotRows()[0].length, 4);
  const reloaded = setupConfiguration();
  reloaded.context.canvas.tokens.controlled = context.canvas.tokens.controlled;
  reloaded.bar.refreshActor();
  assert.equal(reloaded.bar.slotRows()[0].length, 4);
  assert.deepEqual(a.system, original);
  assert.ok(writes[0].key.startsWith("shortcuts."));
});

test("raccourcis : payloads refusés sans écriture ni croissance, droits et contexte de drag", async () => {
  const { bar, a, item, payload, event, node, create, select, writes, warnings } = setupShortcuts();
  const slot = bar.slotRows()[0].at(-1);
  for (const data of [{ type: "Item", uuid: "external" }, { ...payload(), source: "Actor.other.Item.item" },
    { ...payload(), indice: -1 }, { ...payload(), indice: "0" }, { ...payload(), indice: 999 }]) {
    assert.equal(await bar.dropSlot(event(data), slot, node), false);
  }
  assert.equal(writes.length, 0);
  assert.equal(bar.slotRows()[0].length, 3);
  item.actions.push({ ...item.actions[0] });
  assert.equal(await bar.dropSlot(event(), slot, node), false);
  item.actions.pop();
  a.testUserPermission = (_user, level) => level === "OBSERVER";
  assert.equal(await bar.dropSlot(event(), slot, node), false);
  a.testUserPermission = () => true;
  const drag = event(); bar.hoverSlot(drag, slot, node);
  const { actor: b } = create("b"); select(b);
  assert.equal(await bar.dropSlot(drag, slot, node), false);
  select(a);
  const next = event(); bar.hoverSlot(next, slot, node);
  await bar.setActivePreset(2);
  const count = writes.length;
  assert.equal(await bar.dropSlot(next, slot, node), true);
  assert.equal(writes.length, count + 1);
  assert.ok(warnings.length >= 7);
});

test("raccourcis : attaque de rencontre, action portée par acteur et acteur synthétique", async () => {
  const { bar, a, item, context, token, hooks, payload } = setupShortcuts();
  a.type = "encounter"; item.type = "attack";
  assert.equal(bar.shortcutFromDrop(a, { type: "co.attack", uuid: item.uuid }).indice, 0);
  const direct = { source: a.uuid, indice: 5, actionName: "Actor action" };
  Object.defineProperty(a, "actions", { get: () => [direct], configurable: true });
  assert.equal(bar.shortcutFromDrop(a, { type: "co.action", source: a.uuid, indice: 5 }).itemId, null);
  assert.equal(bar.resolveShortcut(a, { source: a.uuid, indice: 5, itemId: null }).action, direct);
  Object.defineProperty(a, "actions", { get: () => item.actions });
  const base = { flags: { co2prism: {} } };
  const synthetic = token(a); synthetic.document.baseActor = base;
  a.uuid = "Scene.s.Token.t.Actor.a";
  context.canvas.tokens.controlled = [synthetic]; hooks.get("controlToken")();
  const ref = bar.shortcutFromDrop(a, payload());
  await bar.saveShortcut(a, 1, bar.slotRows()[1].at(-1), ref);
  assert.equal(Object.keys(base.flags.co2prism).length, 0);
  assert.equal(bar.slotRows()[1].length, 2);
});

async function setupExecution() {
  const env = setupShortcuts();
  const { bar, a, item, context } = env;
  const action = item.actions[0];
  Object.assign(action, { actionTypeFinal: "none", type: "melee", properties: { temporary: false, enabled: false },
    autoAttack: false, hasResolversWithDomage: true });
  const ref = bar.shortcutFromDrop(a, env.payload());
  await bar.saveShortcut(a, 1, bar.slotRows()[0][0], ref);
  const calls = [];
  context.game.system = { api: { macros: Object.fromEntries(["useAction", "sendToChat", "openSheet"].map(name =>
    [name, async (...args) => { calls.push([name, ...args]); }])) } };
  const click = modifiers => ({ button: 0, detail: 1, preventDefault() {}, stopPropagation() {}, ...modifiers });
  const target = (key = "left-hand") => ({ actor: a, token: bar.token, preset: 1, key,
    reference: bar.readConfiguration(a).slots[key] });
  return { ...env, action, calls, click, target };
}

test("attaques de rencontre : source commune, persistance et exécution par Item propriétaire", async () => {
  const { bar, a, item, action, calls, click, target, writes } = await setupExecution();
  a.type = "encounter"; item.type = "attack";
  action.source = "Item.sourceCommune";
  action.resolvers = [{ attack: "+14", damage: "1d6+6" }];
  const secondAction = { ...action, resolvers: [{ attack: "+14", damage: "1d4 + 3" }] };
  const second = { ...item, id: "serpent", uuid: `${a.uuid}.Item.serpent`, actions: [secondAction] };
  a.items.set(second.id, second);
  assert.equal(bar.shortcutFromDrop(a, { type: "co.action", source: action.source, indice: 0 }), null);
  for (const [owned, key] of [[item, "attack-1"], [second, "attack-2"]]) {
    const ref = bar.shortcutFromDrop(a, { type: "co.attack", uuid: owned.uuid });
    assert.equal(ref.itemId, owned.id);
    assert.equal(ref.source, owned.uuid);
    await bar.saveShortcut(a, 1, { row: 1, key, order: 0 }, ref);
    const restored = JSON.parse(JSON.stringify(bar.readConfiguration(a).slots[key]));
    assert.equal(bar.resolveShortcut(a, restored).action, owned.actions[0]);
    const count = writes.length;
    for (const modifiers of [{}, { altKey: true }, { shiftKey: true }]) {
      assert.equal(await bar.executeShortcut(click(modifiers), target(key)), true);
    }
    assert.deepEqual(calls.splice(0), [["useAction", owned.uuid, 0, "attack"],
      ["useAction", owned.uuid, 0, "damage"], ["openSheet", owned.uuid]]);
    assert.equal(writes.length, count);
    assert.equal(owned.actions[0].actionTypeFinal, "none");
    assert.equal(owned.actions[0].source, "Item.sourceCommune");
  }
  secondAction.autoAttack = true;
  await bar.executeShortcut(click(), target("attack-2"));
  assert.deepEqual(calls.pop(), ["useAction", second.uuid, 0, "auto"]);
  const stale = target("attack-2");
  a.items.delete(second.id);
  assert.equal(bar.resolveShortcut(a, stale.reference), null);
  assert.equal(await bar.executeShortcut(click(), stale), false);
  assert.equal(calls.length, 0);
});

test("attaques de rencontre : UUID synthétique, droits et dépôts étrangers refusés", () => {
  const { bar, a, item, create } = setupShortcuts();
  item.type = "attack";
  const oldUuid = item.uuid;
  a.uuid = "Scene.scene.Token.token.Actor.synthetic";
  item.uuid = `${a.uuid}.Item.${item.id}`;
  const drop = () => bar.shortcutFromDrop(a, { type: "co.attack", uuid: item.uuid });
  assert.equal(drop().source, item.uuid);
  assert.equal(bar.shortcutFromDrop(a, { type: "co.attack", uuid: oldUuid }), null);
  assert.equal(bar.shortcutFromDrop(create("other").actor, { type: "co.attack", uuid: item.uuid }), null);
  item.testUserPermission = () => false;
  assert.equal(drop(), null);
  item.testUserPermission = () => true;
  a.testUserPermission = () => false;
  assert.equal(drop(), null);
  a.testUserPermission = () => true;
  item.parent = create("foreign").actor;
  assert.equal(drop(), null);
});

test("exécution CO2 : attaque/dommages/chat/feuille et priorité Shift > Ctrl > Alt", async () => {
  const { bar, item, calls, click, target, writes, a } = await setupExecution();
  const count = writes.length, flags = JSON.stringify(a.flags);
  for (const modifiers of [{}, { ctrlKey: true }, { altKey: true }, { shiftKey: true },
    { shiftKey: true, ctrlKey: true, altKey: true }, { ctrlKey: true, altKey: true }]) {
    assert.equal(await bar.executeShortcut(click(modifiers), target()), true);
  }
  assert.deepEqual(calls, [["useAction", item.uuid, 0, "attack"], ["sendToChat", item.uuid, undefined, 0],
    ["useAction", item.uuid, 0, "damage"], ["openSheet", item.uuid], ["openSheet", item.uuid],
    ["sendToChat", item.uuid, undefined, 0]]);
  assert.equal(writes.length, count);
  assert.equal(JSON.stringify(a.flags), flags);
});

test("exécution CO2 : Alt sans dommages ne déclenche rien, actions temporaires et autres types", async () => {
  const { bar, item, action, calls, click, target, warnings } = await setupExecution();
  action.hasResolversWithDomage = false;
  assert.equal(await bar.executeShortcut(click({ altKey: true }), target()), false);
  assert.equal(calls.length, 0);
  await bar.executeShortcut(click(), target());
  assert.deepEqual(calls.pop(), ["useAction", item.uuid, 0, "attack"]);
  action.properties.temporary = true; action.hasResolversWithDomage = true;
  await bar.executeShortcut(click(), target());
  assert.deepEqual(calls.pop(), ["useAction", item.uuid, 0]);
  assert.equal(await bar.executeShortcut(click({ altKey: true }), target()), false);
  action.properties.temporary = false;
  for (const type of ["heal", "buff", "debuff", "consumable"]) {
    action.type = type;
    await bar.executeShortcut(click(), target());
    assert.deepEqual(calls.pop(), ["useAction", item.uuid, 0, type]);
    assert.equal(await bar.executeShortcut(click({ altKey: true }), target()), false);
  }
  action.type = "melee"; action.autoAttack = true;
  await bar.executeShortcut(click(), target());
  assert.deepEqual(calls.pop(), ["useAction", item.uuid, 0, "melee"]);
  item.type = "attack";
  await bar.executeShortcut(click(), target());
  assert.deepEqual(calls.pop(), ["useAction", item.uuid, 0, "auto"]);
  assert.equal(await bar.executeShortcut(click({ altKey: true }), target()), false);
  assert.equal(warnings.at(-1), "CO2PRISM.Combat.DamageUnavailable");
  assert.equal(calls.length, 0);
});

test("exécution CO2 : droits, références absentes, ancien token/preset/carré et API indisponible", async () => {
  const { bar, a, item, action, context, calls, click, target, create, select } = await setupExecution();
  const original = target();
  a.testUserPermission = (_user, level) => level === "OBSERVER";
  assert.equal(await bar.executeShortcut(click(), original), false);
  context.game.user.isGM = true;
  assert.equal(await bar.executeShortcut(click(), original), true);
  calls.length = 0; context.game.user.isGM = false; a.testUserPermission = () => true;
  a.items.delete(item.id);
  assert.equal(await bar.executeShortcut(click(), original), false);
  a.items.set(item.id, item);
  const { actor: b } = create("other"); select(b);
  assert.equal(await bar.executeShortcut(click(), original), false);
  select(a); await bar.setActivePreset(2);
  assert.equal(await bar.executeShortcut(click(), original), false);
  await bar.setActivePreset(1);
  assert.equal(await bar.executeShortcut(click({ currentTarget: { isConnected: false } }), original), false);
  const stored = a.flags.co2prism.hands.presets[1]["left-hand"];
  a.flags.co2prism.hands.presets[1]["left-hand"] = { ...stored, indice: 9 };
  assert.equal(await bar.executeShortcut(click(), original), false);
  a.flags.co2prism.hands.presets[1]["left-hand"] = stored;
  action.indice = 1;
  a.flags.co2prism.hands.presets[1]["left-hand"] = { ...stored, indice: 1 };
  assert.equal(await bar.executeShortcut(click(), target()), false);
  action.indice = 0;
  a.flags.co2prism.hands.presets[1]["left-hand"] = stored;
  context.game.system.api.macros.useAction = null;
  assert.equal(await bar.executeShortcut(click(), target()), false);
  assert.equal(calls.length, 0);
});

test("exécution CO2 : bon Item et indice, UUID synthétique frais, acteur sans Item explicitement géré", async () => {
  const { bar, a, item, calls, click, target, context, hooks, token } = await setupExecution();
  const second = { id: "second", uuid: `${a.uuid}.Item.second`, name: "Second", actions:
    [0, 1, 2].map(indice => ({ source: `${a.uuid}.Item.second`, indice, type: "heal", actionTypeFinal: "none" })) };
  a.items.set(second.id, second);
  const reference = bar.shortcutFromDrop(a, { type: "co.action", source: second.uuid, indice: 2 });
  await bar.saveShortcut(a, 1, { row: 1, order: 0, key: "ordinary" }, reference);
  await bar.executeShortcut(click(), target("ordinary"));
  assert.deepEqual(calls.pop(), ["useAction", second.uuid, 2, "heal"]);
  const synthetic = token(a); synthetic.document.baseActor = { uuid: "Actor.base" };
  context.canvas.tokens.controlled = [synthetic]; hooks.get("controlToken")();
  item.uuid = "Scene.s.Token.t.Actor.a.Item.item";
  await bar.executeShortcut(click(), target());
  assert.deepEqual(calls.pop(), ["useAction", item.uuid, 0, "attack"]);
  const direct = { source: a.uuid, indice: 5, type: "heal" };
  Object.defineProperty(a, "actions", { get: () => [direct] });
  a.flags.co2prism.shortcuts.ordinary = { source: a.uuid, indice: 5, itemId: null };
  a.sheet = { render: options => calls.push(["actorSheet", options.force]) };
  assert.equal(await bar.executeShortcut(click(), target("ordinary")), false);
  assert.equal(await bar.executeShortcut(click({ ctrlKey: true }), target("ordinary")), false);
  assert.equal(calls.length, 0);
  assert.equal(await bar.executeShortcut(click({ shiftKey: true }), target("ordinary")), true);
  assert.deepEqual(calls.pop(), ["actorSheet", true]);
});

test("exécution CO2 : opération unique, double clic ignoré, erreurs récupérables et synchronisation native", async () => {
  const { bar, context, a, action, calls, click, target, hooks, errors, writes } = await setupExecution();
  for (const modifiers of [{ button: 2 }, { detail: 2 }, { repeat: true }]) {
    assert.equal(await bar.executeShortcut(click(modifiers), target()), false);
  }
  let release;
  context.game.system.api.macros.useAction = () => new Promise(resolve => { calls.push("pending"); release = resolve; });
  const pending = bar.executeShortcut(click(), target());
  assert.equal(bar.busyAction, "shortcut");
  assert.equal(await bar.executeShortcut(click(), target()), false);
  await bar.performAction("fortune");
  assert.equal(calls.length, 1);
  release(); assert.equal(await pending, true);
  context.game.system.api.macros.useAction = async () => { throw Error("Native error"); };
  assert.equal(await bar.executeShortcut(click(), target()), false);
  assert.equal(errors.length, 1);
  assert.equal(bar.busyAction, null);
  const count = writes.length;
  a.system.resources.mana = { value: 8, max: 10 };
  context.game.system.api.macros.useAction = async () => {
    a.system.resources.mana.value = 3; action.charges = 2; action.properties.enabled = true;
    hooks.get("updateActor")(a, { "system.resources.mana.value": 3 });
  };
  assert.equal(await bar.executeShortcut(click(), target()), true);
  assert.equal(bar.gauges.mana.text.textContent, "3 / 10");
  assert.equal(bar.resolveShortcut(a, target().reference).action.charges, 2);
  assert.equal(writes.length, count);
});

test("temporaires activables : vraie bascule CO2, état courant et aucune écriture de flag", async () => {
  const { bar, a, item, action, click, target, hooks, calls, writes } = await setupExecution();
  Object.assign(action.properties, { activable: true, temporary: true, enabled: false });
  const states = [];
  a.activateAction = async options => {
    states.push({ ...options });
    action.properties.enabled = options.state; // Simulation de la mise à jour native de l'Item.
    hooks.get("updateItem")(item, { "system.actions": [] });
  };
  const flags = JSON.stringify(a.flags), count = writes.length;
  assert.equal(await bar.executeShortcut(click(), target()), true);
  assert.equal(action.properties.enabled, true);
  assert.equal(await bar.executeShortcut(click(), target()), true);
  assert.equal(action.properties.enabled, false);
  action.properties.enabled = true; // Changement extérieur sans nouveau contexte de clic.
  const captured = target();
  assert.equal(await bar.executeShortcut(click(), captured), true);
  assert.deepEqual(states, [true, false, false].map(state => ({ state, source: item.uuid, indice: 0, type: undefined })));
  assert.equal(calls.length, 0);
  assert.equal(writes.length, count);
  assert.equal(JSON.stringify(a.flags), flags);
});

test("temporaires activables : modificateurs sans bascule, refus/erreurs et opération en cours", async () => {
  const { bar, a, action, context, calls, click, target, errors } = await setupExecution();
  Object.assign(action.properties, { activable: true, temporary: true, enabled: true });
  let toggles = 0;
  a.activateAction = async () => { toggles++; };
  for (const modifiers of [{ ctrlKey: true }, { shiftKey: true }, { altKey: true },
    { shiftKey: true, ctrlKey: true, altKey: true }, { ctrlKey: true, altKey: true }]) {
    await bar.executeShortcut(click(modifiers), target());
    assert.equal(action.properties.enabled, true);
  }
  assert.equal(toggles, 0);
  assert.deepEqual(calls.map(call => call[0]), ["sendToChat", "openSheet", "openSheet", "sendToChat"]);
  a.activateAction = async () => false;
  assert.equal(await bar.executeShortcut(click(), target()), false);
  assert.equal(action.properties.enabled, true);
  a.activateAction = async () => { throw Error("Native refusal"); };
  assert.equal(await bar.executeShortcut(click(), target()), false);
  assert.equal(errors.length, 1);
  assert.equal(action.properties.enabled, true);
  a.activateAction = undefined;
  assert.equal(await bar.executeShortcut(click(), target()), false);
  assert.equal(action.properties.enabled, true);
  let release;
  a.activateAction = options => new Promise(resolve => {
    release = () => { action.properties.enabled = options.state; resolve(); };
  });
  context.game.system.api.macros.useAction = null; // La bascule n'a pas besoin du wrapper de macro.
  const pending = bar.executeShortcut(click(), target());
  assert.equal(action.properties.enabled, true);
  assert.equal(await bar.executeShortcut(click(), target()), false);
  release(); assert.equal(await pending, true);
  assert.equal(action.properties.enabled, false);
});

test("temporaires activables : acteur synthétique, sélection périmée, droits et suppression", async () => {
  const { bar, a, item, action, context, token, hooks, click, target } = await setupExecution();
  Object.assign(action.properties, { activable: true, temporary: true, enabled: false });
  const activations = [];
  a.activateAction = async function (options) { activations.push({ actor: this, options }); action.properties.enabled = options.state; };
  const old = target();
  const synthetic = token(a); synthetic.document.baseActor = { uuid: "Actor.base" };
  item.uuid = "Scene.s.Token.t.Actor.a.Item.item";
  context.canvas.tokens.controlled = [synthetic]; hooks.get("controlToken")();
  assert.equal(await bar.executeShortcut(click(), old), false);
  assert.equal(activations.length, 0);
  assert.equal(await bar.executeShortcut(click(), target()), true);
  assert.equal(activations[0].actor, a);
  assert.equal(activations[0].options.source, item.uuid);
  a.testUserPermission = (_user, level) => level === "OBSERVER";
  assert.equal(await bar.executeShortcut(click(), target()), false);
  a.testUserPermission = () => true; a.items.delete(item.id);
  assert.equal(await bar.executeShortcut(click(), target()), false);
  assert.equal(activations.length, 1);
});


test("gestion : insertion continue entre lignes, clés et autres presets préservés", async () => {
  const { bar, a, payload } = setupShortcuts();
  const ref = bar.shortcutFromDrop(a, payload());
  for (let i = 0; i < 3; i++) await bar.saveShortcut(a, 1, bar.slotRows()[0].at(-1), ref);
  await bar.saveShortcut(a, 1, bar.slotRows()[1].at(-1), ref);
  await bar.saveShortcut(a, 1, bar.slotRows()[0][0], ref);
  await bar.saveShortcut(a, 2, bar.slotRows(a, 2)[0][0], ref);
  const other = JSON.stringify(bar.readConfiguration().handPresets[2]);
  const hands = JSON.stringify(bar.readConfiguration().slots['left-hand']);
  const keys = row => Array.from(bar.slotRows()[row].filter(s => !s.hand && !s.terminal), s => s.key);
  const initial = keys(0), second = keys(1);
  const capture = key => ({ actor: a, token: bar.token, preset: 1, key, reference: bar.readConfiguration().slots[key] });
  assert.equal(await bar.manageShortcut(capture(initial[2]), bar.slotRows()[0][2]), true);
  assert.deepEqual(keys(0), [initial[2], initial[0], initial[1]]);
  assert.equal(await bar.manageShortcut(capture(initial[0]), bar.slotRows()[1][0]), true);
  assert.deepEqual(keys(1), [initial[0], second[0]]);
  assert.equal(await bar.manageShortcut(capture(second[0]), bar.slotRows()[1][0]), true);
  assert.deepEqual(keys(1), [second[0], initial[0]]);
  assert.equal(await bar.manageShortcut(capture(initial[0]), bar.slotRows()[0].at(-1)), true);
  assert.deepEqual(keys(0), [initial[2], initial[1], initial[0]]);
  for (const row of bar.slotRows()) assert.deepEqual(Array.from(row.filter(s => !s.hand && !s.terminal), s => s.order), Array.from(row.filter(s => !s.hand && !s.terminal), (_, i) => i));
  assert.equal(JSON.stringify(bar.readConfiguration().handPresets[2]), other);
  assert.equal(JSON.stringify(bar.readConfiguration().slots['left-hand']), hands);
  assert.equal(await bar.manageShortcut(capture('left-hand'), bar.slotRows()[1].at(-1)), false);
  assert.equal(await bar.manageShortcut(capture(initial[0]), bar.slotRows()[0][0]), false);
});

test("gestion : suppression compacte, mains permanentes, verrou et contexte périmé", async () => {
  const { bar, a, item, payload, context, create, select } = setupShortcuts();
  let locked = false; context.game.settings.get = () => locked;
  const ref = bar.shortcutFromDrop(a, payload());
  for (let i = 0; i < 2; i++) await bar.saveShortcut(a, 1, bar.slotRows()[0].at(-1), ref);
  await bar.saveShortcut(a, 1, bar.slotRows()[0][0], ref);
  const capture = slot => ({ actor: a, token: bar.token, preset: 1, key: slot.key, reference: slot.reference });
  const first = capture(bar.slotRows()[0][2]);
  locked = true; assert.equal(await bar.manageShortcut(first), false);
  locked = false; a.testUserPermission = () => false; assert.equal(await bar.manageShortcut(first), false);
  a.testUserPermission = () => true;
  await bar.setActivePreset(2); assert.equal(bar.validShortcutContext(first), true); await bar.setActivePreset(1);
  const b = create('other').actor; select(b); assert.equal(await bar.manageShortcut(first), false); select(a);
  assert.equal(await bar.manageShortcut(capture(bar.slotRows()[0][2])), true);
  assert.deepEqual(Array.from(bar.slotRows()[0].filter(s => !s.hand && !s.terminal), s => s.order), [0]);
  assert.equal(await bar.manageShortcut(capture(bar.slotRows()[0][0])), true);
  assert.equal(bar.slotRows()[0][0].key, 'left-hand'); assert.equal(bar.slotRows()[0][0].reference, undefined);
  assert.equal(a.items.get(item.id), item); assert.equal(item.actions.length, 1);
  const reloaded = setupShortcuts(); const restored = reloaded.configuredActor('restored', a.flags); reloaded.select(restored);
  assert.equal(reloaded.bar.slotRows()[0].length, 4);
});

test("compteurs : fréquences natives, quantités et munitions, zéro et absence fiable", () => {
  const { bar } = setupShortcuts();
  const action = { type: 'consumable', properties: {} };
  const item = { type: 'capacity', system: { frequency: 'daily', charges: { current: 0 } } };
  assert.equal(bar.shortcutUses(action, item).value, 0); assert.equal(bar.shortcutUses(action, item).icon, 'sun');
  item.system.frequency = 'combat'; item.system.charges.current = 3;
  assert.equal(bar.shortcutUses(action, item).icon, 'swords');
  action.properties.noChargesUsed = true; assert.equal(bar.shortcutUses(action, item), null);
  action.properties.noChargesUsed = false; item.system.frequency = 'none'; assert.equal(bar.shortcutUses(action, item), null);
  item.type = 'equipment'; item.system = { subtype: 'consumable', quantity: { current: 0 } };
  assert.equal(bar.shortcutUses(action, item).type, 'quantity');
  action.type = 'ranged'; assert.equal(bar.shortcutUses(action, item), null);
  item.system = { properties: { reloadable: true }, charges: { current: 4 } };
  assert.equal(bar.shortcutUses(action, item).value, 4);
  item.type = 'attack'; action.autoAttack = true; assert.equal(bar.shortcutUses(action, item).icon, 'sack');
  item.system.charges.current = undefined; assert.equal(bar.shortcutUses(action, item), null);
  item.system.charges.current = -1; assert.equal(bar.shortcutUses(action, item), null);
});

test("gestion : écriture en attente revérifiée, faux payload interne et erreur sans perte", async () => {
  const { bar, a, payload, event, node, context, writes, errors } = setupShortcuts();
  const ref = bar.shortcutFromDrop(a, payload());
  await bar.saveShortcut(a, 1, bar.slotRows()[0].at(-1), ref);
  const slot = bar.slotRows()[0][2];
  const capture = { actor: a, token: bar.token, preset: 1, key: slot.key, reference: slot.reference };
  let release;
  const pending = bar.queueConfiguration(a, () => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  const deletion = bar.manageShortcut(capture);
  context.game.settings.get = () => true;
  release(true); await pending;
  assert.equal(await deletion, false);
  context.game.settings.get = () => false;
  const before = JSON.stringify(a.flags), count = writes.length;
  assert.equal(await bar.dropSlot(event({ type: "co2prism.shortcut", key: slot.key }), bar.slotRows()[1].at(-1), node), false);
  assert.equal(writes.length, count);
  const save = a.setFlag;
  a.setFlag = async () => { throw Error("Persistence unavailable"); };
  assert.equal(await bar.manageShortcut(capture), false);
  assert.equal(errors.length, 1);
  assert.equal(JSON.stringify(a.flags), before);
  a.setFlag = save;
  assert.equal(await bar.manageShortcut(capture), true);
});

test("quantité consommée : résolution quelconque, priorité ciblée et repli inchangé", () => {
  const { bar } = setupShortcuts();
  const action = { type: "ranged", properties: {}, resolvers: [{ type: "heal" }, { type: "consumable" }] };
  const item = { type: "equipment", system: { subtype: "misc", properties: { reloadable: true },
    quantity: { current: 3 }, charges: { current: 8 } } };
  for (const value of [3, 2, 1, 0]) {
    item.system.quantity.current = value;
    const uses = bar.shortcutUses(action, item);
    assert.equal(uses.value, value);
    assert.equal(uses.icon, "flask-round-potion");
    assert.equal(uses.type, "consumable");
  }
  for (const missing of [undefined, null, "3", NaN, -1]) {
    item.system.quantity.current = missing;
    assert.equal(bar.shortcutUses(action, item).icon, "sack");
    assert.equal(bar.shortcutUses(action, item).value, 8);
  }
  item.system.quantity.current = 3;
  action.resolvers = [{ type: "heal" }];
  assert.equal(bar.shortcutUses(action, item).value, 8);
  action.type = "consumable";
  assert.equal(bar.shortcutUses(action, item), null);
  item.system.subtype = "consumable";
  assert.equal(bar.shortcutUses(action, item).icon, "sack");
  action.resolvers = [null, { type: "consumable" }];
  item.type = "capacity";
  assert.equal(bar.shortcutUses(action, item), null);
  assert.equal(bar.shortcutUses(action, undefined), null);
});

test("verrou : dépôts externes, sauvegarde directe et écriture différée refusés", async () => {
  const { bar, a, item, payload, event, node, context, writes } = setupShortcuts();
  const ref = bar.shortcutFromDrop(a, payload()), slot = bar.slotRows()[0][0];
  let locked = true; context.game.settings.get = () => locked;
  bar.hoverSlot(event(), slot, node);
  assert.equal(await bar.dropSlot(event(), slot, node), false);
  assert.equal(await bar.saveShortcut(a, 1, slot, ref), false);
  assert.equal(writes.length, 0);
  locked = false;
  let release;
  const pending = bar.queueConfiguration(a, () => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  const saved = bar.saveShortcut(a, 1, slot, ref); locked = true;
  release(true); await pending;
  assert.equal(await saved, false); assert.equal(writes.length, 0);
  assert.equal(a.items.get(item.id), item);
});

test("nettoyage : absence certaine, compaction, mains et isolation du preset", async () => {
  const { bar, a, item, payload } = setupShortcuts();
  const ref = bar.shortcutFromDrop(a, payload());
  item.system.actions = item.actions;
  for (let i = 0; i < 3; i++) await bar.saveShortcut(a, 1, bar.slotRows()[0].at(-1), ref);
  await bar.saveShortcut(a, 1, bar.slotRows()[0][0], ref);
  await bar.saveShortcut(a, 2, bar.slotRows(a, 2)[0][0], ref);
  const other = JSON.stringify(bar.readConfiguration().handPresets[2]);
  const ordinary = bar.slotRows()[0].filter(slot => !slot.hand && !slot.terminal);
  a.flags.co2prism.shortcuts[ordinary[1].key].itemId = 'deleted';
  bar.pruneShortcuts(bar.slotRows()); await bar.configWrites.get(a);
  assert.deepEqual(Array.from(bar.slotRows()[0].filter(slot => !slot.hand && !slot.terminal), slot => slot.order), [0, 1]);
  assert.equal(JSON.stringify(bar.readConfiguration().handPresets[2]), other);
  item.actions = []; item.system.actions = [];
  bar.pruneShortcuts(bar.slotRows()); await bar.configWrites.get(a);
  assert.equal(Object.keys(bar.readConfiguration().shortcuts).length, 0);
  assert.equal(bar.slotRows()[0][0].key, 'left-hand');
  assert.equal(a.items.get(item.id), item);
});

test("nettoyage prudent : conditions, droits, chargement et sélection en attente", async () => {
  const { bar, a, item, payload, create, select, writes } = setupShortcuts();
  const ref = bar.shortcutFromDrop(a, payload());
  await bar.saveShortcut(a, 1, bar.slotRows()[0].at(-1), ref);
  item.system.actions = item.actions; item.actions[0].isVisible = async () => false;
  const count = writes.length;
  bar.pruneShortcuts(bar.slotRows()); assert.equal(writes.length, count);
  item.actions.unshift({ indice: 1 });
  const beforeMovedIndex = bar.configWrites.get(a);
  bar.pruneShortcuts(bar.slotRows());
  assert.equal(bar.configWrites.get(a), beforeMovedIndex);
  assert.equal(writes.length, count);
  item.system.actions = undefined; item.actions = [];
  bar.pruneShortcuts(bar.slotRows()); assert.equal(writes.length, count);
  item.system.actions = []; item.testUserPermission = () => false;
  bar.pruneShortcuts(bar.slotRows()); assert.equal(writes.length, count);
  item.testUserPermission = () => true; a.testUserPermission = () => false;
  bar.pruneShortcuts(bar.slotRows()); assert.equal(writes.length, count);
  a.testUserPermission = () => true;
  let release;
  const pending = bar.queueConfiguration(a, () => new Promise(resolve => { release = resolve; }));
  await Promise.resolve(); bar.pruneShortcuts(bar.slotRows());
  const cleanup = bar.configWrites.get(a); select(create('other').actor); release(true); await pending; await cleanup;
  assert.equal(writes.length, count);
  select(a); bar.pruneShortcuts(bar.slotRows()); await bar.configWrites.get(a);
  assert.equal(Object.keys(bar.readConfiguration().shortcuts).length, 0);
});

test("conditions natives : blocage utilisation/dommages, consultations et retour disponible", async () => {
  const { bar, a, item, action, calls, click, target } = await setupExecution();
  let visible = false, evaluations = 0;
  const run = modifiers => bar.executeShortcut(click(modifiers), target());
  action.isVisible = async (source, actor) => { assert.equal(source, item); assert.equal(actor, a); evaluations++; return visible; };
  assert.equal(await run(), false);
  assert.equal(await run({ altKey: true }), false);
  assert.equal(calls.length, 0);
  assert.equal(await run({ ctrlKey: true }), true);
  assert.equal(await run({ shiftKey: true }), true);
  assert.equal(evaluations, 2);
  assert.ok(bar.readConfiguration().slots['left-hand']);
  visible = true;
  assert.equal(await run(), true);
  assert.equal(await run({ altKey: true }), true);
  assert.equal(calls.length, 4);
});

test("conditions natives : résultat tardif après changement d'acteur ou référence", async () => {
  const { bar, a, action, calls, click, target, create, select } = await setupExecution();
  let release;
  action.isVisible = () => new Promise(resolve => { release = resolve; });
  const pending = bar.executeShortcut(click(), target()); select(create('other').actor); release(true);
  assert.equal(await pending, false); assert.equal(calls.length, 0);
  select(a);
  const second = bar.executeShortcut(click(), target()); delete a.flags.co2prism.hands.presets[1]['left-hand']; release(true);
  assert.equal(await second, false); assert.equal(calls.length, 0);
});

test("interface économie : file moteur, verrou indépendant, presets et acteur synthétique", async () => {
  const { bar, a, context, create, select, writes } = setupShortcuts();
  context.game.settings.get = () => true;
  const presets = JSON.stringify(bar.readConfiguration().handPresets);
  await Promise.all([bar.changeEconomy("grant", "m"), bar.changeEconomy("grant", "m"), bar.changeEconomy("spend", "m")]);
  assert.equal(a.flags.co2prism.actionEconomy.bonus.m, 1);
  assert.equal(a.flags.co2prism.actionEconomy.branch, "undecided");
  assert.equal(JSON.stringify(bar.readConfiguration().handPresets), presets);
  await bar.setActivePreset(2);
  assert.equal(a.flags.co2prism.actionEconomy.bonus.m, 1);
  const b = create("synthetic").actor; b.baseActor = a; select(b);
  await bar.changeEconomy("spend", "l");
  assert.equal(b.flags.co2prism.actionEconomy.branch, "limited");
  assert.equal(a.flags.co2prism.actionEconomy.branch, "undecided");
  select(a);
  const count = writes.length;
  a.testUserPermission = (_user, level) => level === "OBSERVER";
  assert.equal(await bar.changeEconomy("grant", "m"), false);
  assert.equal(writes.length, count);
  a.testUserPermission = () => true;
  assert.equal(await bar.changeEconomy("reset"), true);
  assert.equal(a.flags.co2prism.actionEconomy.bonus.m, 0);
});

async function setupTimedExecution(time = "a") {
  const env = await setupExecution();
  const { a, item, action, context, hooks, calls, bar, click, target } = env;
  action.actionTypeFinal = time;
  const behavior = { result: "success" };
  context.foundry.applications ??= {};
  context.foundry.applications.api ??= {};
  context.foundry.applications.api.DialogV2 = { confirm: async () => false };
  const economy = new context.ActionEconomy(a);
  const activate = async options => {
    if (behavior.beforeActivate) await behavior.beforeActivate();
    const guards = [];
    const details = { item, ...options, guard: promise => guards.push(Promise.resolve(promise)) };
    hooks.get("co2.preActivateAction")?.(a, details);
    if ((await Promise.all(guards)).some(value => value === false)) return false;
    if (behavior.dialog) await behavior.dialog();
    if (behavior.result === "error") throw Error("Native error");
    if (behavior.result === "false") return false;
    if (behavior.result === "undefined") return;
    if (behavior.result === "success" && action.properties.temporary) action.properties.enabled = options.state;
    hooks.get("co2.postActivateAction")?.(a, { ...details, success: behavior.result === "success" });
    hooks.get("updateItem")(item, {});
    return true; // activateAction retourne true même si success est faux.
  };
  a.activateAction = activate;
  context.game.system.api.macros.useAction = async (source, indice, type = "attack") => {
    calls.push(["useAction", source, indice, type]);
    await activate({ state: true, source, indice, type }); // Le wrapper ne retourne rien.
  };
  const run = modifiers => bar.executeShortcut(click(modifiers), target());
  return { ...env, economy, behavior, run };
}

test("13 modes : hors combat, non commencé, actif et off sans écriture cachée", async () => {
  const { context, economy, run, calls, writes } = await setupTimedExecution();
  let mode = "combat";
  const get = context.game.settings.get;
  context.game.settings.get = (module, key) => key === "economyMode" ? mode : get(module, key);
  await economy.spend("l");
  const count = writes.length;
  for (const started of [false, true]) {
    context.game.combats.active.started = started;
    for (const selected of ["off", "combat", "always"]) {
      mode = selected;
      const active = selected === "always" || (selected === "combat" && started);
      assert.equal(await run(), !active);
      assert.equal(writes.length, count);
    }
  }
  assert.equal(calls.length, 3);
});

test("13 confirmation : non/fermeture, oui sans dépense, annulation CO2", async () => {
  const { context, economy, run, calls, writes, behavior } = await setupTimedExecution();
  await economy.spend("l");
  const count = writes.length;
  for (const answer of [false, null, true]) {
    context.foundry.applications.api.DialogV2.confirm = async () => answer;
    assert.equal(await run(), answer === true);
    assert.equal(writes.length, count);
  }
  assert.equal(calls.length, 1);
  behavior.result = "cancel";
  assert.equal(await run(), false);
  assert.equal(writes.length, count);
});

test("13 attente : bonus disponible, doubles clics et contexte revérifié", async () => {
  const { context, economy, run, bar, calls, a, writes } = await setupTimedExecution();
  await economy.spend("l");
  context.foundry.applications.api.DialogV2.confirm = async () => {
    assert.equal(await run(), false);
    await economy.grant("a"); return true;
  };
  assert.equal(await run(), true);
  assert.equal(economy.getSnapshot().bonus.a, 0);
  for (const mutate of [() => { context.canvas.tokens.controlled = []; }, () => { a.testUserPermission = () => false; },
    () => { a.flags.co2prism.hands.presets[1]['left-hand'].indice = 99; }]) {
    const selection = context.canvas.tokens.controlled, permission = a.testUserPermission;
    context.foundry.applications.api.DialogV2.confirm = async () => { mutate(); return true; };
    const count = writes.length;
    assert.equal(await run(), false);
    assert.equal(writes.length, count);
    context.canvas.tokens.controlled = selection; a.testUserPermission = permission; bar.refreshActor();
  }
  assert.equal(calls.length, 1);
});

test("12C M : bonus spécialisé, M normal, AM ; gratuit sans budget", async () => {
  const { economy, run, calls, action, writes } = await setupTimedExecution("m");
  await economy.grant("m");
  for (const [branch, remaining] of [["undecided", 2], ["split", 1], ["split", 0]]) {
    assert.equal(await run(), true);
    assert.equal(economy.getSnapshot().branch, branch);
    assert.equal(economy.getSnapshot().movementsRemaining, remaining);
    assert.equal(economy.getSnapshot().movementsMaximum, 3);
  }
  const count = writes.length;
  assert.equal(await run(), false); assert.equal(calls.length, 3); assert.equal(writes.length, count);
  for (const type of ["f", "none"]) {
    action.actionTypeFinal = type; assert.equal(await run(), true);
  }
  assert.equal(writes.length, count);
});

test("12C A/L : budget polyvalent et bonus indépendants", async () => {
  const { economy, run, action } = await setupTimedExecution();
  await economy.grant("a"); await economy.grant("m");
  assert.equal(await run(), true); assert.equal(economy.getSnapshot().branch, "undecided");
  assert.equal(economy.getSnapshot().movementsRemaining, 3);
  assert.equal(await run(), true); assert.equal(economy.getSnapshot().movementsRemaining, 2);
  await economy.reset(); await economy.grant("m");
  action.actionTypeFinal = "l";
  assert.equal(await run(), true); assert.equal(economy.getSnapshot().branch, "limited");
  assert.equal(economy.getSnapshot().bonus.m, 1);
  assert.equal(economy.getSnapshot().movementsRemaining, 1);
});

test("12C consultations, dommages seuls et désactivation temporaire sans débit", async () => {
  const { economy, run, action, writes } = await setupTimedExecution();
  const count = writes.length;
  for (const modifier of [{ ctrlKey: true }, { altKey: true }, { shiftKey: true }]) assert.equal(await run(modifier), true);
  assert.equal(writes.length, count);
  Object.assign(action.properties, { activable: true, temporary: true, enabled: false });
  assert.equal(await run(), true); assert.equal(action.properties.enabled, true);
  assert.equal(economy.getSnapshot().normal.am, false);
  const after = writes.length;
  assert.equal(await run(), true); assert.equal(action.properties.enabled, false);
  assert.equal(writes.length, after);
});

test("12C annulation, refus et undefined sans preuve : aucun débit", async () => {
  const { economy, run, behavior, writes, hooks } = await setupTimedExecution();
  const before = JSON.stringify(economy.getSnapshot()), count = writes.length;
  for (const result of ["cancel", "false", "undefined", "error"]) {
    behavior.result = result;
    assert.equal(await run(), false);
    assert.equal(JSON.stringify(economy.getSnapshot()), before); assert.equal(writes.length, count);
    assert.equal(hooks.has("co2.preActivateAction"), false); assert.equal(hooks.has("co2.postActivateAction"), false);
  }
  behavior.result = "success"; // Le résultat du dé n'intervient pas dans le booléen des resolvers.
  assert.equal(await run(), true); assert.equal(economy.getSnapshot().normal.am, false);
});

test("12C refus avant API : budget, épuisement, conditions, droits et temps inconnu", async () => {
  const { economy, run, calls, action, a, item, writes } = await setupTimedExecution();
  await economy.spend("l"); const count = writes.length;
  assert.equal(await run(), false); assert.equal(calls.length, 0); assert.equal(writes.length, count);
  await economy.reset();
  for (const time of [undefined, "", "am", "unexpected"]) { action.actionTypeFinal = time; assert.equal(await run(), false); }
  action.actionTypeFinal = "a"; action.isVisible = async () => false; assert.equal(await run(), false);
  action.isVisible = async () => true; a.testUserPermission = (_user, level) => level === "OBSERVER";
  assert.equal(await run(), false); a.testUserPermission = () => true;
  item.type = "capacity"; item.system.frequency = "daily"; item.system.charges = { current: 0 };
  assert.equal(await run(), false); assert.equal(calls.length, 0);
});

test("12C garde native après attente : acteur, conditions et temps revérifiés", async () => {
  const { run, behavior, select, create, a, action, economy, calls } = await setupTimedExecution();
  behavior.beforeActivate = async () => { select(create("other").actor); };
  assert.equal(await run(), false); assert.equal(economy.getSnapshot().normal.am, true);
  select(a); behavior.beforeActivate = async () => { action.actionTypeFinal = "m"; };
  assert.equal(await run(), false); assert.equal(economy.getSnapshot().normal.am, true);
  action.actionTypeFinal = "a"; behavior.beforeActivate = async () => { action.isVisible = async () => false; };
  assert.equal(await run(), false); assert.equal(economy.getSnapshot().normal.am, true);
  assert.equal(calls.length, 3);
});

test("12C dialogue : double clic et commandes manuelles bloqués, débit sur acteur d'origine", async () => {
  const { run, behavior, bar, economy, select, create, calls } = await setupTimedExecution();
  let release, opened;
  const started = new Promise(resolve => { opened = resolve; });
  behavior.dialog = () => { opened(); return new Promise(resolve => { release = resolve; }); };
  const pending = run(); await started;
  assert.equal(await run(), false); assert.equal(await bar.changeEconomy("spend", "m"), false);
  assert.equal(economy.getSnapshot().normal.am, true);
  const other = create("other").actor; select(other);
  release(); assert.equal(await pending, true);
  assert.equal(economy.getSnapshot().normal.am, false);
  assert.equal(other.flags.co2prism.actionEconomy, undefined); assert.equal(calls.length, 1);
});

test("12C concurrence externe : action confirmée mais débit impossible signalé sans négatif", async () => {
  const { run, behavior, economy, warnings } = await setupTimedExecution();
  behavior.dialog = async () => { await economy.spend("l"); };
  assert.equal(await run(), false);
  assert.equal(economy.getSnapshot().branch, "limited");
  assert.equal(economy.getSnapshot().movementsRemaining, 0);
  assert.ok(warnings.includes("CO2PRISM.Combat.ActionTimeConflict"));
});

test("12C temporaire via macro : type attack par défaut natif et dépense unique", async () => {
  const { action, run, economy } = await setupTimedExecution("m");
  Object.assign(action.properties, { temporary: true, activable: false });
  assert.equal(await run(), true);
  assert.equal(economy.getSnapshot().normal.m, false);
});

test("12C plusieurs hooks de fin ne débitent qu'une fois ; erreur de flag signalée", async () => {
  const { behavior, run, hooks, a, item, economy, warnings } = await setupTimedExecution();
  behavior.dialog = async () => {
    for (let index = 0; index < 3; index++) hooks.get("co2.postActivateAction")(a, { item, indice: 0, state: true, type: "attack", success: true });
  };
  assert.equal(await run(), true); assert.equal(economy.getSnapshot().normal.m, true);
  assert.equal(economy.getSnapshot().normal.am, false);
  await economy.reset();
  a.setFlag = async () => { throw Error("offline"); };
  assert.equal(await run(), false);
  assert.ok(warnings.includes("CO2PRISM.Combat.ActionTimeConflict"));
  assert.equal(economy.getSnapshot().normal.am, true);
});

test("12C garde native : budget changé avant activation et hooks étrangers ignorés", async () => {
  const { run, behavior, economy, hooks, a, item } = await setupTimedExecution();
  behavior.beforeActivate = async () => { await economy.spend("l"); };
  assert.equal(await run(), false);
  assert.equal(economy.getSnapshot().branch, "limited");
  await economy.reset(); behavior.beforeActivate = undefined; behavior.result = "cancel";
  behavior.dialog = async () => {
    const valid = { item, indice: 0, state: true, type: "attack", success: true };
    for (const [actor, detail] of [[{}, valid], [a, { ...valid, item: {} }], [a, { ...valid, indice: 1 }],
      [a, { ...valid, type: "damage" }], [a, { ...valid, state: false }]]) {
      hooks.get("co2.postActivateAction")(actor, detail);
    }
  };
  assert.equal(await run(), false);
  assert.equal(economy.getSnapshot().normal.am, true);
});

test("12D commande AM : ajout permis, dépense UI refusée, moteur polyvalent préservé", async () => {
  const { bar, a, context, writes } = setupShortcuts();
  context.game.settings.get = () => true;
  const count = writes.length;
  assert.equal(await bar.changeEconomy("spend", "am"), false);
  assert.equal(writes.length, count);
  assert.equal(await bar.changeEconomy("grant", "am"), true);
  assert.equal(a.flags.co2prism.actionEconomy.bonus.am, 1);
  assert.equal(await bar.changeEconomy("spend", "a"), true);
  assert.equal(a.flags.co2prism.actionEconomy.bonus.am, 0);
  assert.equal(a.flags.co2prism.actionEconomy.branch, "undecided");
});

test("Defense CO2: confirmation, exclusive status and budget rollback", async () => {
  const { a, bar, context, economy } = await setupTimedExecution();
  context.game.system.CONST = { defenseStances: [{ id: "partialDef" }, { id: "fullDef" }] };
  const statuses = new Set(), calls = [];
  let refuse = false;
  a.hasEffect = id => statuses.has(id);
  a.canActivateDefenseStance = id => [...statuses].every(status => status === id);
  a.toggleStatusEffect = async (id, { active }) => {
    calls.push([id, active]);
    if (active && refuse) return false;
    if (active) statuses.add(id);
    else statuses.delete(id);
    return active;
  };
  await economy.grant("a"); await economy.grant("l");
  refuse = true;
  assert.equal(await bar.activateDefense("partialDef"), false);
  assert.equal(economy.getSnapshot().bonus.a, 1);
  refuse = false;
  const activating = bar.activateDefense("partialDef");
  assert.equal(await bar.activateDefense("fullDef"), false);
  assert.equal(await activating, true);
  assert.equal(await bar.activateDefense("partialDef"), false);
  assert.equal(await bar.activateDefense("fullDef"), false);
  assert.deepEqual([...statuses], ["partialDef"]);
  assert.equal(economy.getSnapshot().bonus.a, 0);
  assert.equal(economy.getSnapshot().bonus.l, 1);
  statuses.clear();
  const setFlag = a.setFlag;
  a.setFlag = async () => { throw Error("write failed"); };
  assert.equal(await bar.activateDefense("fullDef"), false);
  assert.deepEqual(calls.slice(-2), [["fullDef", true], ["fullDef", false]]);
  assert.equal(statuses.size, 0);
  assert.equal(economy.getSnapshot().bonus.l, 1);
  a.setFlag = setFlag;
  assert.equal(await bar.activateDefense("fullDef"), true);
  assert.equal(economy.getSnapshot().bonus.l, 0);
  await economy.spend("l");
  statuses.clear();
  const count = calls.length;
  assert.equal(await bar.activateDefense("partialDef"), false);
  assert.equal(await bar.activateDefense("fullDef"), false);
  assert.equal(calls.length, count);
});

test("Tokens visibility uses the saved Foundry user setting and defaults on", () => {
  const { context, hooks } = setup();
  const registrations = new Map();
  let stored;
  context.game.system = { id: "co2" };
  context.game.settings = {
    register: (module, key, data) => registrations.set(key, data),
    get: (_module, key) => stored ?? registrations.get(key)?.default
  };
  hooks.get("init")();
  assert.equal(registrations.get("visible").scope, "user");
  assert.equal(registrations.get("visible").default, true);
  const controls = { tokens: { tools: {} }, measure: { tools: {} } };
  hooks.get("getSceneControlButtons")(controls);
  assert.equal(controls.tokens.tools.co2prism.active, true);
  assert.deepEqual(Object.keys(controls.measure.tools), []);
  stored = false;
  hooks.get("getSceneControlButtons")(controls);
  assert.equal(controls.tokens.tools.co2prism.active, false);
});
