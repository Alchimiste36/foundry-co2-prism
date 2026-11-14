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
  bar.connectActor();
  const actor = (id, resources = {}) => ({
    uuid: `Actor.${id}`, name: id, img: `${id}.webp`, testUserPermission: () => true,
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
  assert.equal(bar.gauges.hp.text.textContent, "12 / 30");
  assert.equal(bar.gauges.mana.fill.style["--fill"], "75%");
  const b = token(actor("b"));
  context.canvas.tokens.controlled = [b]; hooks.get("controlToken")(b, true);
  assert.equal(bar.portrait.src, "b.webp");
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
