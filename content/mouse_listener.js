// content/mouse_listener.js
(function() {
  function getXPath(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return `//*[@id="${el.id}"]`;
    const parts = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentNode) {
      let ix = 1;
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (sib.nodeName === node.nodeName) ix++;
      }
      parts.unshift(`${node.nodeName.toLowerCase()}[${ix}]`);
    }
    return "/" + parts.join("/");
  }

  function getClassName(el) {
    if (!el) return "";
    // 兼容 SVG 元素的 className（可能是 SVGAnimatedString）
    const raw = el.getAttribute && el.getAttribute('class');
    if (typeof raw === 'string') return raw.trim();
    if (typeof el.className === 'string') return el.className.trim();
    return "";
  }

  function locator(e) {
    const el = e.composedPath ? e.composedPath()[0] : e.target;
    if (!(el instanceof Element)) return;

    const rect = el.getBoundingClientRect();
    const payload = {
      url: location.href,
      title: document.title,
      // 新增定位字段
      id: el.id || "",
      class_name: getClassName(el) || "",
      // 旧有字段
      x: e.clientX,
      y: e.clientY,
      pageX: e.pageX,
      pageY: e.pageY,
      xpath: getXPath(el),
      tag: el.tagName,
      text: (el.innerText || '').trim().slice(0, 80),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      frameTop: self !== top ? true : false
    };

    chrome.runtime.sendMessage(
      { type: 'cs-event', eventType: 'click', payload },
      () => void chrome.runtime.lastError
    );
  }

  function click_listener() {
    if (window._clickBound) return;
    document.addEventListener('click', locator, true);
    window._clickBound = true;
  }

  function click_unlistener() {
    if (!window._clickBound) return;
    document.removeEventListener('click', locator, true);
    window._clickBound = false;
  }

  self.mouse_listener = function mouse_listener() { click_listener(); };
  self.mouse_unlistener = function mouse_unlistener() { click_unlistener(); };
})();
