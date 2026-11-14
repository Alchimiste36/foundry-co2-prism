import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

// Simuler les documents préparés, sans dépendre d'un monde Foundry lancé.
function setup() {
  const hooks = new Map();
  const context = vm.createContext({
    Hooks: { once() {}, on(name, fn) { hooks.set(name, fn); } },
    game: { user: {}, i18n: { localize: key => key === "CO2PRISM.Unavailable" ? "—" : key } },
    canvas: { ready: true, tokens: { controlled: [] } }
  });
  vm.runInContext(readFileSync(new URL("../module/applications/_module.mjs", import.meta.url), "utf8")
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
