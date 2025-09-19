// instructor.js
// This script powers the instructor dashboard.  It retrieves aggregated
// signals and tasks from the background service worker and displays them.
// Because this extension does not yet connect to a backend, the list of
// students and their engagement scores is mocked for illustrative purposes.

document.addEventListener('DOMContentLoaded', () => {
  // Fetch aggregated data from the background service worker.  If this
  // extension were installed by multiple users on the same course, the
  // backend could merge these counts.  Here we simply retrieve data from
  // storage via messaging.
  chrome.runtime.sendMessage({ type: 'getAggregatedData' }, (data) => {
    if (chrome.runtime.lastError) {
      console.warn('Inferno: could not retrieve aggregated data', chrome.runtime.lastError);
      data = { signals: { low: 0, medium: 0, high: 0 }, tasks: [] };
    }
    displaySignals(data.signals || { low: 0, medium: 0, high: 0 });
    displayStudents();
  });

  // Render the signal counts into cards.  Each card shows a label and a
  // count.  If no data is available, counts default to zero.
  function displaySignals(signals) {
    const container = document.getElementById('signals-container');
    // Remove any existing children
    while (container.firstChild) container.removeChild(container.firstChild);
    const types = [
      { type: 'low',    label: 'Low Understanding 😕' },
      { type: 'medium', label: 'Medium Understanding 😐' },
      { type: 'high',   label: 'High Understanding 😊' }
    ];
    types.forEach(item => {
      const card = document.createElement('div');
      card.className = 'signal-card';
      const labelEl = document.createElement('div');
      labelEl.textContent = item.label;
      const countEl = document.createElement('div');
      countEl.className = 'count';
      const countVal = signals && typeof signals[item.type] === 'number' ? signals[item.type] : 0;
      countEl.textContent = countVal;
      card.appendChild(labelEl);
      card.appendChild(countEl);
      container.appendChild(card);
    });
  }

  // Render a list of student cards.  For now we mock five students with
  // predetermined progress values.  Each card shows the student name,
  // avatar tinted based on progress, and a horizontal progress bar.
  function displayStudents() {
    const students = [
      { name: 'Student A', progress: 0.80 },
      { name: 'Student B', progress: 0.45 },
      { name: 'Student C', progress: 0.65 },
      { name: 'Student D', progress: 0.20 },
      { name: 'Student E', progress: 0.92 }
    ];
    const container = document.getElementById('students-container');
    // Clear existing
    while (container.firstChild) container.removeChild(container.firstChild);
    students.forEach(stu => {
      const card = document.createElement('div');
      card.className = 'student-card';
      const nameEl = document.createElement('div');
      nameEl.className = 'name';
      nameEl.textContent = stu.name;
      const avatar = document.createElement('img');
      avatar.className = 'avatar';
      avatar.src = chrome.runtime.getURL('icons/avatar.png');
      // Tint avatar by adjusting opacity: 40% base + progress * 60%
      avatar.style.filter = 'opacity(' + (0.4 + stu.progress * 0.6) + ')';
      const progressContainer = document.createElement('div');
      progressContainer.className = 'progress-container';
      const progressBar = document.createElement('div');
      progressBar.className = 'progress-bar';
      progressBar.style.width = (stu.progress * 100) + '%';
      progressContainer.appendChild(progressBar);
      card.appendChild(nameEl);
      card.appendChild(avatar);
      card.appendChild(progressContainer);
      container.appendChild(card);
    });
  }
});