// panel/main.js
const logEl = document.getElementById('log');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const downloadBtn = document.getElementById('downloadBtn');
const followTailEl = document.getElementById('followTail');

let windowId = null;
let started = false;
let port = null;

function fmtTs(ts) {
  const d = new Date(ts);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getHours()}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${(d.getMilliseconds()+'').padStart(3,'0')}`;
}

function renderState() {
  startBtn.disabled = started;
  stopBtn.disabled = !started;
}

function appendLog(entry, scroll = true) {
  const div = document.createElement('div');
  div.className = 'log-item';
  div.innerHTML = `
    <div class="meta">
      <span class="type">[${entry.type}]</span>
      <span>${fmtTs(entry.ts)}</span>
      ${entry.tabId != null ? `<span> · tab ${entry.tabId}</span>` : ''}
    </div>
    <div class="payload">${escapeHtml(JSON.stringify(entry.payload || {}, null, 2))}</div>
  `;
  logEl.appendChild(div);
  if (scroll && followTailEl.checked) div.scrollIntoView({ block: 'end' });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

async function init() {
  const w = await chrome.windows.getCurrent();
  windowId = w.id;

  port = chrome.runtime.connect({ name: 'panel' });
  port.postMessage({ type: 'hello', windowId });

  port.onMessage.addListener((msg) => {
    if (msg?.type === 'init') {
      started = !!msg.payload.started;
      renderState();
      logEl.innerHTML = '';
      (msg.payload.logs || []).forEach(e => appendLog(e, false));
      if (followTailEl.checked) logEl.scrollTop = logEl.scrollHeight;
    }
    if (msg?.type === 'state') {
      started = !!msg.payload.started;
      renderState();
    }
    if (msg?.type === 'log') appendLog(msg.payload, true);

    if (msg?.type === 'logs_cleared') {
      logEl.innerHTML = '';
    }
    if (msg?.type === 'download_ok') {
      downloadBtn.textContent = 'Downloaded';
      setTimeout(() => (downloadBtn.textContent = 'Download'), 800);
    }
    if (msg?.type === 'download_err') {
      downloadBtn.textContent = 'Failed';
      console.warn('Download error:', msg.payload);
      setTimeout(() => (downloadBtn.textContent = 'Download'), 1200);
    }
  });

  startBtn.addEventListener('click', () => {
    port.postMessage({ type: 'cmd', cmd: 'start', windowId });
  });
  stopBtn.addEventListener('click', () => {
    port.postMessage({ type: 'cmd', cmd: 'stop', windowId });
  });
  clearBtn.addEventListener('click', () => {
    if (!confirm('清空当前窗口的所有记录？此操作不可撤销。')) return;
    port.postMessage({ type: 'cmd', cmd: 'clear', windowId });
  });
  downloadBtn.addEventListener('click', () => {
    downloadBtn.textContent = 'Preparing...';
    port.postMessage({ type: 'cmd', cmd: 'download', windowId });
  });
}

init();
