import type { Message } from '../shared/messages.js';

let port: chrome.runtime.Port | null = null;

function broadcastError(message: string) {
  const errorMsg: Message = { type: 'error', message };
  chrome.runtime.sendMessage(errorMsg, () => {
    chrome.runtime.lastError; // swallow "receiving end does not exist" when panel is closed
  });
}

function connectPort() {
  port = chrome.runtime.connectNative('com.pi.browser_agent');
  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message || 'Native host disconnected. Is Pi installed and the native messaging host registered?';
    console.error('[background] native port disconnected:', error);
    broadcastError(error);
    port = null;
  });
  port.onMessage.addListener((msg: Message) => {
    if (msg.type === 'tool_call' && !msg.ui) {
      const toolCallMsg = msg as Extract<Message, { type: 'tool_call' }>;
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (!tabId) {
          const error = 'No active tab found to execute browser tool.';
          console.error('[background]', error);
          if (port) port.postMessage({ type: 'tool_result', id: toolCallMsg.id, result: { error }, elapsedMs: 0 });
          return;
        }
        function forwardToolCall(attemptInject = true) {
          chrome.tabs.sendMessage(tabId!, toolCallMsg, (res) => {
            const lastError = chrome.runtime.lastError?.message;
            if (lastError || !res) {
              if (attemptInject && lastError?.includes('Could not establish connection')) {
                console.error('[background] content script not found, injecting...');
                chrome.scripting.executeScript(
                  { target: { tabId: tabId! }, files: ['content.js'] },
                  () => {
                    const injectError = chrome.runtime.lastError?.message;
                    if (injectError) {
                      const error = `Failed to inject content script: ${injectError}`;
                      console.error('[background]', error);
                      if (port) port.postMessage({ type: 'tool_result', id: toolCallMsg.id, result: { error }, elapsedMs: 0 });
                      return;
                    }
                    // Retry once after injection.
                    forwardToolCall(false);
                  }
                );
                return;
              }
              const error = lastError ? `Content script error: ${lastError}` : 'Content script did not respond. Try reloading the page.';
              console.error('[background]', error, toolCallMsg);
              if (port) port.postMessage({ type: 'tool_result', id: toolCallMsg.id, result: { error }, elapsedMs: 0 });
              return;
            }
            if (res && port) {
              port.postMessage(res);
            }
          });
        }
        forwardToolCall();
      });
    } else {
      chrome.runtime.sendMessage(msg, () => {
        chrome.runtime.lastError; // swallow when no extension page is listening
      });
    }
  });
}

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id! }).catch((err: Error) => {
    console.error('[background] sidePanel.open failed:', err.message);
  });
  if (!port) connectPort();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'open_side_panel') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: 'no sender tab' });
      return false;
    }
    (async () => {
      try {
        await chrome.sidePanel.open({ tabId });
      } catch (err: any) {
        console.error('[background] sidePanel.open failed:', err.message);
      }
    })();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'clear_chat') {
    chrome.runtime.sendMessage(msg, () => {
      chrome.runtime.lastError; // swallow when panel is closed
    });
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'capture_tab') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      const windowId = tab?.windowId;
      if (!windowId) {
        sendResponse({ error: 'No active window to capture.' });
        return;
      }
      chrome.tabs.captureVisibleTab(windowId, { format: 'png' }).then((dataUrl) => {
        sendResponse({ screenshot: dataUrl });
      }).catch((err: Error) => {
        sendResponse({ error: err.message });
      });
    });
    return true;
  }
  if (!port) connectPort();
  if (msg.type === 'get_config') {
    if (!port) {
      const error = 'Native host not connected. Please run `npm run install:host` and reload the extension.';
      broadcastError(error);
      sendResponse({ ok: false, error });
      return true;
    }
    try {
      port.postMessage(msg);
      sendResponse({ ok: true });
    } catch (err: any) {
      const error = `Failed to send message to native host: ${err.message}`;
      broadcastError(error);
      sendResponse({ ok: false, error });
      port = null;
    }
    return true;
  }
  if (msg.type === 'user' || msg.type === 'tool_result') {
    if (!port) {
      const error = 'Native host not connected. Please run `npm run install:host` and reload the extension.';
      broadcastError(error);
      sendResponse({ ok: false, error });
      return true;
    }
    try {
      port.postMessage(msg);
      sendResponse({ ok: true });
    } catch (err: any) {
      const error = `Failed to send message to native host: ${err.message}`;
      broadcastError(error);
      sendResponse({ ok: false, error });
      port = null;
    }
    return true;
  }
  sendResponse({ ok: false });
});
