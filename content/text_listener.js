// content/text_listener.js
(function () {
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
    const raw = el.getAttribute && el.getAttribute('class');
    if (typeof raw === 'string') return raw.trim();
    if (typeof el.className === 'string') return el.className.trim();
    return "";
  }

  function isTextualInput(el) {
    if (!el || !(el instanceof Element)) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    if (el.tagName === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'password' || t === 'hidden' || t === 'file') return false;
      return ['text','search','email','url','tel','number'].includes(t);
    }
    return false;
  }
  function getValue(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA') return el.value ?? '';
    if (el.isContentEditable) return (el.innerText ?? el.textContent ?? '').trimEnd();
    if (el.tagName === 'INPUT') return el.value ?? '';
    return '';
  }
  function describeField(el) {
    return {
      tag: el.tagName,
      id: el.id || '',
      class_name: getClassName(el) || '',   // 新增
      name: el.getAttribute('name') || '',
      type: el.tagName === 'INPUT' ? (el.type || 'text') : (el.isContentEditable ? 'contenteditable' : el.tagName.toLowerCase()),
      placeholder: el.getAttribute('placeholder') || '',
      ariaLabel: el.getAttribute('aria-label') || ''
    };
  }

  let active = null; // { el, initial, last, composing, form, idleTimer }

  function beginIfNeeded(target) {
    if (!isTextualInput(target)) return;
    if (active && active.el === target) return;
    cancelActive(false);
    active = {
      el: target,
      initial: getValue(target),
      last: null,
      composing: false,
      form: target.form || closestForm(target),
      idleTimer: null
    };
  }
  function closestForm(el) {
    while (el && el !== document.documentElement) {
      if (el.tagName === 'FORM') return el;
      el = el.parentElement;
    }
    return null;
  }

  function finalize(reason) {
    if (!active) return;
    clearTimeout(active.idleTimer);
    if (active.composing) return;

    const el = active.el;
    const finalVal = getValue(el);
    if (finalVal === active.initial) { active = null; return; }

    const payload = {
      url: location.href,
      title: document.title,
      // 顶层也带上 id/class_name，便于统一回放逻辑
      id: el.id || "",
      class_name: getClassName(el) || "",
      xpath: getXPath(el),
      field: describeField(el),
      value: String(finalVal).slice(0, 5000),
      initial: String(active.initial).slice(0, 2000),
      reason
    };

    try {
      chrome.runtime.sendMessage(
        { type: 'cs-event', eventType: 'text_input', payload },
        () => void chrome.runtime.lastError
      );
    } catch (_) {}
    active = null;
  }
  function cancelActive() {
    clearTimeout(active?.idleTimer);
    active = null;
  }

  function onFocusIn(e){ const t=e.target; if(!isTextualInput(t))return; beginIfNeeded(t); }
  function onInput(e){ if(!active||e.target!==active.el)return; active.last=getValue(active.el); }
  function onFocusOut(e){ if(!active||e.target!==active.el)return; finalize('blur'); }
  function onCompositionStart(e){ if(!active||e.target!==active.el)return; active.composing=true; }
  function onCompositionEnd(e){ if(!active||e.target!==active.el)return; active.composing=false; active.last=getValue(active.el); }
  function onFormSubmit(e){ if(!active)return; const form=e.target; if(form && (form===active.form || form.contains(active.el))) finalize('submit'); }

  function bind() {
    if (window._textBound) return;
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('compositionstart', onCompositionStart, true);
    document.addEventListener('compositionend', onCompositionEnd, true);
    document.addEventListener('submit', onFormSubmit, true);
    window._textBound = true;
  }
  function unbind() {
    if (!window._textBound) return;
    cancelActive(false);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('focusout', onFocusOut, true);
    document.removeEventListener('compositionstart', onCompositionStart, true);
    document.removeEventListener('compositionend', onCompositionEnd, true);
    document.removeEventListener('submit', onFormSubmit, true);
    window._textBound = false;
  }
  self.text_listener = bind;
  self.text_unlistener = unbind;
})();
