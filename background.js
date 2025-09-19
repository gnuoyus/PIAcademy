// background.js
// The background script acts as a lightweight service worker that listens for
// messages from content scripts and aggregates high-level data to support
// instructor dashboards.  In this basic implementation it simply counts
// signals sent by students (confused/agree/question) and keeps a copy of
// each student’s task completion status.  In a future iteration this could
// forward information to a backend or sync across users.

// Keep aggregated signal counts.  Each key holds an integer representing
// how many times students selected a level of understanding.  The keys
// correspond to three levels: low (red), medium (blue) and high (green).
let aggregatedSignals = { low: 0, medium: 0, high: 0 };

// Keep the last known tasks array from any content script.  Because this
// extension is per-user, this is primarily used to support the instructor
// dashboard sample rather than truly multi-user aggregation.
let lastTasksStatus = [];

// Listen for messages from content scripts.  Accept three types of
// messages:
//  - {type:'signal', signal:'low'|'medium'|'high'}: increments the
//    appropriate understanding level counters.
//  - {type:'tasksStatus', tasks:[...] }: caches the tasks array.
//  - {type:'getAggregatedData'}: returns the current aggregated counts and
//    tasks to the caller via sendResponse().
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'signal': {
      const s = msg.signal;
      if (s && Object.prototype.hasOwnProperty.call(aggregatedSignals, s)) {
        aggregatedSignals[s]++;
        // Persist to storage so signals survive service worker restarts
        chrome.storage.local.set({ aggregatedSignals });
      }
      break;
    }
    case 'tasksStatus': {
      lastTasksStatus = msg.tasks || [];
      chrome.storage.local.set({ lastTasksStatus });
      break;
    }
    case 'getAggregatedData': {
      // Respond with deep copies to avoid accidental modification
      sendResponse({
        signals: Object.assign({}, aggregatedSignals),
        tasks: Array.isArray(lastTasksStatus) ? lastTasksStatus.slice() : []
      });
      break;
    }
  }
  // Indicate we intend to respond asynchronously if we handled getAggregatedData
  return true;
});

// When the service worker starts, restore persisted data from storage
chrome.storage.local.get(['aggregatedSignals', 'lastTasksStatus'], (data) => {
  if (data.aggregatedSignals) {
    aggregatedSignals = data.aggregatedSignals;
  }
  if (data.lastTasksStatus) {
    lastTasksStatus = data.lastTasksStatus;
  }
});