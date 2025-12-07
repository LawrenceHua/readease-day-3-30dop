/**
 * ReadEase Background Service Worker
 * v1.1 - Added per-tab state tracking and keyboard shortcut support
 */

// Track active state per tab
const tabStates = new Map();

// Listen for tab updates - reset state if page reloads
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    tabStates.delete(tabId);
  }
});

// Listen for tab removal - clean up state
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});

// Handle messages from content script for state tracking
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SET_TAB_STATE' && sender.tab?.id) {
    tabStates.set(sender.tab.id, message.isActive);
    sendResponse({ success: true });
  }
  if (message.type === 'GET_TAB_STATE' && sender.tab?.id) {
    sendResponse({ isActive: tabStates.get(sender.tab.id) || false });
  }
  return true;
});

// Handle keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-readease') {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE' }, (response) => {
          if (chrome.runtime.lastError) {
            console.log('ReadEase: Cannot toggle on this page');
            return;
          }
          if (response) {
            tabStates.set(tab.id, response.isActive);
          }
        });
      }
    } catch (error) {
      console.error('ReadEase: Toggle error:', error);
    }
  }
});

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    readease_settings: {
      bionicEnabled: true,
      filterEnabled: false,
      filterStrength: 40
    }
  });
  console.log('ReadEase installed (v1.1)');
});

console.log('ReadEase background service worker loaded (v1.1)');
