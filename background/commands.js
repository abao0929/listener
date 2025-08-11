// background/commands.js
import { downloadWindowLogs } from './downloads.js';

export function makeCommandRouter({ controller, store, hub, log }) {
  return async function route({ cmd, windowId, port }) {
    switch (cmd) {
      case 'start': return controller.start(windowId);
      case 'stop':  return controller.stop(windowId);
      case 'clear': {
        await store.clear(windowId);
        hub.broadcast(windowId, { type: 'logs_cleared' });
        return;
      }
      case 'download': {
        try {
          await downloadWindowLogs(windowId, store);
          port?.postMessage({ type: 'download_ok' });
        } catch (e) {
          port?.postMessage({ type: 'download_err', payload: String(e?.message || e) });
        }
        return;
      }
      default:
        console.warn('Unknown cmd:', cmd);
    }
  };
}
