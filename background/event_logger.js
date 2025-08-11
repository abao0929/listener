// background/event_logger.js
export class EventLogger {
  constructor({ hub, store }) {
    this.seq = 1;
    this.hub = hub;
    this.store = store;
  }
  make(windowId, type, tabId, payload) {
    return {
      id: this.seq++,
      ts: Date.now(),
      type,
      windowId,
      tabId: tabId ?? null,
      payload: payload || {}
    };
  }
  push(windowId, type, tabId, payload) {
    const entry = this.make(windowId, type, tabId, payload);
    this.store.append(windowId, entry);
    this.hub.broadcast(windowId, { type: 'log', payload: entry });
  }
}
