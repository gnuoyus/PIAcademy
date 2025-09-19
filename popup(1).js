// popup.js
// This script runs in the context of the extension popup.  It provides
// navigation to the instructor dashboard when the user clicks the button.
document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('open-instructor');
  if (button) {
    button.addEventListener('click', () => {
      // Open the instructor dashboard in a new tab
      chrome.tabs.create({ url: chrome.runtime.getURL('instructor.html') });
    });
  }
});