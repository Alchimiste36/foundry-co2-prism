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
  skip: !existsSync(edge) || !existsSync(foundryCSS), timeout: 30000
}, () => {
  const directory = mkdtempSync(join(tmpdir(), "co2prism-browser-"));
  try {
    const translations = JSON.parse(read("../lang/fr.json"));
    const markup = read("../templates/bar.hbs").replace(/\{\{localize '([^']+)'\}\}/g,
      (_match, key) => key.split(".").reduce((value, part) => value?.[part], translations) ?? key);
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
      const budgetTranslations = ${JSON.stringify(Object.fromEntries(["TimeOr", "TimeControls", "TimeUnavailable", "BonusTime", "NormalTime", "EconomyError"].map(key => [`CO2PRISM.Combat.${key}`, translations.CO2PRISM.Combat[key]])))};
      Object.assign(budgetTranslations, ${JSON.stringify(Object.fromEntries(Object.entries(translations.CO2PRISM.Movement).map(([key, value]) => [`CO2PRISM.Movement.${key}`, value])))});
      budgetTranslations['CO2PRISM.Combat.Movement'] = ${JSON.stringify(translations.CO2PRISM.Combat.Movement)};
      const game = globalThis.game = { system: { id: "co2" }, user: {},
        settings: { get: (_, key) => settings[key], set: (_, key, value) => settings[key] = value },
        i18n: { localize: key => budgetTranslations[key] ?? key,
          format: (key, data) => (budgetTranslations[key] ?? key).replace(/\\{(\\w+)\\}/g, (_, name) => data[name]) } };
      let sequence = 0;
      const foundry = { utils: { deepClone: value => structuredClone(value), randomID: () => "test" + (++sequence) },
        applications: { api: { DialogV2: { confirm: async () => false } }, handlebars: { renderTemplate: async () => ${JSON.stringify(markup)} } } };
      ${"globalThis.ActionEconomy = (() => {" + read("../module/combat/action-economy.mjs").replace("export class ActionEconomy", "class ActionEconomy") + "; return ActionEconomy; })();"}
      ${read("../module/movement/movement-tracker.mjs").replace(/export /g, "")}
      ${read("../module/movement/movement-notifications.mjs").replace(/export /g, "")}
      ${read("../module/movement/movement-zones.mjs").replace(/import[^;]+;/g, "").replace(/export /g, "")}
      ${read("../module/applications/_module.mjs").replace(/import \{[^}]+\} from [^;]+;/g, "")}
      (async () => {
        const result = { dimensions: [], errors: [] };
        const check = (condition, message) => { if (!condition) result.errors.push(message); };
        try {
          await ready[0]();
          const root = document.getElementById("co2prism-bar");
          check(root.parentElement === document.body, "Parent autre que body");
          check(document.querySelectorAll("#co2prism-bar").length === 1, "Plusieurs barres");
          check(root.querySelectorAll("canvas").length === 0, "Canvas ajouté par Prism");
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
              description: '<b>Escalade</b><img src="invalid" onerror="globalThis.co2prismInjected=true">',
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
          for (const action of ["sheet", "fortune", "fastRest", "fullRest"]) {
            if (bar.lastRest) bar.lastRest.at -= 1000;
            root.querySelector('[data-co2prism-action="' + action + '"]').click();
            await new Promise(resolve => setTimeout(resolve, 0));
          }
          check(calls.join(",") === "sheet,fortune,fastRest,fullRest", "Raccordement des clics");
          root.querySelector('[data-co2prism-preset="2"]').click();
          await bar.configWrites.get(actor);
          check(actor.flags.co2prism.activePreset === 2 && bar.configuration.activePreset === 2,
            "Preset non enregistré au clic");
          check(actor.flags.co2prism.panels.combat === true && !bar.combatPanel.hidden, "Combat non ouvert par le preset");
          root.querySelector('[data-co2prism-preset="2"]').click(); await bar.configWrites.get(actor);
          check(bar.combatPanel.hidden, "Combat non replié par le preset actif");
          for (const [size, width] of Object.entries({ S: 300, M: 430, L: 600, XL: 780 })) {
            settings.size = size; bar.position = {}; bar.layout();
            const r = root.getBoundingClientRect();
            result.dimensions.push({ size, width: r.width, height: r.height });
            check(Math.abs(r.width - width) < 0.1, size + " largeur");
            check(Math.abs(r.height - width * 569 / 724) < 0.1, size + " hauteur");
            check(Math.abs(r.left - 40) < 0.1 && Math.abs(innerHeight - r.bottom - 40) < 0.1, size + " marges");
            for (const [x, y] of [[r.left + 2, r.top + 2], [r.right - 2, r.top + 2],
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
              check(Math.abs(b.width - Number(button.style.getPropertyValue("--w")) * r.width / 724) < 0.1,
                size + " boîte du bouton modifiée " + b.width + " attendu " + Number(button.style.getPropertyValue("--w")) * r.width / 724);
              const style = getComputedStyle(button);
              check(style.backgroundColor === "rgba(0, 0, 0, 0)" && style.borderTopWidth === "0px" && style.opacity === "1",
                size + " décoration de bouton inattendue");
            }
            for (const button of bar.presetButtons) {
              const b = button.getBoundingClientRect();
              check(!button.disabled && button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)),
                size + " preset inaccessible");
              const active = button.dataset.co2prismPreset === "2";
              check(button.getAttribute("aria-pressed") === String(active), size + " sélection preset");
              check(!active || getComputedStyle(button).boxShadow !== "none", size + " sélection invisible");
              check(Math.abs(b.width - 47 * r.width / 724) < 0.1 && Math.abs(b.height - 47 * r.width / 724) < 0.1,
                size + " géométrie preset modifiée");
            }
            for (const nodes of Object.values(bar.gauges)) {
              const g = nodes.fill.getBoundingClientRect();
              check(document.elementFromPoint(g.right - 2, g.y + g.height / 2) === nodes.fill, size + " jauge inaccessible");
            }
            bar.position = { x: innerWidth + 200, y: innerHeight + 200 }; bar.layout();
            const bounded = root.getBoundingClientRect();
            check(bounded.right <= innerWidth + 0.1 && bounded.bottom <= innerHeight + 0.1, size + " hors écran");
            check(settings.position.x === bounded.left && settings.position.y === bounded.top, size + " correction non sauvegardée");
            bar.position = settings.position; bar.layout();
            check(Math.abs(root.getBoundingClientRect().left - bounded.left) < 0.1, size + " restauration");
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
            check(Math.abs(r.width - width * 892 / 724) < 0.1 && Math.abs(r.height - width * 806 / 724) < 0.1,
              size + " dimensions volet");
            check(document.elementFromPoint(r.x + 1, r.y + 1)?.id === "board", size + " coin transparent volet");
            check(document.elementFromPoint(r.x + 1, r.bottom - 10)?.id === "board", size + " sous le volet");
            for (const { key, button, value, count } of bar.skillNodes) {
              const b = button.getBoundingClientRect();
              check(button === document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2), size + " losange inaccessible " + key);
              check(Math.abs(b.width - width * 160 / 724) < 0.1, size + " taille losange");
              check(b.x >= r.x - 0.1 && b.y >= r.y - 0.1 && b.right <= r.right + 0.1 && b.bottom <= r.bottom + 0.1,
                size + " losange hors conteneur");
              for (const child of button.children) {
                const c = child.getBoundingClientRect();
                check(c.x >= b.x && c.right <= b.right && c.y >= b.y && c.bottom <= b.bottom, size + " texte déborde");
              }
              check(value.textContent.startsWith(key === "agi" ? "-" : "+"), size + " signe");
              check(count.textContent === (key === "for" ? "(2)" : "(0)"), size + " compte");
              if (key === "for") check(button.title.includes("Escalade") && button.title.includes("En montagne")
                && !button.title.includes("<img") && !globalThis.co2prismInjected, "Description dangereuse");
              button.click(); await new Promise(resolve => setTimeout(resolve, 0));
              check(calls.at(-1) === "skill:" + key, size + " mauvais jet");
            }
            bar.skillsToggle.click(); await bar.configWrites.get(actor);
            check(bar.skillsPanel.hidden, size + " fermeture");
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
            root.querySelector('[data-co2prism-preset="1"]').click(); await bar.configWrites.get(actor);
            const r = root.getBoundingClientRect(), after = bar.portrait.getBoundingClientRect();
            combatDimensions.push({ size, width: r.width, height: r.height });
            check(!bar.combatPanel.hidden && actor.flags.co2prism.activePreset === 1, size + " Combat fermé");
            check(Math.abs(r.width - width * 1381 / 724) < 0.1, size + " étendue Combat");
            check(Math.abs(before.x - after.x) < 0.1 && Math.abs(before.y - after.y) < 0.1, size + " base déplacée par Combat");
            check(bar.combatValues.meters.textContent === "20 / 20" && bar.combatValues.cells.textContent === "10 / 10"
              && bar.combatValues.def.textContent === "15" && bar.combatValues.dr.textContent === "4", "Valeurs Combat");
            const slots = [...root.querySelectorAll(".co2prism-combat-slot")];
            check(slots.length === 4, "Nombre de cases");
            check(slots[0].dataset.co2prismHand === "left" && slots[1].dataset.co2prismHand === "right", "Convention des mains");
            const firstY = slots[0].getBoundingClientRect().y, secondY = slots[3].getBoundingClientRect().y;
            check(slots.slice(0, 3).every(slot => slot.getBoundingClientRect().y === firstY)
              && slots.slice(3).every(slot => slot.getBoundingClientRect().y === secondY) && secondY > firstY, "Disposition 5/3");
            check(bar.combatEffects.children.length === 1 && bar.combatEffects.firstElementChild.title === "Native effect", "Effets réels");
            const count = calls.length, original = JSON.stringify(actor.system);
            for (const node of [...slots, ...root.querySelectorAll(".co2prism-defense-control")]) {
              node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
              node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 }));
            }
            check(calls.length === count && JSON.stringify(actor.system) === original, "Commande Combat exécutée");
            check([...root.querySelectorAll(".co2prism-time")].map(node => node.textContent).join(",") === "L,A,M,AM", "Ordre des temps");
            check(bar.budgetCommands.map(node => node.parentElement.style.getPropertyValue('--x')).join(',') === '6,61,116,171', size + ' visual command order');
            check(bar.budgetCommands.every(node => Math.abs(node.getBoundingClientRect().height - 47 * width / 724) < 1), size + ' command dimensions');
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
            const combined = root.getBoundingClientRect();
            check(document.elementFromPoint(combined.x + 2, combined.y + 2)?.id === "board", size + " coin transparent Combat");
            bar.skillsToggle.click(); await bar.configWrites.get(actor);
            root.querySelector('[data-co2prism-preset="1"]').click(); await bar.configWrites.get(actor);
          }
          result.combatDimensions = combatDimensions;
          // Ouverture au bord droit : déplacer Prism, sans retour arbitraire au repli.
          settings.size = "M"; bar.position = { x: innerWidth - 432, y: 400 }; bar.layout();
          const edgeBefore = bar.portrait.getBoundingClientRect();
          await bar.selectCombatPreset(1);
          const edgeOpen = bar.portrait.getBoundingClientRect();
          check(root.getBoundingClientRect().right <= innerWidth + 0.1 && edgeOpen.x < edgeBefore.x, "Combat hors écran au dépliage");
          await bar.selectCombatPreset(1);
          check(Math.abs(bar.portrait.getBoundingClientRect().x - edgeOpen.x) < 0.1, "Saut arbitraire au repli");
          await bar.setPanelState("competences", true);
          bar.position = { x: innerWidth - 432, y: 400 }; bar.layout();
          await bar.selectCombatPreset(1);
          check(!bar.skillsPanel.hidden && !bar.combatPanel.hidden && root.getBoundingClientRect().right <= innerWidth + 0.1,
            "Combat hors écran avec Compétences");
          const item = { id: "owned", uuid: "Actor.test.Item.owned", name: "Support natif", type: "capacity", parent: actor,
            system: { description: "<b>Description native</b>", hasFrequency: true, frequency: "daily", charges: { current: 3 } },
            testUserPermission: () => true };
          const nativeAction = { source: item.uuid, indice: 0, actionName: "Action réelle",
            actionImg: "file:///F:/FVTT_V14/public/icons/svg/shield.svg", iconFA: "fas fa-sword", actionTypeFinal: "f",
            type: "melee", properties: { temporary: false, enabled: false, activable: true }, autoAttack: false, hasResolversWithDomage: true,
            hasCharges: true, charges: 3, manaCost: 2 };
          item.actions = [nativeAction]; actor.items = new Map([[item.id, item]]);
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
          const lengths = () => bar.combatRows.map(row => row.children.length).join(",");
          const dropAt = async (row, index, data = payload) => {
            const transfer = new DataTransfer(); transfer.setData("text/plain", JSON.stringify(data));
            document.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
            const target = bar.combatRows[row - 1].children[index];
            target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
            if (data === payload) check(target.classList.contains("co2prism-drop-target"), "Cible valide non indiquée");
            target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
            await bar.configWrites.get(actor); await Promise.resolve();
            document.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
          };
          check(lengths() === "3,1", "Preset vide différent de 3/1");
          await dropAt(1, 0); await dropAt(1, 1);
          check(lengths() === "3,1", "Les mains font croître la ligne");
          const occupied = bar.combatRows[0].children[0];
          check(occupied.querySelector("img").src === nativeAction.actionImg && occupied.title.includes("Description native"), "Image ou description copiée incorrectement");
          check(occupied.querySelector(".co2prism-slot-time").textContent === "G"
            && occupied.querySelector(".co2prism-slot-uses").textContent.trim() === "3"
            && occupied.querySelector(".co2prism-slot-cost").textContent.trim() === "2", "Décorations natives");
          const executeFlags = JSON.stringify(actor.flags);
          const clickShortcut = async modifiers => {
            bar.combatRows[0].children[0].dispatchEvent(new MouseEvent("click", {
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
          check(bar.combatRows[0].children[0].querySelector(".co2prism-slot-uses").textContent.trim() === "2"
            && bar.gauges.mana.text.textContent === "17 / 18"
            && bar.combatRows[0].children[0].getAttribute("aria-pressed") === "true", "Rafraîchissement après action natif absent");
          let countCalls = shortcutCalls.length;
          nativeAction.hasResolversWithDomage = false; await clickShortcut({ altKey: true });
          check(shortcutCalls.length === countCalls, "Alt sans dommages a exécuté une action");
          nativeAction.properties.temporary = true; await clickShortcut({});
          check(shortcutCalls.at(-1)[0] === "activateAction" && shortcutCalls.at(-1)[1].state === false
            && shortcutCalls.at(-1)[1].type === undefined, "Action temporaire active non désactivée nativement");
          check(!bar.combatRows[0].children[0].classList.contains("co2prism-action-active"), "Effet actif conservé après désactivation");
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
          bar.combatRows[0].children[0].click(); bar.combatRows[0].children[0].click();
          check(shortcutCalls.length === countCalls + 1 && bar.combatRows[0].children[0].getAttribute("aria-disabled") === "true",
            "Clic pendant une opération en cours");
          complete(); await new Promise(resolve => setTimeout(resolve, 0));
          game.system.api.macros.useAction = nativeUseAction;
          await dropAt(1, 2); check(lengths() === "4,1", "Croissance ligne 1 incorrecte");
          await dropAt(2, 0); check(lengths() === "4,2", "Croissance ligne 2 incorrecte");
          // Même modèle natif dans plusieurs cases, lignes et presets.
          Object.assign(nativeAction.properties, { activable: true, temporary: true, enabled: false });
          hooks.get("updateItem")(item, { "system.actions": [] });
          const toggleFlags = JSON.stringify(actor.flags);
          await clickShortcut({});
          check(nativeAction.properties.enabled && root.querySelectorAll(".co2prism-action-active").length === 4,
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
              check(getComputedStyle(node, "::after").boxShadow !== "none" && getComputedStyle(node.querySelector("img")).filter === "brightness(1.08)",
                size + " contour/éclaircissement absent");
              check(Number(getComputedStyle(node.querySelector(".co2prism-slot-cost")).zIndex) > Number(getComputedStyle(node, "::after").zIndex),
                size + " contour masque les indicateurs");
            }
          }
          check(JSON.stringify(actor.flags) === toggleFlags, "État actif écrit dans les flags Prism");
          const toggleReference = bar.shortcutFromDrop(actor, payload);
          for (const preset of [2, 3]) {
            await bar.saveShortcut(actor, preset, bar.slotRows(actor, preset)[0][0], toggleReference);
            await bar.selectCombatPreset(preset);
            check(root.querySelectorAll(".co2prism-action-active").length === 1, "État actif différent selon le preset");
          }
          nativeAction.properties.enabled = false; hooks.get("updateItem")(item, { "system.actions": [] });
          check(!root.querySelector(".co2prism-action-active"), "Changement depuis feuille non synchronisé");
          await bar.selectCombatPreset(1);
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
          check(JSON.stringify(actor.flags) === invalidBefore && lengths() === "4,2" && warnings.length > 0, "Drop invalide accepté");
          const executeBefore = calls.length;
          const staleBefore = shortcutCalls.length;
          for (const type of ["click", "contextmenu"]) occupied.dispatchEvent(new MouseEvent(type, { bubbles: true, ctrlKey: true }));
          check(calls.length === executeBefore && shortcutCalls.length === staleBefore, "Ancien carré exécuté");
          nativeAction.actionName = "Action modifiée"; nativeAction.charges = 0; nativeAction.hasCharges = false; item.system.charges.current = 0;
          bar.refreshActor();
          check(bar.combatRows[0].children[0].title.includes("Action modifiée")
            && bar.combatRows[0].children[0].querySelector(".co2prism-slot-uses").textContent.trim() === "0", "Données non actualisées");
          const removedSlots = structuredClone(actor.flags.co2prism.presets[1].slots);
          actor.items.delete(item.id); bar.refreshActor(); await bar.configWrites.get(actor);
          check(lengths() === "3,1" && Object.keys(actor.flags.co2prism.presets[1].slots).length === 0, "Raccourcis supprimés non nettoyés");
          actor.flags.co2prism.presets[1].slots = removedSlots;
          actor.items.set(item.id, item); bar.refreshActor();
          await bar.selectCombatPreset(2); check(lengths() === "3,1", "Slots mélangés entre presets");
          await bar.selectCombatPreset(1); check(lengths() === "4,2", "Ordre non restauré");
          settings.size = "XL"; bar.layout();
          for (let index = 0; index < 12; index++) await dropAt(1, bar.combatRows[0].children.length - 1);
          check(lengths() === "16,2", "Limite arbitraire de cases");
          const row = bar.combatRows[0];
          row.scrollLeft = row.scrollWidth;
          const terminal = row.lastElementChild.getBoundingClientRect(), viewport = row.getBoundingClientRect();
          check(row.scrollWidth > row.clientWidth && terminal.right <= viewport.right + 1 && terminal.right > viewport.left, "Fin de ligne inaccessible");
          check(root.getBoundingClientRect().right <= innerWidth + 0.1, "Racine plus large que l'écran");
          check(document.elementFromPoint(innerWidth - 2, innerHeight - 2)?.id === "board", "Overlay après croissance");
          const savedPreset = JSON.stringify(actor.flags.co2prism.presets[1]);
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
              actor.flags.co2prism.presets[3] = { slots: {} };
              actor.flags.co2prism.activePreset = 3;
              actor.flags.co2prism.panels = { combat: true, competences: skills, equipements: false };
              settings.size = size; bar.refreshActor();
              bar.position = { x: 300, y: 350 }; bar.layout();
              const label = size + (skills ? " deux volets" : " Combat seul");
              check(lengths() === "3,1", label + " initialisation"); fullRows(label);
              await dropAt(2, 0); fullRows(label + " seconde ligne à deux cases");
              await dropAt(2, 1);
              check(lengths() === "3,3", label + " lignes égales"); fullRows(label + " lignes égales");
              bar.position = { x: innerWidth - width - 2, y: 350 }; bar.layout();
              const beforeGrowth = bar.portrait.getBoundingClientRect().x;
              const oldWidth = root.getBoundingClientRect().width;
              await dropAt(2, 2);
              check(lengths() === "3,4", label + " seconde ligne plus longue");
              fullRows(label + " seconde ligne plus longue");
              check(root.getBoundingClientRect().width > oldWidth, label + " volet non agrandi");
              check(bar.portrait.getBoundingClientRect().x < beforeGrowth, label + " croissance sans repositionnement");
              check(root.getBoundingClientRect().right <= innerWidth + 0.1, label + " hors écran");
              const origin1 = bar.combatRows[0].getBoundingClientRect().left;
              const origin2 = bar.combatRows[1].getBoundingClientRect().left;
              check(Math.abs(origin2 - origin1 - 209 * width / 724) < 0.1, label + " décalage modifié");
              await bar.setPanelState("combat", false);
              bar.position = { x: innerWidth - width - 2, y: 350 }; bar.layout();
              await bar.setPanelState("combat", true);
              fullRows(label + " réouverture");
              check(root.getBoundingClientRect().right <= innerWidth + 0.1, label + " réouverture hors écran");
            }
          }
          check(JSON.stringify(actor.flags.co2prism.presets[1]) === savedPreset, "Autre preset modifié par les tests de largeur");
          await bar.selectCombatPreset(2); check(lengths() === "3,1", "Dimensions fantômes après changement de preset");
          await bar.selectCombatPreset(3); check(lengths() === "3,4", "Seconde ligne non restaurée");
          fullRows("retour au preset");
          const originalToken = canvas.tokens.controlled[0];
          const other = { ...actor, uuid: "Actor.other", flags: { co2prism: { panels: { combat: true } } }, items: new Map() };
          canvas.tokens.controlled = [{ actor: other, document: { baseActor: other } }]; bar.refreshActor();
          check(lengths() === "3,1", "Cases de l'acteur précédent conservées"); fullRows("autre acteur");
          canvas.tokens.controlled = [originalToken]; bar.refreshActor();
          check(lengths() === "3,4", "Seconde ligne non restaurée après changement d'acteur"); fullRows("retour à l'acteur");
          result.restoredSlots = actor.flags.co2prism.presets[3].slots;
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
          actor.flags.co2prism.activePreset = 1; actor.flags.co2prism.panels.combat = true;
          actor.flags.co2prism.presets[1].slots = {}; settings.locked = false; bar.refreshActor();
          for (let i = 0; i < 3; i++) await dropAt(1, bar.combatRows[0].children.length - 1);
          const orderKeys = row => bar.slotRows()[row].filter(s => !s.hand && !s.terminal).map(s => s.key);
          const initialKeys = orderKeys(0);
          const move = async (sourceRow, sourceIndex, targetRow, targetIndex) => {
            const transfer = new DataTransfer(); const sourceNode = bar.combatRows[sourceRow].children[sourceIndex];
            sourceNode.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
            check(JSON.parse(transfer.getData('text/plain')).type === 'co2prism.shortcut', 'Internal drag payload');
            const target = bar.combatRows[targetRow].children[targetIndex];
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
          await dropAt(1, bar.combatRows[0].children.length - 1);
          check(orderKeys(0).length === 3, 'External drop after internal move');
          const deleteButton = bar.combatRows[0].children[2].querySelector('.co2prism-slot-remove');
          deleteButton.click(); await bar.configWrites.get(actor);
          check(orderKeys(0).length === 2 && actor.items.get(item.id) === item, 'Delete reference only');
          await dropAt(1, 0);
          check(!bar.combatRows[0].children[0].draggable, 'Hand draggable');
          bar.combatRows[0].children[0].querySelector('.co2prism-slot-remove').click(); await bar.configWrites.get(actor);
          check(!bar.slotRows()[0][0].reference && bar.combatRows[0].children.length === 5, 'Permanent hand removal');
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size; settings.locked = false; bar.refreshActor(); bar.layout();
            const widths = [...bar.combatRowWidths];
            check(root.querySelectorAll('.co2prism-slot-remove').length === 3, size + ' unlocked trash');
            settings.locked = true; bar.updateLock();
            check(lengths() === '4,1' && root.querySelectorAll('.co2prism-slot-remove').length === 0, size + ' locked visibility');
            check(bar.combatRowWidths[0] === widths[0] - 209 && bar.combatRowWidths[1] === widths[1] - 209, size + ' actual width shrink');
            check(!bar.combatRows[0].children[0].draggable, size + ' locked drag');
            check(bar.combatRows.every(r => r.scrollWidth <= r.clientWidth + 1), size + ' artificial scroll');
          }
          const lockedCalls = shortcutCalls.length;
          const lockedFlags = JSON.stringify(actor.flags);
          const lockedTransfer = new DataTransfer(); lockedTransfer.setData('text/plain', JSON.stringify(payload));
          const lockedNode = bar.combatRows[0].children[2];
          const lockedHover = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: lockedTransfer });
          lockedNode.dispatchEvent(lockedHover);
          check(!lockedHover.defaultPrevented && !lockedNode.classList.contains('co2prism-drop-target'), 'Locked hover accepted');
          lockedNode.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: lockedTransfer }));
          await Promise.resolve();
          check(JSON.stringify(actor.flags) === lockedFlags, 'Locked external drop wrote flags');
          item.system.charges.current = 2;
          bar.combatRows[0].children[2].click(); await new Promise(resolve => setTimeout(resolve, 0));
          check(shortcutCalls.length > lockedCalls, 'Locked execution blocked');
          item.system.charges.current = 0; item.system.frequency = 'daily'; nativeAction.properties.noChargesUsed = false;
          hooks.get('updateItem')(item, {});
          const exhausted = bar.combatRows[0].children[2];
          check(exhausted.classList.contains('co2prism-action-exhausted') && exhausted.querySelector('.fa-sun'), 'Daily zero exhausted');
          item.system.frequency = 'combat'; hooks.get('updateItem')(item, {});
          check(bar.combatRows[0].children[2].querySelector('.fa-swords'), 'Combat icon');
          item.type = 'equipment'; item.system.subtype = 'consumable'; item.system.quantity = { current: 0 }; nativeAction.type = 'consumable';
          hooks.get('updateItem')(item, {});
          check(bar.combatRows[0].children[2].querySelector('.fa-sack') && bar.combatRows[0].children[2].classList.contains('co2prism-action-exhausted'), 'Quantity zero');
          item.system.quantity.current = 2; hooks.get('updateItem')(item, {});
          check(!bar.combatRows[0].children[2].classList.contains('co2prism-action-exhausted'), 'Quantity refresh');
          delete item.system.quantity; hooks.get('updateItem')(item, {});
          check(!bar.combatRows[0].children[2].querySelector('.co2prism-slot-uses'), 'Missing quantity shown');
          // Une résolution de consommation en seconde position suffit, même hors sous-type consommable.
          item.system.subtype = 'misc'; item.system.properties = { reloadable: true };
          item.system.charges.current = 8; item.system.quantity = { current: 3, destroyIfEmpty: false };
          nativeAction.type = 'heal'; nativeAction.properties.temporary = false;
          nativeAction.resolvers = [{ type: 'heal' }, { type: 'consumable' }];
          hooks.get('updateItem')(item, {});
          const consumedCard = () => bar.combatRows[0].children[2];
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
          check(consumedCard().getAttribute('aria-disabled') === 'true' && consumedCard().title.includes('ConditionsUnavailable'), 'Condition accessibility');
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
          bar.refreshActor(); await Promise.resolve();
          nativeAction.isVisible = async () => true;
          await bar.selectCombatPreset(2); await new Promise(resolve => setTimeout(resolve, 0));
          for (const resolve of completions) resolve(false);
          await new Promise(resolve => setTimeout(resolve, 0));
          check(!root.querySelector('.co2prism-condition-unavailable'), 'Late condition applied to new preset');
          await bar.selectCombatPreset(1); await new Promise(resolve => setTimeout(resolve, 0));
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
          check(!actor.items.has(item.id) && bar.combatRows[0].children.length === 2 && bar.combatRows[1].children.length === 0, 'Destroyed Item reference removed');
          check(Object.keys(actor.flags.co2prism.presets[1].slots).length === 0, 'Destroyed references persisted');
          game.system.api.macros.useAction = previousUse;
          // Matrice mains vides/occupées : mêmes positions, aucune écriture au verrouillage.
          actor.items.set(item.id, item); item.system.quantity.current = 3;
          const handReference = Object.values(removedSlots)[0];
          for (const preset of [1, 2, 3]) for (const size of ['S', 'M', 'L', 'XL']) {
            for (const occupiedHands of [[], ['left-hand'], ['right-hand'], ['left-hand', 'right-hand']]) {
              actor.flags.co2prism.activePreset = preset;
              const slots = {
                'ordinary-first': { ...handReference, row: 1, order: 0, hand: null },
                'ordinary-second': { ...handReference, row: 2, order: 0, hand: null }
              };
              for (const key of occupiedHands) slots[key] = { ...handReference, row: 1, hand: key.split('-')[0] };
              actor.flags.co2prism.presets[preset] = { slots };
              settings.size = size; settings.locked = false; bar.refreshActor(); bar.layout();
              const flags = JSON.stringify(actor.flags);
              const before = [...bar.combatRows[0].children].slice(0, 3).map(node => node.getBoundingClientRect());
              settings.locked = true; bar.updateLock();
              check(lengths() === '3,1', size + ' reserved hand count');
              check(root.querySelectorAll('.co2prism-hand-empty').length === 2 - occupiedHands.length, size + ' hand placeholder count');
              [...bar.combatRows[0].children].forEach((node, index) => {
                const rect = node.getBoundingClientRect();
                check(['left', 'top', 'width', 'height'].every(key => Math.abs(rect[key] - before[index][key]) < 1), size + ' hand position changed');
                if (index >= 2) return;
                if (occupiedHands.includes(index === 0 ? 'left-hand' : 'right-hand')) {
                  check(node.classList.contains('co2prism-slot-executable') && !node.classList.contains('co2prism-hand-empty'), 'Occupied hand hidden');
                } else {
                  const style = getComputedStyle(node), icon = node.querySelector('.fa-solid.fa-hand');
                  check(icon && Number(getComputedStyle(icon).opacity) < 1 && style.pointerEvents === 'none', 'Hand icon interactivity');
                  check(style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.borderLeftColor === 'rgba(0, 0, 0, 0)', 'Empty hand square visible');
                  check(!node.draggable && !node.querySelector('.co2prism-slot-remove, .co2prism-slot-empty, .co2prism-slot-hand'), 'Empty hand controls');
                  const callCount = shortcutCalls.length;
                  node.click(); node.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: lockedTransfer }));
                  check(shortcutCalls.length === callCount, 'Empty hand action');
                }
              });
              check(bar.combatRows.every(row => row.scrollWidth <= row.clientWidth + 1), size + ' placeholder artificial scroll');
              settings.locked = false; bar.updateLock();
              check(lengths() === '4,2' && !root.querySelector('.co2prism-hand-empty'), 'Unlock hand slots');
              check(JSON.stringify(actor.flags) === flags, 'Visual hand placeholder wrote flags');
            }
          }
          const economy = new ActionEconomy(actor);
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
            for (const node of [root.querySelector('[data-co2prism-time="am"]'), ...bar.budgetBar.querySelectorAll('.co2prism-time-mixed')]) {
              const red = getComputedStyle(node, '::after');
              check(red.clipPath === 'polygon(25% 0px, 75% 100%, 25% 100%, 0px 50%)' && red.backgroundColor === 'rgb(237, 21, 32)', 'AM red lower-left polygon');
              const blue = node.matches('button') ? getComputedStyle(node, '::before') : getComputedStyle(node);
              check(blue.backgroundColor === 'rgb(37, 170, 225)' && blue.backgroundImage === 'none', 'AM solid upper-right blue');
              check(!node.textContent.includes('A+M') && node.textContent.includes('AM'), 'AM text');
            }
          };
          const movement = (meters, cells) => check(bar.combatValues.meters.textContent === meters && bar.combatValues.cells.textContent === cells, 'Budget movement ' + meters + ' / ' + cells);
          settings.locked = true; bar.updateLock(); canvas.scene.grid = { type: 1, distance: 2, units: 'm' };
          await resetBudget(); movement('20 / 20', '10 / 10');
          check(halos() === 'l,a,m', 'Initial availability halos'); mixedGeometry();
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
          check(economy.getSnapshot().bonus.am === 1 && halos() === 'l,a,m', 'AM right bonus or halo');
          await resetBudget();
          check(budgetTypes() === 'l,m,am' && bar.budgetBar.querySelector('.co2prism-time-separator'), 'Initial alternative');
          check([...bar.budgetBar.children].every(node => node.getBoundingClientRect().right <= bar.budgetBar.getBoundingClientRect().right + 1), 'Initial budget contents clipped');
          await command('a'); movement('10 / 20', '5 / 10'); check(budgetTypes() === 'm', 'Normal A branch');
          check(halos() === 'm', 'A spend halo');
          await resetBudget(); await command('m'); movement('10 / 20', '5 / 10'); check(budgetTypes() === 'am', 'Normal M branch');
          check(halos() === 'a,m', 'M spend polyvalent halos');
          await command('m'); movement('0 / 20', '0 / 10');
          const emptyBudget = JSON.stringify(actor.flags.co2prism.actionEconomy), warningCount = warnings.length;
          await command('m'); await command('m');
          check(JSON.stringify(actor.flags.co2prism.actionEconomy) === emptyBudget && warnings.length === warningCount, 'Impossible spend mutated or spammed');
          check(bar.budgetCommands.every(button => !button.disabled) && bar.budgetCommands.find(button => button.dataset.co2prismTime === 'm').title.includes('Aucun temps compatible'), 'Spent command disabled');
          await resetBudget(); await command('l'); movement('0 / 20', '0 / 10');
          check(halos() === '', 'Limited spend halos');
          await command('a', true); check(halos() === 'a', 'A bonus restores halo');
          await command('am', true); check(halos() === 'a,m', 'AM bonus restores specialized halos');
          await resetBudget(); await command('m', true); movement('30 / 30', '15 / 15');
          await command('m'); movement('20 / 30', '10 / 15'); check(economy.getSnapshot().branch === 'undecided', 'Bonus M priority');
          await resetBudget(); await command('a', true); movement('20 / 20', '10 / 10');
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
          await command('m', true); await command('l'); movement('10 / 30', '5 / 15');
          canvas.scene.grid.distance = 5; hooks.get('updateScene')(canvas.scene, { grid: {} }); movement('10 / 30', '2 / 6');
          const scene = canvas.scene; canvas.scene = undefined; bar.refreshActor(); movement('10 / 30', 'CO2PRISM.Unavailable'); canvas.scene = scene;
          await resetBudget(); movement('20 / 20', '4 / 4');
          const persistedBudget = JSON.stringify(actor.flags.co2prism.actionEconomy);
          for (const preset of [1, 2, 3]) { await bar.selectCombatPreset(preset); if (bar.combatPanel.hidden) await bar.selectCombatPreset(preset); }
          check(JSON.stringify(actor.flags.co2prism.actionEconomy) === persistedBudget, 'Preset reset economy');
          const shortcutBudget = JSON.stringify(economy.getSnapshot());
          bar.combatRows[0].children[0].click(); await new Promise(resolve => setTimeout(resolve, 0));
          check(JSON.stringify(economy.getSnapshot()) === shortcutBudget, 'Free shortcut spent time');
          actor.testUserPermission = (_, level) => level === 'OBSERVER'; bar.refreshActor();
          check(bar.budgetCommands.every(button => button.disabled) && bar.budgetReset.disabled, 'Observer budget writable');
          check(halos() === '', 'Observer spending halo');
          check(await bar.changeEconomy('grant', 'm') === false, 'Observer command accepted');
          actor.testUserPermission = () => true; bar.refreshActor();
          // Débordement maîtrisé du cadre, puis retour au budget initial.
          await economy.grant('m', 16); bar.refreshActor();
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size; bar.position = { x: innerWidth - 300, y: 300 }; bar.layout();
            check(root.getBoundingClientRect().right <= innerWidth + 1, size + ' budget outside viewport');
            if (bar.budgetScroll.scrollWidth <= bar.budgetScroll.clientWidth + 1) {
              check(bar.budgetReset.getBoundingClientRect().right <= bar.budgetScroll.getBoundingClientRect().right + 1, size + ' reset clipped');
            } else {
              bar.budgetScroll.scrollLeft = bar.budgetScroll.scrollWidth;
              check(bar.budgetReset.getBoundingClientRect().right <= bar.budgetScroll.getBoundingClientRect().right + 1, size + ' budget end inaccessible');
            }
          }
          await resetBudget();
          // Exécution payante : le wrapper ne retourne rien, les hooks natifs confirment.
          nativeAction.actionTypeFinal = 'm'; nativeAction.type = 'heal';
          nativeAction.properties.temporary = false; nativeAction.properties.activable = true;
          let nativeOutcome = true, nativeExecutions = 0;
          const activateTimed = async options => {
            check(halos() === '', 'Spending halo during native execution');
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
            await paidClick(); movement('20 / 30', '4 / 6');
            check(halos() === 'l,a,m', size + ' automatic bonus spend halos');
            check(economy.getSnapshot().branch === 'undecided', size + ' timed M bonus priority');
            await paidClick(); movement('10 / 30', '2 / 6');
            check(halos() === 'a,m', size + ' automatic normal M spend halos');
            await paidClick(); movement('0 / 30', '0 / 6');
            check(halos() === '', size + ' automatic exhaustion halos');
            const exhausted = bar.combatRows[0].querySelector('.co2prism-slot-executable');
            check(exhausted.classList.contains('co2prism-time-insufficient') && getComputedStyle(exhausted).pointerEvents !== 'none'
              && exhausted.getAttribute('aria-disabled') === 'false', size + ' time restriction must remain clickable');
            const executions = nativeExecutions; await paidClick();
            check(nativeExecutions === executions, size + ' exhausted budget executed');
          }
          await resetBudget(); nativeAction.actionTypeFinal = 'a'; nativeOutcome = false;
          await paidClick(); movement('20 / 20', '4 / 4');
          nativeOutcome = true; await paidClick(); movement('10 / 20', '2 / 4');
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
            check(halos() === 'l,a,m', size + ' halo after reset');
            const viewport = bar.budgetScroll.getBoundingClientRect();
            const scale = parseFloat(root.style.getPropertyValue('--co2prism-unit'));
            for (const button of bar.budgetCommands) {
              const rect = button.getBoundingClientRect(), wrapper = button.parentElement;
              check(Math.abs(wrapper.getBoundingClientRect().width - rect.width) < 1, size + ' halo wrapper geometry');
              check(rect.top - viewport.top >= 8 * scale - 1 && viewport.bottom - rect.bottom >= 8 * scale - 1, size + ' halo clipped vertically');
              check(getComputedStyle(wrapper).pointerEvents === 'none', size + ' halo hit surface');
              const hit = document.elementFromPoint(rect.left + scale, rect.top + scale);
              check(!button.contains(hit), size + ' hexagon corner interactive');
              check(button.dataset.co2prismTime === 'am' ? getComputedStyle(wrapper).filter === 'none' : getComputedStyle(wrapper).filter.includes('drop-shadow'), size + ' silhouette halo');
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
              movement(enabled ? '0 / 20' : '10', enabled ? '0 / 4' : '2');
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
              movement('20 / 30', mode === 'down' ? '6 / 10' : '7 / 10');
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
          const movementButton = root.querySelector('.co2prism-movement-toggle');
          const movementPanel = root.querySelector('#co2prism-movement-panel');
          const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
          for (const size of ['S', 'M', 'L', 'XL']) {
            for (const enabled of [true, false]) {
              settings.size = size; settings.economyMode = enabled ? 'always' : 'off';
              actor.flags.co2prism.panels.competences = false;
              bar.refreshActor();
              for (const position of [{ x: 0, y: 0 }, { x: innerWidth - 5, y: innerHeight - 5 }]) {
                bar.position = position; bar.layout();
                const bounds = root.getBoundingClientRect(), name = bar.name.getBoundingClientRect();
                const portrait = bar.portrait.getBoundingClientRect(), star = root.querySelector('[data-co2prism-action="sheet"]').getBoundingClientRect();
                const toggle = movementButton.getBoundingClientRect(), preset = bar.presetButtons[0].getBoundingClientRect();
                const first = bar.combatRows[0].getBoundingClientRect(), second = bar.combatRows[1].getBoundingClientRect();
                const effects = bar.combatEffects.getBoundingClientRect();
                check(bounds.left >= -0.1 && bounds.top >= -0.1 && bounds.right <= innerWidth + 0.1 && bounds.bottom <= innerHeight + 0.1, size + ' 15A screen bounds');
                check(name.top > star.bottom && name.bottom <= bounds.bottom + 0.1 && Math.abs(name.left + name.width / 2 - portrait.left - portrait.width / 2) < 1, size + ' 15A name axis');
                check(bar.name.title === actor.name && getComputedStyle(bar.name).textOverflow === 'ellipsis', size + ' 15A long name');
                check(toggle.bottom < preset.top && movementButton.disabled && toggle.width > 0, size + ' 15A movement command');
                check(movementPanel.hidden && movementPanel.getClientRects().length === 0, size + ' 15A closed movement panel');
                check(effects.top > second.bottom && !intersects(effects, name) && bar.combatEffects.children.length === 80, size + ' 15A effects position');
                bar.combatEffects.scrollLeft = bar.combatEffects.scrollWidth;
                const last = bar.combatEffects.lastElementChild.getBoundingClientRect();
                check(last.right <= effects.right + 1 && last.right > effects.left, size + ' 15A effects accessible');
                const image = bar.combatEffects.lastElementChild.querySelector('img').getBoundingClientRect();
                check(image.top >= effects.top - 0.1 && image.bottom <= effects.bottom + 0.1, size + ' 15A effect image clipped ' + JSON.stringify({ top: image.top, bottom: image.bottom, areaTop: effects.top, areaBottom: effects.bottom }));
                if (enabled) {
                  const budget = bar.budgetScroll.getBoundingClientRect();
                  check(budget.bottom < first.top && budget.top >= bounds.top - 0.1 && !intersects(budget, toggle), size + ' 15A budget position');
                } else check(bar.budgetScroll.getClientRects().length === 0 && bar.panelOffset.y === 0, size + ' 15A hidden budget space');
                for (const row of bar.combatRows) check(!intersects(row.getBoundingClientRect(), toggle), size + ' 15A row collision');
                const flags = JSON.stringify(actor.flags);
                movementButton.click();
                check(JSON.stringify(actor.flags) === flags, size + ' 15A inactive movement changed flags');
                const clearX = bounds.left + 2, clearY = bounds.bottom - 2;
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
          check(!movementButton.disabled, '15C eligible token');
          check(movementButton.textContent === 'Mouvement', 'Archive6 inactive movement label');
          trackedMove(2); trackedMove(3);
          check(movementPanel.hidden && !bar.movementTracker.getSnapshot(tracked).success
            && JSON.stringify(actor.flags.co2prism.actionEconomy) === previewFlag, 'Untracked native moves create no session or budget write');
          const trackedStart = tracked.x;
          movementButton.click();
          check(!movementPanel.hidden && movementButton.getAttribute('aria-pressed') === 'true', '15C session opened');
          check(movementPanel.querySelectorAll('input[type="radio"]').length === 0, 'No movement mode radios');
          check(bar.movementTracker.getSnapshot(tracked).state.mode === 'exact'
            && bar.movementTracker.getSnapshot(tracked).state.start.x === trackedStart, 'Exact session starts at current position');
          check(movementButton.textContent === 'Valider', 'Archive6 active validation label');
          check(movementPanel.querySelector('.co2prism-movement-zones-toggle').disabled
            && movementPanel.querySelector('.co2prism-movement-zones-status').textContent.includes('indisponibles'),
            'Zones prototype unavailable API leaves panel usable with diagnostic');
          trackedMove(7);
          const blocks = () => [...movementPanel.querySelectorAll('.co2prism-movement-block')];
          const grey = () => [...movementPanel.querySelectorAll('.co2prism-movement-cell')].reduce((sum, node) => sum + Number(node.dataset.used), 0);
          check(blocks().length === 5 && grey() === 7 && blocks().every(block => block.children.length === 5), '15C five blocks and seven grey cells');
          check(movementPanel.querySelector('.co2prism-movement-summary').textContent.includes('2 / 5'), '15C theoretical actions');
          check(blocks().slice(0, 3).every(node => Math.abs(node.getBoundingClientRect().top - blocks()[0].getBoundingClientRect().top) < 1)
            && blocks()[3].getBoundingClientRect().top > blocks()[0].getBoundingClientRect().top, '15C maximum three blocks per row');
          trackedMove(22);
          check(grey() === 25 && movementPanel.querySelectorAll('.co2prism-movement-cell').length === 25, '15C excess adds no cells');
          check(movementPanel.querySelector('.co2prism-movement-excess')?.textContent.includes('4 cases'), '15C immediate red excess');
          await economy.grant('am'); hooks.get('updateActor')(actor, { flags: {} });
          check(blocks().length === 6 && !movementPanel.querySelector('.co2prism-movement-excess'), '15C bonus updates capacity');
          await economy.spend('m'); hooks.get('updateActor')(actor, { flags: {} });
          check(blocks().length === 5 && movementPanel.querySelector('.co2prism-movement-excess'), '15C external spend updates capacity');
          settings.economyMode = 'off'; bar.refreshActor();
          check(blocks().length === 1 && !movementPanel.querySelector('.co2prism-movement-excess'), '15C inactive budget single block');
          settings.economyMode = 'always'; bar.refreshActor();
          const beforeReturn = JSON.stringify(actor.flags.co2prism.actionEconomy);
          failReturn = true; await bar.resetMovement();
          check(!movementPanel.querySelector('.co2prism-movement-error').hidden && grey() === 25, '15C return failure preserves path');
          failReturn = false; movementPanel.querySelector('.co2prism-movement-reset').click();
          await new Promise(resolve => setTimeout(resolve, 0));
          check(tracked.x === trackedStart && grey() === 0 && !movementPanel.hidden, 'Successful return keeps exact session');
          check(movementButton.textContent === 'Valider', 'Archive6 label after reset');
          check(JSON.stringify(actor.flags.co2prism.actionEconomy) === beforeReturn, '15C return did not mutate budget');
          const secondDocument = { ...tracked, id: 'second-token', uuid: 'Scene.s.Token.second', x: 500 };
          movementScene.tokens.set(secondDocument.id, secondDocument);
          canvas.tokens.controlled = [{ actor, document: secondDocument }]; hooks.get('controlToken')();
          check(movementPanel.hidden, '15C selection hides previous session');
          check(movementButton.textContent === 'Mouvement', 'Archive6 label after selection');
          movementButton.click(); trackedMove(1, secondDocument);
          canvas.tokens.controlled = [selectedToken]; hooks.get('controlToken')();
          check(!movementPanel.hidden && grey() === 0, '15C return selection restores own session');
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size; bar.position = { x: innerWidth - 1, y: 0 }; bar.layout();
            const bounds = root.getBoundingClientRect(), panel = movementPanel.getBoundingClientRect();
            const base = movementButton.getBoundingClientRect();
            check(bounds.right <= innerWidth + 1 && bounds.top >= -0.1 && bounds.bottom <= innerHeight + 1
              && panel.top >= -0.1 && panel.bottom < base.top, size + ' 15C panel bounds');
            const blankX = bounds.left + 2, blankY = panel.top + 2;
            check(document.elementFromPoint(blankX, blankY)?.id === 'board', size + ' 15C canvas remains accessible');
            const reset = movementPanel.querySelector('.co2prism-movement-reset'), rect = reset.getBoundingClientRect();
            check(reset.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)), size + ' movement reset clickable');
          }
          movementScene.grid.type = 0; hooks.get('updateScene')(movementScene, { grid: {} });
          check(movementPanel.querySelector('.co2prism-movement-summary').textContent.includes('indisponible') && blocks().length === 0, '15C gridless explicit');
          movementScene.grid.type = 1; hooks.get('updateScene')(movementScene, { grid: {} });
          const realHeight = innerHeight;
          Object.defineProperty(window, 'innerHeight', { value: 500, configurable: true });
          bar.layout();
          const smallPanel = movementPanel.getBoundingClientRect(), smallBounds = root.getBoundingClientRect();
          const smallReset = movementPanel.querySelector('.co2prism-movement-reset').getBoundingClientRect();
          check(smallPanel.height >= 60 && smallReset.bottom <= smallPanel.bottom && smallPanel.top >= -0.1
            && smallBounds.bottom <= 500.1, 'Small viewport keeps simplified panel and reset usable');
          Object.defineProperty(window, 'innerHeight', { value: realHeight, configurable: true }); bar.layout();
          trackedMove(11);
          const beforeFinish = JSON.stringify(actor.flags.co2prism.actionEconomy), destination = tracked.x;
          movementButton.click();
          check(movementButton.disabled && bar.movementReset.disabled, '15D controls locked during validation');
          await new Promise(resolve => setTimeout(resolve, 0));
          check(movementPanel.hidden && movementButton.getAttribute('aria-pressed') === 'false' && tracked.x === destination, '15D finish retains destination');
          check(movementButton.textContent === 'Mouvement', 'Archive6 label after finish');
          check(JSON.stringify(actor.flags.co2prism.actionEconomy) !== beforeFinish && economy.getSnapshot().movementsRemaining === 2
            && warnings.length === notificationCount, '15D exact validation spends three M without excess warning');
          movement('20 / 60', '10 / 30');
          // Comparer les blocs et le portrait sur des vitesses non entières.
          actor.system.attributes.movement = { value: 7.2, unit: 'm' };
          settings.movementRounding = 'nearest'; await economy.reset(); bar.refreshActor();
          movementButton.click(); trackedMove(7);
          check(blocks().map(block => Number(block.dataset.cells)).join(',') === '4,3', 'Archive6 variable blocks 4 plus 3');
          check(grey() === 7 && movementPanel.querySelectorAll('.co2prism-movement-cell').length === 7, 'Archive6 seven grey cumulative cells');
          movement('14.4 / 14.4', '7 / 7');
          await bar.toggleMovement();
          check(economy.getSnapshot().movementsRemaining === 0 && bar.movementResults.get(tracked).consumedCount === 2, 'Archive6 seven cells cost two M');
          actor.system.attributes.movement = { value: 10, unit: 'm' }; movementScene.grid.distance = 3;
          for (const mode of ['nearest', 'up', 'down']) {
            settings.movementRounding = mode; await economy.reset(); await economy.grant('m', 3); bar.refreshActor();
            movementButton.click();
            const expected = (mode === 'up' ? Math.ceil : mode === 'down' ? Math.floor : Math.round)(50 / 3);
            const total = [...movementPanel.querySelectorAll('.co2prism-movement-cell')].reduce((sum, cell) => sum + Number(cell.dataset.count), 0);
            check(total === expected && bar.combatValues.cells.textContent === expected + ' / ' + expected, 'Archive6 cumulative portrait and blocks ' + mode);
            trackedMove(7);
            check(grey() === 7, 'Archive6 grey cells across variable blocks ' + mode);
            settings.economyMode = 'off'; bar.refreshActor(); await bar.toggleMovement();
            settings.economyMode = 'always'; bar.refreshActor();
          }
          actor.system.attributes.movement = { value: 0.4, unit: 'm' }; movementScene.grid.distance = 2;
          settings.movementRounding = 'down'; await economy.reset(); bar.refreshActor(); movementButton.click(); trackedMove(1);
          check(blocks().map(block => Number(block.dataset.cells)).join(',') === '0,0'
            && movementPanel.querySelectorAll('.co2prism-movement-cell').length === 0, 'Archive6 zero-sized blocks have no fake squares');
          await economy.grant('m', 3); hooks.get('updateActor')(actor, { flags: {} });
          check(blocks().map(block => Number(block.dataset.cells)).join(',') === '0,0,0,0,1' && grey() === 1, 'Archive6 bonus reveals first attainable cell');
          movement('2 / 2', '1 / 1');
          await bar.toggleMovement();
          check(economy.getSnapshot().movementsRemaining === 0 && bar.movementResults.get(tracked).consumedCount === 5, 'Archive6 five actions for first cell');
          tracked.canUserModify = () => false; bar.refreshActor(); check(movementButton.disabled, '15C permission disables command');
          tracked.canUserModify = () => true;
          hooks.get('deleteToken')(secondDocument);
          check(!bar.movementTracker.getSnapshot(secondDocument).success, '15C deleted token cleanup');
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
      "--window-size=2400,1400", "--virtual-time-budget=4000",
      ...(process.env.CO2PRISM_SCREENSHOT ? [`--screenshot=${process.env.CO2PRISM_SCREENSHOT}`] : []),
      "--dump-dom", pathToFileURL(fixture).href], {
      encoding: "utf8", timeout: 25000, maxBuffer: 2000000, windowsHide: true
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
            flags: { co2prism: { activePreset: 3, panels: { combat: false, competences: true }, presets: { 3: { slots: persistedSlots } } } },
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
          await bar.selectCombatPreset(3);
          const root = document.getElementById("co2prism-bar"), scale = 430 / 724;
          const [first, second] = bar.combatRows;
          check(first.children.length === 3 && second.children.length === 4, "Restauration après relance du navigateur incorrecte");
          check((731 + bar.combatRowWidths[1]) * scale + bar.panelOffset.x > innerWidth,
            "Le manque de place n'est pas réel");
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
      `--user-data-dir=${join(directory, "profile-narrow")}`, "--window-size=1000,1400", "--virtual-time-budget=4000",
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
