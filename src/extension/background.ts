import type { Message } from '../shared/messages.js';

let port: chrome.runtime.Port | null = null;

function connectPort() {
  port = chrome.runtime.connectNative('com.pi.browser_agent');
  port.onDisconnect.addListener(() => {
    console.error('[background] native port disconnected', chrome.runtime.lastError);
    port = null;
  });
  port.onMessage.addListener((msg: Message) => {
    if (msg.type === 'tool_call' && !msg.ui) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (tabId) {
          chrome.tabs.sendMessage(tabId, msg, (res) => {
            if (res && port) port.postMessage(res);
          });
        }
      });
    } else {
      chrome.runtime.sendMessage(msg).catch(() => {});
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
    chrome.runtime.sendMessage(msg).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'capture_tab') {
    chrome.tabs.captureVisibleTab({ format: 'png' }).then((dataUrl) => {
      sendResponse({ screenshot: dataUrl });
    }).catch((err: Error) => {
      sendResponse({ error: err.message });
    });
    return true;
  }
  if (!port) connectPort();
  if (msg.type === 'user' && port) {
    port.postMessage(msg);
    sendResponse({ ok: true });
  } else if (msg.type === 'tool_result' && port) {
    port.postMessage(msg);
    sendResponse({ ok: true });
  } else {
    sendResponse({ ok: false });
  }
  return true;
});
