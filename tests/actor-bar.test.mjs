import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

// Simuler les documents préparés, sans dépendre d'un monde Foundry lancé.
function setup() {
  const hooks = new Map();
  const context = vm.createContext({
    structuredClone,
    Hooks: { once(name, fn) { hooks.set(name, fn); }, on(name, fn) { hooks.set(name, fn); }, off(name, fn) { if (hooks.get(name) === fn) hooks.delete(name); } },
    game: { combats: { active: { started: true } }, user: {}, i18n: { localize: key => key === "CO2PRISM.Unavailable" ? "—" : key } },
    canvas: { ready: true, tokens: { controlled: [] } }
  });
  vm.runInContext('globalThis.ActionEconomy = (() => {' + readFileSync(new URL('../module/combat/action-economy.mjs', import.meta.url), 'utf8').replace('export class ActionEconomy', 'class ActionEconomy') + '; return ActionEconomy; })()', context);
  vm.runInContext(readFileSync(new URL("../module/applications/_module.mjs", import.meta.url), "utf8").replace(/import \{ ActionEconomy \} from [^;]+;/, "")
    + "\nglobalThis.PrismBar = PrismBar;", context);
  const bar = new context.PrismBar();
  const node = () => ({ textContent: "", style: { setProperty(key, value) { this[key] = value; } } });
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
  const token = actor => ({ actor, document: { baseActor: actor } });
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
  bar.handle = { setPointerCapture: id => capture.add(id), hasPointerCapture: id => capture.has(id),
    releasePointerCapture: id => capture.delete(id), classList: { toggle() {} } };
  bar.lock = { setAttribute() {} };
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
      width: parseFloat(this.style.width), height: parseFloat(this.style.height) };
  } };
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
  context.window.innerWidth = 1000;
  context.window.innerHeight = 800;
  bar.layout();
  const enlarged = bar.element.getBoundingClientRect();
  assert.equal(enlarged.width, 780);
  assert.ok(enlarged.left + enlarged.width <= 1000);
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
  context.foundry = { utils: { escapeHTML: text => text }, applications: { api: { DialogV2: {} } } };
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
  assert.equal(button("fastRest").title, "CO2PRISM.RestUnavailable");
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
  context.foundry = { utils: { deepClone: structuredClone } };
  context.game.settings ??= { get: () => false };
  context.ui = { notifications: { error: message => errors.push(message) } };
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
  assert.deepEqual(Object.keys(bar.configuration.presets), ["1", "2", "3"]);
  assert.ok(Object.values(bar.configuration.panels).every(value => value === false));
  assert.notEqual(bar.configuration.presets[1].slots, bar.configuration.presets[2].slots);
  bar.configuration.presets[1].slots.example = "temporary";
  assert.equal(bar.configuration.presets[2].slots.example, undefined);
  bar.refreshActor();
  assert.equal(bar.configuration.presets[1].slots.example, undefined);
  await bar.setActivePreset(1);
  await bar.setPanelState("combat", false);
  assert.equal(writes.length, 0);
  for (const malformed of [null, "old", [], { activePreset: 9, panels: { combat: "true" }, presets: [] }]) {
    const b = configuredActor("malformed", { co2prism: malformed }); select(b);
    assert.equal(bar.configuration.activePreset, 1);
    assert.equal(bar.configuration.panels.combat, false);
    assert.deepEqual(Object.keys(bar.configuration.presets[1].slots), []);
  }
  assert.equal(writes.length, 0);
});

