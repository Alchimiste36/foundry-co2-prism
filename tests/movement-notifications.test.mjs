import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

function network() {
  const users = new Map([...["player", "co-owner", "gm", "outsider"].map(id => [id, { id, active: true, isGM: id === "gm" }])]);
  const listeners = [], clients = new Map();
  const token = { id: "t", name: "Token", parent: { id: "s" },
    actor: { testUserPermission: user => user.id === "player" || user.id === "co-owner" },
    canUserModify: user => user.isGM || user.id === "player" || user.id === "co-owner" };
  const scenes = new Map([["s", { tokens: new Map([["t", token]]) }]]);
  let serial = 0;
  for (const [id, user] of users) {
    const warnings = [], emits = [];
    const context = vm.createContext({
      game: { user, users, scenes, i18n: { format: (key, data) => `${key}:${data.token}:${data.excess}` },
        socket: { on: (channel, fn) => listeners.push({ channel, fn }), emit: (channel, packet) => {
          emits.push(packet); for (const listener of listeners) if (listener.channel === channel) listener.fn(packet);
        } } },
      foundry: { utils: { randomID: () => `notification-${++serial}` } },
      ui: { notifications: { warn: text => warnings.push(text) } }
    });
    vm.runInContext(readFileSync(new URL("../module/movement/movement-notifications.mjs", import.meta.url), "utf8")
      .replace("export class", "class") + "\nglobalThis.notifications = new MovementNotifications();", context);
    context.notifications.connect(); context.notifications.connect();
    clients.set(id, { context, warnings, emits, notifications: context.notifications });
  }
  return { clients, token, listeners, users };
}

test("15D socket : réception propriétaire, copropriétaire et MJ ; écho dédupliqué", () => {
  const { clients, token, listeners } = network();
  assert.equal(listeners.length, 4);
  assert.equal(clients.get("player").notifications.broadcast(token, 4), true);
  for (const id of ["player", "co-owner", "gm"]) {
    assert.equal(clients.get(id).warnings.length, 1);
    assert.match(clients.get(id).warnings[0], /Token:4$/);
  }
  assert.equal(clients.get("outsider").warnings.length, 0);
  const packet = clients.get("player").emits[0];
  clients.get("gm").notifications.receive(packet);
  assert.equal(clients.get("gm").warnings.length, 1);
});

test("15D socket : messages invalides et émetteur sans droits refusés, aucune mutation", () => {
  const { clients, token } = network();
  const receiver = clients.get("gm");
  token.actor.setFlag = token.update = () => assert.fail("Le socket ne doit modifier aucun document");
  const packet = { type: "movement-excess", id: "x", sceneId: "s", tokenId: "t", userId: "player", excess: 1 };
  for (const extra of [{ excess: 0 }, { excess: -1 }, { excess: Infinity }, { userId: "outsider" },
    { tokenId: "missing" }, { type: "spend" }]) assert.equal(receiver.notifications.receive({ ...packet, ...extra }), false);
  assert.equal(receiver.notifications.receive(packet), true); assert.equal(receiver.warnings.length, 1);
});
