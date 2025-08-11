// panel/main.js（替换你当前版本，或合并下面的新增逻辑）
const logEl = document.getElementById('log');

// 录制/监听按钮
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const downloadBtn = document.getElementById('downloadBtn');

// 回放按钮
const replayStartBtn = document.getElementById('replayStartBtn');
const replayPauseBtn = document.getElementById('replayPauseBtn');
const replayResumeBtn = document.getElementById('replayResumeBtn');
const replayStopBtn = document.getElementById('replayStopBtn');

const followTailEl = document.getElementById('followTail');

let windowId = null;
let started = false;

let replayRunning = false;
let replayPaused = false;

let port = null;
let currentPlayingId = null; // 当前高亮中的事件 id

function fmtTs(ts) {
  const d = new Date(ts);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getHours()}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${(d.getMilliseconds()+'').padStart(3,'0')}`;
}

function renderRecordState() {
  const disabledByReplay = replayRunning;
  startBtn.disabled = disabledByReplay || started;
  stopBtn.disabled  = disabledByReplay || !started;
  clearBtn.disabled = disabledByReplay;
  downloadBtn.disabled = disabledByReplay;
}

function renderReplayState() {
  if (!replayRunning) {
    replayStartBtn.disabled  = false;
    replayPauseBtn.disabled  = true;
    replayResumeBtn.disabled = true;
    replayStopBtn.disabled   = true;
  } else {
    replayStartBtn.disabled  = true;
    replayPauseBtn.disabled  = replayPaused;
    replayResumeBtn.disabled = !replayPaused;
    replayStopBtn.disabled   = false;
  }
}
function renderAll() { renderRecordState(); renderReplayState(); }

function getLogElById(id) {
  return logEl.querySelector(`.log-item[data-id="${id}"]`);
}

function setPlaying(id) {
  if (currentPlayingId != null) {
    const prev = getLogElById(currentPlayingId);
    if (prev) prev.classList.remove('playing');
  }
  currentPlayingId = id;
  const el = getLogElById(id);
  if (el) {
    el.classList.remove('error'); // 清掉旧错误样式（如重复尝试）
    el.classList.add('playing');
    el.scrollIntoView({ block: 'center' });
  }
}

function clearPlaying(id) {
  const el = getLogElById(id);
  if (el) el.classList.remove('playing');
  if (currentPlayingId === id) currentPlayingId = null;
}

function markError(id, message) {
  const el = getLogElById(id);
  if (el) {
    el.classList.remove('playing');
    el.classList.add('error');
    el.scrollIntoView({ block: 'center' });
  }
  if (currentPlayingId === id) currentPlayingId = null;
  // 弹窗提醒（简单直给）
  alert(`回放步骤执行失败：#${id}\n原因：${message || '超时或未找到元素'}`);
}

function appendLog(entry, scroll = true) {
  const div = document.createElement('div');
  div.className = 'log-item';
  div.dataset.id = entry.id; // ★ 用于定位
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
      logEl.innerHTML = '';
      (msg.payload.logs || []).forEach(e => appendLog(e, false));
      if (followTailEl.checked) logEl.scrollTop = logEl.scrollHeight;

      replayRunning = false;
      replayPaused = false;
      currentPlayingId = null;
      renderAll();
    }

    if (msg?.type === 'state') {
      started = !!msg.payload.started;
      renderAll();
    }

    if (msg?.type === 'log') appendLog(msg.payload, true);

    if (msg?.type === 'logs_cleared') {
      logEl.innerHTML = '';
      currentPlayingId = null;
    }

    if (msg?.type === 'download_ok') {
      downloadBtn.textContent = '已下载';
      setTimeout(() => (downloadBtn.textContent = '下载'), 800);
    }
    if (msg?.type === 'download_err') {
      downloadBtn.textContent = '失败';
      console.warn('Download error:', msg.payload);
      setTimeout(() => (downloadBtn.textContent = '下载'), 1200);
    }

    // ★ 监听回放每步进度
    if (msg?.type === 'replay_progress') {
      const { id, status, message } = msg.payload || {};
      if (status === 'start') setPlaying(id);
      else if (status === 'done') clearPlaying(id);
      else if (status === 'timeout' || status === 'error') markError(id, message);
    }

    // 回放状态（用于按钮禁用/复位）
    if (msg?.type === 'replay_state') {
      if (typeof msg.payload.running === 'boolean') replayRunning = msg.payload.running;
      if (typeof msg.payload.paused === 'boolean')  replayPaused  = msg.payload.paused;
      // 回放结束 → 清除播放高亮
      if (!replayRunning && currentPlayingId != null) {
        clearPlaying(currentPlayingId);
      }
      renderAll();
    }
  });

  // 录制组
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
    downloadBtn.textContent = '准备中…';
    port.postMessage({ type: 'cmd', cmd: 'download', windowId });
  });

  // 回放组（speed/maxStepDelayMs 可放在 args 里）
  replayStartBtn.addEventListener('click', () => {
    port.postMessage({ type: 'cmd', cmd: 'replay_start', windowId, args: {} });
    replayRunning = true; replayPaused = false; renderAll();
  });
  replayPauseBtn.addEventListener('click', () => {
    port.postMessage({ type: 'cmd', cmd: 'replay_pause', windowId });
    replayPaused = true; renderAll();
  });
  replayResumeBtn.addEventListener('click', () => {
    port.postMessage({ type: 'cmd', cmd: 'replay_resume', windowId });
    replayPaused = false; renderAll();
  });
  replayStopBtn.addEventListener('click', () => {
    port.postMessage({ type: 'cmd', cmd: 'replay_stop', windowId });
    replayRunning = false; replayPaused = false; renderAll();
  });
}

init();
