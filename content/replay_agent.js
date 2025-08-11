// content/replay_agent.js
(function() {
  // 幂等保护
  if (window.__REPLAY_AGENT_BOUND__) return;
  window.__REPLAY_AGENT_BOUND__ = true;

  // ---------- 查找工具 ----------
  function $xUnique(xpath, root = document) {
    try {
      const r = document.evaluate(xpath, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return r.snapshotLength === 1 ? r.snapshotItem(0) : null;
    } catch (_) { return null; }
  }
  function byIdUnique(id) {
    if (!id) return null;
    const esc = (s)=> (window.CSS && CSS.escape ? CSS.escape(s) : s);
    const n = document.querySelectorAll(`#${esc(id)}`);
    return n.length === 1 ? n[0] : null;
  }
  function byClassUnique(cls) {
    if (!cls) return null;
    const list = document.getElementsByClassName(cls);
    return list.length === 1 ? list[0] : null;
  }
  function byCoordsTopOnly(x, y) {
    if (self !== top) return null;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    const el = document.elementFromPoint(x, y);
    return el instanceof Element ? el : null;
  }

  async function findElementWithRetries({ id, class_name, xpath, x, y }, timeout = 5000, interval = 120, useCoords = true) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      let el = byIdUnique(id);
      if (!el) el = byClassUnique(class_name);
      if (!el && xpath) el = $xUnique(xpath);
      if (useCoords && !el) el = byCoordsTopOnly(x, y); // 点击用；输入默认不用
      if (el) return el;
      await new Promise(r => setTimeout(r, interval));
    }
    return null;
  }

  // ---------- 点击（保持之前只触发一次） ----------
  function synthesizeClick(el, clientX, clientY) {
    const rect = el.getBoundingClientRect();
    const cx = typeof clientX === 'number' ? clientX : (rect.left + rect.width / 2);
    const cy = typeof clientY === 'number' ? clientY : (rect.top + rect.height / 2);
    const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };

    el.scrollIntoView({ block: 'center', inline: 'center' });

    el.dispatchEvent(new PointerEvent('pointerover', opts));
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new PointerEvent('pointermove', opts));
    el.dispatchEvent(new MouseEvent('mousemove', opts));
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    try { el.focus?.(); } catch(_) {}
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    try { el.click?.(); } catch(_) {}
    return { ok: true, where: { x: cx, y: cy } };
  }

  // ---------- 输入（新加） ----------
  function isContentEditable(el) {
    return !!(el && el.nodeType === 1 && el.isContentEditable);
  }
  function setValueAndDispatch(el, value) {
    const v = String(value ?? '');
    el.scrollIntoView?.({ block: 'center', inline: 'center' });
    try { el.focus?.(); } catch(_) {}

    // 设置值
    if (isContentEditable(el)) {
      // 对 contenteditable：写入文本（尽量保持纯文本）
      el.innerText = v;
    } else if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      el.value = v;
      // 尝试把光标放到最后
      try {
        el.selectionStart = el.selectionEnd = v.length;
      } catch(_) {}
    } else {
      // 兜底：不可编辑元素，直接失败
      return { ok: false, error: 'element_not_editable' };
    }

    // 触发事件（许多框架依赖这些）
    try {
      // InputEvent（更语义化），失败则退化成普通 input 事件
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertFromPaste', data: v }));
    } catch (_) {
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));

    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'REPLAY_STEP' && msg.action === 'click') {
      (async () => {
        const el = await findElementWithRetries(msg.payload || {}, 5000, 120, /*useCoords*/ true);
        if (!el) return sendResponse?.({ ok: false, error: 'element_not_found' });
        const { x, y } = msg.payload || {};
        const res = synthesizeClick(el, x, y);
        sendResponse?.(res);
      })();
      return true; // 异步
    }

    if (msg?.type === 'REPLAY_STEP' && msg.action === 'input') {
      (async () => {
        // 输入默认不使用坐标兜底：只按 id → class_name → xpath
        const el = await findElementWithRetries(msg.payload || {}, 6000, 120, /*useCoords*/ false);
        if (!el) return sendResponse?.({ ok: false, error: 'element_not_found' });

        const { value } = msg.payload || {};
        const res = setValueAndDispatch(el, value);
        sendResponse?.(res);
      })();
      return true; // 异步
    }
  });
})();
