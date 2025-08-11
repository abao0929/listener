// background.js (MV3, type: module)

// ---------------- Core Stores & Hubs ----------------
class LogStore {
  constructor() { this.map = new Map(); }
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
    // 不 await，异步落盘
    this.save(windowId).catch(() => {});
  }
  snapshot(windowId) { return [...this.get(windowId)]; }
}

class PanelHub {
  constructor() {
    this.portsByWindow = new Map(); // windowId => Set<Port>
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
    for (const port of Array.from(set)) {
      try { port.postMessage(msg); } catch (_) {}
    }
  }
}

class ListenerController {
  constructor({ log, hub, store }) {
    this.startedWindows = new Set();
    this._wiredGlobal = false;
    this.log = log;
    this.hub = hub;
    this.store = store;
  }

  isStarted(windowId) { return this.startedWindows.has(windowId); }

  async start(windowId) {
    if (this.startedWindows.has(windowId)) return;
    this.startedWindows.add(windowId);
    await this._injectIntoWindow(windowId);

    this.log.push(windowId, 'system', null, { message: 'START' });
    this.hub.broadcast(windowId, { type: 'state', payload: { started: true } });
  }

  async stop(windowId) {
    if (!this.startedWindows.has(windowId)) return;
    this.startedWindows.delete(windowId);

    const tabs = await chrome.tabs.query({ windowId });
    await Promise.allSettled(tabs.map(tab => {
      if (!tab.id) return;
      return chrome.tabs.sendMessage(tab.id, { command: 'STOP' }).catch(() => {});
    }));

    this.log.push(windowId, 'system', null, { message: 'STOP' });
    this.hub.broadcast(windowId, { type: 'state', payload: { started: false } });
  }

  async _injectIntoWindow(windowId) {
    const tabs = await chrome.tabs.query({ windowId });
    await Promise.allSettled(tabs.map(tab => this._injectIntoTab(tab.id)));

    // 全局事件只注册一次，再在回调里按 windowId 过滤
    if (!this._wiredGlobal) {
      this._wireGlobalEvents();
      this._wiredGlobal = true;
    }

    // 让现有 tab 进入 START
    await Promise.allSettled(tabs.map(tab => {
      if (!tab.id) return;
      return chrome.tabs.sendMessage(tab.id, { command: 'START' }).catch(() => {});
    }));
  }

  async _injectIntoTab(tabId) {
    if (!tabId) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content/mouse_listener.js', 'content/bridge.js'],
        injectImmediately: true
      });
    } catch (_) { /* 无法注入的页面忽略 */ }
  }

  _wireGlobalEvents() {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.status !== 'complete') return;
      const wId = tab.windowId;
      if (!this.startedWindows.has(wId)) return;
      await this._injectIntoTab(tabId);
      try { await chrome.tabs.sendMessage(tabId, { command: 'START' }); } catch (_) {}
    });

    chrome.tabs.onCreated.addListener(async (tab) => {
      const wId = tab.windowId;
      if (!this.startedWindows.has(wId)) return;
      await this._injectIntoTab(tab.id);
      try { await chrome.tabs.sendMessage(tab.id, { command: 'START' }); } catch (_) {}
    });

    // 标签激活（主动/被动切换都算）
    chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
      if (!this.startedWindows.has(windowId)) return;
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      this.log.push(windowId, 'tab_activated', tabId, {
        url: tab ? (tab.url || '') : '',
        title: tab ? (tab.title || '') : ''
      });
    });

    // 窗口聚焦变更
    chrome.windows.onFocusChanged.addListener(async (windowId) => {
      if (windowId === chrome.windows.WINDOW_ID_NONE) return;
      if (!this.startedWindows.has(windowId)) return;
      const [tab] = await chrome.tabs.query({ windowId, active: true });
      this.log.push(windowId, 'window_focus', tab?.id ?? null, {
        url: tab ? (tab.url || '') : '',
        title: tab ? (tab.title || '') : ''
      });
    });
  }
}

class EventLogger {
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

// 下载（JSON 文件，当前窗口）
async function downloadWindowLogs(windowId, store) {
  const manifest = chrome.runtime.getManifest();
  const data = {
    meta: {
      exportedAt: new Date().toISOString(),
      extensionVersion: manifest.version,
      windowId
    },
    logs: store.snapshot(windowId)
  };
  const json = JSON.stringify(data, null, 2);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dataUrl = "data:application/json;charset=utf-8," + encodeURIComponent(json);
  await chrome.downloads.download({
    url: dataUrl,
    filename: `event-logs/window-${windowId}-${stamp}.json`,
    saveAs: true
  });
}

// ---------------- Singletons ----------------
const store = new LogStore();
const hub = new PanelHub();
const log = new EventLogger({ hub, store });
const controller = new ListenerController({ log, hub, store });

// ---------------- Runtime Wiring ----------------
// 内容脚本事件 → 记日志
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'cs-event') {
    const tab = sender.tab;
    if (!tab) return;
    const windowId = tab.windowId;
    if (!controller.isStarted(windowId)) return;
    log.push(windowId, msg.eventType, tab.id, msg.payload || {});
  }
});

// 侧板长连接
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'panel') return;

  port.onMessage.addListener(async (msg) => {
    if (msg?.type === 'hello' && typeof msg.windowId === 'number') {
      const windowId = msg.windowId;
      port._windowId = windowId;
      hub.add(windowId, port);
      await store.load(windowId);
      port.postMessage({
        type: 'init',
        payload: {
          started: controller.isStarted(windowId),
          logs: store.snapshot(windowId)
        }
      });
    }

    if (msg?.type === 'cmd') {
      const { cmd, windowId } = msg;
      if (cmd === 'start') controller.start(windowId);
      if (cmd === 'stop') controller.stop(windowId);
      if (cmd === 'clear') {
        await store.clear(windowId);
        hub.broadcast(windowId, { type: 'logs_cleared' });
        log.push(windowId, 'system', null, { message: 'CLEARED' }); // 记录一次“清空”动作到新的空日志里
      }
      if (cmd === 'download') {
        try {
          await downloadWindowLogs(windowId, store);
          port.postMessage({ type: 'download_ok' });
        } catch (e) {
          port.postMessage({ type: 'download_err', payload: String(e?.message || e) });
        }
      }
    }
  });

  port.onDisconnect.addListener(() => {
    const windowId = port._windowId;
    if (typeof windowId === 'number') hub.remove(windowId, port);
  });
});

// 点击扩展图标 → 打开侧板
chrome.action.onClicked.addListener(async (tab) => {
  try { await chrome.sidePanel.open({ windowId: tab.windowId }); } catch (_) {}
});
