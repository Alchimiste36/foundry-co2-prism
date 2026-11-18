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
    const nativePath = process.env.CO2PRISM_FOUNDRY_SCRIPT ?? "F:/FVTT_V14/public/scripts/foundry.mjs";
    const native = existsSync(nativePath) ? readFileSync(nativePath, "utf8") : "";
    const nativePart = (start, end) => native.slice(native.indexOf(start), native.indexOf(end));
    const nativeTooltips = native ? "const deepFreeze = Object.freeze;\n"
      + nativePart("const ALLOWED_HTML_TAGS", "const WORLD_JOIN_THEMES")
      + nativePart("function cleanHTML(raw,", "function saveDataToFile(")
      + nativePart("class TooltipManager {", "var _module$H")
      + "foundry.utils.cleanHTML = cleanHTML;\n" : "";
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
      Object.assign(budgetTranslations, ${JSON.stringify(Object.fromEntries(Object.entries(translations.CO2PRISM.Equipment.Operations).map(([key, value]) => [`CO2PRISM.Equipment.Operations.${key}`, value])))});
      budgetTranslations['CO2PRISM.Combat.Movement'] = ${JSON.stringify(translations.CO2PRISM.Combat.Movement)};
      const game = globalThis.game = { system: { id: "co2" }, user: {},
        settings: { get: (_, key) => settings[key], set: (_, key, value) => settings[key] = value },
        i18n: { localize: key => budgetTranslations[key] ?? key,
          format: (key, data) => (budgetTranslations[key] ?? key).replace(/\\{(\\w+)\\}/g, (_, name) => data[name]) } };
      let sequence = 0;
      const foundry = { utils: { cleanHTML: value => value, escapeHTML: value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]), deepClone: value => structuredClone(value), randomID: () => "test" + (++sequence) },
        applications: { api: { DialogV2: { confirm: async () => false, wait: async () => "validate" } }, handlebars: { renderTemplate: async () => ${JSON.stringify(markup)} } } };
      foundry.applications.ux = { TextEditor: { implementation: { async enrichHTML(description, options) {
        if (!options.relativeTo.id) throw new Error('Missing native Item context');
        return description;
      } } } };
      ${nativeTooltips}
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
          check(getComputedStyle(bar.combatToggle).color === "rgb(237, 21, 32)", "Poing actif rouge");
          bar.combatToggle.click(); await bar.configWrites.get(actor);
          check(bar.combatPanel.hidden && bar.combatToggle.getAttribute("aria-expanded") === "false",
            "Le poing doit refermer le combat");
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
            check(bar.presetButtons.every(button => !button.getClientRects().length), "Closed preset controls");
            for (const nodes of Object.values(bar.gauges)) {
              const g = nodes.fill.getBoundingClientRect();
              check(document.elementFromPoint(g.right - 2, g.y + g.height / 2) === nodes.fill, size + " jauge inaccessible");
            }
            const gauges = ["recovery", "fortune", "mana", "hp"].map(key => bar.gauges[key].fill.getBoundingClientRect());
            check(gauges.every((gauge, index) => !index || (gauge.top > gauges[index - 1].bottom
              && Math.abs(gauge.right - gauges[0].right) < 1)), size + " ordre ou alignement des jauges V.3");
            const backing = root.querySelector(".co2prism-gauge-back");
            const backingBounds = backing.getBoundingClientRect(), backingStyle = getComputedStyle(backing);
            check(backingBounds.top < gauges[0].top && backingBounds.bottom > gauges.at(-1).bottom
              && backingStyle.backgroundColor === "rgb(0, 0, 0)" && backingStyle.pointerEvents === "none",
              size + " fond noir continu derrière les jauges");
            for (const button of [bar.combatToggle, bar.skillsToggle]) {
              const b = button.getBoundingClientRect();
              check(button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)),
                size + " commande du noyau inaccessible " + button.className);
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
            check(Math.abs(r.width - width * 922 / 724) < 0.1 && Math.abs(r.height - width * 603 / 724) < 0.1,
              size + " dimensions volet");
            check(document.elementFromPoint(r.x + 1, r.y + 1)?.id === "board", size + " coin transparent volet");
            check(document.elementFromPoint(r.x + 1, r.bottom - 10)?.id === "board", size + " sous le volet");
            const panel = bar.skillsPanel.getBoundingClientRect();
            const unit = width / 724;
            check(Math.abs(panel.left - opened.left + 286 * unit) < 0.1
              && Math.abs(panel.top - opened.top - 251 * unit) < 0.1, size + " ancrage bas-gauche");
            const rows = [[], [], []];
            for (const { key, button, value, count } of bar.skillNodes) {
              const b = button.getBoundingClientRect();
              check(button === document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2), size + " losange inaccessible " + key);
              check(Math.abs(b.width - 128 * unit) < 0.1, size + " taille losange");
              rows[Math.round((b.top - panel.top) / (68 * unit))].push((b.left - panel.left) / unit);
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
            const stagger = rows.map(row => row.sort((a, b) => a - b).map(Math.round).join(",")).join("/");
            check(stagger === "68,204/0,136,272/68,204", size + " rangées en quinconce");
            const outer = bar.skillNodes.find(skill => skill.key === "con").button.getBoundingClientRect();
            bar.skillsToggle.click(); await bar.configWrites.get(actor);
            check(bar.skillsPanel.hidden, size + " fermeture");
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
            check(Math.abs(r.width - width * 1120 / 724) < 0.1, size + " étendue Combat");
            check(Math.abs(before.x - after.x) < 0.1 && Math.abs(before.y - after.y) < 0.1, size + " base déplacée par Combat");
            check(bar.combatValues.meters.textContent === "20" && bar.combatValues.cells.textContent === "10"
              && bar.combatValues.def.textContent === "15" && bar.combatValues.dr.textContent === "4", "Valeurs Combat");
            const slots = [...root.querySelectorAll(".co2prism-combat-slot")];
            check(slots.length === 4, "Nombre de cases");
            check(slots[0].dataset.co2prismHand === "left" && slots[1].dataset.co2prismHand === "right", "Convention des mains");
            const firstY = slots[0].getBoundingClientRect().y, secondY = slots[3].getBoundingClientRect().y;
            check(slots.slice(0, 3).every(slot => slot.getBoundingClientRect().y === firstY)
              && slots.slice(3).every(slot => slot.getBoundingClientRect().y === secondY) && secondY > firstY, "Alignement vertical des deux rangées");
            check(bar.combatEffects.children.length === 1 && bar.combatEffects.firstElementChild.dataset.tooltipHtml === "<strong>Native effect</strong>", "Effets réels");
            if (typeof TooltipManager !== "undefined" && !game.tooltip) {
              const saved = { applied: actor.appliedEffects, custom: actor.system.currentEffects, position: bar.position };
              actor.appliedEffects = [{ name: 'Protection <Mage>', img: "file:///F:/FVTT_V14/public/icons/svg/shield.svg",
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
              icon.dispatchEvent(new PointerEvent("pointerenter"));
              await new Promise(resolve => setTimeout(resolve, 550));
              check(manager.element === icon && tooltipElement.querySelector('em')?.textContent === 'Défense +2',
                'Native tooltip hover renders rich HTML');
              check(tooltipElement.textContent.includes('Protection <Mage>') && tooltipElement.textContent.includes('2 rounds'),
                'Native effect name and prepared duration');
              check(!tooltipElement.querySelector('[onerror], script') && !window.tooltipUnsafe, 'Native HTML sanitization');
              check(!icon.hasAttribute('title') && icon.getAttribute('aria-label') === 'Protection <Mage>'
                && icon.querySelector('img').alt === 'Protection <Mage>', 'No literal HTML title and accessible effect name');
              manager.activate(custom);
              check(tooltipElement.querySelectorAll('br').length >= 5 && tooltipElement.textContent.includes('par Bâton de Mage')
                && !tooltipElement.textContent.includes('<br'), 'CO2 tooltip HTML retained');
              for (const position of [{ x: 0, y: 0 }, { x: innerWidth, y: innerHeight }]) {
                bar.position = position; bar.layout(); manager.activate(icon);
                const bounds = tooltipElement.getBoundingClientRect();
                check(bounds.left >= -1 && bounds.top >= -1 && bounds.right <= innerWidth + 1
                  && bounds.bottom <= innerHeight + 1, 'Native effect tooltip stays inside screen');
              }
              bar.position = saved.position; bar.layout();
              const iconAfter = icon.getBoundingClientRect();
              check(Math.abs(iconBefore.width - iconAfter.width) < 1 && Math.abs(iconBefore.height - iconAfter.height) < 1,
                'Tooltips preserve icon dimensions');
              manager.deactivate(); tooltipElement.hidePopover();
              actor.appliedEffects = saved.applied; actor.system.currentEffects = saved.custom; bar.refreshActor();
            }
            const count = calls.length, original = JSON.stringify(actor.system);
            for (const node of [...slots, ...root.querySelectorAll(".co2prism-defense-control")]) {
              node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
              node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 }));
            }
            check(calls.length === count && JSON.stringify(actor.system) === original, "Commande Combat exécutée");
            check([...root.querySelectorAll(".co2prism-time")].map(node => node.textContent).join(",") === "L,A,M,AM", "Ordre des temps");
            const triangle = bar.timeCommands.getBoundingClientRect();
            const budget = bar.budgetScroll.getBoundingClientRect();
            const band = bar.budgetScroll.parentElement.getBoundingClientRect();
            const { left, right } = bar.combatHands;
            const [leftHand, rightHand] = [left, right].map(node => node.getBoundingClientRect());
            const presets = bar.presetButtons.map(node => node.getBoundingClientRect());
            const [firstRow, secondRow] = bar.combatRows.map(node => node.getBoundingClientRect());
            const stats = root.querySelector(".co2prism-combat-stats").getBoundingClientRect();
            check(budget.bottom < triangle.top && triangle.right < leftHand.left, size + " bande et triangle des actions");
            check(Math.abs((triangle.left - band.left) - (triangle.top - band.top)) < 0.1,
              size + " bande et triangle parallèles au portrait");
            check(!bar.budgetScroll.parentElement.contains(document.elementFromPoint(band.left + 1, band.bottom - 1)),
              size + " coin découpé de la bande");
            check(presets.every((preset, index) => preset.left > leftHand.right && preset.right < rightHand.left
              && (!index || preset.top > presets[index - 1].bottom)), size + " sélecteur entre les mains");
            check(firstRow.left > rightHand.right && Math.abs(firstRow.left - secondRow.left) < 1
              && Math.abs(firstRow.top - leftHand.top) < 1, size + " raccourcis à droite des mains");
            check(stats.left >= bar.name.getBoundingClientRect().right && Math.abs(stats.width - stats.height) < 1,
              size + " carré DEF/Mouvement");
            check(document.elementFromPoint(stats.left + stats.width / 2, stats.top + stats.height / 2)?.id === "board",
              size + " séparation transparente DEF/Mouvement");
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
            const combined = root.getBoundingClientRect();
            check(document.elementFromPoint(combined.x + 2, combined.y + 2)?.id === "board", size + " coin transparent Combat");
            bar.skillsToggle.click(); await bar.configWrites.get(actor);
            await bar.setPanelState('combat', false);
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
          check(lengths() === "3,1", "Preset vide différent de 3/1");
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
          check(lengths() === "3,1", "Item direct refusé dans les raccourcis");
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
          check(getComputedStyle(bar.presetButtons[0]).backgroundColor === "rgb(189, 24, 38)"
            && getComputedStyle(bar.presetButtons[0]).boxShadow !== "none", "Halo rouge du preset actif");
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
          check(lengths() === "3,1", "Les mains font croître la ligne");
          const occupied = cards(0)[0];
          check(occupied.querySelector("img").src === nativeAction.actionImg && occupied.title.includes("Description native"), "Image ou description copiée incorrectement");
          check(occupied.querySelector(".co2prism-slot-time").textContent === "G"
            && occupied.querySelector(".co2prism-slot-uses").textContent.trim() === "3"
            && occupied.querySelector(".co2prism-slot-cost").textContent.trim() === "2", "Décorations natives");
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
          check(shortcutCalls.length === countCalls + 1 && cards(0)[0].getAttribute("aria-disabled") === "true",
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
              check(getComputedStyle(node, "::after").boxShadow !== "none" && getComputedStyle(node.querySelector("img")).filter === "brightness(1.08)",
                size + " contour/éclaircissement absent");
              check(Number(getComputedStyle(node.querySelector(".co2prism-slot-cost")).zIndex) > Number(getComputedStyle(node, "::after").zIndex),
                size + " contour masque les indicateurs");
            }
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
          check(JSON.stringify(actor.flags) === invalidBefore && lengths() === "4,2" && warnings.length > 0, "Drop invalide accepté");
          const executeBefore = calls.length;
          const staleBefore = shortcutCalls.length;
          for (const type of ["click", "contextmenu"]) occupied.dispatchEvent(new MouseEvent(type, { bubbles: true, ctrlKey: true }));
          check(calls.length === executeBefore && shortcutCalls.length === staleBefore, "Ancien carré exécuté");
          nativeAction.actionName = "Action modifiée"; nativeAction.charges = 0; nativeAction.hasCharges = false; item.system.charges.current = 0;
          bar.refreshActor();
          check(cards(0)[0].title.includes("Action modifiée")
            && cards(0)[0].querySelector(".co2prism-slot-uses").textContent.trim() === "0", "Données non actualisées");
          const removedSlots = structuredClone(actor.flags.co2prism.shortcuts);
          actor.items.delete(item.id); bar.refreshActor(); await bar.configWrites.get(actor);
          check(lengths() === "3,1" && Object.keys(actor.flags.co2prism.shortcuts).length === 0, "Raccourcis supprimés non nettoyés");
          actor.flags.co2prism.shortcuts = removedSlots;
          actor.items.set(item.id, item); bar.refreshActor();
          await bar.setActivePreset(2); check(lengths() === "4,2", "Raccourcis communs au preset 2");
          await bar.setActivePreset(1); check(lengths() === "4,2", "Ordre non restauré");
          settings.size = "XL"; bar.layout();
          for (let index = 0; index < 12; index++) await dropAt(1, cards(0).length - 1);
          check(lengths() === "16,2", "Limite arbitraire de cases");
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
              check(Math.abs(origin2 - origin1) < 0.1, label + " décalage modifié");
              await bar.setPanelState("combat", false);
              bar.position = { x: innerWidth - width - 2, y: 350 }; bar.layout();
              await bar.setPanelState("combat", true);
              fullRows(label + " réouverture");
              check(root.getBoundingClientRect().right <= innerWidth + 0.1, label + " réouverture hors écran");
            }
          }
          check(JSON.stringify(actor.flags.co2prism.hands.presets[1]) === savedPreset, "Autre preset modifié par les tests de largeur");
          await bar.setActivePreset(2); check(lengths() === "3,4", "Raccourcis communs au preset 2");
          await bar.setActivePreset(3); check(lengths() === "3,4", "Seconde ligne non restaurée");
          fullRows("retour au preset");
          const originalToken = canvas.tokens.controlled[0];
          const other = { ...actor, uuid: "Actor.other", flags: { co2prism: { panels: { combat: true } } }, items: new Map() };
          canvas.tokens.controlled = [{ actor: other, document: { baseActor: other } }]; bar.refreshActor();
          check(lengths() === "3,1", "Cases de l'acteur précédent conservées"); fullRows("autre acteur");
          canvas.tokens.controlled = [originalToken]; bar.refreshActor();
          check(lengths() === "3,4", "Seconde ligne non restaurée après changement d'acteur"); fullRows("retour à l'acteur");
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
            const widths = [...bar.combatRowWidths];
            check(root.querySelectorAll('.co2prism-slot-remove').length === 3, size + ' unlocked trash');
            settings.locked = true; bar.updateLock();
            check(lengths() === '4,1' && root.querySelectorAll('.co2prism-slot-remove').length === 0, size + ' locked visibility');
            check(bar.combatRowWidths[0] === widths[0] - 180 && bar.combatRowWidths[1] === widths[1] - 180, size + ' actual width shrink');
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
          await bar.setActivePreset(2); await new Promise(resolve => setTimeout(resolve, 0));
          for (const resolve of completions) resolve(false);
          await new Promise(resolve => setTimeout(resolve, 0));
          check(!root.querySelector('.co2prism-condition-unavailable'), 'Late condition applied to new preset');
          await bar.setActivePreset(1); await new Promise(resolve => setTimeout(resolve, 0));
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
              const before = cards(0).slice(0, 3).map(node => node.getBoundingClientRect());
              settings.locked = true; bar.updateLock();
              check(lengths() === '3,1', size + ' reserved hand count');
              check(root.querySelectorAll('.co2prism-hand-empty').length === 2 - occupiedHands.length, size + ' hand placeholder count');
              cards(0).forEach((node, index) => {
                const rect = node.getBoundingClientRect();
                check(['left', 'top', 'width', 'height'].every(key => Math.abs(rect[key] - before[index][key]) < 1), size + ' hand position changed');
                if (index >= 2) return;
                const hand = index === 0 ? 'left' : 'right';
                const marker = node.querySelector('.co2prism-slot-hand.fa-hand');
                const markerStyle = marker && getComputedStyle(marker);
                const markerBounds = marker?.getBoundingClientRect();
                check(markerBounds && Math.abs((markerBounds.left + markerBounds.right - rect.left - rect.right) / 2) < 1
                  && markerBounds.top < rect.top + rect.height / 4 && markerStyle.pointerEvents === 'none'
                  && markerStyle.color === 'rgb(120, 73, 46)' && !marker.textContent
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
            const mixed = root.querySelector('[data-co2prism-time="am"]');
            const commandStyle = getComputedStyle(mixed);
            const hasDiagonal = style => ['135deg', 'rgb(237, 21, 32)', 'rgb(37, 170, 225)']
              .every(color => style.backgroundImage.includes(color));
            check(commandStyle.clipPath === 'polygon(0px 0px, 100% 0px, 100% 100%)'
              && commandStyle.backgroundColor === 'rgb(0, 0, 0)'
              && hasDiagonal(getComputedStyle(mixed, '::before')) && mixed.textContent === 'AM', 'AM triangular command');
            for (const node of bar.budgetBar.querySelectorAll('.co2prism-time-indicator')) {
              const square = getComputedStyle(node, '::before');
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
          await command('a'); movement('10', '5'); check(budgetTypes() === 'm', 'Normal A branch');
          check(halos() === 'm', 'A spend halo');
          await resetBudget(); await command('m'); movement('10', '5'); check(budgetTypes() === 'am', 'Normal M branch');
          check(halos() === 'a,m', 'M spend polyvalent halos');
          await command('m'); movement('0', '0');
          const emptyBudget = JSON.stringify(actor.flags.co2prism.actionEconomy), warningCount = warnings.length;
          await command('m'); await command('m');
          check(JSON.stringify(actor.flags.co2prism.actionEconomy) === emptyBudget && warnings.length === warningCount, 'Impossible spend mutated or spammed');
          check(bar.budgetCommands.every(button => !button.disabled) && bar.budgetCommands.find(button => button.dataset.co2prismTime === 'm').title.includes('Aucun temps compatible'), 'Spent command disabled');
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
            await paidClick(); movement('20', '4');
            check(halos() === 'l,a,m', size + ' automatic bonus spend halos');
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
            check(halos() === 'l,a,m', size + ' halo after reset');
            const scale = parseFloat(root.style.getPropertyValue('--co2prism-unit'));
            for (const button of bar.budgetCommands) {
              const rect = button.getBoundingClientRect(), wrapper = button.parentElement;
              check(Math.abs(wrapper.getBoundingClientRect().width - rect.width) < 1, size + ' halo wrapper geometry');
              check(getComputedStyle(wrapper).pointerEvents === 'none', size + ' halo hit surface');
              const hit = document.elementFromPoint(rect.left + scale, rect.bottom - 3 * scale);
              check(!button.contains(hit), size + ' transparent command corner interactive');
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
                const portrait = bar.portrait.getBoundingClientRect(), health = bar.gauges.hp.fill.getBoundingClientRect();
                const toggle = movementButton.getBoundingClientRect();
                const first = bar.combatRows[0].getBoundingClientRect(), second = bar.combatRows[1].getBoundingClientRect();
                const effects = bar.combatEffects.getBoundingClientRect();
                check(bounds.left >= -0.1 && bounds.top >= -0.1 && bounds.right <= innerWidth + 0.1 && bounds.bottom <= innerHeight + 0.1, size + ' 15A screen bounds');
                check(name.top > health.bottom && Math.abs(name.right - health.right) < 5
                  && name.bottom <= bounds.bottom + 0.1, size + ' V.3 bandeau sous les jauges');
                check(bar.name.title === actor.name && getComputedStyle(bar.name).textOverflow === 'ellipsis', size + ' 15A long name');
                check(toggle.bottom < portrait.top && movementButton.disabled
                  && Math.abs(toggle.left + toggle.width / 2 - portrait.left - portrait.width / 2) < 1,
                  size + ' V.3 commande de mouvement au-dessus du portrait');
                check(movementPanel.hidden && movementPanel.getClientRects().length === 0, size + ' 15A closed movement panel');
                check(effects.top >= name.bottom - 0.1 && effects.top > second.bottom
                  && bar.combatEffects.children.length === 80, size + ' V.3 effets sous le nom');
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
          check(movementButton.getAttribute('aria-label') === 'Mouvement', 'Archive6 inactive movement label');
          trackedMove(2); trackedMove(3);
          check(movementPanel.hidden && !bar.movementTracker.getSnapshot(tracked).success
            && JSON.stringify(actor.flags.co2prism.actionEconomy) === previewFlag, 'Untracked native moves create no session or budget write');
          const trackedStart = tracked.x;
          movementButton.click();
          check(!movementPanel.hidden && movementButton.getAttribute('aria-pressed') === 'true', '15C session opened');
          check(movementPanel.querySelectorAll('input[type="radio"]').length === 0, 'No movement mode radios');
          check(bar.movementTracker.getSnapshot(tracked).state.mode === 'exact'
            && bar.movementTracker.getSnapshot(tracked).state.start.x === trackedStart, 'Exact session starts at current position');
          check(movementButton.getAttribute('aria-label') === 'Mouvement', 'Archive6 active validation label');
          check(movementPanel.querySelector('.co2prism-movement-zones-toggle').disabled
            ,
            'Zones prototype unavailable API leaves panel usable with diagnostic');
          const remainingText = () => movementPanel.querySelector('.co2prism-movement-summary').textContent;
          const excessText = () => movementPanel.querySelector('.co2prism-movement-excess')?.textContent;
          check(remainingText() === '5 cases disponibles', 'Cinq cases à l’ouverture');
          trackedMove(2);
          check(remainingText() === '3 cases disponibles' && !excessText(), 'Trois cases après un coût de deux');
          trackedMove(3);
          check(remainingText() === '0 case disponible' && !excessText(), 'Budget épuisé sans dépassement');
          trackedMove(1);
          check(remainingText() === '0 case disponible' && excessText() === 'Dépassement de 1 case !', 'Dépassement singulier');
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
          check(remainingText() === '0 case disponible', 'Le bonus AM ne recharge pas l’action en cours');
          await economy.spend('m'); hooks.get('updateActor')(actor, { flags: {} });
          check(blocks().length === 1 && movementPanel.querySelector('.co2prism-movement-excess'), 'External spend preserves single block and capacity');
          settings.economyMode = 'off'; bar.refreshActor();
          check(blocks().length === 1 && bar.movementView(tracked).capacity === 5, 'Inactive budget single M capacity');
          check(movementPanel.querySelector('.co2prism-movement-summary').hidden
            && !movementPanel.querySelector('.co2prism-movement-summary').getClientRects().length, 'Inactive budget hides summary entirely');
          settings.economyMode = 'always'; bar.refreshActor();
          check(!movementPanel.querySelector('.co2prism-movement-summary').hidden, 'Active budget shows summary');
          const beforeReturn = JSON.stringify(actor.flags.co2prism.actionEconomy);
          failReturn = true; await bar.resetMovement();
          check(!movementPanel.querySelector('.co2prism-movement-error').hidden && grey() === 5, '15C return failure preserves path');
          failReturn = false; movementPanel.querySelector('.co2prism-movement-reset').click();
          await new Promise(resolve => setTimeout(resolve, 0));
          check(tracked.x === trackedStart && grey() === 0 && !movementPanel.hidden, 'Successful return keeps exact session');
          check(remainingText() === '5 cases disponibles' && !excessText(), 'Le retour restaure le compteur');
          check(movementButton.getAttribute('aria-label') === 'Mouvement', 'Archive6 label after reset');
          check(JSON.stringify(actor.flags.co2prism.actionEconomy) === beforeReturn, '15C return did not mutate budget');
          const secondDocument = { ...tracked, id: 'second-token', uuid: 'Scene.s.Token.second', x: 500 };
          movementScene.tokens.set(secondDocument.id, secondDocument);
          canvas.tokens.controlled = [{ actor, document: secondDocument }]; hooks.get('controlToken')();
          check(movementPanel.hidden, '15C selection hides previous session');
          check(movementButton.getAttribute('aria-label') === 'Mouvement', 'Archive6 label after selection');
          movementButton.click(); trackedMove(1, secondDocument);
          canvas.tokens.controlled = [selectedToken]; hooks.get('controlToken')();
          check(movementPanel.hidden, 'Selection abandons previous session'); movementButton.click();
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size; bar.position = { x: innerWidth - 1, y: 0 }; bar.layout();
            const bounds = root.getBoundingClientRect(), panel = movementPanel.getBoundingClientRect();
            const base = movementButton.getBoundingClientRect();
            check(bounds.right <= innerWidth + 1 && bounds.top >= -0.1 && bounds.bottom <= innerHeight + 1
              && panel.top >= -0.1 && panel.bottom <= base.top + 0.1
              && panel.bottom < bar.budgetScroll.getBoundingClientRect().top, size + ' panneau au-dessus du budget');
            check(!movementPanel.contains(document.elementFromPoint(panel.left + 2, panel.bottom - 2)),
              size + ' biseau transparent du panneau');
            const block = blocks()[0], end = block.lastElementChild.getBoundingClientRect();
            check(Math.abs(end.right - block.getBoundingClientRect().right) < 1,
              size + ' segments jusqu’au bord de la rangée');
            const blankX = bounds.left + 2, blankY = panel.top + 2;
            check(document.elementFromPoint(blankX, blankY)?.id === 'board', size + ' 15C canvas remains accessible');
            const reset = movementPanel.querySelector('.co2prism-movement-reset'), rect = reset.getBoundingClientRect();
            check(reset.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)), size + ' movement reset clickable');
          }
          const frenchMovement = { ...budgetTranslations };
          const movementLanguages = { fr: ${JSON.stringify(translations.CO2PRISM.Movement)}, en: ${JSON.stringify(JSON.parse(read("../lang/en.json")).CO2PRISM.Movement)} };
          for (const [language, texts] of Object.entries(movementLanguages)) {
            for (const [key, value] of Object.entries(texts)) budgetTranslations['CO2PRISM.Movement.' + key] = value;
            bar.movementSignature = null; bar.refreshActor();
            for (const size of ['S', 'M', 'L', 'XL']) {
              settings.size = size; bar.layout();
              const panel = movementPanel.getBoundingClientRect();
              const info = movementPanel.querySelector('.co2prism-movement-info').getBoundingClientRect();
              const zones = bar.movementZonesButton.getBoundingClientRect();
              const reset = bar.movementReset.getBoundingClientRect();
              const validate = bar.movementValidate.getBoundingClientRect();
              check(zones.right <= info.left && info.right <= reset.left, language + size + ' three horizontal zones');
              check(Math.abs(reset.width - reset.height) < 1 && Math.abs(validate.width - validate.height) < 1
                && reset.bottom <= validate.top && Math.abs(reset.left - validate.left) < 1, language + size + ' square stacked commands');
              check(panel.height < 140 && movementPanel.scrollHeight <= movementPanel.clientHeight + 1
                && movementPanel.scrollWidth <= movementPanel.clientWidth + 1, language + size + ' compact without internal scrollbars');
              for (const selector of ['summary', 'message']) {
                const node = movementPanel.querySelector('.co2prism-movement-' + selector);
                const range = document.createRange(); range.selectNodeContents(node);
                check(range.getClientRects().length === 1 && range.getBoundingClientRect().right <= info.right + 1,
                  language + size + selector + ' readable on one line');
              }
              const status = movementPanel.querySelector('.co2prism-movement-message'), originalStatus = status.textContent;
              for (const text of [texts.Normal, texts.Excess.replace('{excess}', '123')]) {
                status.textContent = text; bar.layout();
                const range = document.createRange(); range.selectNodeContents(status);
                check(range.getClientRects().length === 1 && movementPanel.scrollWidth <= movementPanel.clientWidth + 1
                  && movementPanel.getBoundingClientRect().right <= innerWidth, language + size + ' movement status fits');
              }
              status.textContent = originalStatus; bar.layout();
              const cells = [...movementPanel.querySelectorAll('.co2prism-movement-cell')];
              check(cells.every(cell => Math.abs(cell.getBoundingClientRect().top - cells[0].getBoundingClientRect().top) < 1),
                language + size + ' one line of cells');
              for (const button of [bar.movementZonesButton, bar.movementReset, bar.movementValidate]) {
                check(!button.textContent.trim() && button.querySelector('i.fa-solid') && button.title && button.getAttribute('aria-label'),
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
          check(smallPanel.height >= 60 && smallReset.bottom <= smallPanel.bottom && smallPanel.top >= -0.1
            && smallBounds.bottom <= 500.1, 'Small viewport keeps simplified panel and reset usable');
          Object.defineProperty(window, 'innerHeight', { value: realHeight, configurable: true }); bar.layout();
          trackedMove(11);
          const beforeFinish = JSON.stringify(actor.flags.co2prism.actionEconomy), destination = tracked.x;
          bar.movementValidate.click();
          check(movementButton.disabled && bar.movementReset.disabled, '15D controls locked during validation');
          await new Promise(resolve => setTimeout(resolve, 0));
          check(!movementPanel.hidden && movementButton.getAttribute('aria-pressed') === 'true' && tracked.x === destination, '15D finish retains destination');
          check(movementButton.getAttribute('aria-label') === 'Mouvement', 'Archive6 label after finish');
          check(JSON.stringify(actor.flags.co2prism.actionEconomy) !== beforeFinish && economy.getSnapshot().movementsRemaining === 4
            && warnings.length === notificationCount + 1, 'Single M validation warns for excess');
          movement('40', '20');
          // Comparer les blocs et le portrait sur des vitesses non entières.
          actor.system.attributes.movement = { value: 7.2, unit: 'm' };
          settings.movementRounding = 'nearest'; await economy.reset(); bar.refreshActor();
          if (movementPanel.hidden) movementButton.click(); trackedMove(7);
          check(blocks().map(block => Number(block.dataset.cells)).join(',') === '4', 'Fractional speed gives one block of four');
          check(grey() === 4 && movementPanel.querySelectorAll('.co2prism-movement-cell').length === 4, 'Four filled cells capped to single M');
          movement('14.4', '7');
          await bar.validateMovement(tracked);
          check(economy.getSnapshot().movementsRemaining === 1 && bar.movementResults.get(tracked).consumedCount === 1, 'Seven cells cost one M');
          await bar.toggleMovement();
          actor.system.attributes.movement = { value: 10, unit: 'm' }; movementScene.grid.distance = 3;
          for (const mode of ['nearest', 'up', 'down']) {
            settings.movementRounding = mode; await economy.reset(); await economy.grant('m', 3); bar.refreshActor();
            if (movementPanel.hidden) movementButton.click();
            const expected = (mode === 'up' ? Math.ceil : mode === 'down' ? Math.floor : Math.round)(50 / 3);
            const total = [...movementPanel.querySelectorAll('.co2prism-movement-cell')].reduce((sum, cell) => sum + Number(cell.dataset.count), 0);
            check(total === (mode === 'up' ? Math.ceil : mode === 'down' ? Math.floor : Math.round)(10 / 3)
              && bar.combatValues.cells.textContent === String(expected), 'Portrait budget and single M capacity ' + mode);
            trackedMove(7);
            check(grey() === total, 'Filled cells capped to single M ' + mode);
            settings.economyMode = 'off'; bar.refreshActor(); await bar.validateMovement(tracked);
            settings.economyMode = 'always'; bar.refreshActor(); await bar.toggleMovement();
          }
          actor.system.attributes.movement = { value: 0.4, unit: 'm' }; movementScene.grid.distance = 2;
          settings.movementRounding = 'down'; await economy.reset(); bar.refreshActor(); if (movementPanel.hidden) movementButton.click(); trackedMove(1);
          check(blocks().map(block => Number(block.dataset.cells)).join(',') === '0'
            && movementPanel.querySelectorAll('.co2prism-movement-cell').length === 0, 'Zero capacity has no fake squares');
          await economy.grant('m', 3); hooks.get('updateActor')(actor, { flags: {} });
          check(blocks().map(block => Number(block.dataset.cells)).join(',') === '0' && grey() === 0, 'Bonus does not change zero session capacity');
          movement('2', '1');
          await bar.validateMovement(tracked);
          check(economy.getSnapshot().movementsRemaining === 4 && bar.movementResults.get(tracked).consumedCount === 1, 'Zero capacity spends one M');
          actor.system.attributes.movement = { value: 2000000, unit: 'm' }; bar.refreshActor();
          if (movementPanel.hidden) movementButton.click();
          const aggregated = [...movementPanel.querySelectorAll('.co2prism-movement-cell')];
          check(blocks().length === 1 && aggregated.length <= 60
            && aggregated.reduce((sum, node) => sum + Number(node.dataset.count), 0) === 1000000, 'Huge speed DOM bounded to 60 groups');
          check(aggregated.every(node => Math.abs(node.getBoundingClientRect().top - aggregated[0].getBoundingClientRect().top) < 1)
            && movementPanel.scrollWidth <= movementPanel.clientWidth + 1, 'Huge speed remains a single contained row');
          settings.economyMode = 'off'; bar.refreshActor(); await bar.validateMovement(tracked); settings.economyMode = 'always';
          if (!movementPanel.hidden) await bar.toggleMovement();
          await economy.reset(); bar.refreshActor();
          movementButton.click();
          let closeAnswer;
          const originalWait = foundry.applications.api.DialogV2.wait;
          foundry.applications.api.DialogV2.wait = () => new Promise(resolve => { closeAnswer = resolve; });
          trackedMove(1);
          const closing = bar.toggleMovement();
          check(bar.movementToggle.disabled && bar.movementValidate.disabled && bar.movementReset.disabled
            && bar.movementZonesButton.disabled, 'All movement controls locked during close dialogue');
          closeAnswer(null); await closing;
          check(!movementPanel.hidden && !bar.movementValidate.disabled, 'Dismissal keeps path and unlocks commands');
          foundry.applications.api.DialogV2.wait = originalWait;
          await bar.resetMovement();
          check(bar.movementValidate.disabled && bar.movementReset.disabled, 'Empty session commands disabled');
          trackedMove(1); await bar.validateMovement(tracked);
          check(!movementPanel.hidden && bar.movementValidate.disabled && grey() === 0, 'Next session remains open and empty');
          trackedMove(1); await bar.validateMovement(tracked);
          check(!movementPanel.hidden && !movementButton.disabled && movementButton.classList.contains('co2prism-movement-unavailable'), 'Exhausted toggle remains clickable');
          check(!movementPanel.querySelector('.co2prism-movement-empty').hidden
            && movementPanel.querySelector('.co2prism-movement-content').hidden
            && movementPanel.querySelector('.co2prism-movement-empty').textContent === 'Aucune action de mouvement disponible.', 'Exhausted panel only shows required message');
          const empty = movementPanel.querySelector('.co2prism-movement-empty');
          const emptyRange = document.createRange(); emptyRange.selectNodeContents(empty);
          const emptyText = emptyRange.getBoundingClientRect(), emptyPanel = movementPanel.getBoundingClientRect();
          check(emptyRange.getClientRects().length === 1 && emptyPanel.height < 80
            && Math.abs((emptyText.left + emptyText.right - emptyPanel.left - emptyPanel.right) / 2) < 1
            && Math.abs((emptyText.top + emptyText.bottom - emptyPanel.top - emptyPanel.bottom) / 2) < 1,
            'Exhausted message compact and centered');
          check([bar.movementZonesButton, bar.movementReset, bar.movementValidate].every(button => !button.getClientRects().length),
            'All internal icons hidden at zero budget');
          movementButton.click(); check(movementPanel.hidden, 'Exhausted panel closes');
          movementButton.click(); check(!movementPanel.hidden, 'Exhausted panel opens');
          tracked.canUserModify = () => false; bar.refreshActor(); check(movementButton.disabled, '15C permission disables command');
          tracked.canUserModify = () => true;
          hooks.get('deleteToken')(secondDocument);
          check(!bar.movementTracker.getSnapshot(secondDocument).success, '15C deleted token cleanup');
          const openedItems = [];
          const equipmentItem = (name, sort) => {
            const document = { id: name, uuid: 'Actor.test.Item.' + name, name, sort, parent: actor, type: 'equipment',
              canUserModify: () => true, actions: [],
              testUserPermission: () => true, img: 'icons/svg/item-bag.svg',
              system: { description: '<p>Details of ' + name + '</p>' },
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
          const artBeforeEquipment = bar.art.getBoundingClientRect().toJSON();
          bar.equipmentToggle.click();
          await bar.configWrites.get(actor);
          check(JSON.stringify(bar.art.getBoundingClientRect().toJSON()) === JSON.stringify(artBeforeEquipment),
            'Equipment opening preserves portrait geometry');
          const groupFor = key => bar.equipmentGroups.find(group => group.key === key);
          const names = group => [...group.items.querySelectorAll('img')].map(img => img.alt);
          const weaponGroup = groupFor('weapon');
          const order = ['weapon', 'protection', 'consumable', 'misc', 'containers'];
          check(!equipment.hidden && equipment.querySelectorAll('.co2prism-equipment-category').length === 5, 'Equipment open with five groups');
          check(bar.equipmentGroups.map(group => group.key).join() === order.join(), 'Equipment category order');
          check(names(groupFor('protection')).join() === 'shield,armor,armor2,shield2', 'Equipment merged native protection order');
          check(names(groupFor('containers')).join() === 'bag' && names(weaponGroup).length === 31, 'Equipment exclusions and deduplication');
          await bar.setPanelState('combat', true);
          if (movementPanel.hidden) movementButton.click();
          await bar.setPanelState('competences', true);
          for (const size of ['S', 'M', 'L', 'XL']) {
            settings.size = size; settings.position = { x: 1, y: 1 }; bar.position = settings.position; bar.layout();
            const bounds = equipment.getBoundingClientRect();
            const artBounds = bar.art.getBoundingClientRect();
            const movementBounds = movementPanel.getBoundingClientRect();
            const tiles = [...weaponGroup.items.children].map(tile => tile.getBoundingClientRect());
            const scale = artBounds.width / 724;
            const edgeGap = (261 * scale - (tiles[5].left + tiles[5].right) / 2 + artBounds.left
              - tiles[5].bottom + artBounds.top) / scale;
            check(edgeGap > 12 && edgeGap < 17 && bounds.left >= bar.skillsPanel.getBoundingClientRect().left - 1 &&
              bounds.bottom < bar.skillsPanel.getBoundingClientRect().top && bounds.right <= movementBounds.left + 1,
              'Equipment follows the upper-left edge clear of skills and movement at ' + size);
            check(tiles[5].left > tiles[4].left && tiles[5].top < tiles[4].top &&
              Math.abs(tiles[0].left - tiles[6].left) < 1 && tiles[6].top < tiles[0].top,
              'Equipment diagonal wraps after six at ' + size);
            const equipmentStyle = getComputedStyle(equipment);
            const tileStyle = getComputedStyle(weaponGroup.items.firstElementChild);
            const imageStyle = getComputedStyle(weaponGroup.items.querySelector('img'));
            const rotation = new DOMMatrix(tileStyle.transform);
            check(equipmentStyle.overflowY === 'visible' && equipmentStyle.maxHeight === 'none' &&
              tiles.length === 31 && tiles[30].height > 0, 'All equipment remains rendered without internal scrolling at ' + size);
            check(Math.abs(rotation.b + Math.SQRT1_2) < 0.001 && imageStyle.transform === 'none' &&
              tileStyle.borderTopColor === 'rgb(0, 0, 0)' && tiles[0].width > 67 * scale,
              'Equipment square and image share a counterclockwise rotation with a black border at ' + size);
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
          const allOpen = order.map(categoryPosition);
          check(allOpen.every((point, i) => i === 0 || point.top < allOpen[i - 1].top),
            'Expanded categories progress from the portrait outward in order');
          for (const collapsed of [['protection'], ['consumable'], ['protection', 'consumable'], order]) {
            await setCollapsed(collapsed);
            const positions = collapsed.map(categoryPosition);
            const pitch = 40 * bar.art.getBoundingClientRect().width / 724;
            check(equipment.getBoundingClientRect().height < fullHeight &&
              collapsed.every(key => groupFor(key).items.hidden && groupFor(key).button.getClientRects().length === 1),
              'Collapsed categories release their item rows: ' + collapsed.join());
            check(positions.every((point, i) => i === 0 ||
              (Math.abs(point.left - positions[i - 1].left - pitch) < 1 &&
               Math.abs(positions[i - 1].top - point.top - pitch) < 1)),
              'Consecutive collapsed icons form a compact 45-degree diagonal: ' + collapsed.join());
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
            check(tile.dataset.tooltipHtml.includes('<strong>' + id + '</strong>') &&
              tile.dataset.tooltipHtml.includes('Details of ' + id), 'Equipment tooltip for ' + id);
            tile.click();
          }
          check(openedItems.join() === 'weapon0,shield,potion,rope,bag', 'Equipment opens each native Item sheet');
          if (game.tooltip) {
            game.tooltip.activate(tileFor('bag'));
            check(game.tooltip.tooltip.textContent.includes('Details of bag') &&
              !game.tooltip.tooltip.querySelector('[onerror]'), 'Native equipment tooltip sanitizes item description');
            game.tooltip.deactivate();
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
          check(equipment.hidden && bar.equipmentToggle.disabled, 'Equipment hidden without a selected actor');
          canvas.tokens.controlled = [{ actor: other, document: { baseActor: other } }]; bar.refreshActor();
          check(equipment.hidden && bar.equipmentToggle.getAttribute('aria-expanded') === 'false', 'Equipment state isolated per actor');
          canvas.tokens.controlled = selected; bar.refreshActor();
          check(!equipment.hidden && names(weaponGroup).length === 30, 'Equipment restores actor state');
          actor.inventory = []; actor.containers = [];
          hooks.get('createItem')({ parent: actor });
          check(equipment.querySelectorAll('.co2prism-equipment-category').length === 5 && !equipment.querySelector('img'), 'Empty equipment keeps category controls');
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
          const simple = [...groupRow.children].find(slot => slot.title.includes('First'));
          await dropAction(1, simple);
          const members = () => [...groupSlot().querySelectorAll('.co2prism-slot-quadrant')];
          const quadrantCommand = index => members()[index].querySelector('.co2prism-quadrant-command');
          const clickQuadrant = (index, options = {}) => quadrantCommand(index).dispatchEvent(new MouseEvent('click', { bubbles: true, ...options }));
          const images = () => members().map(member => member.querySelector('img')?.getAttribute('src') ?? '');
          const preview = bar.shortcutPreview;
          const previewOpen = () => preview.matches(':popover-open');
          const pointer = (node, type) => node.dispatchEvent(new PointerEvent(type, { pointerType: 'mouse' }));
          const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
          pointer(members()[2], 'pointerenter');
          await pause(360);
          check(!previewOpen(), 'Empty quadrant never opens an action preview');
          check(images().join() === 'icons/svg/sword.svg,icons/svg/shield.svg,,' &&
            members().slice(2).every(member => getComputedStyle(member).backgroundColor === 'rgb(0, 0, 0)' &&
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
          check(getComputedStyle(members()[0].querySelector('img')).filter.startsWith('brightness') &&
            getComputedStyle(members()[1].querySelector('img')).filter.startsWith('grayscale') &&
            getComputedStyle(members()[2].querySelector('img')).filter === 'none', 'Each quadrant renders its own visual filter');
          pointer(members()[0], 'pointerenter');
          await pause(100);
          check(!previewOpen(), 'Hover stays hidden before the delay');
          pointer(members()[0], 'pointerleave'); pointer(members()[1], 'pointerenter');
          await pause(260);
          check(!previewOpen(), 'Switching quadrants cancels the previous timer');
          await pause(100);
          check(previewOpen() && preview.textContent.includes('Second') &&
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
              getComputedStyle(groupSlot()).borderTopColor === 'rgb(114, 14, 53)',
              'Quadrants preserve square geometry and burgundy border at ' + size);
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
              preview.querySelector('.co2prism-shortcut-preview-title').textContent === 'First',
              'Preview preserves the full square, four badges, and viewport geometry at ' + size);
            pointer(members()[0], 'pointerleave');
            check(!previewOpen(), 'Leaving the quadrant dismisses its preview immediately');
          }
          settings.locked = true; bar.updateLock();
          check(images().every(Boolean) && !groupSlot().querySelector('button') && !members().some(member => member.draggable),
            'Locked group preserves images and hides all editing controls');
          pointer(members()[3], 'pointerenter');
          await pause(360);
          check(previewOpen() && preview.textContent.includes('Fourth'), 'Locked quadrant previews its own action');
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
          check(!groupSlot() && [...bar.combatRows[0].children].some(slot => slot.title.includes('First') &&
            slot.classList.contains('co2prism-slot-executable') && slot.querySelector('.co2prism-slot-time')),
            'Removing quadrants restores a normal executable shortcut with its corner indicators');
          const finalShortcut = [...bar.combatRows[0].children].find(slot => slot.title.includes('First'));
          finalShortcut.querySelector('.co2prism-slot-remove').click();
          await bar.configWrites.get(actor);
          check(![...bar.combatRows[0].children].some(slot => slot.title.includes('First')),
            'The final remaining action is removed with the ordinary shortcut command');
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
          const root = document.getElementById("co2prism-bar"), scale = 430 / 724;
          const [first, second] = bar.combatRows;
          check(first.children.length === 1 && second.children.length === 4, "Restauration après relance du navigateur incorrecte");
          check((948 + bar.combatRowWidths[1]) * scale + bar.panelOffset.x > innerWidth,
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
