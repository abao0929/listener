// background/commands.js
import { downloadWindowLogs } from './downloads.js';
import { Replayer } from './replay.js';

const _replayers = new Map(); // windowId -> Replayer

function getReplayer(windowId, deps) {
  if (!_replayers.has(windowId)) _replayers.set(windowId, new Replayer(deps));
  return _replayers.get(windowId);
}

export function makeCommandRouter({ controller, store, hub, log }) {
  return async function route({ cmd, windowId, port, args }) {
    switch (cmd) {
      case 'start': return controller.start(windowId);
      case 'stop':  return controller.stop(windowId);
      case 'clear': {
        await store.clear(windowId);
        hub.broadcast(windowId, { type: 'logs_cleared' });
        return;
      }
      case 'download': {
        try { await downloadWindowLogs(windowId, store); port?.postMessage({ type: 'download_ok' }); }
        catch (e) { port?.postMessage({ type: 'download_err', payload: String(e?.message || e) }); }
        return;
      }

      // 回放控制
      case 'replay_start': {
        const r = getReplayer(windowId, { store, hub });
        hub.broadcast(windowId, { type: 'replay_state', payload: { running: true,  paused: false } });
        r.start(windowId, args || {}).catch(()=>{});
        return;
      }
      case 'replay_pause': {
        const r = getReplayer(windowId, { store, hub });
        r.pause(windowId);
        hub.broadcast(windowId, { type: 'replay_state', payload: { paused: true } });
        return;
      }
      case 'replay_resume': {
        const r = getReplayer(windowId, { store, hub });
        r.resume(windowId);
        hub.broadcast(windowId, { type: 'replay_state', payload: { paused: false } });
        return;
      }
      case 'replay_stop': {
        const r = getReplayer(windowId, { store, hub });
        r.stop(windowId);
        // 这里不必再广播，Replayer.stop 已经广播；留着也无害
        return;
      }
      default:
        console.warn('Unknown cmd:', cmd);
    }
  };
}
