const CHANNEL = "module.co2prism";

/** Canal informatif uniquement : aucun document ni budget n'est modifié à la réception. */
export class MovementNotifications {
  constructor() { this.seen = new Set(); this.connected = false; }

  connect() {
    if (this.connected || !game.socket?.on) return;
    game.socket.on(CHANNEL, packet => { this.receive(packet); });
    this.connected = true;
  }

  receive(packet) {
    if (packet?.type !== "movement-excess" || typeof packet.id !== "string" || packet.id.length > 100
      || !Number.isSafeInteger(packet.excess) || packet.excess <= 0 || this.seen.has(packet.id)) return false;
    const sender = game.users?.get(packet.userId);
    const token = game.scenes?.get(packet.sceneId)?.tokens?.get(packet.tokenId);
    if (!sender?.active || !token || !token.canUserModify?.(sender, "update")
      || !(sender.isGM || token.actor?.testUserPermission?.(sender, "OWNER"))) return false;
    const recipient = game.user;
    if (!(recipient?.isGM || recipient?.id === sender.id || token.actor?.testUserPermission?.(recipient, "OWNER"))) return false;
    this.seen.add(packet.id);
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value);
    ui.notifications.warn(game.i18n.format("CO2PRISM.Movement.ValidatedExcess", { token: token.name ?? token.actor?.name ?? "", excess: packet.excess }));
    return true;
  }

  broadcast(token, excess) {
    const packet = { type: "movement-excess", id: foundry.utils.randomID(), userId: game.user.id,
      sceneId: token.parent.id, tokenId: token.id, excess };
    this.receive(packet);
    if (!game.socket?.emit) return false;
    try { game.socket.emit(CHANNEL, packet); return true; } catch { return false; }
  }
}