test("presets A/B : persistance et restauration, sans écraser slots ou champs inconnus", async () => {
  const { bar, context, configuredActor, select, writes } = setupConfiguration();
  const a = configuredActor("a", { other: { saved: true }, co2prism: {
    extra: { saved: true }, presets: { 1: { slots: { x: { uuid: "existing" } }, extra: 7 },
      2: { slots: { y: "untouched" } }, 3: { slots: {} }, future: { saved: true } }
  } });
  const before = structuredClone(a.flags);
  const b = configuredActor("b");
  select(a); await bar.setActivePreset(2);
  select(b); await bar.setActivePreset(3);
  select(a);
  assert.equal(bar.configuration.activePreset, 2);
  assert.equal(bar.presetButtons[1]["aria-pressed"], "true");
  assert.equal(bar.presetButtons[0]["aria-pressed"], "false");
  assert.deepEqual(a.flags.co2prism.presets, before.co2prism.presets);
  assert.deepEqual(a.flags.other, before.other);
  assert.deepEqual(a.flags.co2prism.extra, before.co2prism.extra);
  bar.configuration.presets[1].slots.x.uuid = "local-only";
  assert.equal(a.flags.co2prism.presets[1].slots.x.uuid, "existing");
  select(b); assert.equal(bar.configuration.activePreset, 3);
  const reloaded = setup();
  reloaded.context.canvas.tokens.controlled = context.canvas.tokens.controlled;
  reloaded.bar.refreshActor();
  assert.equal(reloaded.bar.configuration.activePreset, 3);
  assert.equal(writes.length, 2);
  assert.ok(writes.every(write => write.scope === "co2prism" && write.key === "activePreset"));
});

test("volets indépendants, mises à jour distantes et aucune sauvegarde en boucle", async () => {
  const { bar, configuredActor, select, writes, hooks } = setupConfiguration();
  const a = configuredActor("a", { co2prism: { panels: { future: true } } }); select(a);
  await Promise.all([bar.setPanelState("combat", true), bar.setPanelState("competences", true),
    bar.setPanelState("equipements", true)]);
  assert.ok(Object.values(bar.configuration.panels).every(value => value === true));
  await bar.setPanelState("combat", false);
  assert.equal(bar.configuration.panels.competences, true);
  assert.equal(bar.configuration.panels.equipements, true);
  assert.equal(a.flags.co2prism.panels.future, true);
  assert.deepEqual(writes.map(write => write.key), ["panels.combat", "panels.competences", "panels.equipements", "panels.combat"]);
  const count = writes.length;
  a.flags.co2prism.activePreset = 3;
  a.flags.co2prism.panels.competences = false;
  hooks.get("updateActor")(a, { flags: { co2prism: a.flags.co2prism } });
  assert.equal(bar.configuration.activePreset, 3);
  assert.equal(bar.configuration.panels.competences, false);
  a.flags.co2prism.activePreset = 2;
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
  assert.equal(a.flags.co2prism.activePreset, 1);
  assert.equal(b.flags.co2prism.activePreset, 3);
  assert.deepEqual(writes.filter(write => write.actor === a).map(write => write.value), [2, 3, 1]);
  select(a);
  const denied = bar.setActivePreset(2);
  a.testUserPermission = (_user, level) => level === "OBSERVER";
  assert.equal(await denied, false);
  a.testUserPermission = () => true;
  a.setFlag = async () => { throw Error("Persistence unavailable"); };
  assert.equal(await bar.setActivePreset(2), false);
  assert.equal(errors.length, 1);
  a.setFlag = save;
  assert.equal(await bar.setActivePreset(2), true);
});

