// contentScript.js (enhanced student view)
// This script injects the student-facing Inferno widget into Canvas pages.  It
// features a colour-changing avatar whose hue reflects the student’s self-
// reported understanding level (high/medium/low) and whose size scales with
// task completion.  The widget contains two collapsible panels: one for
// daily tasks and one for a simple community channel.  The tasks panel
// includes a progress bar, a checklist of assignments, a prompt for
// understanding feedback and a link to the assignments page.  The channel
// panel demonstrates how students might chat within the extension.

(function () {
  if (window.infernoWidgetInjected) return;
  window.infernoWidgetInjected = true;

  /*** Data storage keys ***/
  const TASKS_KEY = "infernoTasks";
  const UNDERSTANDING_KEY = "infernoUnderstandingLevel";
  const MESSAGES_KEY = "infernoChannelMessages";

  /*** Load and save helpers ***/
  function loadTasks() {
    try {
      const stored = JSON.parse(localStorage.getItem(TASKS_KEY));
      if (Array.isArray(stored)) return stored;
    } catch (e) {}
    return [
      { id: "task1", title: "Daily Task 1", completed: false },
      { id: "task2", title: "Daily Task 2", completed: false },
      { id: "task3", title: "Daily Task 3", completed: false },
      { id: "task4", title: "Daily Task 4", completed: false },
    ];
  }
  function saveTasks(list) {
    localStorage.setItem(TASKS_KEY, JSON.stringify(list));
  }
  function loadUnderstanding() {
    return localStorage.getItem(UNDERSTANDING_KEY) || "none";
  }
  function saveUnderstanding(level) {
    localStorage.setItem(UNDERSTANDING_KEY, level);
  }
  function loadMessages() {
    try {
      const stored = JSON.parse(localStorage.getItem(MESSAGES_KEY));
      if (Array.isArray(stored)) return stored;
    } catch (e) {}
    return [];
  }
  function saveMessages(list) {
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(list));
  }

  /*** Root widget and header ***/
  const widget = document.createElement("div");
  widget.id = "inferno-widget";

  // Header with flame icon, title and collapse toggle
  const header = document.createElement("div");
  header.className = "inferno-header";

  const flameIcon = document.createElement("img");
  flameIcon.className = "inferno-flame-icon";
  flameIcon.src = chrome.runtime.getURL("icons/icon16.png");
  flameIcon.alt = "";
  header.appendChild(flameIcon);

  const titleSpan = document.createElement("span");
  titleSpan.className = "inferno-title";
  titleSpan.textContent = "Study Motivation";
  header.appendChild(titleSpan);

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "inferno-toggle";
  toggleBtn.textContent = "-";
  toggleBtn.addEventListener("click", () => {
    const collapsed = widget.classList.toggle("collapsed");
    toggleBtn.textContent = collapsed ? "+" : "-";
  });
  header.appendChild(toggleBtn);
  widget.appendChild(header);

  /*** Body container ***/
  const body = document.createElement("div");
  body.className = "inferno-body";

  // Avatar container
  const avatarContainer = document.createElement("div");
  avatarContainer.className = "inferno-avatar";
  const avatarWrapper = document.createElement("div");
  avatarWrapper.className = "inferno-avatar-svg";
  avatarWrapper.innerHTML = `
    <svg width="80" height="100" viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g fill="currentColor">
        <path d="M50 10 c 25 0 35 15 35 45 s -10 45 -35 45 s -35 -15 -35 -45 s 10 -45 35 -45 z" />
        <ellipse cx="35" cy="60" rx="6" ry="8" fill="white" />
        <ellipse cx="65" cy="60" rx="6" ry="8" fill="white" />
        <circle cx="35" cy="60" r="3" fill="#4a4a4a" />
        <circle cx="65" cy="60" r="3" fill="#4a4a4a" />
        <rect x="45" y="80" width="10" height="10" rx="2" fill="#4a4a4a" />
      </g>
      <ellipse cx="32" cy="20" rx="6" ry="10" fill="currentColor" />
      <ellipse cx="68" cy="20" rx="6" ry="10" fill="currentColor" />
    </svg>
  `;
  avatarContainer.appendChild(avatarWrapper);
  body.appendChild(avatarContainer);

  /*** Tasks panel ***/
  const tasksPanel = document.createElement("div");
  tasksPanel.className = "inferno-panel tasks-panel";
  const tasksHeader = document.createElement("div");
  tasksHeader.className = "inferno-panel-header";
  // Icon for daily tasks (calendar)
  const tasksIcon = document.createElement("span");
  tasksIcon.className = "inferno-panel-icon";
  tasksIcon.textContent = "📅";
  const tasksTitle = document.createElement("span");
  tasksTitle.className = "inferno-panel-title";
  tasksTitle.textContent = "Daily Tasks";
  const tasksArrow = document.createElement("span");
  tasksArrow.className = "inferno-panel-arrow";
  tasksArrow.textContent = "▾";
  // Assemble header: icon + title + arrow
  tasksHeader.appendChild(tasksIcon);
  tasksHeader.appendChild(tasksTitle);
  tasksHeader.appendChild(tasksArrow);
  tasksPanel.appendChild(tasksHeader);
  const tasksBody = document.createElement("div");
  tasksBody.className = "inferno-panel-body";
  tasksPanel.appendChild(tasksBody);
  body.appendChild(tasksPanel);

  // Inside tasksBody: status, progress bar, task list, understanding prompt, emoji row, view assignments link
  const statusText = document.createElement("p");
  statusText.className = "inferno-status";
  statusText.id = "inferno-status-text";
  tasksBody.appendChild(statusText);

  const progressContainer = document.createElement("div");
  progressContainer.className = "inferno-progress";
  const progressBar = document.createElement("div");
  progressBar.className = "inferno-progress-bar";
  progressBar.id = "inferno-progress-bar";
  progressContainer.appendChild(progressBar);
  tasksBody.appendChild(progressContainer);

  const taskList = document.createElement("ul");
  taskList.className = "inferno-task-list";
  taskList.id = "inferno-task-list";
  tasksBody.appendChild(taskList);

  // Understanding prompt
  const understandingPrompt = document.createElement("p");
  understandingPrompt.className = "inferno-understanding-prompt";
  understandingPrompt.textContent =
    "What is your level of understanding? Please click an emoji.";
  tasksBody.appendChild(understandingPrompt);

  // Emoji signals for understanding
  const understandingDiv = document.createElement("div");
  understandingDiv.className = "inferno-signals";
  const understandingSignals = [
    { type: "low", emoji: "😕", title: "Low Understanding" },
    { type: "medium", emoji: "😐", title: "Medium Understanding" },
    { type: "high", emoji: "😊", title: "High Understanding" },
  ];
  understandingSignals.forEach((sig) => {
    const btn = document.createElement("button");
    btn.className = "inferno-signal-btn";
    btn.title = sig.title;
    btn.textContent = sig.emoji;
    btn.addEventListener("click", () => {
      // Save understanding level
      currentUnderstanding = sig.type;
      saveUnderstanding(currentUnderstanding);
      updateAvatarColor();
      chrome.runtime.sendMessage({ type: "signal", signal: sig.type });
      // Visual feedback
      btn.classList.add("active");
      setTimeout(() => btn.classList.remove("active"), 800);
    });
    understandingDiv.appendChild(btn);
  });
  tasksBody.appendChild(understandingDiv);

  // View assignments link
  const viewAll = document.createElement("a");
  viewAll.className = "inferno-view-all";
  viewAll.textContent = "View all assignments →";
  // Link to the assignments page relative to Canvas origin
  viewAll.href = window.location.origin + "/assignments";
  tasksBody.appendChild(viewAll);

  // Toggle tasks panel visibility by collapsing the entire panel
  tasksHeader.addEventListener("click", () => {
    const collapsed = tasksPanel.classList.toggle("collapsed");
    tasksArrow.textContent = collapsed ? "▸" : "▾";
  });

  /*** Channel panel ***/
  const channelPanel = document.createElement("div");
  channelPanel.className = "inferno-panel channel-panel";
  const channelHeader = document.createElement("div");
  channelHeader.className = "inferno-panel-header";
  // Icon for channel (chat)
  const channelIcon = document.createElement("span");
  channelIcon.className = "inferno-panel-icon";
  channelIcon.textContent = "💬";
  const channelTitle = document.createElement("span");
  channelTitle.className = "inferno-panel-title";
  channelTitle.textContent = "Channel";
  const channelArrow = document.createElement("span");
  channelArrow.className = "inferno-panel-arrow";
  channelArrow.textContent = "▾";
  channelHeader.appendChild(channelIcon);
  channelHeader.appendChild(channelTitle);
  channelHeader.appendChild(channelArrow);
  channelPanel.appendChild(channelHeader);
  const channelBody = document.createElement("div");
  channelBody.className = "inferno-panel-body";
  channelPanel.appendChild(channelBody);
  body.appendChild(channelPanel);

  // Messages list
  const messagesList = document.createElement("ul");
  messagesList.className = "inferno-channel-messages";
  channelBody.appendChild(messagesList);

  // Message input and send button
  const messageInputContainer = document.createElement("div");
  messageInputContainer.className = "inferno-channel-input";
  const messageInput = document.createElement("input");
  messageInput.type = "text";
  messageInput.placeholder = "Say something...";
  // input styling via CSS .inferno-channel-input input
  const sendBtn = document.createElement("button");
  sendBtn.textContent = "Send";
  // button styling via CSS .inferno-channel-input button
  sendBtn.addEventListener("click", () => {
    const text = messageInput.value.trim();
    if (!text) return;
    messages.push({ text, time: Date.now() });
    saveMessages(messages);
    renderMessages();
    messageInput.value = "";
  });
  messageInputContainer.appendChild(messageInput);
  messageInputContainer.appendChild(sendBtn);
  channelBody.appendChild(messageInputContainer);

  // Toggle channel panel visibility by collapsing the entire panel
  channelHeader.addEventListener("click", () => {
    const collapsed = channelPanel.classList.toggle("collapsed");
    channelArrow.textContent = collapsed ? "▸" : "▾";
  });

  // Assemble body into widget
  widget.appendChild(body);
  document.body.appendChild(widget);

  /*** Data initialization ***/
  let tasks = loadTasks();
  let messages = loadMessages();
  let currentUnderstanding = loadUnderstanding();

  /*** Rendering functions ***/
  function renderTasks() {
    taskList.innerHTML = "";
    tasks.forEach((task) => {
      const li = document.createElement("li");
      li.className = "inferno-task";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !!task.completed;
      checkbox.id = "inferno-task-" + task.id;
      checkbox.addEventListener("change", () => {
        task.completed = checkbox.checked;
        saveTasks(tasks);
        updateProgress();
        chrome.runtime.sendMessage({ type: "tasksStatus", tasks });
        li.classList.toggle("completed", checkbox.checked);
      });
      const label = document.createElement("label");
      label.htmlFor = "inferno-task-" + task.id;
      label.textContent = task.title;
      li.appendChild(checkbox);
      li.appendChild(label);
      li.classList.toggle("completed", task.completed);
      taskList.appendChild(li);
    });
  }

  function updateProgress() {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.completed).length;
    const percent = total > 0 ? completed / total : 0;
    progressBar.style.width = percent * 100 + "%";
    const percentRounded = Math.round(percent * 100);
    if (percent <= 0.25) {
      statusText.textContent = "May all your bacon burn! Let's get started!";
    } else if (percent <= 0.5) {
      statusText.textContent = `I\'m getting warmer! (${percentRounded}%)`;
    } else if (percent < 1) {
      statusText.textContent = `My flames are dancing! (${percentRounded}%)`;
    } else {
      statusText.textContent = `🎉 I\'m blazing magnificently!`;
    }
    // Scale avatar size based on progress (0.6 to 1.0)
    const scale = 0.6 + percent * 0.4;
    avatarWrapper.style.transform = `scale(${scale})`;
  }

  function updateAvatarColor() {
    let colour;
    switch (currentUnderstanding) {
      case "low":
        colour = "#E53935";
        break; // red
      case "medium":
        colour = "#00B0FF";
        break; // blue
      case "high":
        colour = "#00C853";
        break; // green
      default:
        colour = "#C7CBD2"; // grey for none
    }
    widget.style.setProperty("--avatar-color", colour);
  }

  function renderMessages() {
    messagesList.innerHTML = "";
    if (messages.length === 0) {
      const empty = document.createElement("li");
      empty.className = "inferno-channel-message inferno-message-empty";
      empty.textContent = "No messages yet — be the first to say hi!";
      messagesList.appendChild(empty);
    } else {
      messages.forEach((msg) => {
        const li = document.createElement("li");
        li.className = "inferno-channel-message";
        li.textContent = msg.text;
        messagesList.appendChild(li);
      });
    }
  }

  /*** Initialise UI ***/
  renderTasks();
  updateProgress();
  updateAvatarColor();
  renderMessages();

  // Inform background script of current tasks on load
  chrome.runtime.sendMessage({ type: "tasksStatus", tasks });
})();
