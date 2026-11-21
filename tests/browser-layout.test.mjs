import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { measureRecordedPath } from "./helpers/native-movement-double.mjs";

const edge = process.env.CO2PRISM_EDGE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const foundryCSS = process.env.CO2PRISM_FOUNDRY_CSS ?? "F:/FVTT_V14/public/css/foundry2.css";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("boîtes et zones de capture dans Edge avec le CSS Foundry", {
  skip: !existsSync(edge) || !existsSync(foundryCSS), timeout: 65000
}, () => {
  const directory = mkdtempSync(join(tmpdir(), "co2prism-browser-"));
  try {
    const translations = JSON.parse(read("../lang/fr.json"));
    const nativePath = process.env.CO2PRISM_FOUNDRY_SCRIPT ?? "F:/FVTT_V14/public/scripts/foundry.mjs";
    const native = existsSync(nativePath) ? readFileSync(nativePath, "utf8") : "";
    const nativePart = (start, end) => native.slice(native.indexOf(start), native.indexOf(end));
    const nativeTooltips = native ? "const deepFreeze = Object.freeze;\n"
      + nativePart("const ALLOWED_HTML_TAGS", "const WORLD_JOIN_THEMES")
      + nativePart("function cleanHTML(raw,", "function saveDataToFile(")
      + nativePart("class TooltipManager {", "var _module$H")
      + "foundry.utils.cleanHTML = cleanHTML;\n" : "";
    const templates = Object.fromEntries(["bar", "partials/core", "partials/inventory", "partials/movement",
      "partials/skills", "partials/effects", "partials/combat", "partials/combat-actions"].map(name =>
      [`modules/co2prism/templates/${name}.hbs`, read(`../templates/${name}.hbs`).replace(/\{\{localize '([^']+)'\}\}/g,
        (_match, key) => key.split(".").reduce((value, part) => value?.[part], translations) ?? key)]));
    // Un board natif reste derrière Prism ; aucune instance de monde n'est modifiée.
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="${pathToFileURL(foundryCSS).href}">
      <link rel="stylesheet" href="${new URL("../fonts/fontawesome/css/all.min.css", pathToFileURL(foundryCSS)).href}">
      <style>${read("../css/co2prism.css")}</style></head>
      <body class="vtt game"><canvas id="board" aria-label="Canvas Board"></canvas><script>
      const ready = [];
      const hooks = new Map();
      const Hooks = { once(name, fn) { if (name === "ready") ready.push(fn); }, on(name, fn) { hooks.set(name, fn); }, off(name, fn) { if (hooks.get(name) === fn) hooks.delete(name); } };
      const settings = { size: "M", position: {}, locked: false, economyMode: "always" };
      const warnings = [];
      const ui = { notifications: { warn: text => warnings.push(text), error: text => warnings.push(text) } };
      const canvas = globalThis.canvas = { ready: true, tokens: { controlled: [] } };
      const measureRecordedPath = ${measureRecordedPath.toString()};
      const budgetTranslations = ${JSON.stringify(Object.fromEntries(["TimeOr", "TimeControls", "TimeUnavailable", "BonusTime", "NormalTime", "EconomyError", "ActionTime_Limited", "ActionTime_Attack", "ActionTime_Move", "ActionTime_Free", "ActionManaCost", "ActionUses_daily", "ActionUses_combat", "Active", "Inactive"].map(key => [`CO2PRISM.Combat.${key}`, translations.CO2PRISM.Combat[key]])))};
      Object.assign(budgetTranslations, ${JSON.stringify(Object.fromEntries(Object.entries(translations.CO2PRISM.Movement).map(([key, value]) => [`CO2PRISM.Movement.${key}`, value])))});
      Object.assign(budgetTranslations, ${JSON.stringify(Object.fromEntries(Object.entries(translations.CO2PRISM.Equipment.Operations).map(([key, value]) => [`CO2PRISM.Equipment.Operations.${key}`, value])))});
      budgetTranslations['CO2PRISM.Combat.Movement'] = ${JSON.stringify(translations.CO2PRISM.Combat.Movement)};
      const game = globalThis.game = { system: { id: "co2" }, user: {},
        settings: { get: (_, key) => settings[key], set: (_, key, value) => settings[key] = value },
        i18n: { localize: key => budgetTranslations[key] ?? key,
          format: (key, data) => (budgetTranslations[key] ?? key).replace(/\\{(\\w+)\\}/g, (_, name) => data[name]) } };
      let sequence = 0;
      const foundry = { utils: { cleanHTML: value => value, escapeHTML: value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]), deepClone: value => structuredClone(value), randomID: () => "test" + (++sequence) },
        applications: { api: { DialogV2: { confirm: async () => false, wait: async () => "validate" } }, handlebars: {
          renderTemplate: async (path, data) => (${JSON.stringify(templates)})[path].replace(/\\{\\{\\{(\\w+)\\}\\}\\}/g, (_, key) => data[key])
        } } };
      foundry.applications.ux = { TextEditor: { implementation: { async enrichHTML(description, options) {
        if (!options.relativeTo.id) throw new Error('Missing native Item context');
        return description;
      } } } };
      ${nativeTooltips}
      ${"globalThis.ActionEconomy = (() => {" + read("../module/combat/action-economy.mjs").replace("export class ActionEconomy", "class ActionEconomy") + "; return ActionEconomy; })();"}
      ${read("../module/movement/movement-tracker.mjs").replace(/export /g, "")}
      ${read("../module/movement/movement-notifications.mjs").replace(/export /g, "")}
      ${read("../module/movement/movement-zones.mjs").replace(/import[^;]+;/g, "").replace(/export /g, "")}
      ${read("../module/combat/defense.mjs").replace(/export /g, "")}
      ${read("../module/applications/_module.mjs").replace(/import \{[^}]+\} from [^;]+;/g, "")}
      (async () => {
        const result = { dimensions: [], errors: [] };
        const check = (condition, message) => { if (!condition) result.errors.push(message); };
        try {
          await ready[0]();
          const root = document.getElementById("co2prism-bar");
          const prism = (node, name) => getComputedStyle(node).getPropertyValue("--prism-" + name).trim();
          const gold = prism(root, "active");
          const actorLight = () => prism(root, "electric-glass");
          const light = node => prism(node, "light");
          const contactShadow = (panel, direction) => {
            const layer = getComputedStyle(panel, "::after");
            return layer.content !== "none" && layer.position === "absolute" && layer.inset === "0px" &&
              Number(layer.zIndex) > 2 && layer.pointerEvents === "none" && layer.backgroundImage.includes(direction);
          };
          const palette = name => 'rgb(' + getComputedStyle(root).getPropertyValue('--prism-' + name)
            .trim().slice(1).match(/../g).map(channel => parseInt(channel, 16)).join(', ') + ')';
          check(root.parentElement === document.body, "Parent autre que body");
          check(document.querySelectorAll("#co2prism-bar").length === 1, "Plusieurs barres");
          for (const locked of [true, false]) {
            settings.locked = locked; bar.updateLock();
            const icon = bar.lock.querySelector('.fa-gear');
            const gear = getComputedStyle(icon);
            check(gear.display !== 'none' && gear.backgroundClip.split(',').every(clip => clip.trim() === 'text') &&
              (Number(gear.opacity) < 1) === locked && bar.lock.getAttribute('aria-pressed') === String(locked),
              'Actor-colored portrait gear is dim only when locked (' + [locked, gear.display, gear.backgroundClip, gear.opacity].join(', ') + ')');
          }
          check(root.querySelectorAll("canvas").length === 0, "Canvas ajouté par Prism");
          const ids = [...root.querySelectorAll("[id]")].map(node => node.id);
          check(new Set(ids).size === ids.length &&
            [...root.querySelectorAll("[aria-controls]")].every(button =>
              document.getElementById(button.getAttribute("aria-controls"))), "Identifiants des fragments et cibles des commandes");
          check(getComputedStyle(root.querySelector(".co2prism-art")).display === "grid" &&
            !root.querySelector(".co2prism-core [style*='--x']"), "Noyau en grille sans coordonnées héritées");
          check(bar.actions.every(button => button.disabled), "Commandes actives sans acteur");
          const calls = [];
          const actor = { uuid: "Actor.test", name: "Acteur de test", type: "character", img: "", testUserPermission: () => true,
            flags: {}, getFlag(scope, key) { return key.split(".").reduce((value, part) => value?.[part], this.flags[scope]); },
            async setFlag(scope, key, value) {
              this.flags[scope] ??= {}; let target = this.flags[scope]; const parts = key.split(".");
              for (const part of parts.slice(0, -1)) target = target[part] ??= {};
              if (value && typeof value === "object") {
                value = structuredClone(value);
                for (const key of Object.keys(value)) if (key.startsWith("-=")) { delete value[key.slice(2)]; delete value[key]; }
              }
              target[parts.at(-1)] = value;
            },
            getSkillBonuses: key => key === "for" ? [{ name: "Métier", value: 3,
              pathName: "Voie du métier", description: '<b>Escalade</b><img src="invalid" onerror="globalThis.co2prismInjected=true">',
              additionalInfos: "En montagne" }, { name: "Bonus général", value: 1 }] : [],
            rollSkill: (key, options) => { check(options.withDialog === true, "Dialogue natif absent"); calls.push("skill:" + key); },
            sheet: { render: () => calls.push("sheet") }, update: async () => {},
            appliedEffects: [{ name: "Native effect", img: "file:///F:/FVTT_V14/public/icons/svg/shield.svg", statuses: new Set() }],
            system: { combat: { def: { value: 15 }, dr: { value: 4 } },
              abilities: Object.fromEntries(["for", "agi", "con", "cha", "int", "vol", "per"].map((key, index) =>
                [key, { value: [3, -1, 1, 2, 1, 0, 1][index] }])), attributes: { hp: { value: 24, max: 34 } },
              resources: { fortune: { value: 2, max: 4 }, mana: { value: 18, max: 18 }, recovery: { value: 3, max: 3 } },
              rollFortune: () => calls.push("fortune"), useRecovery() {} } };
          game.system.CONST = { restActions: [
            { id: "fastRest", handler: target => { check(target === actor, "Acteur repos"); calls.push("fastRest"); } },
            { id: "fullRest", handler: target => { check(target === actor, "Acteur repos"); calls.push("fullRest"); } }
          ] };
          canvas.tokens.controlled = [{ actor, document: { baseActor: actor } }];
          bar.refreshActor();
          const portraitEvent = (type, options) => bar.portrait.dispatchEvent(new MouseEvent(type, { bubbles: true, ...options }));
          const portraitDoubleClick = () => {
            portraitEvent('click', { detail: 1 });
            portraitEvent('click', { detail: 2 });
            portraitEvent('dblclick', { detail: 2 });
          };
          const refreshTick = () => new Promise(resolve => setTimeout(resolve, 0));
          check(!root.querySelector('[data-co2prism-action="sheet"], .fa-star'), 'Actor sheet star removed');
          for (const locked of [true, false]) {
            settings.locked = locked; bar.updateLock();
            const count = calls.length;
            portraitEvent('click', { detail: 1 });
            check(calls.length === count, 'Single portrait click does not open the sheet');
            portraitDoubleClick(); await refreshTick();
            check(calls.length === count + 1 && calls.at(-1) === 'sheet', 'Portrait double click opens once in either lock mode');
          }
          const oldPosition = bar.position;
          const oldBounds = root.getBoundingClientRect();
          bar.portrait.setPointerCapture = () => {};
          const portraitPointer = (type, x, y) => bar.portrait.dispatchEvent(new PointerEvent(type, {
            button: 0, pointerId: 1, clientX: x, clientY: y, bubbles: true, cancelable: true
          }));
          portraitPointer('pointerdown', 200, 200);
          portraitPointer('pointermove', 240, 180);
          portraitPointer('pointerup', 240, 180);
          check(root.getBoundingClientRect().left > oldBounds.left + 20, 'Unlocked portrait drag moves Prism');
          portraitEvent('click', { detail: 1 });
          portraitPointer('pointerdown', 240, 180);
          portraitPointer('pointerup', 240, 180);
          portraitEvent('click', { detail: 2 });
          portraitEvent('dblclick', { detail: 2 });
          check(calls.join() === 'sheet,sheet', 'A drag followed by a click does not open the actor sheet');
          bar.position = oldPosition; bar.layout();
          const originalSelection = canvas.tokens.controlled;
          const nextActor = { ...actor, uuid: 'Actor.second', sheet: { render: () => calls.push('secondSheet') } };
          canvas.tokens.controlled = [{ actor: nextActor, document: { baseActor: nextActor } }];
          portraitDoubleClick(); await refreshTick();
          check(calls.at(-1) === 'secondSheet', 'Portrait opens the currently selected actor sheet');
          canvas.tokens.controlled = [];
          portraitDoubleClick(); await refreshTick();
          check(calls.join() === 'sheet,sheet,secondSheet', 'No sheet opens without a selected actor');
          canvas.tokens.controlled = originalSelection; bar.refreshActor();
          calls.length = 0;
          for (const action of ["fortune", "fastRest", "fullRest"]) {
            if (bar.lastRest) bar.lastRest.at -= 1000;
            root.querySelector('[data-co2prism-action="' + action + '"]').click();
            await new Promise(resolve => setTimeout(resolve, 0));
          }
          check(calls.join(",") === "fortune,fastRest,fullRest", "Raccordement des clics");
          const commands = ["fortune", "fastRest", "fullRest"].map(action =>
            root.querySelector('[data-co2prism-action="' + action + '"]'));
          const originalFortuneRoll = actor.system.rollFortune;
          let finishFortune, fortuneRolls = 0;
          const pendingFortune = new Promise(resolve => { finishFortune = resolve; });
          actor.system.rollFortune = () => { fortuneRolls++; return pendingFortune; };
          const rollingFortune = bar.performAction("fortune");
          bar.refreshActor();
          check(bar.busyAction === "fortune" && commands.every(button => !button.disabled &&
            button.getAttribute("aria-disabled") === "false"), "Fortune and recovery remain visually available during refresh");
          commands.forEach(button => button.click());
          check(fortuneRolls === 1 && calls.length === 3, "Pending fortune blocks second rolls and recovery");
          const fortuneValue = actor.system.resources.fortune.value;
          actor.system.resources.fortune.value = null;
          bar.refreshActor();
          check(commands[0].disabled && commands.slice(1).every(button => !button.disabled),
            "A real availability change is reflected during the operation");
          actor.system.resources.fortune.value = fortuneValue;
          finishFortune();
          await rollingFortune;
          actor.system.rollFortune = originalFortuneRoll;
          check(commands.every(button => !button.disabled), "Real availability is restored after the roll");
          await bar.setPanelState('combat', true);
          root.querySelector('[data-co2prism-preset="2"]').click();
          await bar.configWrites.get(actor);
          check(actor.flags.co2prism.hands.active === 2 && bar.configuration.activePreset === 2,
            "Preset non enregistré au clic");
          check(!bar.combatPanel.hidden, 'Selector preserves combat');
          await bar.setPanelState('combat', false);
          check(bar.combatEffects.children.length > 0, "Effets absents avec le combat fermé");
          bar.combatToggle.click(); await bar.configWrites.get(actor);
          check(!bar.combatPanel.hidden && bar.combatToggle.getAttribute("aria-expanded") === "true"
            && bar.configuration.activePreset === 2, "Le poing doit ouvrir le combat avec le preset courant");
          bar.combatToggle.click(); await bar.configWrites.get(actor);
          check(bar.combatPanel.hidden && bar.combatToggle.getAttribute("aria-expanded") === "false",
            "Le poing doit refermer le combat");
          for (const backdrop of ["#eee7d7", "#171923", "linear-gradient(90deg, #eee7d7 50%, #171923 50%)"]) {
            document.getElementById("board").style.background = backdrop;
            await bar.setPanelState("combat", true);
            const open = getComputedStyle(bar.combatToggle);
            check(open.backgroundImage === "none" && open.backgroundColor === "rgba(0, 0, 0, 0)" &&
              open.textShadow !== "none" && bar.combatToggle.getAttribute("aria-expanded") === "true",
              "Icône ouverte sans fond individuel sur " + backdrop);
            await bar.setPanelState("combat", false);
          }
          document.getElementById("board").style.removeProperty("background");
          for (const [size, width] of Object.entries({ S: 300, M: 430, L: 600, XL: 780 })) {
            settings.size = size; bar.position = {}; bar.layout();
            const place = bar.place;
            let placements = 0;
            bar.place = function (...args) { placements++; return place.apply(this, args); };
            try {
              bar.layout({ preserveAnchor: true });
              bar.layout({ preserveAnchor: true });
            } finally { bar.place = place; }
            check(placements === 0, size + " aucune écriture de placement à emprise constante");
            const r = root.getBoundingClientRect();
            result.dimensions.push({ size, width: r.width, height: r.height });
            check(r.width > 0 && r.height > 0, size + " dimensions du noyau");
            check(Math.abs(r.left - 40) < 0.1 && Math.abs(innerHeight - r.bottom - 40) < 0.1, size + " marges");
            for (const [x, y] of [[r.right - 2, r.top + 2],
              [r.left + r.width / 2, r.top - 10], [r.right + 10, r.top + 10], [r.left - 10, r.bottom - 10]]) {
              check(document.elementFromPoint(x, y)?.id === "board", size + " zone transparente bloquée");
            }
            const portrait = bar.portrait.getBoundingClientRect();
            check(document.elementFromPoint(portrait.x + portrait.width / 2, portrait.y + portrait.height / 2) === bar.portrait,
              size + " portrait inaccessible");
            const gear = bar.lock.getBoundingClientRect();
            check(bar.lock.contains(document.elementFromPoint(gear.x + gear.width / 2, gear.y + gear.height / 2)),
              size + " rouage inaccessible");
            for (const button of bar.actions) {
              const b = button.getBoundingClientRect();
              check(!button.disabled, size + " commande inactive avec acteur propriétaire");
              check(button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)),
                size + " commande inaccessible " + button.dataset.co2prismAction);
              check(b.width > 0 && b.height > 0, size + " commande visible");
              const style = getComputedStyle(button);
              check(style.backgroundColor === "rgba(0, 0, 0, 0)" && style.borderTopWidth === "0px" && style.opacity === "1",
                size + " décoration de bouton inattendue");
            }
            check(bar.presetButtons.every(button => !button.getClientRects().length), "Closed preset controls");
            for (const nodes of Object.values(bar.gauges)) {
              const g = nodes.fill.getBoundingClientRect();
              check(document.elementFromPoint(g.left + 1, g.top + 1)?.closest(".co2prism-resource") === nodes.fill && nodes.fill.contains(nodes.text), size + " jauge accessible");
            }
            const gauges = ["recovery", "fortune", "mana", "hp"].map(key => bar.gauges[key].fill.getBoundingClientRect());
            check(bar.gauges.hp.fill.contains(bar.actions.find(button => button.dataset.co2prismAction === "fastRest")) &&
              bar.gauges.hp.fill.contains(bar.actions.find(button => button.dataset.co2prismAction === "fullRest")),
              size + " both rest controls are inside the HP gauge");
            const gaugeValues = Object.values(bar.gauges).map(({ text }) => getComputedStyle(text));
            check(gaugeValues.every(style => style.fontSize === gaugeValues[0].fontSize &&
              style.fontWeight === gaugeValues[0].fontWeight && style.textShadow === gaugeValues[0].textShadow),
              size + " typographie commune des jauges");
            check(gauges.every((gauge, index) => !index || (gauge.top >= gauges[index - 1].bottom - 1
              && Math.abs(gauge.right - gauges[0].right) < 1)), size + " quatre jauges en colonne ");
            const resources = root.querySelector(".co2prism-resources").getBoundingClientRect();
            check(Math.abs(portrait.width - portrait.height) < 1 && resources.left >= portrait.right - 1 &&
              bar.name.getBoundingClientRect().top >= portrait.bottom - 1, size + " portrait carre et ressources a droite");
            for (const [index, corner] of [...root.querySelectorAll(".co2prism-corner")].entries()) {
              const box = corner.getBoundingClientRect();
              check(corner.children.length === (index === 0 ? 2 : 1) &&
                (index % 2 === 0 ? box.left === portrait.left : box.right === portrait.right) &&
                (index < 2 ? box.top === portrait.top : box.bottom === portrait.bottom), size + " commandes aux quatre coins");
            }
            const pathsButton = bar.pathsToggle.getBoundingClientRect();
            const equipmentButton = bar.equipmentToggle.getBoundingClientRect();
            check(pathsButton.bottom < equipmentButton.top && Math.abs(pathsButton.left - equipmentButton.left) < 1,
              size + " paths above equipment");
            for (const button of [bar.pathsToggle, bar.equipmentToggle, bar.combatToggle, bar.skillsToggle, bar.lock]) {
              const b = button.getBoundingClientRect();
              check(button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)),
                size + " commande du noyau inaccessible " + button.className);
              const icon = getComputedStyle(button.querySelector("i"));
              check(parseFloat(icon.lineHeight) > parseFloat(icon.fontSize) && getComputedStyle(button).overflow === "visible",
                size + " portrait glyph and halo have room to paint");
            }
            bar.position = { x: innerWidth + 200, y: innerHeight + 200 }; bar.layout();
            const bounded = root.getBoundingClientRect();
            check(bounded.right <= innerWidth + 0.1 && bounded.bottom <= innerHeight + 0.1, size + " hors écran");
            check(Math.abs(settings.position.x - bounded.left - bar.panelOffset.x) < 1 && Math.abs(settings.position.y - bounded.top - bar.panelOffset.y) < 1, size + " correction non sauvegardée");
            bar.position = settings.position; bar.layout();
            check(Math.abs(root.getBoundingClientRect().left - bounded.left) < 0.1, size + " restauration");
          }
          for (const key of ["recovery", "fortune"]) {
            const resource = actor.system.resources[key];
            const original = resource.value;
            const { fill, text } = bar.gauges[key];
            for (const value of [0, 1, resource.max, 0]) {
              resource.value = value;
              bar.refreshActor();
              const painted = parseFloat(getComputedStyle(fill, "::before").width);
              check(fill.contains(text) && Math.abs(painted - fill.clientWidth * value / resource.max) < 1 &&
                fill.style.getPropertyValue("--fill") === (value / resource.max * 100) + "%" &&
                text.textContent === value + " / " + resource.max, key + " horizontal gauge at " + value);
            }
            resource.value = original;
            bar.refreshActor();
          }
          const skillsDimensions = [];
          for (const [size, width] of Object.entries({ S: 300, M: 430, L: 600, XL: 780 })) {
            settings.size = size; bar.position = { x: 300, y: 350 }; bar.layout();
            const portrait = bar.portrait.getBoundingClientRect();
            const font = getComputedStyle(bar.name).fontSize;
            bar.skillsToggle.click(); await bar.configWrites.get(actor);
            const opened = bar.portrait.getBoundingClientRect();
            check(Math.abs(opened.x - portrait.x) < 0.1 && Math.abs(opened.y - portrait.y) < 0.1,
              size + " portrait déplacé à l'ouverture");
            check(getComputedStyle(bar.name).fontSize === font, size + " échelle de base modifiée");
            check(!bar.skillsPanel.hidden && actor.flags.co2prism.panels.competences, size + " ouverture non persistée");
            const r = root.getBoundingClientRect();
            skillsDimensions.push({ size, width: r.width, height: r.height });
            const panel = bar.skillsPanel.getBoundingClientRect();
            check(contactShadow(bar.skillsPanel, "to left") &&
              getComputedStyle(bar.skillsToggle.querySelector("i")).opacity === "1", size + " open Skills overlay and glow");
            check(Math.abs(panel.right - opened.left) < 1 && Math.abs(panel.top - opened.top) < 1,
              size + " grille des competences a gauche");
            const tiles = [...bar.skillsPanel.querySelectorAll("[data-co2prism-ability]")];
            const willpower = tiles.at(-1).getBoundingClientRect();
            check(tiles.map(tile => tile.dataset.co2prismAbility).join(",") === "agi,per,con,cha,for,int,vol"
              && Math.abs(willpower.left + willpower.right - panel.left - panel.right) < 1,
              size + " ordre des compétences et VOL centrée");

            const superiorButton = bar.skillNodes.find(skill => skill.key === "for").button;
            const beforeHalo = superiorButton.getBoundingClientRect();
            actor.system.abilities.for.superior = true;
            hooks.get("updateActor")(actor, { system: {} });
            const halos = tiles.filter(tile => light(tile) === actorLight());
            check(halos.length === 1 && halos[0] === superiorButton &&
              JSON.stringify(beforeHalo) === JSON.stringify(superiorButton.getBoundingClientRect()),
              size + " superior ability alone glows without a geometry change");
            superiorButton.disabled = true;
            check(light(superiorButton) === actorLight() && prism(superiorButton, "rim") === actorLight(),
              size + " superior identity persists when disabled");
            bar.refreshActor();
            for (const { key, button, value, count } of bar.skillNodes) {
              const b = button.getBoundingClientRect();
              check(button === document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2), size + " losange inaccessible " + key);
              check(b.x >= r.x - 0.1 && b.y >= r.y - 0.1 && b.right <= r.right + 0.1 && b.bottom <= r.bottom + 0.1,
                size + " losange hors conteneur");
              for (const child of button.children) {
                const c = child.getBoundingClientRect();
                check(c.x >= b.x - 1 && c.right <= b.right + 1 && c.y >= b.y - 1 && c.bottom <= b.bottom + 1, size + " texte déborde");
              }
              check(value.textContent.startsWith(key === "agi" ? "-" : "+"), size + " signe");
              check(count.textContent === (key === "for" ? "(2)" : "(0)"), size + " compte");
              if (key === "for") check(button.dataset.co2prismDescription.includes("Voie du métier") && button.dataset.co2prismDescription.includes("En montagne")
                && !button.dataset.co2prismDescription.includes("Escalade") && !globalThis.co2prismInjected, "Description dangereuse");
              button.click(); await new Promise(resolve => setTimeout(resolve, 0));
              check(calls.at(-1) === "skill:" + key, size + " mauvais jet");
            }
            actor.system.abilities.for.superior = false;
            hooks.get("updateActor")(actor, { system: {} });
            check(light(superiorButton) === "transparent", size + " losing superior removes the halo");
            const outer = bar.skillNodes.find(skill => skill.key === "con").button.getBoundingClientRect();
            bar.skillsToggle.click(); await bar.configWrites.get(actor);
            check(bar.skillsPanel.hidden && getComputedStyle(bar.skillsPanel, "::after").content === "none" &&
              Number(getComputedStyle(bar.skillsToggle.querySelector("i")).opacity) < 1, size + " closed Skills has no overlay or glow");
            check(document.elementFromPoint(outer.left + outer.width / 2, outer.top + outer.height / 2)?.id === "board",
              size + " panneau fermé encore cliquable");
            const closed = bar.portrait.getBoundingClientRect();
            check(Math.abs(closed.x - portrait.x) < 0.1 && Math.abs(closed.y - portrait.y) < 0.1,
              size + " portrait déplacé à la fermeture");
          }
          result.skillsDimensions = skillsDimensions;
          const combatDimensions = [];
          actor.system.attributes.movement = { value: 10, unit: "m" };
          canvas.scene = { grid: { type: 1, distance: 2, units: "m" } };
          for (const [size, width] of Object.entries({ S: 300, M: 430, L: 600, XL: 780 })) {
            settings.size = size; bar.position = { x: 300, y: 350 }; bar.layout();
            const before = bar.portrait.getBoundingClientRect();
            await bar.setPanelState('combat', true); await bar.setActivePreset(1);
            const r = root.getBoundingClientRect(), after = bar.portrait.getBoundingClientRect();
            combatDimensions.push({ size, width: r.width, height: r.height });
            check(!bar.combatPanel.hidden && actor.flags.co2prism.hands.active === 1, size + " Combat fermé");
            check(Math.abs(before.x - after.x) < 0.1 && Math.abs(before.y - after.y) < 0.1, size + " base déplacée par Combat");
            check(bar.combatValues.meters.textContent === "20" && bar.combatValues.cells.textContent === "10"
              && bar.combatValues.def.textContent === "15" && bar.combatValues.dr.textContent === "4", "Valeurs Combat");
            check([["full", "limited"], ["partial", "attack"]].every(([control, token]) => {
              const indicator = root.querySelector(".co2prism-defense-" + control);
              const style = getComputedStyle(indicator);
              return style.backgroundColor === palette(token) && style.cursor === "default" && style.clipPath === "none";
            }), size + " défense totale et partielle reprennent les couleurs L/A");
            const slots = [...root.querySelectorAll(".co2prism-combat-slot")];
            check(slots.length === 5, "Nombre de cases");
            check(slots[0].dataset.co2prismHand === "right" && slots[1].dataset.co2prismHand === "left", "Convention des mains");
            const [row1, row2, row3] = bar.combatRows.map(row => row.getBoundingClientRect());
            check(row1.bottom <= row2.top && row2.bottom <= row3.top && row1.left === row2.left && row2.left === row3.left, "Three aligned shortcut rows");
            check(bar.combatEffects.children.length === 1 && bar.combatEffects.firstElementChild.dataset.co2prismDescriptionHtml === "<strong>Native effect</strong>", "Effets réels");
            if (typeof TooltipManager !== "undefined" && !game.tooltip) {
              const saved = { applied: actor.appliedEffects, custom: actor.system.currentEffects, position: bar.position };
              actor.appliedEffects = [{ id: "protection", name: 'Protection <Mage>', img: "file:///F:/FVTT_V14/public/icons/svg/shield.svg",
                description: '<p><em>Défense +2</em></p><img src="data:," onerror="window.tooltipUnsafe = true">',
                duration: { label: '2 rounds', remaining: 2 }, statuses: new Set() }];
              actor.system.currentEffects = [{ name: 'Flamme', sourceParts: {},
                tooltip: 'Durée : 3 rounds<br />Restant : 2<br />Dégâts : 1d6 feu<br />Statuts : Étourdi<br />Défense : -2<br />par Bâton de Mage'
                  + '<scr' + 'ipt>window.tooltipUnsafe = true</scr' + 'ipt>' }];
              bar.refreshActor();
              const icon = bar.combatEffects.firstElementChild, custom = bar.combatEffects.children[1];
              const iconBefore = icon.getBoundingClientRect();
              const tooltipElement = document.createElement("aside"); tooltipElement.id = "tooltip";
              tooltipElement.setAttribute("popover", "manual"); document.body.append(tooltipElement);
              Math.clamp = (number, min, max) => Math.min(max, Math.max(min, number));
              const Tour = globalThis.Tour = { tourInProgress: false };
              foundry.applications.detached = { adoptNodes: (parent, ...nodes) => parent.append(...nodes) };
              foundry.utils.getDefiningClass = () => TooltipManager;
              const manager = game.tooltip = new TooltipManager();
              manager.activateListeners(document);
              const hoverDescription = (node, shiftKey = false) => node.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, shiftKey }));
              const shift = (type, shiftKey) => window.dispatchEvent(new KeyboardEvent(type, { key: "Shift", shiftKey }));
              icon.dispatchEvent(new PointerEvent("pointerenter"));
              hoverDescription(icon);
              await new Promise(resolve => setTimeout(resolve, 550));
              check(!manager.element, "Descriptive effect waits for Shift");
              shift("keydown", true);
              check(manager.element === icon && tooltipElement.querySelector('em')?.textContent === 'Défense +2',
                'Native tooltip hover renders rich HTML');
              check(tooltipElement.textContent.includes('Protection <Mage>') && tooltipElement.textContent.includes('2 rounds'),
                'Native effect name and prepared duration');
              check(!tooltipElement.querySelector('[onerror], script') && !window.tooltipUnsafe, 'Native HTML sanitization');
              check(!icon.hasAttribute('title') && icon.getAttribute('aria-label') === 'Protection <Mage>'
                && icon.querySelector('img').alt === 'Protection <Mage>', 'No literal HTML title and accessible effect name');
              shift('keyup', false);
              check(!manager.element, 'Releasing Shift dismisses the effect tooltip');
              hoverDescription(icon, true);
              icon.focus();
              actor.appliedEffects[0].duration.label = '1 round';
              for (let index = 0; index < 3; index++) bar.refreshActor();
              await Promise.resolve();
              check(document.activeElement === icon && bar.combatEffects.firstElementChild === icon &&
                bar.combatEffects.children[1] === custom && bar.combatEffects.children.length === 2 &&
                manager.element === icon && tooltipElement.textContent.includes('1 round'),
                'Effect refresh keeps keyboard focus, updates the native tooltip, and reuses both nodes');
              hoverDescription(custom, true);
              check(tooltipElement.querySelectorAll('br').length >= 5 && tooltipElement.textContent.includes('par Bâton de Mage')
                && !tooltipElement.textContent.includes('<br'), 'CO2 tooltip HTML retained');
              for (const position of [{ x: 0, y: 0 }, { x: innerWidth, y: innerHeight }]) {
                bar.position = position; bar.layout(); hoverDescription(icon, true);
                const bounds = tooltipElement.getBoundingClientRect();
                check(bounds.left >= -1 && bounds.top >= -1 && bounds.right <= innerWidth + 1
                  && bounds.bottom <= innerHeight + 1, 'Native effect tooltip stays inside screen');
              }
              bar.position = saved.position; bar.layout();
              const iconAfter = icon.getBoundingClientRect();
              check(Math.abs(iconBefore.width - iconAfter.width) < 1 && Math.abs(iconBefore.height - iconAfter.height) < 1,
                'Tooltips preserve icon dimensions');
              icon.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
              check(!manager.element, 'Leaving Prism dismisses its descriptive tooltip');
              tooltipElement.hidePopover();
              actor.appliedEffects = saved.applied; actor.system.currentEffects = saved.custom; bar.refreshActor();
            }
            const count = calls.length, original = JSON.stringify(actor.system);
            for (const node of [...slots, ...root.querySelectorAll(".co2prism-defense-control")]) {
              node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
              node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 }));
            }
            check(calls.length === count && JSON.stringify(actor.system) === original, "Commande Combat exécutée");
            check([...root.querySelectorAll(".co2prism-time")].map(node => node.textContent).join(",") === "A,L,AM,M", "Ordre des temps");
            const triangle = bar.timeCommands.getBoundingClientRect();
            const budget = bar.budgetScroll.getBoundingClientRect();
            const { left, right } = bar.combatHands;
            const [leftHand, rightHand] = [left, right].map(node => node.getBoundingClientRect());
            const presets = bar.presetButtons.map(node => node.getBoundingClientRect());
            const [firstRow, secondRow, thirdRow] = bar.combatRows.map(node => node.getBoundingClientRect());
            const controls = root.querySelector(".co2prism-combat-controls").getBoundingClientRect();
            const portrait = bar.portrait.getBoundingClientRect();
            const frame = getComputedStyle(root.querySelector(".co2prism-art"), "::before");
            const upperStyle = getComputedStyle(bar.upperLine);
            check(contactShadow(bar.upperLine, "to top") && upperStyle.borderTopLeftRadius === "0px" &&
              frame.borderBottomLeftRadius === "0px", size + " upper overlay and square corners");
            const budgetStyle = getComputedStyle(bar.budgetBand);
            const movementStyle = getComputedStyle(bar.movementPanel);
            check(budget.bottom <= controls.top + 1 && controls.top >= portrait.top &&
              bar.movementPanel.nextElementSibling === bar.budgetBand &&
              bar.movementPanel.getBoundingClientRect().right < bar.budgetBand.getBoundingClientRect().left &&
              upperStyle.boxShadow !== "none" && budgetStyle.boxShadow === "none" && movementStyle.boxShadow === "none" &&
              +getComputedStyle(bar.anchor).zIndex > +frame.zIndex && +frame.zIndex > +upperStyle.zIndex &&
              +upperStyle.zIndex > +getComputedStyle(bar.skillsPanel).zIndex &&
              +getComputedStyle(bar.skillsPanel).zIndex > +getComputedStyle(bar.pathsPanel.parentElement).zIndex,
              size + " single shared frame and correct surface layers");
            const indicator = bar.budgetBar.querySelector(".co2prism-time-indicator");
            const markerHeight = parseFloat(getComputedStyle(indicator, "::before").height);
            check(markerHeight < indicator.getBoundingClientRect().height &&
              Math.abs(bar.budgetBand.getBoundingClientRect().height - Math.max(22, 42 * bar.presentationScale)) < 1,
              size + " budget markers have vertical room within the original height");
            const nameIcon = bar.name.previousElementSibling;
            check(nameIcon.matches(".fa-solid.fa-gem[aria-hidden=true]") && getComputedStyle(nameIcon).pointerEvents === "none" &&
              nameIcon.getBoundingClientRect().left > bar.name.parentElement.getBoundingClientRect().left &&
              nameIcon.getBoundingClientRect().right < bar.name.getBoundingClientRect().left,
              size + " decorative gem leaves space before the actor name");
            const commandBoxes = bar.budgetCommands.map(button => button.getBoundingClientRect());
            check(commandBoxes.every(box => Math.abs(box.width - box.height) < 1 &&
              Math.abs(box.width - commandBoxes[0].width) < 1) &&
              commandBoxes[0].left === commandBoxes[2].left && commandBoxes[0].top === commandBoxes[1].top &&
              commandBoxes[2].top === commandBoxes[3].top && commandBoxes[2].top > commandBoxes[0].top,
              size + " commandes des temps en grille 2 × 2");
            check(Math.abs(leftHand.left - rightHand.left) <= 1 && rightHand.bottom <= leftHand.top &&
              presets.every(preset => preset.top >= leftHand.bottom - 1 && preset.left >= leftHand.left - 1 &&
                preset.right <= leftHand.right + 1), size + " right hand, left hand, then presets");
            check(firstRow.left > rightHand.right && Math.abs(firstRow.left - secondRow.left) < 1
              && firstRow.top <= rightHand.top + 1, size + " shortcuts beside the hands");
            const [def, move] = root.querySelectorAll(".co2prism-combat-stat");
            const [moveBox, defBox] = [move, def].map(node => node.getBoundingClientRect());
            const gauges = root.querySelector(".co2prism-resources").getBoundingClientRect();
            const lowerColumn = left.parentElement.getBoundingClientRect();
            const identity = bar.name.parentElement.getBoundingClientRect();
            check(Math.abs(portrait.bottom - gauges.bottom) < 1 && Math.abs(gauges.height - lowerColumn.height) < 1 &&
              Math.abs(gauges.bottom - root.querySelector('.co2prism-presets').getBoundingClientRect().bottom) < 1 &&
              presets.every(box => Math.abs(box.bottom - bar.gauges.hp.fill.getBoundingClientRect().bottom) < 1) &&
              Math.abs(identity.top - portrait.bottom) < 1 && Math.abs(identity.left - portrait.left) < 1 &&
              Math.abs(identity.right - lowerColumn.right) < 1 && bar.lock.closest(".co2prism-corner-br") && bar.combatToggle.closest(".co2prism-corner-tr") &&
              !root.querySelector(".co2prism-movement-toggle"),
              size + " two lower columns with one continuous name bar");
            const centerY = box => (box.top + box.bottom) / 2;
            const handCard = right.firstElementChild.getBoundingClientRect();
            const rightCell = right.parentElement.getBoundingClientRect();
            const margins = (outer, inner) => [inner.left - outer.left, outer.right - inner.right,
              inner.top - outer.top, outer.bottom - inner.bottom];
            const regular = gaps => gaps.every(gap => gap > 0 && Math.abs(gap - gaps[0]) < 1);
            const commandArea = { left: commandBoxes[0].left, top: commandBoxes[0].top,
              right: commandBoxes[3].right, bottom: commandBoxes[3].bottom };
            const timeGap = commandBoxes[1].left - commandBoxes[0].right;
            check(regular(margins(triangle, commandArea)) &&
              Math.abs(2 * commandBoxes[0].width + timeGap + 2 * (commandArea.left - triangle.left) - rightCell.width) < 1 &&
              Math.abs(triangle.height - rightCell.height) < 1,
              size + " time grid has four equal insets and keeps the original outer square");
            check(regular(margins(rightCell, rightHand)) &&
              regular(margins({ ...lowerColumn.toJSON(), bottom: lowerColumn.top + rightCell.height }, leftHand)) &&
              Math.abs(handCard.width - rightHand.width) < 1 && Math.abs(handCard.height - rightHand.height) < 1,
              size + " hand squares fit their cells with equal margins on all sides");
            check(bar.gauges.recovery.fill.getBoundingClientRect().top - defBox.bottom < 20 * bar.presentationScale &&
              Math.abs(identity.height - 40 * bar.presentationScale) < 1,
              size + " gauge spacing is reduced and the name line retains its height");
            check([moveBox, defBox, handCard].every(box => Math.abs(centerY(box) - centerY(triangle)) < 1) &&
              triangle.top > portrait.top && triangle.width - commandBoxes[0].width * 2 > 4 * bar.presentationScale &&
              Math.abs(triangle.width - triangle.height) < 1 && secondRow.top < leftHand.top &&
              thirdRow.bottom <= lowerColumn.bottom + 1 &&
              Math.abs(leftHand.height - rightHand.height) < 1 && Math.abs(rightHand.width - rightHand.height) < 1,
              size + " four aligned upper blocks and matching shortcut rows");
            check(defBox.right <= moveBox.left && moveBox.right <= triangle.left &&
              Math.abs(defBox.width - moveBox.width) < 1 && Math.abs(defBox.height - moveBox.height) < 1 &&
              controls.right <= rightHand.left + 1, size + " time commands, movement and defense aligned");
            for (const button of [...bar.budgetCommands, ...bar.presetButtons]) {
              const b = button.getBoundingClientRect();
              const triangular = ["a", "m", "am"].includes(button.dataset.co2prismTime);
              check(button.contains(document.elementFromPoint(b.x + b.width * (triangular ? 0.66 : 0.5),
                b.y + b.height * (triangular ? 0.33 : 0.5))),
                size + " commande Combat inaccessible " + button.textContent);
            }
            for (const button of bar.actions) {
              const b = button.getBoundingClientRect(), hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
              check(button.contains(hit), size + " commande de base recouverte: " + button.dataset.co2prismAction + " par " + hit?.className);
            }
            bar.skillsToggle.click(); await bar.configWrites.get(actor);
            check(!bar.skillsPanel.hidden && !bar.combatPanel.hidden, "Volets exclusifs");
            for (const node of [...root.querySelectorAll(".co2prism-combat-slot"), ...bar.skillNodes.map(skill => skill.button)]) {
              const b = node.getBoundingClientRect();
              check(node.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)), size + " collision de volets " + node.className + " à " + b.x + "," + b.y);
            }
            check(getComputedStyle(bar.art).gridTemplateRows.split(" ").length === 5,
              size + " no dedicated preset track");
            const nucleus = () => [bar.anchor, bar.portrait, root.querySelector(".co2prism-resources"), bar.name.parentElement]
              .flatMap(node => { const rect = node.getBoundingClientRect(); return [rect.left, rect.top, rect.height]; });
            for (const skillsOpen of [true, false]) {
              await bar.setPanelState("competences", skillsOpen);
              const stable = nucleus();
              for (const combatOpen of [false, true, false, true]) {
                await bar.setPanelState("combat", combatOpen);
                check(bar.upperLine.hidden === !combatOpen, size + " shared line follows Combat");
                check(getComputedStyle(bar.art, "::before").gridColumnEnd === (combatOpen ? "5" : "3"),
                  size + " closed frame excludes the upper gauge area");
                check(nucleus().every((value, i) => Math.abs(value - stable[i]) <= 1),
                  size + " stable nucleus with skills=" + skillsOpen + ", combat=" + combatOpen);
              }
            }
            await bar.setPanelState("combat", false);
          }
          result.combatDimensions = combatDimensions;
          // Ouverture au bord droit : déplacer Prism, sans retour arbitraire au repli.
          settings.size = "M"; bar.position = { x: innerWidth - 432, y: 400 }; bar.layout();
          const edgeBefore = bar.portrait.getBoundingClientRect();
          await bar.setPanelState('combat', true);
          const edgeOpen = bar.portrait.getBoundingClientRect();
          check(root.getBoundingClientRect().right <= innerWidth + 0.1 && edgeOpen.x < edgeBefore.x, "Combat hors écran au dépliage");
          await bar.setPanelState('combat', false);
          check(Math.abs(bar.portrait.getBoundingClientRect().x - edgeOpen.x) < 0.1, "Saut arbitraire au repli");
          await bar.setPanelState("competences", true);
          bar.position = { x: innerWidth - 432, y: 400 }; bar.layout();
          await bar.setPanelState('combat', true);
          check(!bar.skillsPanel.hidden && !bar.combatPanel.hidden && root.getBoundingClientRect().right <= innerWidth + 0.1,
            "Combat hors écran avec Compétences");
          const item = { id: "owned", uuid: "Actor.test.Item.owned", name: "Support natif", type: "equipment", parent: actor,
            system: { description: "<b>Description native</b>", hasFrequency: true, frequency: "daily", isWeapon: true, useHands: true, equipped: false,
              usage: { oneHand: false, twoHand: true }, properties: { equipable: true, reloadable: true }, charges: { current: 3 } },
            testUserPermission: () => true };
          const nativeAction = { source: item.uuid, indice: 0, actionName: "Action réelle",
            actionImg: "file:///F:/FVTT_V14/public/icons/svg/shield.svg", iconFA: "fas fa-sword", actionTypeFinal: "f",
            type: "melee", properties: { temporary: false, enabled: false, activable: true }, autoAttack: false, hasResolversWithDomage: true,
            hasCharges: true, charges: 3, manaCost: 2 };
          item.actions = [nativeAction]; actor.items = new Map([[item.id, item]]);
          actor.toggleEquipmentEquipped = async id => { const model = actor.items.get(id).system; model.equipped = !model.equipped; hooks.get("updateItem")(item, {}); };
          Object.defineProperty(actor, "actions", { get: () => [...actor.items.values()].flatMap(owned => owned.actions) });
          const shortcutCalls = [];
          actor.activateAction = async options => {
            shortcutCalls.push(["activateAction", options]);
            nativeAction.properties.enabled = options.state;
            hooks.get("updateItem")(item, { "system.actions": [] });
          };
          game.system.api = { macros: {
            async useAction(...args) {
              shortcutCalls.push(["useAction", ...args]);
              nativeAction.charges = 2; item.system.charges.current = 2; nativeAction.properties.enabled = true;
              actor.system.resources.mana.value = 17;
            },
            async sendToChat(...args) { shortcutCalls.push(["sendToChat", ...args]); },
            async openSheet(...args) { shortcutCalls.push(["openSheet", ...args]); }
          } };
          const payload = { type: "co.action", source: item.uuid, indice: 0, name: "Copie ignorée", img: "ignored" };
          const cards = index => {
            const shortcuts = [...bar.combatRows[index].children];
            if (index !== 0) return shortcuts;
            const { left, right } = bar.combatHands;
            return [left.firstElementChild, right.firstElementChild, ...shortcuts];
          };
          const lengths = () => bar.combatRows.map((_, index) => cards(index).length).join(",");
          const dropAt = async (row, index, data = payload) => {
            const transfer = new DataTransfer(); transfer.setData("text/plain", JSON.stringify(data));
            document.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
            const target = cards(row - 1)[index];
            target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
            if (data === payload) check(target.classList.contains("co2prism-drop-target"), "Cible valide non indiquée");
            target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
            await bar.configWrites.get(actor); await Promise.resolve();
            document.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
          };
          check(lengths() === "3,1,1", "Empty preset has three rows");
          await dropAt(3, 0);
          check(lengths() === "3,1,2" && Object.values(actor.flags.co2prism.shortcuts).some(slot => slot.row === 3),
            "Third row accepts and persists shortcuts");
          cards(2)[0].querySelector(".co2prism-slot-remove").click(); await bar.configWrites.get(actor);
          const shield = { id: "shield", uuid: "Actor.test.Item.shield", name: "Shield", type: "equipment",
            parent: actor, img: nativeAction.actionImg, actions: [], system: {
              properties: { equipable: true }, equipped: false, usage: { oneHand: true, twoHand: false }
            } };
          actor.items.set(shield.id, shield);
          const shieldPayload = { type: "Item", uuid: shield.uuid };
          const removeHand = async index => {
            cards(0)[index].querySelector(".co2prism-slot-remove").click();
            await bar.configWrites.get(actor);
          };
          await dropAt(1, 2, shieldPayload);
          check(lengths() === "3,1,1", "Item direct refusé dans les raccourcis");
          for (const index of [0, 1]) {
            await dropAt(1, index, shieldPayload);
            const direct = cards(0)[index];
            check(shield.system.equipped && direct.querySelector("img")?.src === shield.img
              && !direct.querySelector(".co2prism-slot-time, .co2prism-slot-type, .co2prism-slot-uses, .co2prism-slot-cost")
              && direct.querySelector(".co2prism-slot-remove"), "Bouclier direct sans action");
            await removeHand(index);
            check(!shield.system.equipped, "Retrait du bouclier direct");
          }
          const checkMirror = index => {
            const mirror = cards(0)[index];
            const illustration = mirror.querySelector("img");
            check(mirror.classList.contains("co2prism-hand-mirror") && illustration?.src === nativeAction.actionImg
              && Number(getComputedStyle(illustration).opacity) < 1 && mirror.children.length === 2
              && mirror.querySelector(".co2prism-slot-hand"), "Miroir avec repère de main et sans commandes");
          };
          await dropAt(1, 1); checkMirror(0);
          await dropAt(1, 0, shieldPayload);
          check(!shield.system.equipped && !bar.configuration.handPresets[1]["left-hand"], "Dépôt refusé sur le miroir");
          await removeHand(1);
          await dropAt(1, 0); checkMirror(1);
          settings.locked = true; bar.updateLock();
          check(bar.presetButtons.map(button => button.hidden).join() === "false,true,true", "Presets vides masqués");
          const squarePreset = button => {
            const square = getComputedStyle(button, "::before");
            return square.content !== "none" && square.backgroundImage.includes("radial-gradient") &&
              square.borderRadius === "0px" && Math.abs(parseFloat(square.width) - parseFloat(square.height)) < 0.2;
          };
          check(squarePreset(bar.presetButtons[0]), "Active preset has a square glossy face");
          settings.locked = false; bar.updateLock();
          check(bar.presetButtons.every(button => !button.hidden), "Presets vides visibles en édition");
          const selectPreset = bar.setActivePreset.bind(bar);
          let requestedShift;
          bar.setActivePreset = (number, shift) => {
            requestedShift = shift;
            return selectPreset(number, shift);
          };
          bar.presetButtons[0].dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
          await bar.configWrites.get(actor);
          bar.setActivePreset = selectPreset;
          check(requestedShift === true && item.system.equipped, "MAJ issue du clic et preset actif réappliqué");
          check(lengths() === "3,1,1", "Les mains font croître la ligne");
          const occupied = cards(0)[0];
          check(occupied.querySelector("img").src === nativeAction.actionImg && occupied.dataset.co2prismDescriptionHtml?.includes("Description native"), "Image ou description copiée incorrectement");
          check(occupied.querySelector(".co2prism-slot-time").textContent === "G"
            && occupied.querySelector(".co2prism-slot-uses").textContent.trim() === "3"
            && occupied.querySelector(".co2prism-slot-cost").textContent.trim() === "2", "Décorations natives");
          if (game.tooltip) {
            const baseline = calls.length;
            const card = root.appendChild(document.createElement('div'));
            card.className = 'co2prism-combat-slot'; card.style.position = 'absolute';
            const capacity = { ...item, type: 'capacity', name: 'Capacity source',
              system: { frequency: 'daily', charges: { current: 2 }, description: '<p>First paragraph</p><p>Second paragraph</p><ul><li>Bullet</li></ul><ol><li>Step</li></ol>' } };
            const action = { actionName: 'Dedicated action', label: 'Dedicated action', hasLabel: true, actionTypeFinal: 'l',
              manaCost: 3, properties: { temporary: true, activable: true, enabled: false } };
            const hover = (node, shiftKey = false) => node.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, shiftKey }));
            const shift = (type, shiftKey) => window.dispatchEvent(new KeyboardEvent(type, { key: 'Shift', shiftKey }));
            bar.describeShortcut(card, { item: capacity, action }, action.actionName);
            await new Promise(resolve => setTimeout(resolve, 0)); hover(card);
            const tooltip = game.tooltip.tooltip;
            const text = () => tooltip.textContent.split('\\n');
            check(game.tooltip.element === card && text().join('|') ===
              'Capacity source|Dedicated action|Limit\u00e9e|Co\u00fbt en PM : 3|Nombre d\u2019utilisations : 2 par jour|Action d\u00e9sactiv\u00e9e', 'Plain action tooltip follows the requested order');
            check(tooltip.querySelector('em')?.textContent === 'Dedicated action', 'The action name is italic');
            shift('keydown', true);
            check(game.tooltip.element === card && tooltip.querySelectorAll('p').length === 2 && tooltip.querySelector('ul li') &&
              tooltip.querySelector('ol li') && !tooltip.textContent.includes('Dedicated action'), 'Shift shows formatted source description');
            shift('keyup', false);
            check(game.tooltip.element === card && text()[1] === 'Dedicated action' && !tooltip.querySelector('ol'), 'Releasing Shift restores the summary');
            capacity.system.frequency = 'combat';
            Object.assign(action, { hasLabel: false, actionName: capacity.name, label: '', manaCost: 0, actionTypeFinal: 'm' });
            action.properties.enabled = true;
            bar.describeShortcut(card, { item: capacity, action }, action.actionName); hover(card);
            check(text().join('|') === 'Capacity source|Mouvement|Nombre d\u2019utilisations : 2 par combat|Action activ\u00e9e', 'Summary omits missing name and cost and shows combat frequency');
            bar.budgetReset.dispatchEvent(new PointerEvent('pointerenter'));
            hover(bar.budgetReset);
            check(!game.tooltip.element, 'Non-action tooltips stay hidden without Shift');
            shift('keydown', true);
            check(game.tooltip.element === bar.budgetReset, 'Shift shows the budget control tooltip');
            shift('keyup', false); card.remove();
            check(!game.tooltip.element && calls.length === baseline, 'Tooltip modifiers do not execute an action');
          }
          const executeFlags = JSON.stringify(actor.flags);
          const clickShortcut = async modifiers => {
            cards(0)[0].dispatchEvent(new MouseEvent("click", {
              bubbles: true, cancelable: true, button: 0, detail: 1, ...modifiers
            }));
            await new Promise(resolve => setTimeout(resolve, 0));
          };
          for (const modifiers of [{}, { ctrlKey: true }, { altKey: true }, { shiftKey: true },
            { shiftKey: true, ctrlKey: true, altKey: true }, { ctrlKey: true, altKey: true }]) await clickShortcut(modifiers);
          check(JSON.stringify(shortcutCalls) === JSON.stringify([
            ["useAction", item.uuid, 0, "attack"], ["sendToChat", item.uuid, undefined, 0],
            ["useAction", item.uuid, 0, "damage"], ["openSheet", item.uuid], ["openSheet", item.uuid],
            ["sendToChat", item.uuid, undefined, 0]
          ]), "Raccourcis clavier CO2 incorrects");
          check(JSON.stringify(actor.flags) === executeFlags, "Configuration modifiée par exécution");
          check(cards(0)[0].querySelector(".co2prism-slot-uses").textContent.trim() === "2"
            && bar.gauges.mana.text.textContent === "17 / 18"
            && cards(0)[0].getAttribute("aria-pressed") === "true", "Rafraîchissement après action natif absent");
          let countCalls = shortcutCalls.length;
          nativeAction.hasResolversWithDomage = false; await clickShortcut({ altKey: true });
          check(shortcutCalls.length === countCalls, "Alt sans dommages a exécuté une action");
          nativeAction.properties.temporary = true; await clickShortcut({});
          check(shortcutCalls.at(-1)[0] === "activateAction" && shortcutCalls.at(-1)[1].state === false
            && shortcutCalls.at(-1)[1].type === undefined, "Action temporaire active non désactivée nativement");
          check(!cards(0)[0].classList.contains("co2prism-action-active"), "Effet actif conservé après désactivation");
          countCalls = shortcutCalls.length; await clickShortcut({ altKey: true });
          check(shortcutCalls.length === countCalls, "Alt temporaire a exécuté une action");
          nativeAction.properties.temporary = false; nativeAction.type = "heal"; await clickShortcut({});
          check(shortcutCalls.at(-1)[3] === "heal", "Soin forcé en attaque");
          nativeAction.type = "melee"; nativeAction.hasResolversWithDomage = true;
          for (let repeat = 0; repeat < 5; repeat++) bar.refreshActor();
          countCalls = shortcutCalls.length; await clickShortcut({});
          check(shortcutCalls.length === countCalls + 1, "Listeners de clic accumulés");
          await clickShortcut({ detail: 2 });
          check(shortcutCalls.length === countCalls + 1, "Double clic exécuté deux fois");
          bar.combatRows[0].lastElementChild.click();
          check(shortcutCalls.length === countCalls + 1, "Case vide exécutée");
          countCalls = shortcutCalls.length;
          let complete;
          const nativeUseAction = game.system.api.macros.useAction;
          game.system.api.macros.useAction = (...args) => new Promise(resolve => { shortcutCalls.push(["useAction", ...args]); complete = resolve; });
          cards(0)[0].click(); cards(0)[0].click();
          await new Promise(resolve => setTimeout(resolve, 0));
          check(shortcutCalls.length === countCalls + 1 && cards(0)[0].getAttribute("aria-disabled") === "true",
            "Clic pendant une opération en cours");
          complete(); await new Promise(resolve => setTimeout(resolve, 0));
          game.system.api.macros.useAction = nativeUseAction;
          await dropAt(1, 2); check(lengths() === "4,1,1", "Croissance ligne 1 incorrecte");
          await dropAt(2, 0); check(lengths() === "4,2,1", "Croissance ligne 2 incorrecte");
          // Même modèle natif dans plusieurs cases, lignes et presets.
          Object.assign(nativeAction.properties, { activable: true, temporary: true, enabled: false });
          hooks.get("updateItem")(item, { "system.actions": [] });
          const toggleFlags = JSON.stringify(actor.flags);
          await clickShortcut({});
          check(nativeAction.properties.enabled && root.querySelectorAll(".co2prism-action-active").length === 3,
            "Activation non synchronisée entre raccourcis");
          await clickShortcut({});
          check(!nativeAction.properties.enabled && !root.querySelector(".co2prism-action-active"), "Second clic sans désactivation");
          const geometry = () => JSON.stringify([...root.querySelectorAll(".co2prism-combat-slot")].map(node => {
            const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
          }).concat(bar.combatRows.map(row => [row.clientWidth, row.scrollWidth])));
          for (const size of ["S", "M", "L", "XL"]) {
            settings.size = size; bar.layout();
            nativeAction.properties.enabled = false; hooks.get("updateItem")(item, { "system.actions": [] });
            const before = geometry();
            nativeAction.properties.enabled = true; hooks.get("updateItem")(item, { "system.actions": [] });
            check(geometry() === before, size + " contour actif déplace ou élargit les cases");
            for (const node of root.querySelectorAll(".co2prism-slot-executable")) {
              check(node.classList.contains("co2prism-action-active") && node.getAttribute("aria-pressed") === "true", size + " état actif non restauré");
              const layer = getComputedStyle(node, "::after");
              check(layer.boxShadow !== "none" && layer.pointerEvents === "none" && light(node) === gold &&
                getComputedStyle(node.querySelector("img")).filter === "none", size + " halo preserves the original image");
              check(prism(node, "rim") === (node.hasAttribute("data-co2prism-hand") ? actorLight() : prism(root, "blue")),
                size + " shortcut retains its family rim");
              check(Number(getComputedStyle(node.querySelector(".co2prism-slot-cost")).zIndex) > Number(getComputedStyle(node, "::after").zIndex),
                size + " contour masque les indicateurs");
            }
            const shortcut = root.querySelector(".co2prism-slot-executable:not([data-co2prism-hand])");
            shortcut.classList.add("co2prism-linked-origin");
            check(prism(shortcut, "rim") === prism(root, "linked") && light(shortcut) === gold,
              size + " active linked shortcut combines a magenta rim with a gold halo");
            shortcut.classList.add("co2prism-time-insufficient");
            check(light(shortcut) === "transparent" && prism(shortcut, "rim-strength") === "29%",
              size + " unavailable linked shortcut loses the active halo and keeps a dim rim");
            shortcut.classList.remove("co2prism-linked-origin", "co2prism-time-insufficient");
          }
          check(JSON.stringify(actor.flags) === toggleFlags, "État actif écrit dans les flags Prism");
          const toggleReference = bar.shortcutFromDrop(actor, payload);
          for (const preset of [2, 3]) {
            await bar.setActivePreset(preset);
            check(root.querySelectorAll(".co2prism-action-active").length === 2, "Raccourcis actifs communs");
          }
          nativeAction.properties.enabled = false; hooks.get("updateItem")(item, { "system.actions": [] });
          check(!root.querySelector(".co2prism-action-active"), "Changement depuis feuille non synchronisé");
          await bar.setActivePreset(1);
          check(!root.querySelector(".co2prism-action-active"), "État précédent conservé au retour du preset");
          const nativeToggle = actor.activateAction;
          actor.activateAction = async () => false;
          await clickShortcut({});
          check(!nativeAction.properties.enabled && !root.querySelector(".co2prism-action-active"), "Refus affiché comme activation");
          actor.activateAction = nativeToggle;
          nativeAction.properties.activable = false; nativeAction.properties.enabled = true;
          hooks.get("updateItem")(item, { "system.actions": [] });
          check(!root.querySelector(".co2prism-action-active"), "Effet actif sans propriété activable");
          nativeAction.properties.activable = true; nativeAction.properties.temporary = false;
          hooks.get("updateItem")(item, { "system.actions": [] });
          check(!root.querySelector(".co2prism-action-active"), "Effet actif sur action ordinaire");
          const invalidBefore = JSON.stringify(actor.flags);
          await dropAt(2, 1, { type: "Item", uuid: item.uuid });
          check(JSON.stringify(actor.flags) === invalidBefore && lengths() === "4,2,1" && warnings.length > 0, "Drop invalide accepté");
          const executeBefore = calls.length;
          const staleBefore = shortcutCalls.length;
          for (const type of ["click", "contextmenu"]) occupied.dispatchEvent(new MouseEvent(type, { bubbles: true, ctrlKey: true }));
          check(calls.length === executeBefore && shortcutCalls.length === staleBefore, "Ancien carré exécuté");
          nativeAction.actionName = "Action modifiée"; nativeAction.charges = 0; nativeAction.hasCharges = false; item.system.charges.current = 0;
          bar.refreshActor();
          check(cards(0)[0].dataset.co2prismTooltipText.includes("Action modifiée")
            && cards(0)[0].querySelector(".co2prism-slot-uses").textContent.trim() === "0", "Données non actualisées");
          const removedSlots = structuredClone(actor.flags.co2prism.shortcuts);
          actor.items.delete(item.id); bar.refreshActor(); await bar.configWrites.get(actor);
          check(lengths() === "3,1,1" && Object.keys(actor.flags.co2prism.shortcuts).length === 0, "Raccourcis supprimés non nettoyés");
          actor.flags.co2prism.shortcuts = removedSlots;
          actor.items.set(item.id, item); bar.refreshActor();
          await bar.setActivePreset(2); check(lengths() === "4,2,1", "Raccourcis communs au preset 2");
          await bar.setActivePreset(1); check(lengths() === "4,2,1", "Ordre non restauré");
          settings.size = "XL"; bar.layout();
          for (let index = 0; index < 26; index++) await dropAt(1, cards(0).length - 1);
          check(lengths() === "30,2,1", "Limite arbitraire de cases");
          const row = bar.combatRows[0];
          row.scrollLeft = row.scrollWidth;
          const terminal = row.lastElementChild.getBoundingClientRect(), viewport = row.getBoundingClientRect();
          check(row.scrollWidth > row.clientWidth && terminal.right <= viewport.right + 1 && terminal.right > viewport.left, "Fin de ligne inaccessible");
          check(root.getBoundingClientRect().right <= innerWidth + 0.1, "Racine plus large que l'écran");
          check(document.elementFromPoint(innerWidth - 2, innerHeight - 2)?.id === "board", "Overlay après croissance");
          const savedPreset = JSON.stringify(actor.flags.co2prism.hands.presets[1]);
          const fullRows = label => {
            for (const row of bar.combatRows) {
              const bounds = row.getBoundingClientRect(), last = row.lastElementChild.getBoundingClientRect();
              check(row.scrollWidth <= row.clientWidth && row.scrollLeft === 0, label + " défilement inutile");
              check(last.right <= bounds.right + 0.1, label + " dernière case tronquée");
            }
          };
          for (const [size, width] of Object.entries({ S: 300, M: 430, L: 600, XL: 780 })) {
            for (const skills of [false, true]) {
              // Preset isolé pour tester les largeurs sans modifier les raccourcis précédents.
              actor.flags.co2prism.shortcuts = {};
              actor.flags.co2prism.hands.active = 3;
              actor.flags.co2prism.panels = { combat: true, competences: skills, equipements: false };
              settings.size = size; bar.refreshActor();
              bar.position = { x: 300, y: 350 }; bar.layout();
              const label = size + (skills ? " deux volets" : " Combat seul");
              check(lengths() === "3,1,1", label + " initialisation"); fullRows(label);
              await dropAt(2, 0); fullRows(label + " seconde ligne à deux cases");
              await dropAt(2, 1);
              check(lengths() === "3,3,1", label + " lignes égales"); fullRows(label + " lignes égales");
              bar.position = { x: innerWidth - width - 2, y: 350 }; bar.layout();
              const beforeGrowth = bar.portrait.getBoundingClientRect().x;
              const oldWidth = root.getBoundingClientRect().width;
              await dropAt(2, 2);
              check(lengths() === "3,4,1", label + " seconde ligne plus longue");
              fullRows(label + " seconde ligne plus longue");
              check(root.getBoundingClientRect().width > oldWidth, label + " volet non agrandi");
              check(bar.portrait.getBoundingClientRect().x < beforeGrowth, label + " croissance sans repositionnement");
              check(root.getBoundingClientRect().right <= innerWidth + 0.1, label + " hors écran");
              const origin1 = bar.combatRows[0].getBoundingClientRect().left;
              const origin2 = bar.combatRows[1].getBoundingClientRect().left;
              check(Math.abs(origin2 - origin1) < 0.1, label + " décalage modifié");
              await bar.setPanelState("combat", false);
              bar.position = { x: innerWidth - width - 2, y: 350 }; bar.layout();
              await bar.setPanelState("combat", true);
              fullRows(label + " réouverture");
              check(root.getBoundingClientRect().right <= innerWidth + 0.1, label + " réouverture hors écran");
            }
          }
          check(JSON.stringify(actor.flags.co2prism.hands.presets[1]) === savedPreset, "Autre preset modifié par les tests de largeur");
          await bar.setActivePreset(2); check(lengths() === "3,4,1", "Raccourcis communs au preset 2");
          await bar.setActivePreset(3); check(lengths() === "3,4,1", "Seconde ligne non restaurée");
          fullRows("retour au preset");
          const originalToken = canvas.tokens.controlled[0];
          const other = { ...actor, uuid: "Actor.other", flags: { co2prism: { panels: { combat: true } } }, items: new Map() };
          canvas.tokens.controlled = [{ actor: other, document: { baseActor: other } }]; bar.refreshActor();
          check(lengths() === "3,1,1", "Cases de l'acteur précédent conservées"); fullRows("autre acteur");
          canvas.tokens.controlled = [originalToken]; bar.refreshActor();
          check(lengths() === "3,4,1", "Seconde ligne non restaurée après changement d'acteur"); fullRows("retour à l'acteur");
          result.restoredSlots = actor.flags.co2prism.shortcuts;
          await bar.setPanelState("combat", false); await bar.setPanelState("competences", false);
          if (${Boolean(process.env.CO2PRISM_SCREENSHOT)}) {
            settings.size = "L"; bar.position = { x: 300, y: 350 }; bar.layout();
            actor.img = "file:///F:/FVTT_V14/public/icons/svg/mystery-man.svg";
            Object.assign(nativeAction.properties, { activable: true, temporary: true, enabled: true });
            bar.skillsToggle.click(); await bar.configWrites.get(actor);
            root.querySelector('[data-co2prism-preset="1"]').click(); await bar.configWrites.get(actor);
          }
          const board = document.getElementById("board").getBoundingClientRect();
          result.board = { width: board.width, height: board.height };

          // Repartir avec un preset court pour les interactions de configuration.
          actor.flags.co2prism.hands.active = 1; actor.flags.co2prism.panels.combat = true;
          actor.flags.co2prism.shortcuts = {}; actor.flags.co2prism.hands.presets[1] = {}; item.system.equipped = false; settings.locked = false; bar.refreshActor();
          for (let i = 0; i < 3; i++) await dropAt(1, cards(0).length - 1);
          const orderKeys = row => bar.slotRows()[row].filter(s => !s.hand && !s.terminal).map(s => s.key);
          const initialKeys = orderKeys(0);
          const move = async (sourceRow, sourceIndex, targetRow, targetIndex) => {
            const transfer = new DataTransfer(); const sourceNode = cards(sourceRow)[sourceIndex];
            sourceNode.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
            check(JSON.parse(transfer.getData('text/plain')).type === 'co2prism.shortcut', 'Internal drag payload');
            const target = cards(targetRow)[targetIndex];
            target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
            check(target.classList.contains('co2prism-drop-insert'), 'Insertion indicator');
            target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
            await bar.configWrites.get(actor);
            sourceNode.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
            await new Promise(resolve => setTimeout(resolve, 0));
          };
          const beforeMoveCalls = shortcutCalls.length;
          await move(0, 4, 0, 2);
          check(orderKeys(0).join() === [initialKeys[2], initialKeys[0], initialKeys[1]].join(), 'Internal insertion order');
          await move(0, 2, 1, 0);
          check(orderKeys(1)[0] === initialKeys[2] && orderKeys(0).length === 2, 'Cross-row move');
          check(shortcutCalls.length === beforeMoveCalls, 'Drag executed action');
          await dropAt(1, cards(0).length - 1);
          check(orderKeys(0).length === 3, 'External drop after internal move');
          const deleteButton = cards(0)[2].querySelector('.co2prism-slot-remove');
          deleteButton.click(); await bar.configWrites.get(actor);
          check(orderKeys(0).length === 2 && actor.items.get(item.id) === item, 'Delete reference only');
          await dropAt(1, 0);
          check(!cards(0)[0].draggable, 'Hand draggable');
          cards(0)[0].querySelector('.co2prism-slot-remove').click(); await bar.configWrites.get(actor);
          check(!bar.slotRows()[0][0].reference && cards(0).length === 5, 'Permanent hand removal');
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size; settings.locked = false; bar.refreshActor(); bar.layout();
            const widths = bar.combatRows.map(row => row.children.length);
            check(root.querySelectorAll('.co2prism-slot-remove').length === 3, size + ' unlocked trash');
            settings.locked = true; bar.updateLock();
            check(lengths() === '4,1,0' && root.querySelectorAll('.co2prism-slot-remove').length === 0, size + ' locked visibility');
            check(bar.combatRows.every((row, index) => row.children.length === widths[index] - 1), size + ' actual width shrink');
            check(!cards(0)[0].draggable, size + ' locked drag');
            check(bar.combatRows.every(r => r.scrollWidth <= r.clientWidth + 1), size + ' artificial scroll');
          }
          const lockedCalls = shortcutCalls.length;
          const lockedFlags = JSON.stringify(actor.flags);
          const lockedTransfer = new DataTransfer(); lockedTransfer.setData('text/plain', JSON.stringify(payload));
          const lockedNode = cards(0)[2];
          const lockedHover = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: lockedTransfer });
          lockedNode.dispatchEvent(lockedHover);
          check(!lockedHover.defaultPrevented && !lockedNode.classList.contains('co2prism-drop-target'), 'Locked hover accepted');
          lockedNode.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: lockedTransfer }));
          await Promise.resolve();
          check(JSON.stringify(actor.flags) === lockedFlags, 'Locked external drop wrote flags');
          item.system.charges.current = 2;
          cards(0)[2].click(); await new Promise(resolve => setTimeout(resolve, 0));
          check(shortcutCalls.length > lockedCalls, 'Locked execution blocked');
          settings.locked = false; bar.updateLock();
          const remainingHand = bar.slotRows()[0][1];
          await bar.manageShortcut({ actor, token: bar.token, key: remainingHand.key, preset: 1, reference: remainingHand.reference });
          settings.locked = true; bar.updateLock();
          item.type = "capacity";
          item.system.charges.current = 0; item.system.frequency = 'daily'; nativeAction.properties.noChargesUsed = false;
          hooks.get('updateItem')(item, {});
          const exhausted = cards(0)[2];
          check(exhausted.classList.contains('co2prism-action-exhausted') && exhausted.querySelector('.fa-sun'), 'Daily zero exhausted');
          item.system.frequency = 'combat'; hooks.get('updateItem')(item, {});
          check(cards(0)[2].querySelector('.fa-swords'), 'Combat icon');
          item.type = 'equipment'; item.system.subtype = 'consumable'; item.system.quantity = { current: 0 }; nativeAction.type = 'consumable';
          hooks.get('updateItem')(item, {});
          check(cards(0)[2].querySelector('.fa-sack') && cards(0)[2].classList.contains('co2prism-action-exhausted'), 'Quantity zero');
          item.system.quantity.current = 2; hooks.get('updateItem')(item, {});
          check(!cards(0)[2].classList.contains('co2prism-action-exhausted'), 'Quantity refresh');
          delete item.system.quantity; hooks.get('updateItem')(item, {});
          check(!cards(0)[2].querySelector('.co2prism-slot-uses'), 'Missing quantity shown');
          // Une résolution de consommation en seconde position suffit, même hors sous-type consommable.
          item.system.subtype = 'misc'; item.system.properties = { reloadable: true };
          item.system.charges.current = 8; item.system.quantity = { current: 3, destroyIfEmpty: false };
          nativeAction.type = 'heal'; nativeAction.properties.temporary = false;
          nativeAction.resolvers = [{ type: 'heal' }, { type: 'consumable' }];
          hooks.get('updateItem')(item, {});
          const consumedCard = () => cards(0)[2];
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size; bar.layout();
            const badge = consumedCard().querySelector('.co2prism-slot-uses');
            check(badge.textContent.trim() === '3' && badge.querySelector('.fa-flask-round-potion'), size + ' potion counter');
            check(consumedCard().querySelectorAll('.co2prism-slot-uses').length === 1, size + ' overlapping counters');
            const cardRect = consumedCard().getBoundingClientRect(), badgeRect = badge.getBoundingClientRect();
            check(Math.abs(cardRect.left + parseFloat(getComputedStyle(consumedCard()).borderLeftWidth) - badgeRect.left) < 1
              && badgeRect.bottom <= cardRect.bottom, size + ' potion bottom left');
          }
          const flagsBeforeConsumption = JSON.stringify(actor.flags);
          // Simuler le prédicat natif asynchrone sans le réimplémenter dans Prism.
          let equipped = false;
          nativeAction.isVisible = async (source, owner) => {
            check(source === item && owner === actor, 'Native condition arguments'); return equipped;
          };
          nativeAction.type = 'ranged'; nativeAction.properties.temporary = true; nativeAction.properties.enabled = true;
          hooks.get('updateItem')(item, {}); await new Promise(resolve => setTimeout(resolve, 0));
          check(consumedCard().classList.contains('co2prism-condition-unavailable')
            && consumedCard().classList.contains('co2prism-action-active'), 'Condition state lost active glow');
          check(consumedCard().getAttribute('aria-disabled') === 'true' && consumedCard().dataset.co2prismTooltipText.includes('ConditionsUnavailable'), 'Condition accessibility');
          const beforeUnavailable = shortcutCalls.length;
          consumedCard().click(); await new Promise(resolve => setTimeout(resolve, 0));
          consumedCard().dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
          await new Promise(resolve => setTimeout(resolve, 0));
          check(shortcutCalls.length === beforeUnavailable, 'Unavailable execution');
          consumedCard().dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
          await new Promise(resolve => setTimeout(resolve, 0));
          consumedCard().dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
          await new Promise(resolve => setTimeout(resolve, 0));
          check(shortcutCalls.length === beforeUnavailable + 2, 'Unavailable consultation blocked');
          equipped = true; hooks.get('updateItem')(item, {}); await new Promise(resolve => setTimeout(resolve, 0));
          check(!consumedCard().classList.contains('co2prism-condition-unavailable') && consumedCard().getAttribute('aria-disabled') === 'false', 'Equipped availability not restored');
          const completions = [];
          nativeAction.isVisible = () => new Promise(resolve => completions.push(resolve));
          hooks.get('updateItem')(item, {}); await Promise.resolve();
          nativeAction.isVisible = async () => true;
          hooks.get('updateItem')(item, {});
          await bar.setActivePreset(2); await new Promise(resolve => setTimeout(resolve, 0));
          for (const resolve of completions) resolve(false);
          await new Promise(resolve => setTimeout(resolve, 0));
          check(!root.querySelector('.co2prism-condition-unavailable'), 'Late condition applied to new preset');
          await bar.setActivePreset(1); await new Promise(resolve => setTimeout(resolve, 0));
          let visibilityChecks = 0;
          item.type = 'capacity'; item.system.learned = true;
          actor.canUseCapacities = true;
          nativeAction.isVisible = async source => { visibilityChecks++; return source.system.learned; };
          hooks.get('updateItem')(item, {});
          await new Promise(resolve => setTimeout(resolve, 0));
          const beforeGraphics = visibilityChecks;
          const lockedBeforeGraphics = settings.locked;
          bar.refreshActor();
          settings.locked = true; bar.updateLock();
          settings.locked = false; bar.updateLock();
          for (const size of ['S', 'M', 'L', 'XL']) { settings.size = size; bar.layout(); }
          settings.locked = lockedBeforeGraphics; bar.updateLock();
          await new Promise(resolve => setTimeout(resolve, 0));
          check(visibilityChecks === beforeGraphics, 'Graphic refreshes reuse native visibility checks');
          const capacityBeforeRestriction = consumedCard();
          actor.canUseCapacities = false;
          hooks.get('updateActor')(actor, { system: {} });
          await new Promise(resolve => setTimeout(resolve, 0));
          check(consumedCard() === capacityBeforeRestriction && consumedCard().classList.contains('co2prism-condition-unavailable') &&
            [...consumedCard().querySelectorAll('.co2prism-slot-type, .co2prism-slot-time, .co2prism-slot-cost, .co2prism-slot-uses')]
              .every(badge => getComputedStyle(badge).display === 'none'), 'Native armor/shield gate masks the badge without rebuilding the square');
          const callsBeforeRestricted = shortcutCalls.length;
          consumedCard().click(); await new Promise(resolve => setTimeout(resolve, 0));
          check(shortcutCalls.length === callsBeforeRestricted, 'The native equipment restriction blocks execution');
          actor.canUseCapacities = true;
          item.system.learned = false;
          hooks.get('updateItem')(item, {});
          await new Promise(resolve => setTimeout(resolve, 0));
          check(consumedCard().classList.contains('co2prism-condition-unavailable'), 'Native learned condition hides the existing shortcut');
          item.system.learned = true;
          hooks.get('updateItem')(item, {});
          await new Promise(resolve => setTimeout(resolve, 0));
          check(!consumedCard().classList.contains('co2prism-condition-unavailable'), 'Relearning restores the existing shortcut');
          item.type = 'equipment';
          delete actor.canUseCapacities;
          nativeAction.isVisible = async () => true;
          check(JSON.stringify(actor.flags) === flagsBeforeConsumption, 'False conditions removed shortcut');
          nativeAction.type = 'heal'; nativeAction.properties.temporary = false;
          hooks.get('updateItem')(item, {}); await new Promise(resolve => setTimeout(resolve, 0));
          const previousUse = game.system.api.macros.useAction;
          let consumeCalls = 0;
          game.system.api.macros.useAction = async (source, indice) => {
            check(source === item.uuid && indice === 0, 'Consumption support');
            consumeCalls++;
            // Simulation du resolver CO2 : aucun calcul de consommation ajouté à Prism.
            item.system.quantity.current--;
            if (item.system.quantity.current === 0 && item.system.quantity.destroyIfEmpty) {
              actor.items.delete(item.id); hooks.get('deleteItem')(item, {});
            } else hooks.get('updateItem')(item, {});
          };
          for (const value of [2, 1, 0]) {
            consumedCard().click(); await new Promise(resolve => setTimeout(resolve, 0));
            check(item.system.quantity.current === value && consumedCard().querySelector('.co2prism-slot-uses').textContent.trim() === String(value), 'Consumption refresh ' + value);
          }
          check(consumeCalls === 3 && consumedCard().classList.contains('co2prism-action-exhausted')
            && consumedCard().querySelector('.fa-flask-round-potion'), 'Potion zero exhausted');
          item.system.quantity.current = 3; hooks.get('updateItem')(item, {});
          check(!consumedCard().classList.contains('co2prism-action-exhausted') && consumedCard().querySelector('.co2prism-slot-uses').textContent.trim() === '3', 'Sheet quantity update');
          nativeAction.resolvers = [{ type: 'heal' }]; nativeAction.type = 'consumable'; hooks.get('updateItem')(item, {});
          check(!consumedCard().querySelector('.fa-flask-round-potion'), 'Action type mistaken for resolver');
          nativeAction.resolvers.push({ type: 'consumable' }); nativeAction.type = 'heal';
          item.system.quantity = { current: 1, destroyIfEmpty: true }; hooks.get('updateItem')(item, {});
          consumedCard().click(); await new Promise(resolve => setTimeout(resolve, 0));
          await bar.configWrites.get(actor);
          check(!actor.items.has(item.id) && cards(0).length === 2 && bar.combatRows[1].children.length === 0, 'Destroyed Item reference removed');
          check(Object.keys(actor.flags.co2prism.shortcuts).length === 0, 'Destroyed references persisted');
          game.system.api.macros.useAction = previousUse;
          // Matrice mains vides/occupées : mêmes positions, aucune écriture au verrouillage.
          actor.items.set(item.id, item); item.system.quantity.current = 3;
          const handReference = Object.values(removedSlots)[0];
          for (const preset of [1, 2, 3]) for (const size of ['S', 'M', 'L', 'XL']) {
            for (const occupiedHands of [[], ['left-hand'], ['right-hand'], ['left-hand', 'right-hand']]) {
              actor.flags.co2prism.hands.active = preset;
              const slots = {
                'ordinary-first': { ...handReference, row: 1, order: 0, hand: null },
                'ordinary-second': { ...handReference, row: 2, order: 0, hand: null }
              };
              for (const key of occupiedHands) slots[key] = { ...handReference, row: 1, hand: key.split('-')[0] };
              actor.flags.co2prism.shortcuts = Object.fromEntries(Object.entries(slots).filter(([key]) => !occupiedHands.includes(key)));
              actor.flags.co2prism.hands.presets[preset] = Object.fromEntries(occupiedHands.map(key => [key, slots[key]]));
              settings.size = size; settings.locked = false; bar.refreshActor(); bar.layout();
              const flags = JSON.stringify(actor.flags);
              const beforeAnchor = bar.anchor.getBoundingClientRect();
              const before = cards(0).slice(0, 2).map(node => node.getBoundingClientRect());
              settings.locked = true; bar.updateLock();
              check(lengths() === '3,1,0', size + ' reserved hand count');
              check(root.querySelectorAll('.co2prism-hand-empty').length === 2 - occupiedHands.length, size + ' hand placeholder count');
              cards(0).forEach((node, index) => {
                const rect = node.getBoundingClientRect();
                if (index >= 2) return;
                const afterAnchor = bar.anchor.getBoundingClientRect();
                check(Math.abs(rect.left - afterAnchor.left - before[index].left + beforeAnchor.left) < 1 &&
                  Math.abs(rect.top - afterAnchor.top - before[index].top + beforeAnchor.top) < 1 &&
                  Math.abs(rect.width - before[index].width) < 1, size + ' hand position relative to portrait');

                const hand = index === 0 ? 'left' : 'right';
                const marker = node.querySelector('.co2prism-slot-hand.fa-hand');
                const markerStyle = marker && getComputedStyle(marker);
                const markerBounds = marker?.getBoundingClientRect();
                check(markerBounds && Math.abs((markerBounds.left + markerBounds.right - rect.left - rect.right) / 2) < 1
                  && markerBounds.top < rect.top + rect.height / 4 && markerStyle.pointerEvents === 'none'
                  && markerStyle.color === palette('hand') && !marker.textContent
                  && markerStyle.transform === (hand === 'left' ? 'matrix(-1, 0, 0, 1, 0, 0)' : 'none'),
                  size + ' repère de main centré en haut');
                if (occupiedHands.includes(index === 0 ? 'left-hand' : 'right-hand')) {
                  check(node.classList.contains('co2prism-slot-executable') && !node.classList.contains('co2prism-hand-empty'), 'Occupied hand hidden');
                } else {
                  const style = getComputedStyle(node);
                  check(style.pointerEvents === 'none', 'Hand icon interactivity');
                  check(style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.borderLeftColor === 'rgba(0, 0, 0, 0)', 'Empty hand square visible');
                  check(!node.draggable && !node.querySelector('.co2prism-slot-remove, .co2prism-slot-empty'), 'Empty hand controls');
                  const callCount = shortcutCalls.length;
                  node.click(); node.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: lockedTransfer }));
                  check(shortcutCalls.length === callCount, 'Empty hand action');
                }
              });
              check(bar.combatRows.every(row => row.scrollWidth <= row.clientWidth + 1), size + ' placeholder artificial scroll');
              settings.locked = false; bar.updateLock();
              check(lengths() === '4,2,1' && !root.querySelector('.co2prism-hand-empty'), 'Unlock hand slots');
              check(JSON.stringify(actor.flags) === flags, 'Visual hand placeholder wrote flags');
            }
          }
          const economy = new ActionEconomy(actor);
          const statuses = new Set();
          game.system.CONST = { defenseStances: [{ id: "partialDef" }, { id: "fullDef" }] };
          actor.hasEffect = id => statuses.has(id);
          actor.canActivateDefenseStance = id => [...statuses].every(status => status === id);
          actor.toggleStatusEffect = async (id, { active }) => {
            if (active) statuses.add(id); else statuses.delete(id);
            return active;
          };
          await economy.reset(); await economy.grant("l"); bar.refreshActor();
          const [partial, full] = bar.defenseButtons;
          const [partialBox, fullBox] = bar.defenseButtons.map(button => button.getBoundingClientRect());
          check(!partial.disabled && !full.disabled && Math.abs(partialBox.width - partialBox.height) < 1 &&
            Math.abs(fullBox.width - fullBox.height) < 1 && partialBox.right < fullBox.left,
            "DEF renders two available square buttons side by side");
          const availableTimes = () => bar.budgetCommands
            .filter(button => button.parentElement.classList.contains("co2prism-time-available"))
            .map(button => button.dataset.co2prismTime).join(",");
          const skillAvailability = () => bar.skillNodes.map(({ button }) => button.disabled).join(",");
          const skillsWereOpen = actor.flags.co2prism.panels.competences;
          actor.flags.co2prism.panels.competences = true;
          bar.refreshActor();
          const initialTimes = availableTimes();
          const initialSkills = skillAvailability();
          const initialBudget = JSON.stringify(economy.getSnapshot());
          const rollSkill = actor.rollSkill;
          let finishRoll;
          let rollCount = 0;
          const pendingRoll = new Promise(resolve => { finishRoll = resolve; });
          actor.rollSkill = () => { rollCount++; return pendingRoll; };
          const rolling = bar.performAction("skill:agi");
          check(bar.busyAction === "skill:agi" && initialSkills.includes("false"), "Skill dialog is pending with available skills");
          const checkAvailabilityDuringRoll = () => {
            check(availableTimes() === initialTimes && !availableTimes().includes("am") &&
              skillAvailability() === initialSkills && !partial.disabled && !full.disabled,
              "Time, skill and defense availability stays visible during the skill dialog");
          };
          checkAvailabilityDuringRoll();
          bar.refreshActor();
          checkAvailabilityDuringRoll();
          bar.skillNodes[0].button.click();
          bar.budgetCommands.find(button => button.dataset.co2prismTime === "a").click();
          partial.click(); full.click();
          await new Promise(resolve => setTimeout(resolve, 0));
          check(rollCount === 1 && statuses.size === 0 && JSON.stringify(economy.getSnapshot()) === initialBudget,
            "Concurrent clicks during the skill dialog cannot roll twice, change defense or spend time");
          finishRoll();
          await rolling;
          actor.rollSkill = rollSkill;
          actor.flags.co2prism.panels.competences = skillsWereOpen;
          bar.refreshActor();
          partial.click(); await new Promise(resolve => setTimeout(resolve, 0));
          check(statuses.has("partialDef") && partial.getAttribute("aria-pressed") === "true" && full.disabled &&
            economy.getSnapshot().bonus.l === 1 && !economy.getSnapshot().canSpend.a,
            "Click spends A, marks the defense active and blocks full defense even with L");
          check(!partial.disabled, "Active defense remains clickable without A");
          const budgetAfterDefense = JSON.stringify(economy.getSnapshot());
          partial.click(); await new Promise(resolve => setTimeout(resolve, 0));
          check(!statuses.has("partialDef") && partial.getAttribute("aria-pressed") === "false" && partial.disabled && !full.disabled &&
            JSON.stringify(economy.getSnapshot()) === budgetAfterDefense, "Second click removes only the posture without changing the budget");
          await economy.reset(); bar.refreshActor();
          const budgetTypes = () => [...bar.budgetBar.querySelectorAll('[data-co2prism-budget-type]')].map(node => node.dataset.co2prismBudgetType).join(',');
          const command = async (type, bonus = false) => {
            const button = root.querySelector('[data-co2prism-time="' + type + '"]');
            const event = new MouseEvent(bonus ? 'contextmenu' : 'click', { bubbles: true, cancelable: true, button: bonus ? 2 : 0 });
            button.dispatchEvent(event); await new Promise(resolve => setTimeout(resolve, 0));
            if (bonus) check(event.defaultPrevented, 'Native context menu not prevented');
          };
          const resetBudget = async () => { bar.budgetReset.click(); await new Promise(resolve => setTimeout(resolve, 0)); };
          const halos = () => bar.budgetCommands.filter(button => button.parentElement.classList.contains('co2prism-time-available')).map(button => button.dataset.co2prismTime).join(',');
          const mixedGeometry = () => {
            const mixed = root.querySelector('[data-co2prism-time="am"]');
            const commandStyle = getComputedStyle(mixed);
            check(new Set(bar.budgetCommands.map(button => getComputedStyle(button).color)).size === 1,
              'M uses the same light text as the other time commands');
            const hasDiagonal = style => ['135deg', palette('attack'), palette('move')]
              .every(color => style.backgroundImage.includes(color));
            check(commandStyle.clipPath === 'none' && commandStyle.backgroundImage.includes('135deg') &&
              !hasDiagonal(commandStyle) && !mixed.parentElement.classList.contains('co2prism-time-available') &&
              mixed.textContent === 'AM', 'AM command retains its attenuated split colors');
            for (const node of bar.budgetBar.querySelectorAll('.co2prism-time-indicator')) {
              const square = getComputedStyle(node, '::before');
              check(getComputedStyle(node).color === commandStyle.color, 'Budget letters use the same light text');
              check(Math.abs(parseFloat(square.width) - parseFloat(square.height)) < 0.2
                && getComputedStyle(node).clipPath === 'none', 'Budget square');
              if (node.dataset.co2prismBudgetType === 'am') {
                check(hasDiagonal(square) && node.textContent.includes('AM'), 'AM diagonal budget square');
              }
            }
          };
          const movement = (meters, cells) => check(bar.combatValues.meters.textContent === meters && bar.combatValues.cells.textContent === cells, 'Budget movement ' + meters + ' / ' + cells);
          settings.locked = true; bar.updateLock(); canvas.scene.grid = { type: 1, distance: 2, units: 'm' };
          await resetBudget(); movement('20', '10');
          check(halos() === 'a,l,m', 'Initial availability halos'); mixedGeometry();
          const beforeMixedClick = JSON.stringify(actor.flags);
          await command('am');
          const mixedButton = root.querySelector('[data-co2prism-time="am"]');
          for (const key of ['Enter', ' ']) {
            mixedButton.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
            mixedButton.click();
            mixedButton.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
          }
          await new Promise(resolve => setTimeout(resolve, 0));
          check(JSON.stringify(actor.flags) === beforeMixedClick, 'AM left/keyboard spent budget');
          await command('am', true); mixedGeometry();
          check(economy.getSnapshot().bonus.am === 1 && halos() === 'a,l,m', 'AM right bonus or halo');
          await resetBudget();
          check(budgetTypes() === 'l,m,am' && bar.budgetBar.querySelector('.co2prism-time-separator'), 'Initial alternative');
          check([...bar.budgetBar.children].every(node => node.getBoundingClientRect().right <= bar.budgetBar.getBoundingClientRect().right + 1), 'Initial budget contents clipped');
          await command('a'); movement('10', '5'); check(budgetTypes() === 'm', 'Normal A branch');
          check(halos() === 'm', 'A spend halo');
          await resetBudget(); await command('m'); movement('10', '5'); check(budgetTypes() === 'am', 'Normal M branch');
          check(halos() === 'a,m', 'M spend polyvalent halos');
          await command('m'); movement('0', '0');
          const emptyBudget = JSON.stringify(actor.flags.co2prism.actionEconomy), warningCount = warnings.length;
          await command('m'); await command('m');
          check(JSON.stringify(actor.flags.co2prism.actionEconomy) === emptyBudget && warnings.length === warningCount, 'Impossible spend mutated or spammed');
          check(bar.budgetCommands.every(button => !button.disabled) && bar.budgetCommands.find(button => button.dataset.co2prismTime === 'm').dataset.co2prismTooltipText.includes('Aucun temps compatible'), 'Spent command disabled');
          await resetBudget(); await command('l'); movement('0', '0');
          check(halos() === '', 'Limited spend halos');
          await command('a', true); check(halos() === 'a', 'A bonus restores halo');
          await command('am', true); check(halos() === 'a,m', 'AM bonus restores specialized halos');
          await resetBudget(); await command('m', true); movement('30', '15');
          await command('m'); movement('20', '10'); check(economy.getSnapshot().branch === 'undecided', 'Bonus M priority');
          await resetBudget(); await command('a', true); movement('20', '10');
          check(bar.budgetBar.querySelector('.co2prism-time-bonus.co2prism-time-attack'), 'Red bonus A missing');
          await command('a'); check(economy.getSnapshot().branch === 'undecided' && budgetTypes() === 'l,m,am', 'Bonus A priority');
          for (const type of ['a', 'm', 'am']) {
            await resetBudget(); await command('am', true); await command(type);
            const state = economy.getSnapshot();
            check(type === 'a' ? state.bonus.am === 0 && state.branch === 'undecided'
              : type === 'm' ? state.bonus.am === 1 && !state.normal.m : state.bonus.am === 1 && state.branch === 'undecided', 'Bonus AM consumption ' + type);
          }
          await resetBudget(); await command('l', true); await command('l');
          check(economy.getSnapshot().branch === 'undecided', 'Bonus L closed branch');
          await command('m', true); await command('l'); movement('10', '5');
          canvas.scene.grid.distance = 5; hooks.get('updateScene')(canvas.scene, { grid: {} }); movement('10', '2');
          const scene = canvas.scene; canvas.scene = undefined; bar.refreshActor(); movement('10', 'CO2PRISM.Unavailable'); canvas.scene = scene;
          await resetBudget(); movement('20', '4');
          const persistedBudget = JSON.stringify(actor.flags.co2prism.actionEconomy);
          for (const preset of [1, 2, 3]) { await bar.setActivePreset(preset); if (bar.combatPanel.hidden) await bar.setActivePreset(preset); }
          check(JSON.stringify(actor.flags.co2prism.actionEconomy) === persistedBudget, 'Preset reset economy');
          const shortcutBudget = JSON.stringify(economy.getSnapshot());
          cards(0)[0].click(); await new Promise(resolve => setTimeout(resolve, 0));
          check(JSON.stringify(economy.getSnapshot()) === shortcutBudget, 'Free shortcut spent time');
          actor.testUserPermission = (_, level) => level === 'OBSERVER'; bar.refreshActor();
          check(bar.budgetCommands.every(button => button.disabled) && bar.budgetReset.disabled, 'Observer budget writable');
          check(halos() === '', 'Observer spending halo');
          check(await bar.changeEconomy('grant', 'm') === false, 'Observer command accepted');
          actor.testUserPermission = () => true; bar.refreshActor();
          // Débordement maîtrisé du cadre, puis retour au budget initial.
          const originalLayout = bar.layout;
          let budgetLayouts = 0;
          bar.layout = function (...args) { budgetLayouts++; return originalLayout.apply(this, args); };
          try { await economy.grant('m', 16); bar.refreshActor(); }
          finally { bar.layout = originalLayout; }
          check(budgetLayouts === 0, 'Growing the local budget does not reposition Prism');
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size; bar.position = { x: 160, y: 300 }; bar.layout();
            const wideBudget = bar.budgetScroll.getBoundingClientRect();
            const rightHand = bar.combatHands.right.getBoundingClientRect();
            const wideTile = bar.budgetBar.lastElementChild.getBoundingClientRect();
            check(wideBudget.right > rightHand.right && bar.budgetScroll.scrollWidth <= bar.budgetScroll.clientWidth + 1,
              size + ' budget extends past Combat before scrolling');
            settings.size = size; bar.position = { x: innerWidth - 300, y: 300 }; bar.layout();
            check(root.getBoundingClientRect().right <= innerWidth + 1, size + ' budget outside viewport');
            const reset = bar.budgetReset.getBoundingClientRect(), scroller = bar.budgetScroll.getBoundingClientRect();
            bar.budgetScroll.scrollLeft = bar.budgetScroll.scrollWidth;
            const last = bar.budgetBar.lastElementChild.getBoundingClientRect();
            check(last.right <= scroller.right + 1 && last.right > scroller.left, size + ' budget end accessible');
            check(Math.abs(last.width - wideTile.width) < 1 && reset.right <= innerWidth,
              size + ' budget indicators keep their size at the edge');
            check(reset.left >= scroller.right && reset.left === bar.budgetReset.getBoundingClientRect().left &&
              bar.budgetReset.contains(document.elementFromPoint(reset.x + reset.width / 2, reset.y + reset.height / 2)),
              size + ' reset independently accessible');
          }
          await resetBudget();
          // Exécution payante : le wrapper ne retourne rien, les hooks natifs confirment.
          nativeAction.actionTypeFinal = 'm'; nativeAction.type = 'heal';
          nativeAction.properties.temporary = false; nativeAction.properties.activable = true;
          let nativeOutcome = true, nativeExecutions = 0;
          const activateTimed = async options => {
            const { canSpend } = economy.getSnapshot();
            check(halos() === ['a', 'l', 'm'].filter(type => canSpend[type]).join(','),
              'Time highlights reflect the actual budget during native execution');
            const guards = [];
            const details = { item, ...options, guard: promise => guards.push(Promise.resolve(promise)) };
            hooks.get('co2.preActivateAction')?.(actor, details);
            if ((await Promise.all(guards)).some(value => value === false)) return false;
            nativeExecutions++;
            if (nativeOutcome && nativeAction.properties.temporary) nativeAction.properties.enabled = options.state;
            hooks.get('co2.postActivateAction')?.(actor, { ...details, success: nativeOutcome });
            hooks.get('updateItem')(item, {});
            return true;
          };
          game.system.api.macros.useAction = async (source, indice, type = 'attack') => {
            check(source === item.uuid && indice === 0, 'Timed native support');
            await activateTimed({ state: true, source, indice, type });
          };
          actor.activateAction = activateTimed;
          const paidClick = async () => {
            bar.combatRows[0].querySelector('.co2prism-slot-executable').click();
            await new Promise(resolve => setTimeout(resolve, 0));
          };
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size; await resetBudget(); await command('m', true);
            await paidClick(); movement('20', '4');
            check(halos() === 'a,l,m', size + ' automatic bonus spend halos');
            check(economy.getSnapshot().branch === 'undecided', size + ' timed M bonus priority');
            await paidClick(); movement('10', '2');
            check(halos() === 'a,m', size + ' automatic normal M spend halos');
            await paidClick(); movement('0', '0');
            check(halos() === '', size + ' automatic exhaustion halos');
            const exhausted = bar.combatRows[0].querySelector('.co2prism-slot-executable');
            check(exhausted.classList.contains('co2prism-time-insufficient') && getComputedStyle(exhausted).pointerEvents !== 'none'
              && exhausted.getAttribute('aria-disabled') === 'false', size + ' time restriction must remain clickable');
            const executions = nativeExecutions; await paidClick();
            check(nativeExecutions === executions, size + ' exhausted budget executed');
          }
          await resetBudget(); nativeAction.actionTypeFinal = 'a'; nativeOutcome = false;
          await paidClick(); movement('20', '4');
          nativeOutcome = true; await paidClick(); movement('10', '2');
          check(budgetTypes() === 'm', 'Paid attack budget not rendered');
          await resetBudget(); nativeAction.properties.temporary = true; nativeAction.properties.enabled = false;
          await paidClick();
          check(bar.combatRows[0].querySelector('.co2prism-action-active') && !economy.getSnapshot().normal.am, 'Paid temporary activation');
          const activatedBudget = JSON.stringify(actor.flags.co2prism.actionEconomy);
          await paidClick();
          check(!bar.combatRows[0].querySelector('.co2prism-action-active') && JSON.stringify(actor.flags.co2prism.actionEconomy) === activatedBudget, 'Temporary deactivation spent time');
          check(!hooks.has('co2.preActivateAction') && !hooks.has('co2.postActivateAction'), 'Timed listeners leaked');
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size; await resetBudget(); await command('am', true);
            bar.position = { x: innerWidth - 300, y: 300 }; bar.layout(); mixedGeometry();
            check(halos() === 'a,l,m', size + ' halo after reset');
            const scale = parseFloat(root.style.getPropertyValue('--co2prism-unit'));
            for (const button of bar.budgetCommands) {
              const rect = button.getBoundingClientRect(), wrapper = button.parentElement;
              check(Math.abs(wrapper.getBoundingClientRect().width - rect.width) < 1, size + ' halo wrapper geometry');
              check(getComputedStyle(wrapper).pointerEvents === 'none', size + ' halo hit surface');
              const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
              check(button.contains(hit), size + ' rectangular command corner clickable');
              check(getComputedStyle(wrapper).filter === 'none' &&
                (getComputedStyle(button).boxShadow !== 'none') === (button.dataset.co2prismTime !== 'am'),
                size + ' time glow excludes the AM command without changing its hit surface');
            }
            check(bar.budgetScroll.scrollWidth <= bar.budgetScroll.clientWidth + 1, size + ' halo artificial scroll');
          }
          nativeAction.properties.temporary = false; nativeAction.actionTypeFinal = 'm';
          await resetBudget(); await economy.spend('l'); bar.refreshActor();
          const spentFlag = JSON.stringify(actor.flags.co2prism.actionEconomy);
          for (const mode of ['off', 'combat', 'always']) {
            settings.economyMode = mode;
            for (const started of [false, true]) {
              game.combats = { active: { started } }; bar.refreshActor();
              const enabled = mode === 'always' || (mode === 'combat' && started);
              check(bar.budgetScroll.hidden === !enabled, 'Mode budget visibility ' + mode + started);
              check(bar.timeCommands.hidden === !enabled, 'Mode budget command visibility ' + mode + started);
              movement(enabled ? '0' : '10', enabled ? '0' : '2');
              const node = bar.combatRows[0].querySelector('.co2prism-slot-executable');
              check(node.classList.contains('co2prism-time-insufficient') === enabled, 'Mode shortcut greying');
              check(node.querySelector('.co2prism-slot-time')?.textContent === 'M', 'Informative time badge');
              const executions = nativeExecutions;
              await paidClick();
              check(nativeExecutions === executions + Number(!enabled), 'Mode execution ' + mode + started);
              check(JSON.stringify(actor.flags.co2prism.actionEconomy) === spentFlag, 'Mode changed hidden budget');
            }
          }
          settings.economyMode = 'always'; bar.refreshActor();
          canvas.scene.grid.distance = 3;
          await resetBudget(); await command('m', true); await command('m');
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size;
            for (const mode of ['nearest', 'up', 'down']) {
              settings.movementRounding = mode; bar.refreshActor(); bar.layout();
              movement('20', mode === 'down' ? '6' : '7');
              const node = bar.combatValues.cells, rect = node.getBoundingClientRect();
              check(node.scrollWidth <= node.clientWidth + 1, size + ' rounded cells overflow');
              const bounds = root.getBoundingClientRect();
              check(rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1, size + ' rounded cells bounds');
            }
          }
          const originalName = actor.name, originalEffects = actor.appliedEffects;
          actor.name = 'Alexandrine des Marches lointaines, gardienne du dernier passage';
          actor.appliedEffects = Array.from({ length: 80 }, (_, index) => ({ name: 'Effet ' + index,
            img: 'file:///F:/FVTT_V14/public/icons/svg/shield.svg', statuses: new Set() }));
          const movementPanel = root.querySelector('#co2prism-movement-panel');
          const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
          const manyEffects = actor.appliedEffects;
          bar.position = { x: 40, y: 300 };
          settings.size = 'M'; bar.layout();
          let twoEffectsWidth;
          for (const count of [0, 2, 12]) {
            actor.appliedEffects = manyEffects.slice(0, count); bar.refreshActor();
            const effects = bar.combatEffects;
            const box = effects.getBoundingClientRect();
            if (count === 0) check(box.width === 0, 'No effects surface for an empty list');
            if (count === 2) twoEffectsWidth = box.width;
            if (count === 12) {
              check(box.width > twoEffectsWidth && Math.abs(box.right - bar.name.parentElement.getBoundingClientRect().right) < 1 &&
                effects.scrollWidth <= effects.clientWidth + 1, 'Twelve effects fit the name line without scrolling');
            }
          }
          actor.appliedEffects = manyEffects;
          for (const size of ['S', 'M', 'L', 'XL']) {
            for (const enabled of [true, false]) {
              settings.size = size; settings.economyMode = enabled ? 'always' : 'off';
              actor.flags.co2prism.panels.competences = false;
              bar.refreshActor();
              for (const position of [{ x: 0, y: 0 }, { x: innerWidth - 5, y: innerHeight - 5 }]) {
                bar.position = position; bar.layout();
                const bounds = root.getBoundingClientRect(), name = bar.name.getBoundingClientRect();
                const portrait = bar.portrait.getBoundingClientRect();
                const toggle = bar.combatToggle.getBoundingClientRect();
                const first = bar.combatRows[0].getBoundingClientRect(), second = bar.combatRows[1].getBoundingClientRect();
                const effects = bar.combatEffects.getBoundingClientRect();
                check(bounds.left >= -0.1 && bounds.top >= -0.1 && bounds.right <= innerWidth + 0.1 && bounds.bottom <= innerHeight + 0.1, size + ' 15A screen bounds');
                check(name.top >= portrait.bottom - 1 && name.bottom <= bounds.bottom + 0.1,
                  size + ' name stays below the portrait');
                check(bar.name.dataset.co2prismTooltipText === actor.name && getComputedStyle(bar.name).textOverflow === 'ellipsis' &&
                  bar.name.scrollWidth > bar.name.clientWidth && name.right <= effects.left &&
                  !intersects(bar.lock.getBoundingClientRect(), name), size + ' long name yields to effects while the lock remains clear');
                check(!bar.upperLine.hidden && !movementPanel.hidden && bar.movementZonesButton.disabled,
                  size + ' shared movement line is visible with disabled controls for an ineligible token');
                check(bar.combatEffects.parentElement === bar.name.parentElement && Math.abs(effects.right - bar.name.parentElement.getBoundingClientRect().right) < 1 &&
                  effects.top >= portrait.bottom - 1 && getComputedStyle(bar.combatEffects).backgroundColor === 'rgba(0, 0, 0, 0)'
                  && bar.combatEffects.children.length === 80, size + ' effects share the name background');
                check(getComputedStyle(bar.combatEffects).scrollbarWidth === 'none', size + ' effects without overlay scrollbar');
                bar.combatEffects.scrollLeft = 0;
                bar.combatEffects.dispatchEvent(new WheelEvent('wheel', { deltaY: 100000, cancelable: true }));
                const last = bar.combatEffects.lastElementChild.getBoundingClientRect();
                check(last.right <= effects.right + 1 && last.right > effects.left, size + ' 15A effects accessible');
                const image = bar.combatEffects.lastElementChild.querySelector('img').getBoundingClientRect();
                check(image.top >= effects.top - 0.1 && image.bottom <= effects.bottom + 0.1, size + ' 15A effect image clipped ' + JSON.stringify({ top: image.top, bottom: image.bottom, areaTop: effects.top, areaBottom: effects.bottom }));
                if (enabled) {
                  const budget = bar.budgetScroll.getBoundingClientRect();
                  check(budget.top < bar.combatHands.left.getBoundingClientRect().top && budget.top >= bounds.top - 0.1 && !intersects(budget, toggle), size + ' 15A budget position');
                } else check(bar.budgetScroll.getClientRects().length === 0, size + ' 15A hidden budget space');
                for (const row of bar.combatRows) check(!intersects(row.getBoundingClientRect(), toggle), size + ' 15A row collision');
                const clearX = bounds.left > 5 ? 2 : innerWidth - 2, clearY = 2;
                check(document.elementFromPoint(clearX, clearY)?.id === 'board', size + ' 15A transparent lower corner');
              }
              actor.flags.co2prism.panels.competences = true; bar.refreshActor();
              const b = root.getBoundingClientRect();
              check(b.top >= -0.1 && b.bottom <= innerHeight + 0.1, size + ' 15A combined bounds');
            }
          }
          actor.name = originalName; actor.appliedEffects = originalEffects;
          actor.flags.co2prism.panels.competences = false; settings.economyMode = 'always'; bar.refreshActor();
          // Raccorder un vrai double de TokenDocument pour les interactions 15C.
          const selectedToken = canvas.tokens.controlled[0], tracked = selectedToken.document;
          const movementScene = canvas.scene;
          movementScene.id = 'movement-scene'; movementScene.tokens = new Map();
          Object.assign(tracked, { id: 'movement-token', uuid: 'Scene.s.Token.t', parent: movementScene,
            actor, x: 0, y: 0, elevation: 0, width: 1, height: 1, depth: 0, shape: 1, level: 'level', movementHistory: [],
            testUserPermission: () => true, canUserModify: () => true,
            object: { measureMovementPath: measureRecordedPath } });
          movementScene.tokens.set(tracked.id, tracked);
          movementScene.grid = { type: 1, distance: 2, units: 'm' };
          await economy.reset(); await economy.grant('m', 3); hooks.get('updateActor')(actor, { flags: {} });
          let moveSerial = 0;
          const trackedMove = (spaces, target = tracked) => {
            const origin = { x: target.x, y: target.y, elevation: target.elevation };
            target.x += spaces * 100;
            const nativeDistance = spaces * target.parent.grid.distance;
            hooks.get('moveToken')(target, { id: 'tracked-' + (++moveSerial), origin, method: 'keyboard',
              passed: { waypoints: [{ x: target.x, y: target.y, elevation: target.elevation,
                terrain: { testCost: nativeDistance, testDistance: nativeDistance, testSpaces: spaces } }], spaces, distance: nativeDistance, cost: nativeDistance } });
          };
          let failReturn = false;
          tracked.update = async data => {
            if (failReturn) throw Error('Return rejected');
            Object.assign(tracked, Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'action')));
            trackedMove(0); return tracked;
          };
          bar.refreshActor();
          const previewFlag = JSON.stringify(actor.flags.co2prism.actionEconomy), notificationCount = warnings.length;
          await bar.setPanelState('combat', false);
          trackedMove(2); trackedMove(3);
          check(bar.upperLine.hidden && !bar.movementTracker.getSnapshot(tracked).success
            && JSON.stringify(actor.flags.co2prism.actionEconomy) === previewFlag, 'Closed Combat tracks no moves');
          const trackedStart = tracked.x;
          await bar.setPanelState('combat', true);
          check(!bar.upperLine.hidden && bar.movementTracker.getSnapshot(tracked).success, 'Combat starts the movement session');
          check(movementPanel.querySelectorAll('input[type="radio"]').length === 0, 'No movement mode radios');
          check(bar.movementTracker.getSnapshot(tracked).state.mode === 'exact'
            && bar.movementTracker.getSnapshot(tracked).state.start.x === trackedStart, 'Exact session starts at current position');
          check(movementPanel.querySelector('.co2prism-movement-zones-toggle').disabled
            ,
            'Zones prototype unavailable API leaves panel usable with diagnostic');
          const remainingText = () => movementPanel.querySelector('.co2prism-movement-summary').textContent;
          const excessText = () => movementPanel.querySelector('.co2prism-movement-excess')?.textContent;
          check(remainingText() === '5', 'Cinq cases à l’ouverture');
          trackedMove(2);
          check(remainingText() === '3' && !excessText(), 'Trois cases après un coût de deux');
          const availableSegments = [...movementPanel.querySelectorAll('.co2prism-movement-cell[data-used="0"]')];
          const segmentBounds = availableSegments.map(node => node.getBoundingClientRect());
          check(segmentBounds.length === 3 && segmentBounds.every((segment, index) =>
            segment.width > 0 && (index === 0 || segment.left - segmentBounds[index - 1].right >= 1.9)) &&
            availableSegments.every(node => getComputedStyle(node).backgroundImage.includes(palette('move'))),
            'Trois cases disponibles correspondent à trois segments bleus séparés');
          trackedMove(3);
          check(remainingText() === '0' && !excessText(), 'Budget épuisé sans dépassement');
          trackedMove(1);
          check(remainingText() === '-1' && movementPanel.querySelector('.co2prism-movement-summary').dataset.negative === 'true' && excessText() === 'Dépassement de 1 case !', 'Dépassement singulier');
          trackedMove(1);
          const blocks = () => [...movementPanel.querySelectorAll('.co2prism-movement-block')];
          const grey = () => [...movementPanel.querySelectorAll('.co2prism-movement-cell')].reduce((sum, node) => sum + Number(node.dataset.used), 0);
          check(blocks().length === 1 && grey() === 5 && blocks()[0].children.length === 5, 'Single block with five filled cells');
          check(blocks()[0].getBoundingClientRect().width <= movementPanel.getBoundingClientRect().width, 'Single block fits panel');
          trackedMove(22);
          check(grey() === 5 && movementPanel.querySelectorAll('.co2prism-movement-cell').length === 5, '15C excess adds no cells');
          check(movementPanel.querySelector('.co2prism-movement-excess')?.textContent.includes('24 cases'), 'Single M immediate red excess');
          await economy.grant('am'); hooks.get('updateActor')(actor, { flags: {} });
          check(blocks().length === 1 && movementPanel.querySelector('.co2prism-movement-excess')?.textContent.includes('24 cases'), 'Bonus preserves single block and capacity');
          check(remainingText() === '-24', 'Le bonus AM ne recharge pas l’action en cours');
          await economy.spend('m'); hooks.get('updateActor')(actor, { flags: {} });
          check(blocks().length === 1 && movementPanel.querySelector('.co2prism-movement-excess'), 'External spend preserves single block and capacity');
          settings.economyMode = 'off'; bar.refreshActor();
          check(blocks().length === 1 && bar.movementView(tracked).capacity === 5, 'Inactive budget single M capacity');
          check(remainingText() === '-24', 'Inactive economy preserves the tactical count');
          settings.economyMode = 'always'; bar.refreshActor();
          check(!movementPanel.querySelector('.co2prism-movement-summary').hidden, 'Active budget shows summary');
          const beforeReturn = JSON.stringify(actor.flags.co2prism.actionEconomy);
          failReturn = true; await bar.resetMovement();
          check(!movementPanel.querySelector('.co2prism-movement-error').hidden && grey() === 5, '15C return failure preserves path');
          failReturn = false; movementPanel.querySelector('.co2prism-movement-reset').click();
          await new Promise(resolve => setTimeout(resolve, 0));
          check(tracked.x === trackedStart && grey() === 0 && !movementPanel.hidden, 'Successful return keeps exact session');
          check(remainingText() === '5' && !excessText(), 'Le retour restaure le compteur');
          check(JSON.stringify(actor.flags.co2prism.actionEconomy) === beforeReturn, '15C return did not mutate budget');
          const secondDocument = { ...tracked, id: 'second-token', uuid: 'Scene.s.Token.second', x: 500 };
          movementScene.tokens.set(secondDocument.id, secondDocument);
          canvas.tokens.controlled = [{ actor, document: secondDocument }]; hooks.get('controlToken')();
          check(!bar.movementTracker.getSnapshot(tracked).success && bar.movementTracker.getSnapshot(secondDocument).success, 'Selection starts a fresh movement session');
          trackedMove(1, secondDocument);
          canvas.tokens.controlled = [selectedToken]; hooks.get('controlToken')();
          check(!bar.movementTracker.getSnapshot(secondDocument).success && bar.movementTracker.getSnapshot(tracked).state.segmentCount === 0, 'Selection abandons previous session');
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size; bar.position = { x: innerWidth - 1, y: 0 }; bar.layout();
            const bounds = root.getBoundingClientRect(), panel = movementPanel.getBoundingClientRect();
            const budget = bar.budgetBand.getBoundingClientRect();
            if (!bar.budgetScroll.hidden && !bar.budgetBand.hidden) {
              check(budget.left >= panel.right && Math.abs(budget.top - panel.top) <= 1,
                size + ' tactical movement and budget share the upper line ' + JSON.stringify({ panel, budget }));
            }
            check(bounds.right <= innerWidth + 1 && bounds.top >= -0.1 && bounds.bottom <= innerHeight + 1
              && panel.bottom <= bar.anchor.getBoundingClientRect().top + 1,
              size + ' tactical movement above Combat');
            check(getComputedStyle(movementPanel).clipPath === 'none' &&
              movementPanel.contains(document.elementFromPoint(panel.left + 2, panel.bottom - 2)),
              size + ' rectangular movement counter');
            const blankX = bar.anchor.getBoundingClientRect().left + 2, blankY = panel.top + 2;
            check(document.elementFromPoint(blankX, blankY)?.id === 'board', size + ' 15C canvas remains accessible');
            const reset = movementPanel.querySelector('.co2prism-movement-reset'), rect = reset.getBoundingClientRect();
            check(reset.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)), size + ' movement reset clickable');
          }
          bar.position = { x: 300, y: 400 }; bar.layout();
          check(!movementPanel.hidden && !bar.budgetBand.hidden && !bar.budgetScroll.hidden, 'Both upper panels visible');
          const upperBefore = movementPanel.getBoundingClientRect();
          const budgetBefore = bar.budgetBand.getBoundingClientRect();
          const portraitBefore = bar.portrait.getBoundingClientRect();
          const extraTime = Array.from({ length: 16 }, () => bar.budgetBar.firstElementChild.cloneNode(true));
          bar.budgetBar.append(...extraTime); bar.layout({ preserveAnchor: true });
          const upperAfter = movementPanel.getBoundingClientRect();
          const budgetAfter = bar.budgetBand.getBoundingClientRect();
          const portraitAfter = bar.portrait.getBoundingClientRect();
          check(budgetAfter.left >= upperAfter.right && budgetAfter.width > budgetBefore.width &&
            Math.abs(budgetAfter.left - budgetBefore.left) < 1 && Math.abs(budgetAfter.top - upperAfter.top) < 1 &&
            Math.abs(upperAfter.left - upperBefore.left) < 1 && Math.abs(upperAfter.top - upperBefore.top) < 1 &&
            Math.abs(portraitAfter.left - portraitBefore.left) < 1 && Math.abs(portraitAfter.top - portraitBefore.top) < 1,
            'Longer budget grows right without moving the tactical panel or portrait ' + JSON.stringify({ upperBefore, upperAfter, budgetBefore, budgetAfter, portraitBefore, portraitAfter }));
          extraTime.forEach(node => node.remove());
          check(Math.abs(bar.budgetBand.getBoundingClientRect().width - budgetBefore.width) < 1 &&
            bar.budgetScroll.scrollWidth <= bar.budgetScroll.clientWidth + 1, 'Budget returns to its short width without scrolling');
          const budgetRowHeight = () => Math.max(22, 42 * bar.presentationScale);
          const frenchMovement = { ...budgetTranslations };
          const movementLanguages = { fr: ${JSON.stringify(translations.CO2PRISM.Movement)}, en: ${JSON.stringify(JSON.parse(read("../lang/en.json")).CO2PRISM.Movement)} };
          for (const [language, texts] of Object.entries(movementLanguages)) {
            for (const [key, value] of Object.entries(texts)) budgetTranslations['CO2PRISM.Movement.' + key] = value;
            bar.movementSignature = null; bar.refreshActor();
            for (const size of ['S', 'M', 'L', 'XL']) {
              settings.size = size; bar.layout();
              const panel = movementPanel.getBoundingClientRect();
              const [zones, summary, cellsBox, reset, validate] = [bar.movementZonesButton,
                movementPanel.querySelector('.co2prism-movement-summary'),
                movementPanel.querySelector('.co2prism-movement-blocks'), bar.movementReset, bar.movementValidate]
                .map(node => node.getBoundingClientRect());
              check(zones.right <= summary.left && summary.right <= cellsBox.left && cellsBox.width > 0 &&
                cellsBox.right <= reset.left && reset.right <= validate.left &&
                Math.abs(reset.top - validate.top) < 1 && Math.abs(reset.width - reset.height) < 1,
                language + size + ' tactical control order');
              check(panel.height > 0 && movementPanel.scrollWidth <= movementPanel.clientWidth + 1,
                language + size + ' counter fits its frame');
              const status = movementPanel.querySelector('.co2prism-movement-message');
              check(getComputedStyle(status).clipPath === 'inset(50%)' &&
                Math.abs(panel.height - budgetRowHeight()) < 1,
                language + size + ' only one visible line');
              const cells = [...movementPanel.querySelectorAll('.co2prism-movement-cell')];
              check(cells.every(cell => Math.abs(cell.getBoundingClientRect().top - cells[0].getBoundingClientRect().top) < 1),
                language + size + ' one line of cells');
              for (const button of [bar.movementZonesButton, bar.movementReset, bar.movementValidate]) {
                check(!button.textContent.trim() && button.querySelector('i.fa-solid') && button.dataset.co2prismTooltipText && button.getAttribute('aria-label'),
                  language + size + ' labelled icon only');
              }
            }
          }
          Object.assign(budgetTranslations, frenchMovement); bar.movementSignature = null; bar.refreshActor();
          movementScene.grid.type = 0; hooks.get('updateScene')(movementScene, { grid: {} });
          check(movementPanel.querySelector('.co2prism-movement-message').textContent.includes('indisponible') && blocks().length === 0, '15C gridless explicit');
          movementScene.grid.type = 1; hooks.get('updateScene')(movementScene, { grid: {} });
          const realHeight = innerHeight;
          Object.defineProperty(window, 'innerHeight', { value: 500, configurable: true });
          bar.layout();
          const smallPanel = movementPanel.getBoundingClientRect(), smallBounds = root.getBoundingClientRect();
          const smallReset = movementPanel.querySelector('.co2prism-movement-reset').getBoundingClientRect();
          check(smallPanel.height < 60 && smallReset.bottom <= smallPanel.bottom && smallPanel.top >= -0.1
            && smallBounds.bottom <= 500.1, 'Small viewport keeps simplified panel and reset usable');
          Object.defineProperty(window, 'innerHeight', { value: realHeight, configurable: true }); bar.layout();
          trackedMove(11);
          const beforeFinish = JSON.stringify(actor.flags.co2prism.actionEconomy), destination = tracked.x;
          bar.movementValidate.click();
          check(bar.movementValidate.disabled && bar.movementReset.disabled, '15D controls locked during validation');
          await new Promise(resolve => setTimeout(resolve, 0));
          check(!bar.upperLine.hidden && tracked.x === destination, '15D finish retains destination');
          check(JSON.stringify(actor.flags.co2prism.actionEconomy) !== beforeFinish && economy.getSnapshot().movementsRemaining === 4
            && warnings.length === notificationCount + 1, 'Single M validation warns for excess');
          movement('40', '20');
          // Comparer les blocs et le portrait sur des vitesses non entières.
          actor.system.attributes.movement = { value: 7.2, unit: 'm' };
          settings.movementRounding = 'nearest'; await economy.reset(); bar.refreshActor();
          trackedMove(7);
          check(blocks().map(block => Number(block.dataset.cells)).join(',') === '4', 'Fractional speed gives one block of four');
          check(grey() === 4 && movementPanel.querySelectorAll('.co2prism-movement-cell').length === 4, 'Four filled cells capped to single M');
          movement('14.4', '7');
          await bar.validateMovement(tracked);
          check(economy.getSnapshot().movementsRemaining === 1 && bar.movementResults.get(tracked).consumedCount === 1, 'Seven cells cost one M');
          await bar.setPanelState('combat', false); await bar.setPanelState('combat', true);
          actor.system.attributes.movement = { value: 10, unit: 'm' }; movementScene.grid.distance = 3;
          for (const mode of ['nearest', 'up', 'down']) {
            settings.movementRounding = mode; await economy.reset(); await economy.grant('m', 3); bar.refreshActor();
            await bar.setPanelState('combat', false); await bar.setPanelState('combat', true);
            const expected = (mode === 'up' ? Math.ceil : mode === 'down' ? Math.floor : Math.round)(50 / 3);
            const total = [...movementPanel.querySelectorAll('.co2prism-movement-cell')].reduce((sum, cell) => sum + Number(cell.dataset.count), 0);
            check(total === (mode === 'up' ? Math.ceil : mode === 'down' ? Math.floor : Math.round)(10 / 3)
              && bar.combatValues.cells.textContent === String(expected), 'Portrait budget and single M capacity ' + mode);
            trackedMove(7);
            check(grey() === total, 'Filled cells capped to single M ' + mode);
            settings.economyMode = 'off'; bar.refreshActor(); await bar.validateMovement(tracked);
            settings.economyMode = 'always'; bar.refreshActor(); await bar.setPanelState('combat', false); await bar.setPanelState('combat', true);
          }
          actor.system.attributes.movement = { value: 0.4, unit: 'm' }; movementScene.grid.distance = 2;
          settings.movementRounding = 'down'; await economy.reset();
          await bar.setPanelState('combat', false); await bar.setPanelState('combat', true); trackedMove(1);
          check(blocks().map(block => Number(block.dataset.cells)).join(',') === '0'
            && movementPanel.querySelectorAll('.co2prism-movement-cell').length === 0, 'Zero capacity has no fake squares');
          await economy.grant('m', 3); hooks.get('updateActor')(actor, { flags: {} });
          check(blocks().map(block => Number(block.dataset.cells)).join(',') === '0' && grey() === 0, 'Bonus does not change zero session capacity');
          movement('2', '1');
          await bar.validateMovement(tracked);
          check(economy.getSnapshot().movementsRemaining === 4 && bar.movementResults.get(tracked).consumedCount === 1, 'Zero capacity spends one M');
          actor.system.attributes.movement = { value: 2000000, unit: 'm' };
          await bar.setPanelState('combat', false); await bar.setPanelState('combat', true);
          const aggregated = [...movementPanel.querySelectorAll('.co2prism-movement-cell')];
          check(blocks().length === 1 && aggregated.length <= 60
            && aggregated.reduce((sum, node) => sum + Number(node.dataset.count), 0) === 1000000, 'Huge speed DOM bounded to 60 groups');
          check(aggregated.every(node => Math.abs(node.getBoundingClientRect().top - aggregated[0].getBoundingClientRect().top) < 1)
            && movementPanel.scrollWidth <= movementPanel.clientWidth + 1, 'Huge speed remains a single contained row');
          settings.economyMode = 'off'; bar.refreshActor(); await bar.validateMovement(tracked); settings.economyMode = 'always';
          await bar.setPanelState('combat', false);
          await economy.reset(); bar.refreshActor();
          await bar.setPanelState('combat', true);
          let closeAnswer;
          const originalWait = foundry.applications.api.DialogV2.wait;
          foundry.applications.api.DialogV2.wait = () => new Promise(resolve => { closeAnswer = resolve; });
          trackedMove(1);
          const closing = bar.toggleMovement();
          check(bar.movementValidate.disabled && bar.movementReset.disabled
            && bar.movementZonesButton.disabled, 'All movement controls locked during close dialogue');
          closeAnswer(null); await closing;
          check(!movementPanel.hidden && !bar.movementValidate.disabled, 'Dismissal keeps path and unlocks commands');
          foundry.applications.api.DialogV2.wait = originalWait;
          await bar.resetMovement();
          check(bar.movementValidate.disabled && bar.movementReset.disabled, 'Empty session commands disabled');
          trackedMove(1); await bar.validateMovement(tracked);
          check(!movementPanel.hidden && bar.movementValidate.disabled && grey() === 0, 'Next session remains open and empty');
          trackedMove(1); await bar.validateMovement(tracked);
          check(!bar.upperLine.hidden && bar.movementValidate.disabled, 'Exhausted movement remains in the topline');
          check(!movementPanel.querySelector('.co2prism-movement-empty').hidden && remainingText() === '0' &&
            [bar.movementZonesButton, bar.movementReset, bar.movementValidate].every(button => button.disabled && button.getClientRects().length),
            'Exhausted counter keeps the same row and disables its controls');
          await bar.setPanelState('combat', false); check(bar.upperLine.hidden, 'Exhausted topline closes with Combat');
          await bar.setPanelState('combat', true); check(!bar.upperLine.hidden, 'Exhausted topline opens with Combat');
          tracked.canUserModify = () => false; bar.refreshActor(); check(bar.movementZonesButton.disabled && bar.movementValidate.disabled, '15C permission disables command');
          tracked.canUserModify = () => true;
          hooks.get('deleteToken')(secondDocument);
          check(!bar.movementTracker.getSnapshot(secondDocument).success, '15C deleted token cleanup');
          const openedItems = [];
          const equipmentItem = (name, sort) => {
            const document = { id: name, uuid: 'Actor.test.Item.' + name, name, sort, parent: actor, type: 'equipment',
              canUserModify: () => true, actions: [],
              testUserPermission: () => true, img: 'icons/svg/item-bag.svg',
              system: { description: '<p>Details of ' + name + '</p><p>Second paragraph<br>Another line</p><ol><li>First</li><li>Second</li></ol>' },
              sheet: { render: force => { if (force) openedItems.push(name); } } };
            actor.items.set(name, document);
            return document;
          };
          actor.unsetFlag = async function(scope, key) {
            const [group, id] = key.split('.');
            delete this.flags[scope][group][id];
          };
          const weapons = Array.from({ length: 31 }, (_, i) => equipmentItem('weapon' + i, i));
          const stored = equipmentItem('stored', -1);
          const bag = equipmentItem('bag', 0);
          bag.type = 'container';
          actor.inventory = [
            { category: 'weapon', items: [stored, ...weapons] },
            { category: 'armor', items: [equipmentItem('armor', 4), equipmentItem('armor2', 8)] },
            { category: 'shield', items: [equipmentItem('shield', 2), equipmentItem('shield2', 8)] },
            { category: 'consumable', items: [equipmentItem('potion', 1)] },
            { category: 'misc', items: [equipmentItem('rope', 1)] }
          ];
          actor.containers = [bag, bag];
          actor.containedItemUuids = new Set([stored.uuid]);
          bag.system.description += '<img src="invalid" onerror="globalThis.co2prismInjected=true">';
          const equipment = bar.equipmentPanel;
          const artBeforeEquipment = bar.anchor.getBoundingClientRect();
          bar.equipmentToggle.click();
          await bar.configWrites.get(actor);
          const artWithEquipment = bar.anchor.getBoundingClientRect();
          check(artWithEquipment.width === artBeforeEquipment.width && artWithEquipment.height === artBeforeEquipment.height,
            'Equipment opening preserves the nucleus scale while clamping it to the viewport');
          const groupFor = key => bar.equipmentGroups.find(group => group.key === key);
          const names = group => [...group.items.querySelectorAll('img')].map(img => img.alt);
          const weaponGroup = groupFor('weapon');
          const order = ['weapon', 'protection', 'consumable', 'misc', 'containers'];
          check(!equipment.hidden && equipment.querySelectorAll('.co2prism-equipment-category').length === 5, 'Equipment open with five groups');
          check(bar.equipmentGroups.map(group => group.key).join() === [...order].reverse().join(), 'Equipment category order');
          check(names(groupFor('protection')).join() === 'shield,armor,armor2,shield2', 'Equipment merged native protection order');
          check(names(groupFor('containers')).join() === 'bag' && names(weaponGroup).length === 31, 'Equipment exclusions and deduplication');
          await bar.setPanelState('combat', true);
                    await bar.setPanelState('competences', true);
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size; settings.position = { x: 1, y: 1 }; bar.position = settings.position; bar.layout();
            const bounds = equipment.getBoundingClientRect();
            await bar.setPanelState('competences', false);
            check(Math.abs(equipment.getBoundingClientRect().width - bounds.width) < 1, size + ' equipment width independent of skills');
            await bar.setPanelState('competences', true);
            const portrait = bar.anchor.getBoundingClientRect();
            const moveBounds = movementPanel.getBoundingClientRect();
            const tiles = [...weaponGroup.items.children];
            check(Math.abs(bounds.bottom - portrait.top) < 1 && Math.abs(bounds.right - portrait.right) < 1 &&
              moveBounds.left >= bounds.right - 1 && !intersects(bounds, moveBounds) &&
              getComputedStyle(equipment).clipPath === 'none', 'Rectangular inventory dock at ' + size);
            const category = weaponGroup.button.getBoundingClientRect();
            const cells = tiles.map(tile => tile.getBoundingClientRect());
            const wrap = cells.findIndex(cell => cell.top > cells[0].top + 1);
            const groupGap = parseFloat(getComputedStyle(weaponGroup.button.parentElement).columnGap);
            const itemGap = parseFloat(getComputedStyle(weaponGroup.items).rowGap);
            check(!weaponGroup.button.textContent.trim() && Math.abs(category.width - cells[0].width) < 1 &&
              Math.abs(category.height - cells[0].height) < 1 && Math.abs(cells[0].left - category.right - groupGap) < 1 &&
              wrap > 0 && Math.abs(cells[wrap].left - cells[0].left) < 1 && Math.abs(cells[wrap].top - cells[0].bottom - itemGap) < 1,
              size + ' equipment squares wrap under the first item with regular gaps');
            check(tiles.length === 31 && tiles.every(tile => getComputedStyle(tile).transform === 'none'),
              'Inventory keeps every tile in normal flow at ' + size);
            check([...equipment.querySelectorAll('.co2prism-equipment-category')].every(button =>
              getComputedStyle(button).backgroundColor === 'rgba(0, 0, 0, 0)'), 'Transparent categories at ' + size);
          }
          const categoryPosition = key => groupFor(key).button.getBoundingClientRect();
          const setCollapsed = async keys => {
            for (const key of order) {
              const { button, items } = groupFor(key);
              if (items.hidden !== keys.includes(key)) {
                button.click(); await bar.configWrites.get(actor);
              }
            }
          };

          const fullHeight = equipment.getBoundingClientRect().height;
          const equipmentWidth = equipment.getBoundingClientRect().width;
          const allOpen = [...order].reverse().map(categoryPosition);
          check(allOpen.every((point, i) => i === 0 || point.top > allOpen[i - 1].top),
            'Containers on top and weapons nearest the portrait');
          for (const collapsed of [['protection'], ['consumable'], ['protection', 'consumable'], order]) {
            await setCollapsed(collapsed);
            check(equipment.getBoundingClientRect().width === equipmentWidth, 'Inventory width stays stable');
            check(equipment.getBoundingClientRect().height <= fullHeight + 1 &&
              collapsed.every(key => groupFor(key).items.hidden && groupFor(key).button.getClientRects().length === 1),
              'Collapsed categories release their item rows: ' + collapsed.join());
          }
          await setCollapsed([]);
          check(Math.abs(equipment.getBoundingClientRect().height - fullHeight) < 1 && names(weaponGroup).length === 31,
            'Reopening categories restores all item rows');
          const categoryColors = [];
          for (const locked of [true, false]) {
            settings.locked = locked; bar.updateLock();
            weaponGroup.button.click(); await bar.configWrites.get(actor);
            check(weaponGroup.items.hidden === locked && actor.flags.co2prism.equipmentCollapsed.weapon === locked,
              'Equipment category writes independently of position lock');
            categoryColors.push(getComputedStyle(weaponGroup.button).color);
          }
          check(categoryColors[0] !== categoryColors[1], 'Equipment category colors distinguish both states');
          const tileFor = id => equipment.querySelector('[data-item-id="' + id + '"]');
          for (const id of ['weapon0', 'shield', 'potion', 'rope', 'bag']) {
            const tile = tileFor(id);
            check(tile.dataset.co2prismDescriptionHtml.includes('<strong>' + id + '</strong>') &&
              tile.dataset.co2prismDescriptionHtml.includes('Details of ' + id), 'Equipment tooltip for ' + id);
            tile.click();
          }
          check(openedItems.join() === 'weapon0,shield,potion,rope,bag', 'Equipment opens each native Item sheet');
          if (game.tooltip) {
            tileFor('bag').dispatchEvent(new PointerEvent('pointerover', { bubbles: true, shiftKey: true }));
            check(game.tooltip.tooltip.textContent.includes('Details of bag') &&
              !game.tooltip.tooltip.querySelector('[onerror]'), 'Native equipment tooltip sanitizes item description');
            check(game.tooltip.tooltip.querySelectorAll('p').length === 2 && game.tooltip.tooltip.querySelector('p br') &&
              game.tooltip.tooltip.querySelectorAll('ol li').length === 2 &&
              getComputedStyle(game.tooltip.tooltip.querySelector('ol')).listStyleType === 'decimal',
              'Rich description keeps paragraphs, line breaks and ordered lists');
            const prismTooltip = game.tooltip.tooltip;
            check(prismTooltip.classList.contains('co2prism-tooltip') &&
              getComputedStyle(prismTooltip).overflowWrap === 'anywhere' &&
              prismTooltip.getBoundingClientRect().width < innerWidth, 'Prism tooltip is scoped and constrained');
            const longText = root.appendChild(document.createElement('span'));
            longText.dataset.co2prismTooltipText = 'Long heading\\n' + 'unbreakable'.repeat(380);
            longText.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, shiftKey: true }));
            check(prismTooltip.textContent === longText.dataset.co2prismTooltipText &&
              prismTooltip.scrollWidth <= prismTooltip.clientWidth + 1 &&
              prismTooltip.getBoundingClientRect().height < innerHeight,
              'Long plain text wraps and remains within the viewport');
            longText.remove();
            const external = document.body.appendChild(document.createElement('span'));
            external.dataset.tooltipText = 'Other module';
            game.tooltip.activate(external);
            check(!prismTooltip.classList.contains('co2prism-tooltip'), 'Prism theme leaves other Foundry tooltips alone');
            game.tooltip.deactivate();
            external.remove();
          }
          const contextClick = node => !node.dispatchEvent(new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true }));
          const toggleAllEquipment = async () => {
            check(contextClick(bar.equipmentToggle), 'Suitcase consumes its own context click');
            await bar.configWrites.get(actor);
          };
          const allEquipmentCollapsed = state => bar.equipmentGroups.every(({ key, button, items }) =>
            actor.flags.co2prism.equipmentCollapsed[key] === state && items.hidden === state &&
            button.getAttribute('aria-expanded') === String(!state));
          for (const locked of [true, false]) {
            settings.locked = locked; bar.updateLock();
            await toggleAllEquipment();
            check(!equipment.hidden && allEquipmentCollapsed(true) && !bar.equipmentMenu.matches(':popover-open'),
              'Suitcase collapses all groups in either lock mode');
            await toggleAllEquipment();
            check(!equipment.hidden && allEquipmentCollapsed(false), 'Second suitcase context click expands every group');
          }
          await setCollapsed(['protection']);
          bar.equipmentToggle.click(); await bar.configWrites.get(actor);
          await toggleAllEquipment();
          check(equipment.hidden && Object.values(actor.flags.co2prism.equipmentCollapsed).every(Boolean),
            'Suitcase context click collapses mixed categories without opening the panel');
          bar.equipmentToggle.click(); await bar.configWrites.get(actor);
          check(!equipment.hidden && allEquipmentCollapsed(true), 'Suitcase left click reopens with persisted categories');
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size; bar.layout();
            const categories = bar.equipmentGroups.map(({ button }) => button.getBoundingClientRect());
            check(categories[1].left > categories[0].right && Math.abs(categories[1].top - categories[0].top) < 1 &&
              categories.every((box, index) => index === 0 || box.top > categories[index - 1].top ||
                box.left >= categories[index - 1].right), size + ' collapsed categories flow across each row in order');
          }
          await toggleAllEquipment();
          check(allEquipmentCollapsed(false), 'Suitcase restores every category after reopening');
          const initialColumn = tileFor('weapon0').style.getPropertyValue('--column');
          check(contextClick(tileFor('weapon0').querySelector('img')), 'Unlocked equipment handles the context click');
          await bar.configWrites.get(actor);
          check(actor.flags.co2prism.hiddenEquipment.weapon0 === true &&
            getComputedStyle(tileFor('weapon0').querySelector('img')).filter === 'grayscale(1)' &&
            tileFor('weapon0').style.getPropertyValue('--column') === initialColumn, 'Masked equipment is grey in place');
          tileFor('weapon0').click();
          check(openedItems.at(-1) === 'weapon0', 'Grey equipment remains consultable');
          settings.locked = true; bar.updateLock();
          check(!tileFor('weapon0') && tileFor('weapon1').style.getPropertyValue('--column') === initialColumn &&
            !contextClick(tileFor('weapon1')), 'Locked equipment compacts and leaves the context click alone');
          settings.locked = false; bar.updateLock();
          check(tileFor('weapon0').classList.contains('co2prism-equipment-masked'), 'Unlocking restores the masked equipment');
          actor.testUserPermission = (_, permission) => permission !== 'OWNER';
          bar.refreshActor();
          check(!contextClick(tileFor('weapon0')), 'Observer cannot change the hidden flag');
          const beforeObserver = openedItems.length;
          tileFor('weapon0').click();
          check(openedItems.length === beforeObserver + 1 && openedItems.at(-1) === 'weapon0',
            'Observer can still consult a visible item');
          actor.testUserPermission = () => true;
          const selectedForMask = canvas.tokens.controlled;
          const sameName = { ...weapons[0], uuid: 'Actor.other.Item.weapon0', parent: other };
          other.flags.co2prism.panels.equipements = true;
          other.items.set(sameName.id, sameName);
          other.inventory = [{ category: 'weapon', items: [sameName] }];
          canvas.tokens.controlled = [{ actor: other, document: { baseActor: other } }]; bar.refreshActor();
          check(!tileFor(sameName.id).classList.contains('co2prism-equipment-masked'), 'Item visibility is isolated by actor');
          canvas.tokens.controlled = selectedForMask; bar.refreshActor();
          other.flags.co2prism.panels.equipements = false;
          await bar.setPanelState('equipements', false);
          await bar.setPanelState('equipements', true);
          const reloaded = new PrismBar();
          check(tileFor('weapon0').classList.contains('co2prism-equipment-masked') &&
            reloaded.readConfiguration(actor).hiddenEquipment.has('weapon0'), 'Visibility survives reopening and fresh configuration');
          contextClick(tileFor('weapon0')); await bar.configWrites.get(actor);
          check(!tileFor('weapon0').classList.contains('co2prism-equipment-masked') &&
            !actor.flags.co2prism.hiddenEquipment.weapon0, 'Second context click restores normal equipment');
          contextClick(tileFor('weapon30')); await bar.configWrites.get(actor);
          actor.inventory[0].items.pop();
          actor.items.delete('weapon30');
          hooks.get('deleteItem')({ parent: actor });
          check(names(weaponGroup).length === 30 && !tileFor('weapon30') && actor.flags.co2prism.hiddenEquipment.weapon30,
            'Deleting masked equipment leaves no ghost and writes no cleanup');
          weapons[0].name = 'Renamed weapon';
          hooks.get('updateItem')({ parent: other });
          check(names(weaponGroup)[0] === 'weapon0', 'Equipment ignores unrelated item changes');
          hooks.get('updateItem')({ parent: actor });
          check(names(weaponGroup)[0] === 'Renamed weapon', 'Equipment refreshes changed item labels');
          const selected = canvas.tokens.controlled;
          canvas.tokens.controlled = []; bar.refreshActor();
          check(root.hidden && equipment.getClientRects().length === 0, 'Equipment hidden without a selected actor');
          canvas.tokens.controlled = [{ actor: other, document: { baseActor: other } }]; bar.refreshActor();
          check(equipment.hidden && bar.equipmentToggle.getAttribute('aria-expanded') === 'false', 'Equipment state isolated per actor');
          canvas.tokens.controlled = selected; bar.refreshActor();
          check(!equipment.hidden && names(weaponGroup).length === 30, 'Equipment restores actor state');
          actor.inventory = []; actor.containers = [];
          hooks.get('createItem')({ parent: actor });
          check(equipment.querySelectorAll('.co2prism-equipment-category').length === 5 && !equipment.querySelector('.co2prism-equipment-items > *') && !equipment.textContent.trim(),
            'Empty equipment keeps only its category controls');
          const menu = bar.equipmentMenu;
          const operations = () => [...menu.children].map(button => button.textContent);
          const settled = () => new Promise(resolve => setTimeout(resolve, 0));
          const equipmentPill = equipmentItem('elixir', 1);
          const inventoryBlade = equipmentItem('blade', 2);
          Object.assign(equipmentPill.system, { properties: { stackable: true }, quantity: { current: 1, max: 2 },
            charges: { current: 4 } });
          let quantityWrites = 0;
          equipmentPill.update = async update => {
            quantityWrites++;
            check(Object.keys(update).join() === 'system.quantity.current', 'Equipment writes only the native quantity field');
            await settled();
            equipmentPill.system.quantity.current = update['system.quantity.current'];
            hooks.get('updateItem')(equipmentPill);
          };
          Object.assign(inventoryBlade.system, { properties: { equipable: true }, equipped: false });
          actor.inventory = [{ category: 'consumable', items: [equipmentPill, stored] },
            { category: 'weapon', items: [inventoryBlade] }];
          actor.containers = [bag];
          settings.locked = true; bar.updateLock();
          check(!tileFor('stored') && !contextClick(tileFor('bag')) && !menu.matches(':popover-open'),
            'Contained items stay excluded and ordinary containers have no operation menu');
          const openItemMenu = id => contextClick(tileFor(id)) && menu.matches(':popover-open');
          check(openItemMenu('elixir') && operations().join() === 'Quantité −1,Quantité +1', 'Stack menu has both feasible operations');
          tileFor('elixir').dispatchEvent(new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true,
            clientX: innerWidth - 1, clientY: innerHeight - 1 }));
          const menuBounds = menu.getBoundingClientRect();
          check(menuBounds.right <= innerWidth && menuBounds.bottom <= innerHeight, 'Operations menu fits at the viewport edge');
          const decrease = menu.firstElementChild;
          decrease.click(); decrease.click();
          check(!contextClick(tileFor('elixir')), 'An in-flight mutation prevents a second operation menu');
          await settled(); await settled();
          check(quantityWrites === 1 && equipmentPill.system.quantity.current === 0 && equipmentPill.system.charges.current === 4
            && actor.items.get('elixir') === equipmentPill, 'Quantity reaches zero once, without changing charges or deleting the item');
          check(openItemMenu('elixir') && operations().join() === 'Quantité +1', 'No decrease at zero');
          menu.firstElementChild.click(); await settled(); await settled();
          check(openItemMenu('elixir'), 'Quantity operation reopens after completion');
          menu.lastElementChild.click(); await settled(); await settled();
          check(openItemMenu('elixir') && operations().join() === 'Quantité −1', 'No increase at the native positive maximum');
          bar.closeEquipmentMenu();
          const equipCalls = [];
          actor.toggleEquipmentEquipped = async (id, bypass) => {
            equipCalls.push([id, bypass]);
            if (bypass) actor.items.get(id).system.equipped = !actor.items.get(id).system.equipped;
          };
          check(openItemMenu('blade') && operations().join() === 'Équiper', 'Non-stackable blade only offers Equip');
          menu.firstElementChild.click(); await settled();
          check(openItemMenu('blade') && operations().join() === 'Équiper', 'Native refusal leaves the real label intact');
          menu.firstElementChild.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); await settled();
          check(openItemMenu('blade') && operations().join() === 'Déséquiper' &&
            JSON.stringify(equipCalls) === JSON.stringify([['blade', false], ['blade', true]]),
            'Shift reaches the native equipment toggle once and uses the true equipment state');
          inventoryBlade.canUserModify = () => false;
          menu.firstElementChild.click(); await settled();
          check(equipCalls.length === 2 && !contextClick(tileFor('blade')), 'Permission loss prevents both stale and new operations');
          inventoryBlade.canUserModify = () => true;
          const inventoryAction = (indice, actionName) => ({ indice, actionName, type: 'heal', actionTypeFinal: 'm',
            properties: { visible: true }, isVisible: async () => true });
          equipmentPill.actions = equipmentPill.system.actions = [inventoryAction(0, 'First'), inventoryAction(1, 'Second')];
          const inventoryExecutions = [];
          game.system.api.macros.useAction = async (source, indice, type) => {
            const guards = [];
            const details = { item: equipmentPill, source, indice, type, state: true, guard: promise => guards.push(promise) };
            hooks.get('co2.preActivateAction')?.(actor, details);
            if ((await Promise.all(guards)).includes(false)) return false;
            inventoryExecutions.push([source, indice, type]);
            hooks.get('co2.postActivateAction')?.(actor, { ...details, success: true });
          };
          await economy.reset();
          await bar.setPanelState('combat', false);
          const onlyAction = equipmentPill.actions.pop();
          check(openItemMenu('elixir') && operations().filter(label => label.startsWith('Exécuter')).join() === 'Exécuter First',
            'A single configured action shows a single action command');
          equipmentPill.actions.push(onlyAction);
          check(openItemMenu('elixir') && operations().filter(label => label.startsWith('Exécuter')).join() === 'Exécuter First,Exécuter Second',
            'Multiple native actions display their actual names with Combat closed');
          onlyAction.isVisible = async () => false;
          [...menu.children].find(button => button.textContent === 'Exécuter Second').click();
          await settled();
          check(!inventoryExecutions.length && economy.getSnapshot().normal.m, 'Failed native action conditions leave the budget intact');
          onlyAction.isVisible = async () => true;
          check(openItemMenu('elixir'), 'Operations menu reopens after a failed action condition');
          [...menu.children].find(button => button.textContent === 'Exécuter Second').click();
          await settled();
          check(JSON.stringify(inventoryExecutions) === JSON.stringify([[equipmentPill.uuid, 1, 'heal']]) &&
            economy.getSnapshot().normal.m === false, 'Selected action uses native index and existing movement-action budget');
          check(openItemMenu('elixir'), 'Operations menu available before document deletion');
          actor.items.delete('elixir'); actor.inventory[0].items.shift();
          hooks.get('deleteItem')(equipmentPill);
          check(!menu.matches(':popover-open'), 'Deleting target closes operations menu');
          check(openItemMenu('blade'), 'Operations menu available before switching token');
          canvas.tokens.controlled = [{ actor: other, document: { baseActor: other } }]; bar.refreshActor();
          check(!menu.matches(':popover-open'), 'Switching token closes operations menu');
          canvas.tokens.controlled = selected; bar.refreshActor();
          check(openItemMenu('blade'), 'Operations menu available before closing the panel');
          await bar.setPanelState('equipements', false);
          check(!menu.matches(':popover-open'), 'Closing equipment panel dismisses operations menu');
          settings.locked = false; bar.updateLock();
          await bar.setPanelState('combat', true);
          await economy.reset();
          inventoryBlade.actions = inventoryBlade.system.actions = ['First', 'Second', 'Third', 'Fourth'].map((name, index) =>
            ({ ...inventoryAction(index, name), source: inventoryBlade.uuid, actionImg: 'icons/svg/' +
              ['sword', 'shield', 'fire', 'sun'][index] + '.svg' }));
          Object.assign(inventoryBlade.actions[0].properties, { activable: true, temporary: true, enabled: true });
          Object.assign(inventoryBlade.actions[0], { iconFA: 'fa-solid fa-sword', manaCost: 2,
            resolvers: [{ type: 'consumable' }] });
          inventoryBlade.system.quantity = { current: 3 };
          inventoryBlade.actions[1].isVisible = async () => false;
          const groupCalls = [];
          const groupActivation = async ({ source, indice, type, state }) => {
            const guards = [];
            const details = { item: inventoryBlade, source, indice, type, state, guard: promise => guards.push(promise) };
            hooks.get('co2.preActivateAction')?.(actor, details);
            if ((await Promise.all(guards)).includes(false)) return false;
            groupCalls.push(['activate', source, indice, type ?? null, state]);
            if (indice === 0) {
              inventoryBlade.actions[0].properties.enabled = state;
              if (state) inventoryBlade.system.quantity.current--;
            }
            hooks.get('co2.postActivateAction')?.(actor, { ...details, success: true });
            hooks.get('updateItem')(inventoryBlade);
            return true;
          };
          actor.activateAction = groupActivation;
          inventoryBlade.actions[0].toObject = function() {
            return { source: this.source, indice: this.indice, label: this.actionName, properties: { ...this.properties } };
          };
          game.system.api.macros.useAction = (source, indice, type) => groupActivation({ source, indice, type, state: true });
          game.system.api.macros.openSheet = source => groupCalls.push(['sheet', source]);
          game.system.api.macros.sendToChat = (source, _name, indice) => groupCalls.push(['chat', source, indice]);
          const groupRow = bar.combatRows[1];
          const groupSlot = () => root.querySelector('.co2prism-slot-group');
          const dropAction = async (indice, target) => {
            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/plain', JSON.stringify({ type: 'co.action', source: inventoryBlade.uuid, indice }));
            target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
            await bar.configWrites.get(actor);
          };
          await dropAction(0, groupRow.lastElementChild);
          const firstShortcut = () => [...groupRow.children].find(slot => slot.dataset.co2prismTooltipText.includes('First'));
          const presetMenu = bar.presetActionMenu;
          const presetMenuOpen = () => presetMenu.matches(':popover-open');
          const ruleIcon = node => node.querySelector('.co2prism-slot-rule');
          const transparentRule = node => {
            const style = getComputedStyle(ruleIcon(node));
            return style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.textShadow !== 'none';
          };
          const selectRule = async index => {
            presetMenu.children[index].click();
            await bar.configWrites.get(actor);
          };
          actor.flags.co2prism.hands.presets = {};
          await bar.setActivePreset(1);
          check(ruleIcon(firstShortcut()).classList.contains('fa-circle-dashed') &&
            contextClick(firstShortcut()) && presetMenuOpen() && presetMenu.children.length === 3 &&
            presetMenu.children[2].getAttribute('aria-pressed') === 'true', 'Eligible simple shortcut offers three exclusive rules');
          await selectRule(0);
          check(ruleIcon(firstShortcut()).classList.contains('fa-toggle-large-on') && transparentRule(firstShortcut()) && !groupCalls.length,
            'Choosing Activate only updates the rule indicator');
          await bar.setActivePreset(2);
          check(ruleIcon(firstShortcut()).classList.contains('fa-circle-dashed'), 'Second preset initially has its own default');
          const selectedPreset = getComputedStyle(bar.presetButtons[1]);
          check(squarePreset(bar.presetButtons[1]) && Number(selectedPreset.fontWeight) >= 750 &&
            getComputedStyle(bar.presetButtons[0], '::before').content === 'none' &&
            getComputedStyle(bar.presetButtons[2], '::before').content === 'none', 'Silver square follows the selected preset');
          contextClick(firstShortcut()); await selectRule(1);
          check(ruleIcon(firstShortcut()).classList.contains('fa-toggle-large-off'), 'Second preset has its own deactivation indicator');
          await bar.setActivePreset(3);
          contextClick(firstShortcut());
          settings.locked = true; bar.updateLock();
          presetMenu.children[0].click();
          check(!presetMenuOpen() && !ruleIcon(firstShortcut()) && contextClick(firstShortcut()) && !presetMenuOpen(),
            'Locked default is hidden and neither a right click nor a stale menu can edit it');
          await bar.setActivePreset(1);
          check(ruleIcon(firstShortcut()).classList.contains('fa-toggle-large-on') && !groupCalls.length &&
            inventoryBlade.actions[0].properties.enabled, 'Locked active rule stays visible and preset switching does not activate anything');
          settings.locked = false; bar.updateLock();
          await dropAction(1, firstShortcut());
          const members = () => [...groupSlot().querySelectorAll('.co2prism-slot-quadrant')];
          const quadrantCommand = index => members()[index].querySelector('.co2prism-quadrant-command');
          const clickQuadrant = (index, options = {}) => quadrantCommand(index).dispatchEvent(new MouseEvent('click', { bubbles: true, ...options }));
          const images = () => members().map(member => member.querySelector('img')?.getAttribute('src') ?? '');
          const preview = bar.shortcutPreview;
          const previewOpen = () => preview.matches(':popover-open');
          const pointer = (node, type) => node.dispatchEvent(new PointerEvent(type, { pointerType: 'mouse' }));
          const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
          check(contextClick(quadrantCommand(0)) && presetMenuOpen() &&
            presetMenu.children[0].getAttribute('aria-pressed') === 'true' &&
            !ruleIcon(groupSlot()), 'Eligible quadrant uses the same saved rule without drawing it in the miniature');
          await selectRule(1);
          check(!contextClick(quadrantCommand(1)) && !presetMenuOpen() && !groupCalls.length,
            'Ineligible quadrant has no automation menu and configuring its neighbor has no action effect');
          pointer(members()[2], 'pointerenter');
          await pause(360);
          check(!previewOpen(), 'Empty quadrant never opens an action preview');
          check(images().join() === 'icons/svg/sword.svg,icons/svg/shield.svg,,' &&
            members().slice(2).every(member => getComputedStyle(member).backgroundColor === palette('ink') &&
              !member.querySelector('button')), 'Two actions leave two black, inert quadrants');
          members()[2].click(); groupSlot().click();
          clickQuadrant(1); await settled();
          check(!groupCalls.length && economy.getSnapshot().normal.m, 'Empty zones and an unavailable action produce no execution');
          clickQuadrant(0); await settled();
          check(groupCalls.length === 1 && groupCalls[0][2] === 0 && groupCalls[0][4] === false &&
            economy.getSnapshot().normal.m && !members()[0].classList.contains('co2prism-action-active'),
            'Two-member group deactivates only its selected action without spending time');
          clickQuadrant(0); await settled();
          check(groupCalls.length === 2 && groupCalls[1][2] === 0 && groupCalls[1][4] === true &&
            !economy.getSnapshot().normal.m && inventoryBlade.system.quantity.current === 2,
            'Reactivation uses native consumption and the shared budget');
          await economy.reset();
          await dropAction(2, groupSlot());
          check(images()[2] === 'icons/svg/fire.svg' && !images()[3], 'Third action fills the bottom-left quadrant');
          clickQuadrant(2); await settled();
          check(groupCalls.length === 3 && groupCalls[2][2] === 2 && !economy.getSnapshot().normal.m,
            'Third quadrant executes its native index in a three-member group');
          await economy.reset();
          await dropAction(3, groupSlot());
          await settled();
          check(images()[3] === 'icons/svg/sun.svg' && groupSlot().querySelectorAll('button').length === 4 &&
            !groupSlot().classList.contains('co2prism-slot-executable') &&
            !groupSlot().querySelector('.co2prism-slot-type, .co2prism-slot-time, .co2prism-slot-uses, .co2prism-slot-cost'),
            'Full group has four images and individual remove buttons, without corner badges or execution');
          check(members().map(member => member.classList.contains('co2prism-action-active')).join() === 'true,false,false,false'
            && members().map(member => member.classList.contains('co2prism-condition-unavailable')).join() === 'false,true,false,false',
            'Activation and unavailable conditions affect only the matching quadrant');
          check(light(members()[0]) === gold && light(members()[1]) === 'transparent' &&
            getComputedStyle(members()[0].querySelector('img')).filter === 'none' &&
            getComputedStyle(members()[1].querySelector('img')).filter.startsWith('grayscale') &&
            getComputedStyle(members()[2].querySelector('img')).filter === 'none', 'Each quadrant paints its own availability and halo');
          pointer(members()[0], 'pointerenter');
          await pause(100);
          check(!previewOpen(), 'Hover stays hidden before the delay');
          pointer(members()[0], 'pointerleave'); pointer(members()[1], 'pointerenter');
          await pause(260);
          check(!previewOpen(), 'Switching quadrants cancels the previous timer');
          await pause(100);
          check(previewOpen() && preview.querySelector('img')?.alt === 'Second' &&
            preview.querySelector('.co2prism-condition-unavailable'), 'Only the new quadrant opens with its own state');
          members()[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
          check(!previewOpen(), 'Right click dismisses the preview');
          inventoryBlade.actions[1].isVisible = async () => true;
          Object.assign(inventoryBlade.actions[2], { type: 'melee', hasResolversWithDomage: true });
          hooks.get('updateItem')(inventoryBlade);
          await settled();
          check(members()[0].classList.contains('co2prism-action-active') &&
            !members()[1].classList.contains('co2prism-condition-unavailable'), 'Native Item update refreshes individual quadrant states');
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size; bar.layout();
            const bounds = groupSlot().getBoundingClientRect(), plain = groupRow.lastElementChild.getBoundingClientRect();
            const [topLeft, topRight, bottomLeft, bottomRight] = members().map(member => member.getBoundingClientRect());
            check(Math.abs(bounds.width - plain.width) < 1 && Math.abs(bounds.height - plain.height) < 1 &&
              topLeft.top === topRight.top && topLeft.left === bottomLeft.left && topRight.left === bottomRight.left &&
              bottomRight.bottom <= bounds.bottom && bottomRight.right <= bounds.right &&
              getComputedStyle(groupSlot()).borderTopColor === 'rgba(0, 0, 0, 0)' &&
              parseFloat(getComputedStyle(groupSlot()).gap) > 0,
              'Quadrants keep their square geometry with soft separators at ' + size);
            groupRow.scrollLeft = groupSlot().offsetLeft;
            await settled();
            pointer(members()[0], 'pointerenter');
            await pause(360);
            const popup = preview.getBoundingClientRect(), previewSquare = preview.firstElementChild?.getBoundingClientRect();
            check(previewOpen() && Math.abs(previewSquare.width - bounds.width) < 1
              && Math.abs(previewSquare.height - bounds.height) < 1 && popup.left >= 0 && popup.top >= 0
              && popup.right <= innerWidth && popup.bottom <= innerHeight &&
              getComputedStyle(preview.firstElementChild).pointerEvents === 'none' &&
              preview.querySelectorAll('.co2prism-slot-type, .co2prism-slot-time, .co2prism-slot-uses, .co2prism-slot-cost').length === 4 &&
              preview.querySelector('.co2prism-action-active') && !preview.querySelector('button') &&
              ruleIcon(preview).classList.contains('fa-toggle-large-off') &&
              ruleIcon(preview).getBoundingClientRect().left >= preview.querySelector('.co2prism-slot-type').getBoundingClientRect().right &&
              ruleIcon(preview).getBoundingClientRect().right <= preview.querySelector('.co2prism-slot-time').getBoundingClientRect().left &&
              preview.querySelector('img')?.alt === 'First' && preview.children.length === 1,
              'Preview preserves the full square, four badges, and viewport geometry at ' + size + JSON.stringify({ bounds, previewSquare, popup,
                pointerEvents: getComputedStyle(preview.firstElementChild).pointerEvents,
                badges: preview.querySelectorAll('.co2prism-slot-type, .co2prism-slot-time, .co2prism-slot-uses, .co2prism-slot-cost').length,
                alt: preview.querySelector('img')?.alt, children: preview.children.length,
                rule: ruleIcon(preview).getBoundingClientRect(), left: preview.querySelector('.co2prism-slot-type').getBoundingClientRect(),
                right: preview.querySelector('.co2prism-slot-time').getBoundingClientRect() }));
            pointer(members()[0], 'pointerleave');
            check(!previewOpen(), 'Leaving the quadrant dismisses its preview immediately');
          }
          settings.locked = true; bar.updateLock();
          check(images().every(Boolean) && !groupSlot().querySelector('button') && !members().some(member => member.draggable),
            'Locked group preserves images and hides all editing controls');
          pointer(members()[3], 'pointerenter');
          await pause(360);
          check(previewOpen() && preview.querySelector('img')?.alt === 'Fourth', 'Locked quadrant previews its own action');
          const storedGroup = JSON.stringify(actor.flags.co2prism.shortcuts);
          clickQuadrant(3, { ctrlKey: true }); await settled();
          check(!previewOpen() && groupCalls.at(-1).join() === ['chat', inventoryBlade.uuid, 3].join(),
            'Locked Ctrl-click closes preview and sends exactly its action to chat');
          clickQuadrant(3, { shiftKey: true }); await settled();
          check(groupCalls.at(-1).join() === ['sheet', inventoryBlade.uuid].join(), 'Locked Shift-click opens the native sheet');
          clickQuadrant(2, { altKey: true }); await settled();
          check(groupCalls.at(-1).join() === ['activate', inventoryBlade.uuid, 2, 'damage', true].join() &&
            economy.getSnapshot().normal.m, 'Alt-click uses the native damage command without an action-time debit');
          actor.testUserPermission = (_, permission) => permission !== 'OWNER';
          bar.refreshActor();
          const beforeDenied = groupCalls.length;
          clickQuadrant(3); await settled();
          check(groupCalls.length === beforeDenied, 'Observer cannot execute a group action');
          actor.testUserPermission = () => true;
          bar.refreshActor();
          const beforeFourth = groupCalls.length;
          const fourth = quadrantCommand(3);
          fourth.click(); fourth.click();
          await settled();
          check(groupCalls.length === beforeFourth + 1 && groupCalls.at(-1)[2] === 3 &&
            !economy.getSnapshot().normal.m && JSON.stringify(actor.flags.co2prism.shortcuts) === storedGroup,
            'Rapid locked clicks activate the fourth action once and preserve the references');
          const staleFourth = quadrantCommand(3);
          canvas.tokens.controlled = [{ actor: other, document: { baseActor: other } }]; bar.refreshActor();
          staleFourth.click();
          check(groupCalls.length === beforeFourth + 1, 'A stale quadrant cannot execute after a token change');
          canvas.tokens.controlled = selected; bar.refreshActor();
          pointer(members()[3], 'pointerenter');
          hooks.get('updateItem')(inventoryBlade);
          check(!previewOpen() && !bar.shortcutHover, 'Rebuilding Combat clears the active preview and its timer');
          pointer(members()[0], 'pointerenter');
          await bar.setPanelState('combat', false);
          check(!previewOpen() && !bar.shortcutHover, 'Closing Combat cancels a pending preview');
          await bar.setPanelState('combat', true);
          pointer(members()[0], 'pointerenter');
          root.hidden = true;
          await settled();
          check(!previewOpen() && !bar.shortcutHover, 'Hiding Prism cancels a pending preview');
          root.hidden = false;
          settings.locked = false; bar.updateLock();
          const wholeTransfer = new DataTransfer();
          pointer(members()[0], 'pointerenter');
          groupSlot().dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: wholeTransfer }));
          check(!previewOpen() && !bar.shortcutHover, 'Starting a drag cancels a pending preview');
          check(JSON.parse(wholeTransfer.getData('text/plain')).actionIndex === undefined, 'Group border starts a whole-slot drag');
          bar.combatRows[0].lastElementChild.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: wholeTransfer }));
          await bar.configWrites.get(actor);
          check(groupSlot().parentElement === bar.combatRows[0] && images().every(Boolean), 'Moving the square preserves all four images');
          const groupTransfer = new DataTransfer();
          members()[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: groupTransfer }));
          check(JSON.parse(groupTransfer.getData('text/plain')).actionIndex === 0, 'Member drag identifies the native slot and action index');
          members()[2].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: groupTransfer }));
          await bar.configWrites.get(actor);
          check(images().join() === 'icons/svg/shield.svg,icons/svg/fire.svg,icons/svg/sword.svg,icons/svg/sun.svg',
            'Quadrant drop reorders the images within the group');
          for (const index of [3, 0, 0]) {
            members()[index].querySelector('button').click();
            await bar.configWrites.get(actor);
          }
          check(!groupSlot() && [...bar.combatRows[0].children].some(slot => slot.dataset.co2prismTooltipText.includes('First') &&
            slot.classList.contains('co2prism-slot-executable') && slot.querySelector('.co2prism-slot-time')),
            'Removing quadrants restores a normal executable shortcut with its corner indicators');
          const finalShortcut = [...bar.combatRows[0].children].find(slot => slot.dataset.co2prismTooltipText.includes('First'));
          finalShortcut.querySelector('.co2prism-slot-remove').click();
          await bar.configWrites.get(actor);
          check(![...bar.combatRows[0].children].some(slot => slot.dataset.co2prismTooltipText.includes('First')),
            'The final remaining action is removed with the ordinary shortcut command');
          inventoryBlade.actions[0].properties.enabled = true;
          inventoryBlade.actions[1].conditions = [{ predicate: 'isLinkedActionActivated', object: '0' }];
          await dropAction(0, groupRow.lastElementChild);
          await settled();
          const linkedGroup = () => bar.conditionalActionGroups.find(group => group.source.itemId === inventoryBlade.id);
          const conditionalZone = bar.conditionalZone;
          check(linkedGroup()?.available[0]?.indice === 1 && conditionalZone.children.length === 1,
            'Combat renders the available native dependent references');
          inventoryBlade.actions[0].properties.enabled = false;
          hooks.get('updateItem')(inventoryBlade);
          await settled();
          check(linkedGroup()?.dependencies.length === 1 && linkedGroup()?.available.length === 0 &&
            conditionalZone.hidden && !root.querySelector('.co2prism-conditional-halo') &&
            root.querySelector('.co2prism-linked-origin'),
            'An Item update removes availability but keeps the dependency');
          let releaseLinkedVisibility;
          inventoryBlade.actions[0].properties.enabled = true;
          inventoryBlade.actions[1].isVisible = () => new Promise(resolve => { releaseLinkedVisibility = resolve; });
          hooks.get('updateItem')(inventoryBlade);
          await settled();
          canvas.tokens.controlled = [{ actor: other, document: { baseActor: other } }]; bar.refreshActor();
          releaseLinkedVisibility(true);
          await settled();
          check(!linkedGroup() && conditionalZone.hidden, 'An old visibility result cannot escape its actor context');
          canvas.tokens.controlled = selected; bar.refreshActor();
          inventoryBlade.actions[1].isVisible = async () => true;
          hooks.get('updateItem')(inventoryBlade);
          await settled();
          check(linkedGroup()?.available[0]?.indice === 1, 'Returning to the actor rebuilds the conditional data');
          const conditionalLink = object => ({ predicate: 'isLinkedActionActivated', object });
          inventoryBlade.actions[2].conditions = [conditionalLink('0')];
          inventoryBlade.actions[3].conditions = [conditionalLink('0'), conditionalLink('2')];
          inventoryBlade.actions[3].isVisible = async () => inventoryBlade.actions[2].properties.enabled;
          inventoryBlade.actions[2].properties.enabled = true;
          await dropAction(2, [...groupRow.children].find(slot => slot.dataset.co2prismTooltipText.includes('First')));
          await dropAction(0, bar.combatRows[0].lastElementChild);
          await dropAction(1, bar.combatRows[0].lastElementChild);
          await settled();
          const temporaryIndices = () => [...conditionalZone.children].map(row =>
            [...row.children].map(square => square.dataset.co2prismIndice).join()).join('|');
          check(temporaryIndices() === '1,2,3|3' && conditionalZone.querySelectorAll('.co2prism-slot-time').length === 4,
            'Two sources render separate rows in native order with the ordinary badges');
          check(groupSlot().querySelectorAll('.co2prism-slot-quadrant.co2prism-conditional-halo').length === 2 &&
            !groupSlot().classList.contains('co2prism-conditional-halo') &&
            [...bar.combatRows[0].children].some(slot => slot.dataset.co2prismTooltipText.includes('First') && slot.classList.contains('co2prism-conditional-halo')) &&
            [...bar.combatRows[0].children].some(slot => slot.dataset.co2prismTooltipText.includes('Second') && !slot.classList.contains('co2prism-conditional-halo')),
            'All source representations are highlighted and the manually saved dependent remains separate');
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size; bar.position = { x: 40, y: 500 }; bar.layout();
            const normal = bar.combatRows[0].getBoundingClientRect();
            const firstRow = conditionalZone.firstElementChild;
            const square = firstRow.firstElementChild.getBoundingClientRect();
            const base = bar.combatRows[0].firstElementChild.getBoundingClientRect();
            check(firstRow.getBoundingClientRect().bottom <= bar.upperLine.getBoundingClientRect().top && Math.abs(square.width - base.width) < 1 &&
              Math.abs(square.height - base.height) < 1 && Math.abs(square.left - normal.left) < 1 &&
              conditionalZone.getBoundingClientRect().top >= 0 && getComputedStyle(conditionalZone).pointerEvents === 'none',
              'Conditional rows keep exact card size and stay above normal rows at ' + size);
          }
          bar.position = { x: 40, y: 0 }; bar.layout();
          check(conditionalZone.getBoundingClientRect().bottom <= bar.upperLine.getBoundingClientRect().top &&
            conditionalZone.getBoundingClientRect().top >= -1 &&
            conditionalZone.getBoundingClientRect().height > 0, 'Conditional rows remain reachable at the top of the screen');
          check(conditionalZone.getBoundingClientRect().right <= innerWidth &&
            conditionalZone.clientWidth > bar.combatRows[0].clientWidth, 'Conditional rows can extend beyond the ordinary rows');
          conditionalZone.style.maxWidth = conditionalZone.firstElementChild.firstElementChild.getBoundingClientRect().width + 'px';
          check(conditionalZone.firstElementChild.scrollWidth > conditionalZone.firstElementChild.clientWidth,
            'A long conditional row scrolls without reducing the squares');
          conditionalZone.style.removeProperty('max-width');
          bar.layout();
          const conditionalSquare = (index, row = 0) =>
            conditionalZone.children[row].querySelector('[data-co2prism-indice="' + index + '"]');
          document.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
          await settled();
          const dispatchConditional = (index, options) => conditionalSquare(index).dispatchEvent(
            new MouseEvent('click', { bubbles: true, ...options }));
          const persistentDependent = () => [...bar.combatRows[0].children].find(slot => slot.dataset.co2prismTooltipText.includes('Second'));
          check(conditionalSquare(1).dataset.co2prismTooltipText === persistentDependent().dataset.co2prismTooltipText &&
            !conditionalSquare(1).draggable && !conditionalSquare(1).querySelector('.co2prism-slot-remove'),
            'Temporary and permanent action share the tooltip, while temporary actions cannot be edited');
          for (const locked of [false, true]) {
            settings.locked = locked; bar.updateLock(); await settled();
            check(contextClick(conditionalSquare(1)) && !presetMenuOpen(), 'Conditional right-click opens no configuration menu');
          }
          const conditionalCalls = groupCalls.length;
          for (const index of [1, 2, 3]) {
            await economy.reset(); bar.refreshActor(); await settled();
            const square = conditionalSquare(index);
            square.click(); square.click();
            await settled();
            check(groupCalls.length === conditionalCalls + index && groupCalls.at(-1)[2] === index &&
              groupCalls.at(-1)[1] === inventoryBlade.uuid && !economy.getSnapshot().normal.m,
              'Locked conditional action executes the right native index once and uses the shared budget: ' + index);
          }
          dispatchConditional(1, { ctrlKey: true }); await settled();
          check(groupCalls.at(-1).join() === ['chat', inventoryBlade.uuid, 1].join(), 'Conditional Ctrl-click uses native chat');
          dispatchConditional(1, { shiftKey: true }); await settled();
          check(groupCalls.at(-1).join() === ['sheet', inventoryBlade.uuid].join(), 'Conditional Shift-click uses the native sheet');
          await economy.reset(); bar.refreshActor(); await settled();
          persistentDependent().click(); await settled();
          check(groupCalls.at(-1)[2] === 1, 'The same dependent remains executable as a permanent shortcut');
          const beforeInvalidConditional = groupCalls.length;
          inventoryBlade.actions[3].isVisible = async () => false;
          conditionalSquare(3).click(); await settled();
          check(groupCalls.length === beforeInvalidConditional && temporaryIndices() === '1,2',
            'A now-false native condition denies a stale card and refreshes the rows');
          inventoryBlade.actions[3].isVisible = async () => inventoryBlade.actions[2].properties.enabled;
          hooks.get('updateItem')(inventoryBlade); await settled();
          const obsoleteConditional = conditionalSquare(1);
          canvas.tokens.controlled = [{ actor: other, document: { baseActor: other } }]; bar.refreshActor();
          obsoleteConditional.click();
          check(groupCalls.length === beforeInvalidConditional && conditionalZone.hidden,
            'Switching actor invalidates a previously attached temporary shortcut');
          canvas.tokens.controlled = selected; bar.refreshActor(); await settled();
          settings.locked = false; bar.updateLock(); await settled();
          const anchoredRow = bar.combatRows[0].getBoundingClientRect().toJSON();
          inventoryBlade.actions[2].properties.enabled = false;
          hooks.get('updateItem')(inventoryBlade);
          await settled();
          check(temporaryIndices() === '1,2' && groupSlot().querySelectorAll('.co2prism-conditional-halo').length === 1 &&
            JSON.stringify(bar.combatRows[0].getBoundingClientRect().toJSON()) === JSON.stringify(anchoredRow),
            'A second false condition removes only the affected row and halo without moving normal slots');
          inventoryBlade.actions[0].properties.enabled = false;
          hooks.get('updateItem')(inventoryBlade);
          await settled();
          check(conditionalZone.hidden && !conditionalZone.children.length && !root.querySelector('.co2prism-conditional-halo'),
            'Deactivation clears the conditional cards and every highlight');
          const conditionalSource = { itemId: inventoryBlade.id, source: inventoryBlade.uuid, indice: 0 };
          const permanentShortcuts = JSON.stringify(actor.flags.co2prism.shortcuts);
          await economy.reset();
          await bar.setPresetActionRule(actor, conditionalSource, 3, 'activate');
          await bar.setActivePreset(3);
          await settled();
          check(temporaryIndices() === '1,2' && JSON.stringify(actor.flags.co2prism.shortcuts) === permanentShortcuts,
            'Preset automation shows conditional rows without writing permanent shortcuts');
          await bar.setActivePreset(1);
          await settled();
          check(conditionalZone.hidden && !root.querySelector('.co2prism-conditional-halo'),
            'Preset deactivation removes the temporary row and highlights');
          await economy.reset();
          await bar.setActivePreset(3);
          await settled();
          game.system.api.macros.useAction = async (source, indice, type) => {
            const result = await groupActivation({ source, indice, type, state: true });
            if (result && indice === 1) {
              inventoryBlade.actions[0].properties.enabled = false;
              hooks.get('updateItem')(inventoryBlade);
            }
            return result;
          };
          await economy.reset(); bar.refreshActor(); await settled();
          conditionalSquare(1).click(); await settled();
          check(conditionalZone.hidden && !root.querySelector('.co2prism-conditional-halo'),
            'A dependent action changing the native source state clears the temporary row');
          const pathSheets = [];
          const makePathItem = (owner, type, id, sort, system, img) => {
            const document = { id, uuid: owner.uuid + '.Item.' + id, type, name: id, sort, img, parent: owner,
              system: { description: '<p>Details of ' + id + '</p>', ...system },
              testUserPermission: () => true, sheet: { render: force => { if (force) pathSheets.push(id); } } };
            owner.items.set(id, document);
            return document;
          };
          for (const owner of [actor, other]) {
            owner.getEmbeddedItemByUuid = uuid => owner.items.get(uuid.split('.').at(-1));
            owner.paths = []; owner.capacities = [];
          }
          for (const count of [12, 7, 6, 5, 3, 1, 0]) {
            const path = makePathItem(actor, 'path', 'path' + count, count, { capacities: [] }, 'icons/svg/sun.svg');
            actor.paths.push(path);
            for (let rank = count; rank > 0; rank--) {
              const capacity = makePathItem(actor, 'capacity', path.id + 'rank' + rank, rank,
                { path: path.uuid, rank, learned: rank % 2 === 1 }, 'icons/svg/sword.svg');
              actor.capacities.push(capacity);
              path.system.capacities.push(capacity.uuid);
            }
            if (count) path.system.capacities.push(path.system.capacities[0], actor.uuid + '.Item.deleted');
          }
          const foreign = makePathItem(actor, 'capacity', 'foreign', 0,
            { path: 'Actor.other.Item.missing', rank: 0 }, 'icons/svg/fire.svg');
          actor.capacities.push(foreign);
          actor.paths[0].system.capacities.push('Actor.other.Item.foreign');
          actor.capacities.push(makePathItem(actor, 'capacity', 'free', 0, { path: null, rank: 0 }, 'icons/svg/fire.svg'));
          const encounterPath = makePathItem(other, 'path', 'encounter-path', 0, { capacities: [] }, 'icons/svg/sun.svg');
          other.type = 'encounter';
          other.paths.push(encounterPath);
          for (let rank = 1; rank <= 3; rank++) {
            const capacity = makePathItem(other, 'capacity', 'encounter-rank' + rank, rank,
              { path: encounterPath.uuid, rank }, 'icons/svg/sword.svg');
            other.capacities.push(capacity);
            encounterPath.system.capacities.push(capacity.uuid);
          }
          other.capacities.push(...Array.from({ length: 6 }, (_, index) => makePathItem(other, 'capacity',
            'encounter-free' + index, index, { path: null, rank: index }, 'icons/svg/fire.svg')));
          const pathPanel = bar.pathsPanel;
          const pathGroup = id => pathPanel.querySelector('[data-path-key="' + id + '"]');
          const pathCapacities = id => [...pathGroup(id).querySelectorAll('[data-learned]')];
          const togglePaths = async () => { bar.pathsToggle.click(); await bar.configWrites.get(bar.actor); };
          const pathHeader = id => pathGroup(id).querySelector('.co2prism-path-header');
          const togglePathGroup = async target => {
            check(contextClick(target), 'Paths context click is handled locally');
            await bar.configWrites.get(bar.actor);
          };
          await bar.setPanelState('equipements', true);
          await togglePaths();
          check(!pathPanel.hidden && equipment.hidden && actor.flags.co2prism.panels.equipements === false,
            'Opening Paths closes Equipment in the same configuration');
          check([...pathPanel.children].map(node => node.dataset.pathKey).join() === 'path0,path1,path3,path5,path6,path7,path12,off-paths',
            'Native path sort and final off-path block');
          for (const count of [0, 1, 3, 5, 6, 7, 12]) {
            const id = 'path' + count, tiles = pathCapacities(id);
            check(tiles.length === count && tiles.every((tile, index) => tile.dataset.itemId === id + 'rank' + (index + 1) &&
              tile.dataset.learned === String(index % 2 === 0)), 'Path rank order, deduplication, learning and wrapping: ' + count);
          }
          check(pathGroup('path12').querySelector('.co2prism-path-header img').alt === 'path12' &&
            pathGroup('path12').querySelector('.co2prism-path-label').textContent === 'path12' &&
            pathHeader('off-paths').querySelector('i.fa-circle-star') && pathCapacities('off-paths').length === 1 &&
            !pathPanel.querySelector('[data-item-id="foreign"]'), 'Path image, off-path icon, and actor-scoped UUID resolution');
          await settled();
          for (const node of [pathHeader('path12'), ...pathCapacities('path12').slice(0, 2)]) {
            check(node.dataset.co2prismDescriptionHtml.includes('Details of ' + node.dataset.itemId), 'Path or capacity tooltip uses its own description');
            node.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
          }
          check(pathHeader('off-paths').querySelector('i.fa-circle-star') && !pathHeader('off-paths').textContent.trim(), 'Off-path is icon only');
          check(pathSheets.join() === 'path12,path12rank1,path12rank2' &&
            pathHeader('off-paths').dataset.co2prismTooltipText && !pathHeader('off-paths').dataset.co2prismDescriptionHtml,
            'Native sheets open for both learning states, while Off-path only has its category label');
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size; bar.layout();
            const skillsOpen = !bar.skillsPanel.hidden;
            const paneWidth = pathPanel.getBoundingClientRect().width;
            const contentWidth = pathPanel.clientWidth;
            pathPanel.style.maxHeight = '50px';
            check(pathPanel.scrollHeight > pathPanel.clientHeight && pathPanel.clientWidth === contentWidth &&
              Math.abs(pathPanel.getBoundingClientRect().width - paneWidth) < 1, size + ' paths gutter keeps content width stable');
            pathPanel.style.removeProperty('max-height');
            await bar.setPanelState('competences', !skillsOpen);
            check(Math.abs(pathPanel.getBoundingClientRect().width - paneWidth) < 1, size + ' paths width independent of skills');
            await bar.setPanelState('competences', skillsOpen);
            for (const count of [0, 1, 5]) {
              const group = pathGroup('path' + count);
              const bounds = group.getBoundingClientRect();
              const tiles = pathCapacities('path' + count).map(tile => tile.getBoundingClientRect());
              check(tiles.length === count && tiles.every(tile => tile.top === tiles[0].top && tile.right <= bounds.right + 1),
                size + ' path tiles fit in one line with ' + count + ' ranks');
            }
            const tiles = pathCapacities('path12');
            const offHeader = pathHeader('off-paths');
            const offBox = offHeader.getBoundingClientRect(), offCapacity = pathCapacities('off-paths')[0].getBoundingClientRect();
            check(Math.abs(offBox.width - pathHeader('path12').getBoundingClientRect().width) < 1 &&
              Math.abs(offBox.height - pathHeader('path12').getBoundingClientRect().height) < 1 &&
              Math.abs((offBox.top + offBox.bottom) - (offCapacity.top + offCapacity.bottom)) < 2 &&
              offBox.right < offCapacity.left, size + ' off-path icon is centered on the capacity row');
            const image = pathHeader('path12').getBoundingClientRect();
            const label = pathGroup('path12').querySelector('.co2prism-path-label').getBoundingClientRect();
            const ranks = tiles.slice(0, 6).map(tile => tile.getBoundingClientRect());
            check(image.right <= label.left && image.right <= ranks[0].left && image.top <= label.top &&
              ranks.slice(0, 5).every(rank => rank.top === ranks[0].top) &&
              ranks[5].top > ranks[0].top, size + ' path image precedes title and capacity rows');
            check(tiles.every(tile => getComputedStyle(tile).transform === 'none') &&
              Math.abs(pathPanel.getBoundingClientRect().bottom - bar.anchor.getBoundingClientRect().top) < 1 &&
              Math.abs(pathPanel.getBoundingClientRect().right - bar.anchor.getBoundingClientRect().right) < 1,
              'Paths share the rectangular inventory dock at ' + size);
            check(light(tiles[0]) === gold && light(tiles[1]) === 'transparent' &&
              getComputedStyle(tiles[0].querySelector('img')).filter === 'none' &&
              getComputedStyle(tiles[1].querySelector('img')).filter.includes('saturate') &&
              light(pathHeader('path12')) === actorLight(),
              'Learned capacities and open paths receive the proper halos at ' + size);
          }

          const pathsWidth = pathPanel.getBoundingClientRect().width;
          const expandedPathsHeight = pathPanel.getBoundingClientRect().height;
          const pathDisclosure = () => pathGroup('path7').querySelector('.co2prism-path-header');
          const expandedPathBox = pathDisclosure().getBoundingClientRect();
          const expandedOffBox = pathHeader('off-paths').getBoundingClientRect();
          pathDisclosure().focus();
          pathDisclosure().click(); await bar.configWrites.get(actor);
          const disclosure = pathDisclosure();
          check(document.activeElement === disclosure && disclosure.getAttribute('aria-expanded') === 'false' &&
            document.getElementById(disclosure.getAttribute('aria-controls')).hidden,
            'Path disclosure restores focus and controls the capacity grid');
          check(pathCapacities('path7').length === 0 && pathGroup('path7').querySelector('.co2prism-path-header img') &&
            getComputedStyle(pathGroup('path7').querySelector('.co2prism-path-label')).display === 'none' &&
            pathPanel.getBoundingClientRect().height <= expandedPathsHeight + 1 && pathCapacities('path12').length === 12,
            'Collapsed path retains only its enlarged image and compacts the next blocks');
          await togglePathGroup(pathHeader('off-paths'));
          check(!pathCapacities('off-paths').length && pathHeader('off-paths').querySelector('i.fa-circle-star') &&
            pathHeader('off-paths').getBoundingClientRect().width === expandedOffBox.width &&
            pathHeader('off-paths').getBoundingClientRect().height === expandedOffBox.height &&
            pathDisclosure().getBoundingClientRect().width === expandedPathBox.width &&
            pathDisclosure().getBoundingClientRect().height === expandedPathBox.height, 'Collapsed groups retain their icon sizes');
          await togglePathGroup(bar.pathsToggle);

          check([...pathPanel.children].every(group => group.dataset.collapsed === 'true'), 'Global click collapses mixed states');
          const collapsedHeaders = [...pathPanel.querySelectorAll('.co2prism-path-header')].map(header => header.getBoundingClientRect());
          check(collapsedHeaders[0].top === collapsedHeaders[1].top && collapsedHeaders[0].right < collapsedHeaders[1].left,
            'Collapsed groups still share horizontal space');
          check(pathPanel.getBoundingClientRect().width === pathsWidth &&
            pathPanel.getBoundingClientRect().height < expandedPathsHeight, 'Collapsed paths keep a stable width');
          await togglePathGroup(bar.pathsToggle);
          check(pathCapacities('path7').length === 7 && pathCapacities('off-paths').length === 1,
            'Global reopening restores the individual paths and Off-path');
          settings.locked = true; bar.updateLock();
          await togglePathGroup(pathHeader('path7'));
          check(pathGroup('path7').dataset.collapsed === 'true', 'Individual path collapse works locked');
          await togglePaths();
          await togglePathGroup(bar.pathsToggle);
          check(pathPanel.hidden && actor.flags.co2prism.panels.voies === false &&
            Object.values(actor.flags.co2prism.pathCollapsed).every(Boolean), 'Global collapse works locked without reopening Paths');
          await togglePaths();
          check([...pathPanel.children].every(group => group.dataset.collapsed === 'true'), 'Opening Paths reads the persisted collapse flags');
          const compactHeaders = [...pathPanel.children].map(group => group.querySelector('.co2prism-path-header').getBoundingClientRect());
          check(compactHeaders.every((header, index) => !index || header.top >= compactHeaders[index - 1].bottom || header.left >= compactHeaders[index - 1].right),
            'Collapsed headers remain in order without overlapping');
          actor.testUserPermission = (_, permission) => permission !== 'OWNER'; bar.refreshActor();
          contextClick(pathHeader('path12'));
          check(pathGroup('path12').dataset.collapsed === 'true', 'Observer cannot change path flags');
          pathHeader('path12').click();
          check(pathSheets.at(-1) === 'path12', 'Observer can still consult an Item sheet');
          actor.testUserPermission = () => true; bar.refreshActor();
          await togglePathGroup(pathHeader('path12'));
          check(pathCapacities('path12').length === 12 && !pathCapacities('path7').length, 'Individual reopening after global collapse stays independent');
          await togglePathGroup(bar.pathsToggle);
          await togglePathGroup(bar.pathsToggle);
          settings.locked = false; bar.updateLock();
          await bar.setPanelState('equipements', true);
          check(pathPanel.hidden && !equipment.hidden && actor.flags.co2prism.panels.voies === false, 'Equipment closes Paths');
          await togglePaths();
          canvas.tokens.controlled = [{ actor: other, document: { baseActor: other } }]; bar.refreshActor();
          check(pathPanel.hidden, 'Different actor has its own Paths panel state');
          const encounterText = key => bar.gauges[key].encounterText;
          Object.assign(budgetTranslations, { 'CO.encounter.category.beast': 'Beast', 'CO.size.small': 'Small',
            'CO2PRISM.Encounter.Name': '{name} (NC {nc})', 'CO2PRISM.Encounter.Properties': 'Propri\u00e9t\u00e9s',
            'CO2PRISM.Encounter.NoProperties': 'Aucune propri\u00e9t\u00e9' });
          other.system = { ...other.system, attributes: { ...other.system.attributes } };
          other.system.attributes.nc = 2;
          other.system.details = { category: 'beast', size: 'small', properties: '<p>&nbsp; </p>' };
          bar.refreshActor();
          check(root.classList.contains('co2prism-encounter') && bar.name.textContent === other.name + ' (NC 2)' &&
            bar.name.dataset.co2prismTooltipText === bar.name.textContent && encounterText('recovery').textContent === 'Beast' &&
            encounterText('fortune').textContent === 'Small' && encounterText('mana').textContent === 'Aucune propri\u00e9t\u00e9' &&
            !bar.gauges.mana.fill.dataset.co2prismImmediateHtml && !root.querySelector('.co2prism-rest-actions').getClientRects().length,
            'Encounter renders localized details, NC and the empty properties state');
          for (const [key, icon] of [['recovery', 'paw-claws'], ['fortune', 'ruler-triangle'], ['mana', 'book']]) {
            const row = bar.gauges[key].fill;
            check(row.querySelector('.co2prism-encounter-icon .fa-' + icon)?.getClientRects().length &&
              encounterText(key).getClientRects().length && getComputedStyle(row, '::before').display === 'none' &&
              !bar.gauges[key].text.getClientRects().length, 'Encounter detail replaces gauge and controls for ' + key);
          }
          const detailsRow = bar.gauges.mana.fill;
          other.system.details.properties = '<p><strong>B</strong> <em>I</em></p><ul><li>One</li></ul>';
          hooks.get('updateActor')(other, { system: {} });
          detailsRow.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
          check(encounterText('mana').textContent === 'Propri\u00e9t\u00e9s' && (!game.tooltip || (game.tooltip.element === detailsRow &&
            game.tooltip.tooltip.querySelector('strong') && game.tooltip.tooltip.querySelector('em') && game.tooltip.tooltip.querySelector('li'))),
            'Rich encounter properties appear immediately without Shift');
          other.system.details.properties = '<p>X</p>'; other.system.attributes.nc = 3;
          hooks.get('updateActor')(other, { system: {} });
          await settled();
          check(detailsRow.dataset.co2prismImmediateHtml === '<p>X</p>' && bar.name.textContent === other.name + ' (NC 3)' &&
            (!game.tooltip || game.tooltip.tooltip.textContent === 'X'), 'An open tooltip updates for a single-character property');
          const resources = () => Object.values(bar.gauges).map(({ fill }) => {
            const r = fill.getBoundingClientRect(), anchor = bar.anchor.getBoundingClientRect();
            return [r.x - anchor.x, r.y - anchor.y, r.width, r.height];
          });
          const encounterToken = canvas.tokens.controlled;
          const portraitFrame = () => getComputedStyle(bar.portrait.parentElement, "::before");
          const setCompanion = isCompanion => {
            other.system.companion = { isCompanion };
            hooks.get("updateActor")(other, { "system.companion.isCompanion": isCompanion });
          };
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size; bar.layout();
            const encounterRows = JSON.stringify(resources());
            const encounterSurface = palette("nucleus"), healthColor = palette("health");
            const red = actorLight();
            check(red === "#ff344a" && portraitFrame().boxShadow.includes(palette("electric-glass")) &&
              portraitFrame().pointerEvents === "none", size + " encounter rim is red and leaves the portrait clickable");
            const healthFill = getComputedStyle(bar.gauges.hp.fill, "::before").backgroundImage;
            const timeFills = () => bar.budgetCommands.map(button => {
              const style = getComputedStyle(button);
              return [style.backgroundColor, style.backgroundImage];
            }).join();
            const redTimeFills = timeFills();
            setCompanion(true);
            check(actorLight() === "#ffdc36" && root.classList.contains("co2prism-encounter") &&
              root.classList.contains("co2prism-companion") && portraitFrame().boxShadow.includes(palette("electric-glass")) &&
              JSON.stringify(resources()) === encounterRows && bar.pathsPanel.hidden &&
              !root.querySelector(".co2prism-rest-actions").getClientRects().length &&
              getComputedStyle(bar.gauges.hp.fill, "::before").backgroundImage === healthFill && timeFills() === redTimeFills,
              size + " companion without a master is yellow and keeps encounter geometry and functional colors");
            canvas.tokens.controlled = selected; bar.refreshActor();
            check(actorLight() === "#318dff" && portraitFrame().boxShadow.includes(palette("electric-glass")) &&
              Number(portraitFrame().zIndex) > 0, size + " character rim is blue in front of the vignette");
            check(!root.classList.contains('co2prism-encounter') && !root.classList.contains('co2prism-companion') &&
              bar.name.textContent === actor.name &&
              root.querySelector('.co2prism-rest-actions').getClientRects().length && !detailsRow.dataset.co2prismImmediateHtml &&
              palette('nucleus') !== encounterSurface && palette('health') === healthColor &&
              encounterRows === JSON.stringify(resources()), size + ' encounter and character share all four resource coordinates and functional colors');
            canvas.tokens.controlled = encounterToken; bar.refreshActor();
            check(actorLight() === "#ffdc36", size + " selecting a companion applies yellow immediately");
            setCompanion(false);
            check(actorLight() === red && !root.classList.contains("co2prism-companion"), size + " clearing the native flag restores red");
          }

          setCompanion(true);
          await togglePaths();
          check(prism(pathHeader('encounter-path'), 'rim') === actorLight() && actorLight() === "#ffdc36",
            "The companion palette reaches the open Paths panel");
          setCompanion(false);
          check(pathCapacities('encounter-path').length === 3 && pathCapacities('off-paths').length === 6, 'Encounter Paths and off-path inventory');
          other.capacities = other.capacities.filter(capacity => capacity.system.path);
          hooks.get('deleteItem')({ parent: other });
          check(!pathGroup('off-paths'), 'No empty off-path category after an Item update');
          await togglePathGroup(bar.pathsToggle);
          check(other.flags.co2prism.pathCollapsed['encounter-path'] && !('off-paths' in other.flags.co2prism.pathCollapsed),
            'Global collapse does not persist an absent Off-path category');
          await togglePaths();
          check(pathPanel.hidden && bar.pathsToggle.getAttribute('aria-expanded') === 'false', 'Paths button closes its own panel');
          canvas.tokens.controlled = selected; bar.refreshActor();
          check(!pathPanel.hidden && pathCapacities('path12').length === 12, 'Returning to actor restores its panel and items');
          const learnedTile = () => pathPanel.querySelector('[data-item-id="path12rank2"]');
          const learningCapacity = actor.items.get('path12rank2');
          for (const locked of [true, false]) {
            settings.locked = locked; bar.updateLock();
            for (const learned of [true, false]) {
              learningCapacity.system.learned = learned;
              hooks.get('updateItem')(learningCapacity);
              check((light(learnedTile()) === gold) === learned,
                'Native learning update toggles the halo in lock mode ' + locked);
            }
          }
          const changedPath = actor.items.get('path12');
          changedPath.name = 'Voie renommée ' + 'Trèslongnomdevoie'.repeat(8);
          changedPath.img = 'icons/svg/fire.svg';
          hooks.get('updateItem')(changedPath);
          check(pathGroup('path12').querySelector('.co2prism-path-label').textContent === changedPath.name &&
            pathHeader('path12').querySelector('img').getAttribute('src') === changedPath.img, 'Path title and image follow native updates');
          Object.assign(learningCapacity, { name: 'Capacité renommée', img: 'icons/svg/sun.svg' });
          Object.assign(learningCapacity.system, { rank: 0, description: '<p>Description mise à jour</p>' });
          hooks.get('updateItem')(learningCapacity);
          await settled();
          check(pathCapacities('path12')[0] === learnedTile() &&
            learnedTile().querySelector('img').getAttribute('src') === learningCapacity.img &&
            learnedTile().dataset.co2prismDescriptionHtml.includes(learningCapacity.name) &&
            learnedTile().dataset.co2prismDescriptionHtml.includes('Description mise à jour'), 'Native rank, name, image and description update together');
          learningCapacity.system.path = actor.items.get('path3').uuid;
          hooks.get('updateItem')(learningCapacity);
          check(pathCapacities('path3')[0] === learnedTile() && pathCapacities('path12').length === 11 &&
            pathPanel.querySelectorAll('[data-item-id="path12rank2"]').length === 1, 'Reassociation moves the tile without duplicating it');
          learningCapacity.system.path = null;
          learningCapacity.system.learned = true;
          hooks.get('updateItem')(learningCapacity);
          check(pathCapacities('off-paths').includes(learnedTile()) && pathCapacities('path3').length === 3 &&
            light(learnedTile()) === gold, 'A detached and learned capacity moves to Off-path with its halo');
          const newPath = makePathItem(actor, 'path', 'new-path', 20, { capacities: [] }, 'icons/svg/sun.svg');
          actor.paths.push(newPath);
          hooks.get('createItem')(newPath);
          const newCapacity = makePathItem(actor, 'capacity', 'new-capacity', 1,
            { path: newPath.uuid, rank: 1, learned: true }, 'icons/svg/fire.svg');
          actor.capacities.push(newCapacity);
          hooks.get('createItem')(newCapacity);
          check(pathCapacities('new-path').length === 1, 'New embedded capacity appears in the new path');
          await togglePathGroup(pathHeader('new-path'));
          actor.items.delete(newCapacity.id);
          actor.capacities = actor.capacities.filter(capacity => capacity !== newCapacity);
          hooks.get('deleteItem')(newCapacity);
          check(pathGroup('new-path').dataset.collapsed === 'true', 'Deleting an item preserves its path preference');
          actor.items.delete(newPath.id);
          actor.paths = actor.paths.filter(path => path !== newPath);
          hooks.get('deleteItem')(newPath);
          check(!pathGroup('new-path') && actor.flags.co2prism.pathCollapsed['new-path'] &&
            pathCapacities('path12').length === 11, 'Deleting a collapsed path leaves no visual ghost or affects other paths');
          const paletteProbe = document.createElement('div');
          paletteProbe.className = 'co2prism-combat-slot';
          root.append(paletteProbe);
          const paletteSamples = [
            ['L', 'limited', '--prism-limited'], ['A', 'attack', '--prism-attack'],
            ['M', 'move', '--prism-move'], ['G', null, '--prism-free']
          ];
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size; bar.layout();
            const dimensions = paletteSamples.map(([letter, subtype, token]) => {
              paletteProbe.style.color = 'var(' + token + ')';
              paletteProbe.innerHTML = '<span class="co2prism-slot-time co2prism-slot-time-' + letter + '">' + letter +
                '</span><i class="co2prism-slot-type fa-solid fa-axe"></i><span class="co2prism-slot-uses">3</span>' +
                '<span class="co2prism-slot-cost">2</span>' +
                (subtype ? '<span class="co2prism-time-indicator co2prism-time-' + subtype + '"></span>' : '');
              const badge = paletteProbe.firstElementChild, color = getComputedStyle(paletteProbe).color;
              check(getComputedStyle(badge).backgroundColor === color, 'Action badge uses the semantic palette for ' + letter);
              if (subtype) {
                const command = root.querySelector('button.co2prism-time-' + subtype);
                const style = getComputedStyle(command);
                check(style.getPropertyValue('--co2prism-time-color').trim() ===
                  style.getPropertyValue(token).trim() &&
                  (command.parentElement.classList.contains('co2prism-time-available')
                    ? style.backgroundColor === color && style.backgroundImage !== 'none'
                    : style.backgroundColor !== color) &&
                  getComputedStyle(paletteProbe.lastElementChild, '::before').backgroundColor === color,
                  'Budget command and indicator share the badge color for ' + letter);
              }
              check([...paletteProbe.querySelectorAll('.co2prism-slot-type, .co2prism-slot-uses, .co2prism-slot-cost')].every(node =>
                getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(node).textShadow !== 'none'),
                'Ordinary corner badges use text shadow on a clear background');
              const { width, height } = badge.getBoundingClientRect();
              return [width, height].join();
            });
            check(dimensions.every(dimension => dimension === dimensions[0]), 'Time badges have identical dimensions at ' + size);
          }
          const prismColors = getComputedStyle(root);
          check(bar.movementZones.getPalette().move === parseInt(prismColors.getPropertyValue('--prism-move').trim().slice(1), 16),
            'Tactical markers use the same movement palette as the HUD');
          paletteProbe.remove();
          for (const panel of [bar.equipmentPanel, bar.pathsPanel]) {
            const wasHidden = panel.hidden;
            const frame = panel.parentElement;
            const original = [...panel.childNodes];
            panel.hidden = false;
            panel.style.maxHeight = "120px";
            const filler = document.createElement("div");
            filler.style.flex = "0 0 100%"; filler.style.height = "300px";
            panel.replaceChildren(filler);
            await settled();
            const shades = (above, below) => panel.hasAttribute("data-scroll-above") === above &&
              panel.hasAttribute("data-scroll-below") === below &&
              (getComputedStyle(frame, "::before").content !== "none") === above &&
              (getComputedStyle(frame, "::after").content !== "none") === below;
            const scroll = top => { panel.scrollTop = top; panel.dispatchEvent(new Event("scroll")); };
            check(shades(false, true), panel.id + " bottom fade on opening");
            scroll(50);
            const topFade = getComputedStyle(frame, "::before"), bottomFade = getComputedStyle(frame, "::after");
            check(shades(true, true) && panel.scrollTop === 50 && topFade.top === "0px" && bottomFade.bottom === "0px" &&
              topFade.pointerEvents === "none" && bottomFade.pointerEvents === "none" &&
              getComputedStyle(frame).overflow === "clip" && parseFloat(topFade.width) <= panel.clientWidth,
              panel.id + " both fades stay clipped to the viewport without covering the scrollbar");
            scroll(panel.scrollHeight);
            check(shades(true, false), panel.id + " top fade at the end");
            panel.style.maxHeight = "400px";
            panel.getBoundingClientRect();
            for (let attempt = 0; attempt < 8 && !shades(false, false); attempt++) {
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            check(shades(false, false), panel.id + " no fades after increasing the viewport " +
              JSON.stringify([panel.scrollTop, panel.clientHeight, panel.scrollHeight, panel.getAttributeNames()]));
            panel.style.maxHeight = "120px";
            panel.replaceChildren();
            await settled();
            check(shades(false, false), panel.id + " no fades after removing content");
            panel.replaceChildren(filler);
            await settled();
            panel.hidden = true;
            await settled();
            check(shades(false, false), panel.id + " hidden frame clears both fades");
            panel.replaceChildren(...original); panel.style.removeProperty("max-height"); panel.hidden = wasHidden;
          }
          const sceneControls = { tokens: { tools: { select: { name: "select", order: 0 } } } };
          const registerSceneControls = hooks.get("getSceneControlButtons");
          registerSceneControls(sceneControls);
          const tool = sceneControls.tokens.tools.co2prism;
          check(tool?.toggle && tool.active && tool.icon === "fa-solid fa-gem" && Object.keys(sceneControls).length === 1,
            "Gem is a default-on native toggle in Tokens");
          const choose = (...actors) => {
            canvas.tokens.controlled = actors.map(actor => ({ actor, document: { baseActor: actor } }));
            hooks.get("controlToken")();
          };
          game.user.isGM = true; game.user.character = actor;
          choose(); check(root.hidden, "GM with zero tokens remains hidden");
          choose(actor); check(!root.hidden && bar.actor === actor, "GM with one token sees Prism");
          choose(actor, other); check(root.hidden, "GM with multiple tokens stays hidden");
          game.user.isGM = false;
          choose(); check(!root.hidden && bar.actor === actor && !bar.token, "Player falls back to assigned actor without token");
          canvas.ready = false; hooks.get("canvasTearDown")();
          check(!root.hidden && bar.actor === actor, "Assigned actor remains visible without an active canvas");
          await bar.setPanelState("combat", true);
          check(actor.flags.co2prism.panels.combat && bar.combatValues.cells.textContent === "0" && movementPanel.querySelector(".co2prism-movement-summary").textContent === "0" &&
            [bar.movementZonesButton, bar.movementReset, bar.movementValidate].every(button => button.disabled), "Tokenless actor has zero cells and disabled tactical commands");
          canvas.ready = true;
          choose(other); check(!root.hidden && bar.actor === other, "Selected companion takes priority");
          choose(actor, other); check(root.hidden, "Multiple tokens suppress fallback");
          choose(); check(!root.hidden && bar.actor === actor, "Deselecting companion restores assigned actor");
          game.user.character = null;
          hooks.get("updateUser")(game.user, { character: null });
          check(root.hidden, "Unassigned player with no selection stays hidden");
          const forbidden = { ...other, testUserPermission: () => false };
          choose(forbidden); check(root.hidden, "Unobservable token stays hidden");
          choose(other); check(!root.hidden && bar.actor === other, "Unassigned player can see selected actor");
          bar.position = { x: 300, y: 350 }; settings.size = "L"; bar.layout();
          const savedAnchor = bar.anchor.getBoundingClientRect();
          bar.shortcutPreview.showPopover(); bar.equipmentMenu.showPopover();
          tool.onChange(null, false);
          check(root.hidden && getComputedStyle(root).display === "none" && !root.querySelector(":popover-open"),
            "Toggle hides the entire Prism DOM and floating UI immediately");
          choose(actor); choose(); choose(other);
          check(root.hidden && bar.actor === other, "Selection still updates while the toggle is off");
          await visibilityWrite;
          registerSceneControls(sceneControls);
          check(settings.visible === false && sceneControls.tokens.tools.co2prism.active === false, "Stored toggle state is restored in Tokens");
          tool.onChange(null, true);
          check(!root.hidden && bar.actor === other && root === bar.element &&
            ["left", "top", "width"].every(key => Math.abs(bar.anchor.getBoundingClientRect()[key] - savedAnchor[key]) < 1),
            "Reactivation reuses the same element, anchor and scale");
          await visibilityWrite;
          check(board.width === innerWidth && board.height === innerHeight, "Board natif modifié");
        } catch (error) { result.errors.push(error.stack); }
        const output = document.createElement("pre"); output.id = "co2prism-browser-result";
        output.textContent = JSON.stringify(result); document.body.append(output);
      })();</script></body></html>`;
    const fixture = join(directory, "layout.html");
    writeFileSync(fixture, html);
    const execution = spawnSync(edge, ["--headless", "--no-sandbox", "--disable-gpu", "--in-process-gpu",
      "--disable-software-rasterizer", "--no-first-run", "--no-default-browser-check",
      "--allow-file-access-from-files", `--user-data-dir=${join(directory, "profile")}`,
      "--window-size=2400,1400", "--virtual-time-budget=6000",
      ...(process.env.CO2PRISM_SCREENSHOT ? [`--screenshot=${process.env.CO2PRISM_SCREENSHOT}`] : []),
      "--dump-dom", pathToFileURL(fixture).href], {
      encoding: "utf8", timeout: 55000, maxBuffer: 2000000, windowsHide: true
    });
    assert.ifError(execution.error);
    assert.equal(execution.status, 0, execution.stderr);
    const output = execution.stdout.match(/<pre id="co2prism-browser-result">([^<]+)<\/pre>/);
    assert.ok(output, "Résultat navigateur manquant");
    const result = JSON.parse(output[1]);
    console.log(JSON.stringify({ dimensions: result.dimensions, skillsDimensions: result.skillsDimensions,
      combatDimensions: result.combatDimensions, board: result.board }));
    assert.deepEqual(result.errors, []);
    // Même module dans un vrai viewport étroit, sans masquer les assertions du scénario large.
    const narrowScript = `
      (async () => {
        const result = { errors: [] };
        const check = (condition, message) => { if (!condition) result.errors.push(message); };
        try {
          await ready[0]();
          const source = "Actor.test.Item.owned";
          const persistedSlots = ${JSON.stringify(result.restoredSlots)};
          const actor = { uuid: "Actor.test", name: "Narrow", type: "character", system: {},
            testUserPermission: () => true, getSkillBonuses: () => [],
            flags: { co2prism: { hands: { active: 3 }, panels: { combat: false, competences: true }, shortcuts: persistedSlots } },
            getFlag(scope, key) { return key.split(".").reduce((value, part) => value?.[part], this.flags[scope]); },
            async setFlag(scope, key, value) {
              let target = this.flags[scope]; const parts = key.split(".");
              for (const part of parts.slice(0, -1)) target = target[part] ??= {};
              target[parts.at(-1)] = value;
            }
          };
          const action = { source, indice: 0, actionName: "Native action" };
          actor.items = new Map([["owned", { id: "owned", uuid: source, actions: [action] }]]);
          actor.actions = [action];
          canvas.tokens.controlled = [{ actor, document: { baseActor: actor } }];
          bar.refreshActor();
          bar.position = { x: innerWidth - 432, y: 350 }; bar.layout();
          await bar.setPanelState("combat", true);
          const root = document.getElementById("co2prism-bar");
          const [first, second] = bar.combatRows;
          check(first.children.length === 1 && second.children.length === 4, "Restauration après relance du navigateur incorrecte");
          check(first.scrollWidth <= first.clientWidth && first.scrollLeft === 0, "Première ligne inutilement réduite");
          check(second.scrollWidth > second.clientWidth, "Défilement nécessaire absent");
          second.scrollLeft = second.scrollWidth;
          const last = second.lastElementChild.getBoundingClientRect(), visible = second.getBoundingClientRect();
          check(last.left >= visible.left - 0.1 && last.right <= visible.right + 1, "Dernière case inaccessible");
          check(root.getBoundingClientRect().right <= innerWidth + 0.1, "Prism hors fenêtre étroite");
          check(document.elementFromPoint(innerWidth - 2, innerHeight - 2)?.id === "board", "Canvas bloqué");
          settings.size = "S"; bar.layout();
          check(second.scrollWidth <= second.clientWidth && second.scrollLeft === 0, "Défilement conservé après retour à une taille adaptée");
          result.viewport = innerWidth;
        } catch (error) { result.errors.push(error.stack); }
        const output = document.createElement("pre"); output.id = "co2prism-browser-result";
        output.textContent = JSON.stringify(result); document.body.append(output);
      })();</script></body></html>`;
    const narrowFixture = join(directory, "narrow.html");
    writeFileSync(narrowFixture, html.slice(0, html.indexOf("      (async () => {")) + narrowScript);
    const narrowExecution = spawnSync(edge, ["--headless", "--no-sandbox", "--disable-gpu", "--in-process-gpu",
      "--disable-software-rasterizer", "--no-first-run", "--no-default-browser-check", "--allow-file-access-from-files",
      `--user-data-dir=${join(directory, "profile-narrow")}`, "--window-size=630,1400", "--virtual-time-budget=4000",
      "--dump-dom", pathToFileURL(narrowFixture).href], {
      encoding: "utf8", timeout: 25000, maxBuffer: 2000000, windowsHide: true
    });
    assert.ifError(narrowExecution.error);
    assert.equal(narrowExecution.status, 0, narrowExecution.stderr);
    const narrowOutput = narrowExecution.stdout.match(/<pre id="co2prism-browser-result">([^<]+)<\/pre>/);
    assert.ok(narrowOutput, "Résultat navigateur étroit manquant");
    const narrowResult = JSON.parse(narrowOutput[1]);
    console.log(JSON.stringify({ narrowViewport: narrowResult.viewport }));
    assert.deepEqual(narrowResult.errors, []);
  } finally {
    // Vérifier la destination avant de supprimer le profil temporaire.
    const target = resolve(directory);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.split(sep).at(-1).startsWith("co2prism-browser-"));
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