test("configuration : droits Owner/MJ, sélection neutre et entrées refusées", async () => {
  const { bar, context, configuredActor, select, writes, hooks } = setupConfiguration();
  const a = configuredActor("a", { co2prism: { activePreset: 2 } });
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
  const base = configuredActor("base", { co2prism: { activePreset: 2 } });
  select(base); await bar.setActivePreset(3);
  const synthetic = configuredActor("synthetic", { co2prism: { activePreset: 3 } });
  synthetic.uuid = "Scene.s.Token.t.Actor.base";
  const unlinked = token(synthetic); unlinked.document.baseActor = base;
  context.canvas.tokens.controlled = [unlinked]; hooks.get("controlToken")();
  await bar.setActivePreset(1);
  assert.equal(writes.at(-1).actor, synthetic);
  assert.equal(base.flags.co2prism.activePreset, 3);
  assert.equal(synthetic.flags.co2prism.activePreset, 1);
  hooks.get("updateToken")(unlinked.document, { "delta.flags.co2prism.activePreset": 1 });
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
  bar.layout();
  bar.skillsPanel = { hidden: true };
  bar.skillsToggle = { setAttribute(key, value) { this[key] = value; } };
  const node = () => ({ textContent: "", style: { setProperty(key, value) { this[key] = value; } } });
  bar.skillNodes = ["for", "agi", "con", "cha", "int", "vol", "per"].map(key => ({ key,
    value: node(), count: node(), button: { setAttribute(key, value) { this[key] = value; } } }));
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
  assert.ok(Math.abs(bar.element.getBoundingClientRect().width - 430 * 1512 / 724) < 0.01);
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
  bonuses.for = [{ name: "Métier", value: 4, description: "Force", additionalInfos: "Seulement en montagne" },
    { name: "Bonus général", value: 2 }];
  await bar.setPanelState("competences", true);
  assert.equal(bar.skillNodes[0].value.textContent, "+3");
  assert.equal(bar.skillNodes[1].value.textContent, "-1");
  assert.equal(bar.skillNodes[5].value.textContent, "+0");
  assert.equal(bar.skillNodes[0].count.textContent, "(2)");
  assert.equal(bar.skillNodes[1].count.textContent, "(0)");
  assert.match(bar.skillNodes[0].button.title, /Métier — \+4/);
  assert.match(bar.skillNodes[0].button.title, /Seulement en montagne/);
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
  bar.combatEffects = { replaceChildren() {} };
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

test("14 budget : arrondir les totaux restants/maximum, bonus puis consommation", async () => {
  const { settings, display, a, context } = setupMovementDisplay();
  let state;
  a.getFlag = () => state;
  a.setFlag = async (_, key, value) => { state = structuredClone(value); };
  const economy = new context.ActionEconomy(a);
  settings.economyMode = "always";
  await economy.grant("m"); await economy.spend("m");
  for (const [mode, expected] of [["nearest", "7 / 10"], ["up", "7 / 10"], ["down", "6 / 10"]]) {
    settings.movementRounding = mode;
    assert.deepEqual(display(), ["20 / 30", expected]);
  }
  await economy.spend("m");
  assert.deepEqual(display(), ["10 / 30", "3 / 10"]);
  await economy.reset(); settings.movementRounding = "nearest";
  assert.deepEqual(display(), ["20 / 20", "7 / 7"]);
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
  assert.deepEqual(display(), ["20 / 20", "6 / 6"]);
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

test("Combat : presets ouvrent/replient sans modifier slots ni les autres volets", async () => {
  const { bar, configuredActor, select, writes } = setupConfiguration();
  const a = configuredActor("a", { co2prism: { panels: { competences: true, equipements: true },
    presets: { 1: { slots: { untouched: { unknownReference: "kept" } } } }, extra: "kept" } });
  const originalSlots = structuredClone(a.flags.co2prism.presets);
  select(a);
  await bar.selectCombatPreset(1);
  assert.equal(bar.configuration.panels.combat, true);
  assert.equal(bar.presetButtons[0]["aria-expanded"], "true");
  await bar.selectCombatPreset(1);
  assert.equal(bar.configuration.panels.combat, false);
  await bar.selectCombatPreset(2);
  assert.equal(bar.configuration.activePreset, 2);
  assert.equal(bar.configuration.panels.combat, true);
  await bar.selectCombatPreset(3);
  assert.equal(bar.configuration.activePreset, 3);
  assert.equal(bar.configuration.panels.combat, true);
  assert.equal(bar.configuration.panels.competences, true);
  assert.equal(bar.configuration.panels.equipements, true);
  assert.deepEqual(a.flags.co2prism.presets, originalSlots);
  assert.equal(a.flags.co2prism.extra, "kept");
  const b = configuredActor("b"); select(b); await bar.selectCombatPreset(2);
  select(a); assert.equal(bar.configuration.activePreset, 3);
  assert.equal(bar.configuration.panels.combat, true);
  a.testUserPermission = (_user, level) => level === "OBSERVER";
  const length = writes.length;
  assert.equal(await bar.selectCombatPreset(1), false);
  assert.equal(writes.length, length);
  a.testUserPermission = () => true;
  await Promise.all([bar.selectCombatPreset(3), bar.selectCombatPreset(3)]);
  assert.equal(bar.configuration.panels.combat, true);
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
    item.actions = [{ source: item.uuid, indice: 0, actionName: "Native action", actionImg: "native.webp",
      iconFA: "fas fa-sword", actionTypeFinal: "a", hasCharges: true, charges: 3, manaCost: 2 }];
    actor.items = new Map([[item.id, item]]);
    Object.defineProperty(actor, "actions", { configurable: true, get: () => [...actor.items.values()].flatMap(owned => owned.actions) });
    return { actor, item };
  };
  const { actor: a, item } = create("shortcuts"); select(a);
  const payload = () => ({ type: "co.action", source: item.uuid, indice: 0, name: "Ignored copy", img: "ignored.webp" });
  const event = (data = payload()) => ({ dataTransfer: { types: ["text/plain"], getData: () => JSON.stringify(data) },
    preventDefault() {}, stopPropagation() {} });
  const node = { classList: { add() {}, remove() {} } };
  return { ...env, a, item, create, warnings, payload, event, node };
}

test("raccourcis : 3/1 initiaux, mains permanentes et croissance indépendante", async () => {
  const { bar, a, payload } = setupShortcuts();
  const ref = bar.shortcutFromDrop(a, payload());
  assert.deepEqual(Array.from(bar.slotRows(), row => row.length), [3, 1]);
  await bar.saveShortcut(a, 1, bar.slotRows()[0][0], ref);
  await bar.saveShortcut(a, 1, bar.slotRows()[0][1], ref);
  assert.deepEqual(Array.from(bar.slotRows(), row => row.length), [3, 1]);
  const empty = bar.slotRows()[0].at(-1);
  await Promise.all([bar.saveShortcut(a, 1, empty, ref), bar.saveShortcut(a, 1, empty, ref)]);
  assert.deepEqual(Array.from(bar.slotRows(), row => row.length), [5, 1]);
  assert.deepEqual(Array.from(bar.slotRows()[0].filter(slot => !slot.hand && !slot.terminal), slot => slot.order), [0, 1]);
  await bar.saveShortcut(a, 1, bar.slotRows()[1].at(-1), ref);
  assert.deepEqual(Array.from(bar.slotRows(), row => row.length), [5, 2]);
  assert.ok(bar.slotRows().every(row => row.filter(slot => slot.terminal).length === 1));
  assert.equal(bar.slotRows()[0][0].hand, "left");
  assert.equal(bar.slotRows()[0][1].hand, "right");
});

test("raccourcis : références natives seules, restauration, isolation et disparition", async () => {
  const { bar, context, a, item, payload, create, select, writes } = setupShortcuts();
  const original = structuredClone(a.system);
  const ref = bar.shortcutFromDrop(a, payload());
  await bar.saveShortcut(a, 1, bar.slotRows()[0].at(-1), ref);
  const slots = a.flags.co2prism.presets[1].slots;
  const stored = Object.values(slots)[0];
  assert.deepEqual(Object.keys(stored).sort(), ["source", "indice", "itemId", "row", "order", "hand"].sort());
  assert.equal(stored.itemId, item.id);
  assert.equal(bar.resolveShortcut(a, stored).action, item.actions[0]);
  item.actions[0].manaCost = 7;
  assert.equal(bar.resolveShortcut(a, stored).action.manaCost, 7);
  a.items.delete(item.id);
  assert.equal(bar.resolveShortcut(a, stored), null);
  assert.equal(bar.slotRows()[0].length, 4);
  assert.deepEqual(a.flags.co2prism.presets[1].slots, slots);
  a.items.set(item.id, item);
  await bar.setActivePreset(2);
  assert.deepEqual(Array.from(bar.slotRows(), row => row.length), [3, 1]);
  const { actor: b } = create("other"); select(b);
  assert.deepEqual(Array.from(bar.slotRows(), row => row.length), [3, 1]);
  select(a); await bar.setActivePreset(1);
  assert.equal(bar.slotRows()[0].length, 4);
  const reloaded = setupConfiguration();
  reloaded.context.canvas.tokens.controlled = context.canvas.tokens.controlled;
  reloaded.bar.refreshActor();
  assert.equal(reloaded.bar.slotRows()[0].length, 4);
  assert.deepEqual(a.system, original);
  assert.ok(writes[0].key.startsWith("presets.1.slots."));
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
  assert.equal(await bar.dropSlot(next, slot, node), false);
  assert.equal(writes.length, count);
  assert.ok(warnings.length >= 8);
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
    reference: bar.readConfiguration(a).presets[1].slots[key] });
  return { ...env, action, calls, click, target };
}

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
  const stored = a.flags.co2prism.presets[1].slots["left-hand"];
  a.flags.co2prism.presets[1].slots["left-hand"] = { ...stored, indice: 9 };
  assert.equal(await bar.executeShortcut(click(), original), false);
  a.flags.co2prism.presets[1].slots["left-hand"] = stored;
  action.indice = 1;
  a.flags.co2prism.presets[1].slots["left-hand"] = { ...stored, indice: 1 };
  assert.equal(await bar.executeShortcut(click(), target()), false);
  action.indice = 0;
  a.flags.co2prism.presets[1].slots["left-hand"] = stored;
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
  await bar.saveShortcut(a, 1, bar.slotRows()[0][1], reference);
  await bar.executeShortcut(click(), target("right-hand"));
  assert.deepEqual(calls.pop(), ["useAction", second.uuid, 2, "heal"]);
  const synthetic = token(a); synthetic.document.baseActor = { uuid: "Actor.base" };
  context.canvas.tokens.controlled = [synthetic]; hooks.get("controlToken")();
  item.uuid = "Scene.s.Token.t.Actor.a.Item.item";
  await bar.executeShortcut(click(), target());
  assert.deepEqual(calls.pop(), ["useAction", item.uuid, 0, "attack"]);
  const direct = { source: a.uuid, indice: 5, type: "heal" };
  Object.defineProperty(a, "actions", { get: () => [direct] });
  a.flags.co2prism.presets[1].slots["left-hand"] = { source: a.uuid, indice: 5, itemId: null };
  a.sheet = { render: options => calls.push(["actorSheet", options.force]) };
  assert.equal(await bar.executeShortcut(click(), target()), false);
  assert.equal(await bar.executeShortcut(click({ ctrlKey: true }), target()), false);
  assert.equal(calls.length, 0);
  assert.equal(await bar.executeShortcut(click({ shiftKey: true }), target()), true);
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
  const other = JSON.stringify(bar.readConfiguration().presets[2]);
  const hands = JSON.stringify(bar.readConfiguration().presets[1].slots['left-hand']);
  const keys = row => Array.from(bar.slotRows()[row].filter(s => !s.hand && !s.terminal), s => s.key);
  const initial = keys(0), second = keys(1);
  const capture = key => ({ actor: a, token: bar.token, preset: 1, key, reference: bar.readConfiguration().presets[1].slots[key] });
  assert.equal(await bar.manageShortcut(capture(initial[2]), bar.slotRows()[0][2]), true);
  assert.deepEqual(keys(0), [initial[2], initial[0], initial[1]]);
  assert.equal(await bar.manageShortcut(capture(initial[0]), bar.slotRows()[1][0]), true);
  assert.deepEqual(keys(1), [initial[0], second[0]]);
  assert.equal(await bar.manageShortcut(capture(second[0]), bar.slotRows()[1][0]), true);
  assert.deepEqual(keys(1), [second[0], initial[0]]);
  assert.equal(await bar.manageShortcut(capture(initial[0]), bar.slotRows()[0].at(-1)), true);
  assert.deepEqual(keys(0), [initial[2], initial[1], initial[0]]);
  for (const row of bar.slotRows()) assert.deepEqual(Array.from(row.filter(s => !s.hand && !s.terminal), s => s.order), Array.from(row.filter(s => !s.hand && !s.terminal), (_, i) => i));
  assert.equal(JSON.stringify(bar.readConfiguration().presets[2]), other);
  assert.equal(JSON.stringify(bar.readConfiguration().presets[1].slots['left-hand']), hands);
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
  await bar.setActivePreset(2); assert.equal(await bar.manageShortcut(first), false); await bar.setActivePreset(1);
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
  const other = JSON.stringify(bar.readConfiguration().presets[2]);
  const ordinary = bar.slotRows()[0].filter(slot => !slot.hand && !slot.terminal);
  a.flags.co2prism.presets[1].slots[ordinary[1].key].itemId = 'deleted';
  bar.pruneShortcuts(bar.slotRows()); await bar.configWrites.get(a);
  assert.deepEqual(Array.from(bar.slotRows()[0].filter(slot => !slot.hand && !slot.terminal), slot => slot.order), [0, 1]);
  assert.equal(JSON.stringify(bar.readConfiguration().presets[2]), other);
  item.actions = []; item.system.actions = [];
  bar.pruneShortcuts(bar.slotRows()); await bar.configWrites.get(a);
  assert.equal(Object.keys(bar.readConfiguration().presets[1].slots).length, 0);
  assert.equal(bar.slotRows()[0][0].key, 'left-hand');
  assert.equal(a.items.get(item.id), item);
});

test("nettoyage prudent : conditions, droits, chargement et sélection en attente", async () => {
  const { bar, a, item, payload, create, select, writes } = setupShortcuts();
  const ref = bar.shortcutFromDrop(a, payload());
  await bar.saveShortcut(a, 1, bar.slotRows()[0][0], ref);
  item.system.actions = item.actions; item.actions[0].isVisible = async () => false;
  const count = writes.length;
  bar.pruneShortcuts(bar.slotRows()); assert.equal(writes.length, count);
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
  assert.equal(Object.keys(bar.readConfiguration().presets[1].slots).length, 0);
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
  assert.ok(bar.readConfiguration().presets[1].slots['left-hand']);
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
  const second = bar.executeShortcut(click(), target()); delete a.flags.co2prism.presets[1].slots['left-hand']; release(true);
  assert.equal(await second, false); assert.equal(calls.length, 0);
});

test("interface économie : file moteur, verrou indépendant, presets et acteur synthétique", async () => {
  const { bar, a, context, create, select, writes } = setupShortcuts();
  context.game.settings.get = () => true;
  const presets = JSON.stringify(bar.readConfiguration().presets);
  await Promise.all([bar.changeEconomy("grant", "m"), bar.changeEconomy("grant", "m"), bar.changeEconomy("spend", "m")]);
  assert.equal(a.flags.co2prism.actionEconomy.bonus.m, 1);
  assert.equal(a.flags.co2prism.actionEconomy.branch, "undecided");
  assert.equal(JSON.stringify(bar.readConfiguration().presets), presets);
  await bar.selectCombatPreset(2);
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
    () => { a.flags.co2prism.presets[1].slots['left-hand'].indice = 99; }]) {
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
  item.system.frequency = "daily"; item.system.charges = { current: 0 };
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
