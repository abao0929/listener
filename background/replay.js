// background/replay.js
export class Replayer {
  constructor({ store, hub }) {
    this.store = store;
    this.hub = hub;
    this.runningByWindow = new Map(); // windowId -> state
  }
  

  isRunning(windowId) {
    const st = this.runningByWindow.get(windowId);
    return !!st?.running;
  }

  async start(windowId, { speed = 1.0, maxStepDelayMs = 3000 } = {}) {
    if (this.isRunning(windowId)) return;

    const logs = this._getPlayableLogs(windowId);
    if (!logs.length) return;

    const tabMap = new Map(); // origTabId -> newTabId
    const state = { running: true, paused: false, idx: 0, logs, speed, maxStepDelayMs, tabMap };
    this.runningByWindow.set(windowId, state);

    try { await chrome.windows.update(windowId, { focused: true }); } catch(_) {}

    let prevTs = logs[0].ts;
    for (let i = 0; i < logs.length; i++) {
      state.idx = i;
      if (!state.running) break;
      while (state.paused) await this._sleep(100);

      const step = logs[i];

      // 广播：开始执行该事件
      this._notify(windowId, step, 'start');

      const delay = Math.min(Math.max(0, step.ts - prevTs) / (state.speed || 1), state.maxStepDelayMs);
      if (delay > 0) await this._sleep(delay);

      try {
        await this._processStep(windowId, step, state);
        // 成功
        this._notify(windowId, step, 'done');
      } catch (err) {
        // 失败/超时（不中断整体回放，继续下一步）
        const msg = (err && err.message) || String(err) || 'unknown error';
        const status = (err && err.kind === 'timeout') ? 'timeout' : 'error';
        this._notify(windowId, step, status, msg);
      }

      prevTs = step.ts;
    }

    state.running = false;
    // 回放自然结束 → 通知面板复位按钮
    try { this.hub?.broadcast(windowId, { type: 'replay_state', payload: { running: false, paused: false, done: true } }); } catch(_) {}
  }

  stop(windowId) {
    const st = this.runningByWindow.get(windowId);
    if (st) st.running = false;
    try { this.hub?.broadcast(windowId, { type: 'replay_state', payload: { running: false, paused: false } }); } catch(_) {}
  }

  pause(windowId) {
    const st = this.runningByWindow.get(windowId);
    if (st) st.paused = true;
  }
  resume(windowId) {
    const st = this.runningByWindow.get(windowId);
    if (st) st.paused = false;
  }

  _getPlayableLogs(windowId) {
    return this.store.snapshot(windowId)
      .filter(e => !!e && ['tab_created','tab_url_changed','tab_activated','window_focus','click','text_input'].includes(e.type))
      .sort((a,b)=>a.ts-b.ts);
  }

  _notify(windowId, step, status, message) {
    try {
      this.hub?.broadcast(windowId, {
        type: 'replay_progress',
        payload: { id: step.id, type: step.type, status, message: message || '' }
      });
    } catch (_) {}
  }

