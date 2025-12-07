/**
 * ReadEase Popup Script
 * v1.5 - Opens the floating side panel
 */

(function() {
  'use strict';

  document.getElementById('openPanelBtn').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }, (response) => {
          if (chrome.runtime.lastError) {
            // Content script not loaded, try reloading the page
            alert('Please refresh the page to use ReadEase.');
            return;
          }
          // Close popup after opening panel
          window.close();
        });
      }
    } catch (e) {
      console.error('Error opening panel:', e);
    }
  });
})();
