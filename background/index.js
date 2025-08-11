// background/index.js
import { ListenerController } from './controller.js';
import { LogStore } from './log_store.js';
import { PanelHub } from './panel_hub.js';
import { EventLogger } from './event_logger.js';
import { makeCommandRouter } from './commands.js';

const store = new LogStore();
const hub = new PanelHub();
const log = new EventLogger({ hub, store });
const controller = new ListenerController({ log, hub, store });
const route = makeCommandRouter({ controller, store, hub, log });

// 内容脚本事件 → 记录
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'cs-event') {

    const tab = sender.tab;
    if (!tab) return;
    const windowId = tab.windowId;
    if (!controller.isStarted(windowId)) return;

    const payload = { ...(msg.payload || {}), frameId: sender.frameId };

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
      return;
    }

    if (msg?.type === 'cmd') {
      const { cmd, windowId } = msg;
      route({ cmd, windowId, port });
    }
  });

  port.onDisconnect.addListener(() => {
    const windowId = port._windowId;
    if (typeof windowId === 'number') hub.remove(windowId, port);
  });
});

// 点击图标 → 打开侧板
chrome.action.onClicked.addListener(async (tab) => {
  try { await chrome.sidePanel.open({ windowId: tab.windowId }); } catch (_) {}
});