  async _processStep(windowId, step, state) {
    switch (step.type) {
      case 'window_focus': {
        await chrome.windows.update(windowId, { focused: true }).catch(()=>{});
        return;
      }
      case 'tab_created': {
        const t = await chrome.tabs.create({
          windowId,
          url: step.payload?.url || 'about:blank',
          active: true
        }).catch(()=>null);
        if (t?.id != null) state.tabMap.set(step.tabId, t.id);
        return;
      }
      case 'tab_activated': {
        const realTabId = await this._ensureTab(windowId, step, state);
        if (realTabId) {
          await chrome.windows.update(windowId, { focused: true }).catch(()=>{});
          await chrome.tabs.update(realTabId, { active: true }).catch(()=>{});
        }
        return;
      }
      case 'tab_url_changed': {
        const realTabId = await this._ensureTab(windowId, step, state);
        if (realTabId) {
          await chrome.tabs.update(realTabId, { url: step.payload?.to || step.payload?.url || '' }).catch(()=>{});
          const ok = await this._waitTabComplete(realTabId, 15000).catch(()=>false);
          await this._ensureAgentInjected(realTabId);
          if (!ok) {
            const err = new Error('page load timeout'); err.kind = 'timeout'; throw err;
          }
        }
        return;
      }
      case 'click': {
        const realTabId = await this._ensureTab(windowId, step, state);
        if (!realTabId) return;

        await chrome.windows.update(windowId, { focused: true }).catch(()=>{});
        await chrome.tabs.update(realTabId, { active: true }).catch(()=>{});
        await this._ensureAgentInjected(realTabId);

        const options = (typeof step.payload?.frameId === 'number')
            ? { frameId: step.payload.frameId }
            : undefined;

        const resp = await this._sendMessageWithTimeout(
            realTabId,
            {
            type: 'REPLAY_STEP',
            action: 'click',
            payload: {
                id: step.payload?.id || '',
                class_name: step.payload?.class_name || '',
                xpath: step.payload?.xpath,
                x: step.payload?.x,
                y: step.payload?.y,
                timeout: 5000
            }
            },
            6000,
            options // ← 定向到录制时的 frame
            );
            if (!resp || resp.ok === false) {
            const err = new Error(resp?.error || 'click failed'); throw err;
            }
            return;
        }
      case 'text_input': {
        const realTabId = await this._ensureTab(windowId, step, state);
        if (!realTabId) return;

        await chrome.windows.update(windowId, { focused: true }).catch(()=>{});
        await chrome.tabs.update(realTabId, { active: true }).catch(()=>{});
        await this._ensureAgentInjected(realTabId);

        const options = (typeof step.payload?.frameId === 'number')
            ? { frameId: step.payload.frameId }
            : undefined;

        const resp = await this._sendMessageWithTimeout(
            realTabId,
            {
            type: 'REPLAY_STEP',
            action: 'input',
            payload: {
                // 与录制对齐的定位信息
                id: step.payload?.id || '',
                class_name: step.payload?.class_name || '',
                xpath: step.payload?.xpath || '',
                // 输入内容
                value: step.payload?.value ?? ''
            }
            },
            8000, // 输入可适当给更长的超时
            options
        );
        if (!resp || resp.ok === false) {
            const err = new Error(resp?.error || 'input failed');
            if (String(err.message).includes('timeout')) err.kind = 'timeout';
            throw err;
        }
        return;
        }
    }
  }

  async _ensureTab(windowId, step, state) {
    if (state.tabMap.has(step.tabId)) return state.tabMap.get(step.tabId);

    const firstUrl = step.payload?.to || step.payload?.url;
    if (firstUrl) {
      const t = await chrome.tabs.create({ windowId, url: firstUrl, active: true }).catch(()=>null);
      if (t?.id != null) {
        state.tabMap.set(step.tabId, t.id);
        await this._waitTabComplete(t.id, 15000).catch(()=>{});
        await this._ensureAgentInjected(t.id);
        return t.id;
      }
    } else {
      const [t] = await chrome.tabs.query({ windowId, active: true });
      if (t?.id != null) {
        state.tabMap.set(step.tabId, t.id);
        await this._ensureAgentInjected(t.id);
        return t.id;
      }
    }
    return null;
  }

  async _ensureAgentInjected(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content/replay_agent.js'],
        injectImmediately: true
      });
    } catch (_) {}
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    _sendMessageWithTimeout(tabId, msg, timeout = 5000, options) {
    return new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
        if (done) return; done = true; reject(new Error('timeout'));
        }, timeout);
        try {
        const cb = (resp) => {
            const _ = chrome.runtime.lastError;
            if (done) return;
            clearTimeout(timer);
            done = true;
            resolve(resp);
        };
        // 有 options 用四参；否则用三参
        if (options) chrome.tabs.sendMessage(tabId, msg, options, cb);
        else chrome.tabs.sendMessage(tabId, msg, cb);
        } catch (e) {
        clearTimeout(timer);
        reject(e);
        }
    });
    }

  _waitTabComplete(tabId, timeout = 15000) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      function onUpdated(id, info) {
        if (id !== tabId) return;
        if (info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve(true);
        }
      }
      chrome.tabs.onUpdated.addListener(onUpdated);
      const timer = setInterval(() => {
        if (Date.now() - t0 >= timeout) {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          clearInterval(timer);
          resolve(false);
        }
      }, 250);
    });
  }
}
