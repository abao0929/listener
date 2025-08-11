// background/controller.js
export class ListenerController {
  constructor({ log, hub, store }) {
    this.log = log;
    this.hub = hub;
    this.store = store;
    this.startedWindows = new Set();
    this._wiredGlobal = false;
  }

  isStarted(windowId) { return this.startedWindows.has(windowId); }

  async start(windowId) {
    if (this.startedWindows.has(windowId)) return;
    this.startedWindows.add(windowId);
    await this._injectIntoWindow(windowId);
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

    this.hub.broadcast(windowId, { type: 'state', payload: { started: false } });
  }

  async _injectIntoWindow(windowId) {
    const tabs = await chrome.tabs.query({ windowId });
    await Promise.allSettled(tabs.map(tab => this._injectIntoTab(tab.id)));

    if (!this._wiredGlobal) {
      this._wireGlobalEvents();
      this._wiredGlobal = true;
    }

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
        files: [
          'content/mouse_listener.js',
          'content/text_listener.js', 
          'content/bridge.js',
          'content/replay_agent.js'
        ],
        injectImmediately: true
      });
    } catch (_) { /* 无法注入的页面忽略 */ }
  }

  _wireGlobalEvents() {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      
      const wId = tab.windowId;
      if (!this.startedWindows.has(wId)) return;
      
      if (changeInfo.url) {
        this.log.push(wId, 'tab_url_changed', tabId, {
          url: changeInfo.url || '',
          title: tab ? (tab.title || '') : ''
        });
      }

      if (changeInfo.status === 'complete') {
        await this._injectIntoTab(tabId);
        try { await chrome.tabs.sendMessage(tabId, { command: 'START' }); } catch (_) {}
      }
    });

    chrome.tabs.onCreated.addListener(async (tab) => {
      const wId = tab.windowId;
      if (!this.startedWindows.has(wId)) return;
      await this._injectIntoTab(tab.id);
      try { await chrome.tabs.sendMessage(tab.id, { command: 'START' }); } catch (_) {}
      if (tab.url) {
        this.log.push(wId, 'tab_url_changed', tab.id, {
          url: tab.url || '',
          title: tab.title || ''
        });
      }
    });

    chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
      if (!this.startedWindows.has(windowId)) return;
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      this.log.push(windowId, 'tab_activated', tabId, {
        url: tab ? (tab.url || '') : '',
        title: tab ? (tab.title || '') : ''
      });
    });

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
