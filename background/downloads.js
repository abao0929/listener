// background/downloads.js
export async function downloadWindowLogs(windowId, store) {
  const manifest = chrome.runtime.getManifest();
  const data = {
    meta: {
      exportedAt: new Date().toISOString(),
      extensionVersion: manifest.version,
      windowId
    },
    logs: store.snapshot(windowId)
  };
  const json = JSON.stringify(data, null, 2);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dataUrl = "data:application/json;charset=utf-8," + encodeURIComponent(json);

  await chrome.downloads.download({
    url: dataUrl,
    filename: `event-logs/window-${windowId}-${stamp}.json`,
    saveAs: true
  });
}
