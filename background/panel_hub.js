// background/panel_hub.js
export class PanelHub {
  constructor() {
    this.portsByWindow = new Map(); // windowId -> Set<Port>
  }
  _set(windowId) {
    if (!this.portsByWindow.has(windowId)) this.portsByWindow.set(windowId, new Set());
    return this.portsByWindow.get(windowId);
  }
  add(windowId, port) { this._set(windowId).add(port); }
  remove(windowId, port) { this._set(windowId).delete(port); }
  broadcast(windowId, msg) {
    const set = this.portsByWindow.get(windowId);
    if (!set) return;
    for (const port of set) {
      try {
        port.postMessage(msg);
      } catch (_) {
        // Remove disconnected ports to keep the set clean
        set.delete(port);
      }
    }
  }
}
