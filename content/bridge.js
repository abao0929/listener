// content/bridge.js
(function() {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.command === 'START') {
      try { self.mouse_listener?.(); } catch (_) {}
      try { self.text_listener?.(); } catch(_) {}
      sendResponse?.({ ok: true });
      return;
    }
    if (msg?.command === 'STOP') {
      try { self.mouse_unlistener?.(); } catch (_) {}
      try { self.text_unlistener?.(); } catch (_) {}
      sendResponse?.({ ok: true });
      return;
    }
  });
})();
