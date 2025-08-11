// background/log_store.js
export class LogStore {
  constructor() {
    this.map = new Map(); // windowId -> Array<log>
  }
  _key(windowId) { return `logs:${windowId}`; }
  get(windowId) {
    if (!this.map.has(windowId)) this.map.set(windowId, []);
    return this.map.get(windowId);
  }
  async load(windowId) {
    const key = this._key(windowId);
    const { [key]: arr } = await chrome.storage.session.get(key);
    if (arr) this.map.set(windowId, arr);
  }
  async save(windowId) {
    const key = this._key(windowId);
    await chrome.storage.session.set({ [key]: this.get(windowId) });
  }
  async clear(windowId) {
    this.map.set(windowId, []);
    await chrome.storage.session.remove(this._key(windowId));
  }
  append(windowId, entry, cap = 2000) {
    const arr = this.get(windowId);
    arr.push(entry);
    if (arr.length > cap) arr.splice(0, arr.length - cap);
    this.save(windowId).catch(() => {});
  }
  snapshot(windowId) { return [...this.get(windowId)]; }
}
