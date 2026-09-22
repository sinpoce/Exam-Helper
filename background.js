// Background Service Worker: one cancellable request per content-script batch.
importScripts('modules/ai-client.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
chrome.action.onClicked.addListener(tab => chrome.sidePanel.open({ tabId: tab.id }));

const pendingRequests = new Map();
function requestKey(sender, id) {
  return `${sender.tab?.id ?? 'popup'}:${sender.frameId ?? 0}:${id}`;
}
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'cancelAI') {
    pendingRequests.get(requestKey(sender, request.requestId))?.abort();
    sendResponse({ success: true });
    return;
  }
  if (!['callAI', 'analyzeHTML'].includes(request.action)) return;
  const key = requestKey(sender, request.requestId || crypto.randomUUID());
  if (pendingRequests.has(key)) {
    sendResponse({ success: false, error: '重复请求', fatal: true });
    return;
  }
  const controller = new AbortController();
  pendingRequests.set(key, controller);
  const mode = request.action === 'analyzeHTML' ? 'analyze' : request.mode === 'batch' ? 'batch' : 'answer';
  AIClient.request(request.config, request.prompt, {
    mode, timeoutMs: request.timeoutMs || (mode === 'analyze' ? 90000 : 45000), signal: controller.signal,
  }).then(data => sendResponse({ success: true, data }))
    .catch(error => sendResponse({ success: false, error: error.message, code: error.code, fatal: error.fatal, status: error.status }))
    .finally(() => pendingRequests.delete(key));
  return true;
});
