// contentScript.js
//
// This script injects the Inferno extension UI into Canvas pages for both
// students and instructors.  It detects the user role via localStorage
// (defaulting to 'student') and builds either a student engagement widget
// or an instructor overview panel.  The student view includes a dynamically
// generated task list (assignments), a colour‑changing avatar whose size
// grows as tasks are completed, a peer matching section and a messaging
// system.  The instructor view shows a summary of class understanding
// levels, a list of students with progress and grades, and quick links to
// message each student.

(function () {
  // Prevent multiple injections
  if (window.infernoInjected) return;
  window.infernoInjected = true;

  /*** Configuration and constants ***/
  // Storage keys
  const TASKS_KEY = "infernoTasks";
  const UNDERSTANDING_KEY = "infernoUnderstandingLevel";
  const CONVOS_KEY = "infernoConversations";
  const STUDENTS_KEY = "infernoStudents";
  const ROLE_KEY = "infernoRole";

  // Understanding colour map
  const understandingColours = {
    low: "#E53935", // red ring colour
    medium: "#00B0FF", // blue ring colour
    high: "#00C853", // green ring colour
    none: "#C7CBD2", // grey (default)
  };

  // Define gradient start and end colours for the custom fire avatar.  These
  // colours correspond to the three understanding levels.  The 'none' value
  // falls back to grey.
  const avatarGradientColours = {
    low: { start: "#F97316", end: "#EF4444" }, // red/orange gradient
    medium: { start: "#38BDF8", end: "#3B82F6" }, // blue gradient
    high: { start: "#19C37D", end: "#0FBF63" }, // green gradient
    none: { start: "#C7CBD2", end: "#C7CBD2" }, // neutral grey
  };
  const avatarEarTips = {
    low: "#FDBA74",
    medium: "#93C5FD",
    high: "#7CE9C3",
    none: "#E4E7EB",
  };

  /**
   * Create a fire avatar element with optional glow and pulse.  This helper
   * supports different size presets: 'xs'≈16px, 'sm'≈20px, 'md'≈36px, 'lg'≈72px.
   * It returns a wrapper span containing an SVG.  A pulsing halo is applied via
   * CSS; to disable pulse or glow, pass false for those flags.  The wrapper
   * sets a CSS custom property --avatar-color used by the glow.
   *
   * @param {string} level   'low' | 'medium' | 'high' | 'none' indicating colour
   * @param {string|number} sizeKey  Preset key or explicit pixel size (defaults to 'md')
   * @param {boolean} glow    Whether to render the halo (default true)
   * @param {boolean} pulse   Whether to animate the halo (default true)
   * @param {boolean} ring    Whether to draw an outer stroke ring (default false)
   */
  function createFireAvatar(
    level = "none",
    sizeKey = "md",
    glow = true,
    pulse = true,
    ring = false
  ) {
    const sizeMap = { xs: 16, sm: 20, md: 36, lg: 72 };
    const size =
      typeof sizeKey === "number" ? sizeKey : sizeMap[sizeKey] || sizeMap.md;
    const colours = avatarGradientColours[level] || avatarGradientColours.none;
    const earTipColour = avatarEarTips[level] || avatarEarTips.none;
    const uniqueId = Math.random().toString(36).substr(2, 9);
    const bodyGradientId = "infernoGradientBody-" + uniqueId;
    const earGradientId = "infernoGradientEar-" + uniqueId;
    const wrapper = document.createElement("span");
    wrapper.className = "inferno-fire-avatar avatar-reset";
    wrapper.style.width = size + "px";
    wrapper.style.height = size + "px";
    const glowColour = understandingColours[level] || understandingColours.none;
    wrapper.style.setProperty("--avatar-color", glowColour);

    const svgClasses = ["inferno-fire-svg"];
    if (glow) svgClasses.push("inferno-fire-glow");
    if (pulse) svgClasses.push("inferno-fire-pulse");

    const ringMarkup = ring
      ? `<circle cx="50" cy="50" r="48" fill="none" stroke="${glowColour}" stroke-width="2" />`
      : "";

    wrapper.innerHTML = `
      <svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="${svgClasses.join(
      " "
    )}">
        <defs>
          <linearGradient id="${bodyGradientId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${colours.start}" />
            <stop offset="100%" stop-color="${colours.end}" />
          </linearGradient>
          <linearGradient id="${earGradientId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${earTipColour}" />
            <stop offset="100%" stop-color="${colours.start}" />
          </linearGradient>
        </defs>
        ${ringMarkup}
        <path d="M50 16c16 0 28 12 28 28 0 10-5 18-12 23-4 3-8 6-16 6s-12-3-16-6c-7-5-12-13-12-23 0-16 12-28 28-28z" fill="url(#${bodyGradientId})" />
        <path d="M36 12 q4 -6 8 0" stroke="url(#${earGradientId})" stroke-width="8" stroke-linecap="round" fill="none" />
        <path d="M56 12 q4 -6 8 0" stroke="url(#${earGradientId})" stroke-width="8" stroke-linecap="round" fill="none" />
        <circle cx="38" cy="20" r="6" fill="url(#${bodyGradientId})" />
        <circle cx="62" cy="20" r="6" fill="url(#${bodyGradientId})" />
        <circle cx="42" cy="46" r="6" fill="#ffffff" />
        <circle cx="58" cy="46" r="6" fill="#ffffff" />
        <circle cx="42" cy="46" r="3" fill="#111111" />
        <circle cx="58" cy="46" r="3" fill="#111111" />
        <rect x="46" y="58" width="8" height="8" rx="2" fill="#222222" />
      </svg>`;
    return wrapper;
  }

  // Attach a Dot helper to generate an xs avatar quickly
  createFireAvatar.Dot = function (level = "none") {
    return createFireAvatar(level, "xs");
  };

  // Instructor avatar sizing helpers (progress -> pixel size)
  const PROGRESS_AVATAR_MIN = 20; // 0%
  const PROGRESS_AVATAR_MAX = 48; // 100%
  const PROGRESS_AVATAR_GAMMA = 1.75;

  function clamp01(x) {
    return Math.min(1, Math.max(0, x));
  }

  function sizeFromProgressPercent(pct) {
    const t = clamp01(pct / 100);
    const eased = Math.pow(t, PROGRESS_AVATAR_GAMMA); // power ease to favor top end
    let px =
      PROGRESS_AVATAR_MIN + (PROGRESS_AVATAR_MAX - PROGRESS_AVATAR_MIN) * eased;

    if (pct >= 100) {
      px += 2; // subtle celebratory bump at full completion
    }

    return Math.round(px);
  }

  // Determine user role (student or instructor).  Developers can set
  // localStorage.infernoRole = 'instructor' to preview the instructor panel.
  const role = (localStorage.getItem(ROLE_KEY) || "student").toLowerCase();

  /*** Utility functions ***/
  function loadJSON(key, fallback) {
    try {
      const val = JSON.parse(localStorage.getItem(key));
      return val !== null && val !== undefined ? val : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  /*** Sample data factories (used when API access is unavailable) ***/
  // Generate sample assignments with due dates and point values
  function generateSampleAssignments() {
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    return [
      {
        id: "a1",
        title: "Daily Task 1",
        points: 5,
        dueDate: new Date(now.getTime() + dayMs * 2).toISOString(),
        completed: false,
      },
      {
        id: "a2",
        title: "Daily Task 2",
        points: 2,
        dueDate: new Date(now.getTime() + dayMs * 3).toISOString(),
        completed: false,
      },
      {
        id: "a3",
        title: "Daily Task 3",
        points: 3,
        dueDate: new Date(now.getTime() + dayMs * 4).toISOString(),
        completed: false,
      },
      {
        id: "a4",
        title: "Daily Task 4",
        points: 4,
        dueDate: new Date(now.getTime() + dayMs * 7).toISOString(),
        completed: false,
      },
    ];
  }
  // Generate sample channels for messages.  Each channel has conversations
  function generateSampleChannels() {
    return [
      {
        id: "ch1",
        title: "# general",
        type: "text",
        unread: 3,
        messages: [
          {
            sender: "Alice",
            text: "Hey everyone 👋",
            time: Date.now() - 7200000,
          },
          {
            sender: "Bob",
            text: "Working on the assignment right now.",
            time: Date.now() - 3600000,
          },
        ],
      },
      {
        id: "ch2",
        title: "# random",
        type: "text",
        unread: 0,
        messages: [
          {
            sender: "Charlie",
            text: "Anyone want to grab coffee?",
            time: Date.now() - 600000,
          },
        ],
      },
      {
        id: "dm1",
        title: "DMS",
        type: "dm",
        unread: 1,
        messages: [
          {
            sender: "Prof. Smith",
            text: "Don’t forget about the quiz tomorrow!",
            time: Date.now() - 86400000,
          },
        ],
      },
    ];
  }

  // Generate sample conversations with messages.  Each conversation has
  // participants (array of names), messages (array of {sender,text,time}).
  function generateSampleConversations() {
    return [
      {
        id: "c1",
        title: "Professor Smith",
        participants: ["Me", "Prof. Smith"],
        unread: 0,
        messages: [
          {
            sender: "Prof. Smith",
            text: "Don’t forget about the quiz tomorrow!",
            time: Date.now() - 86400000,
          },
          {
            sender: "Me",
            text: "Thanks for the reminder!",
            time: Date.now() - 80000000,
          },
        ],
      },
      {
        id: "c2",
        title: "CSE 101 Group",
        participants: ["Me", "Alice", "Bob"],
        unread: 2,
        messages: [
          {
            sender: "Alice",
            text: "Has anyone started the project yet?",
            time: Date.now() - 3600000,
          },
          {
            sender: "Bob",
            text: "Not yet, maybe we can meet this weekend.",
            time: Date.now() - 1800000,
          },
          {
            sender: "Me",
            text: "I can meet on Saturday afternoon.",
            time: Date.now() - 600000,
          },
        ],
      },
      {
        id: "c3",
        title: "Study Buddy (Jane)",
        participants: ["Me", "Jane"],
        unread: 1,
        messages: [
          {
            sender: "Jane",
            text: "Can you explain the last lecture to me?",
            time: Date.now() - 7200000,
          },
        ],
      },
    ];
  }
  // Generate sample student list for instructor panel
  function generateSampleStudents() {
    // Helper to generate a random timestamp within the past few days
    function randomPast(maxDays) {
      const now = Date.now();
      const offset = Math.floor(Math.random() * maxDays * 24 * 60 * 60 * 1000);
      return now - offset;
    }
    return [
      {
        id: "s1",
        name: "Alice",
        understanding: "high",
        grade: 92,
        tasksCompleted: 3,
        tasksTotal: 4,
        lastActive: randomPast(2),
        badges: { extraCredit: true, paired: true, needsHelp: false },
      },
      {
        id: "s2",
        name: "Bob",
        understanding: "medium",
        grade: 78,
        tasksCompleted: 2,
        tasksTotal: 4,
        lastActive: randomPast(3),
        badges: { extraCredit: false, paired: false, needsHelp: true },
      },
      {
        id: "s3",
        name: "Charlie",
        understanding: "low",
        grade: 65,
        tasksCompleted: 1,
        tasksTotal: 4,
        lastActive: randomPast(1),
        badges: { extraCredit: false, paired: false, needsHelp: true },
      },
      {
        id: "s4",
        name: "Dina",
        understanding: "high",
        grade: 88,
        tasksCompleted: 4,
        tasksTotal: 4,
        lastActive: randomPast(4),
        badges: { extraCredit: true, paired: false, needsHelp: false },
      },
      {
        id: "s5",
        name: "Ethan",
        understanding: "medium",
        grade: 71,
        tasksCompleted: 2,
        tasksTotal: 4,
        lastActive: randomPast(5),
        badges: { extraCredit: false, paired: false, needsHelp: true },
      },
    ];
  }

  /*** Role-based initialisation (unified panel) ***/
  // Instead of mounting separate widgets for students and instructors, we use a
  // single panel and switch the content based on the current role.  The
  // initInfernoPanel function builds the shared header and body, then renders
  // either the student or instructor view.  A segmented control in the header
  // allows switching between modes on the fly.
  initInfernoPanel();

  /**
   * Build the appropriate panel depending on the current role.
   * If the role is 'student', create the student widget.  If 'instructor',
   * initialise the instructor view.  This wrapper allows us to reuse the
   * same mode toggle in the header to switch between modes without
   * injecting multiple panels or taking over the full page.  When the
   * mode changes, the page reloads and the corresponding view is built.
   */
  function initInfernoPanel() {
    if (role === "instructor") {
      initInstructorPanel();
    } else {
      initStudentWidget();
    }
  }

  /*** Student View Implementation ***/
  function initStudentWidget() {
    // Create or load tasks
    let tasks = loadJSON(TASKS_KEY, null);
    if (!tasks) {
      // Attempt to fetch assignments from Canvas; if fails, fallback to sample
      tasks = generateSampleAssignments();
      saveJSON(TASKS_KEY, tasks);
    }
    // Load understanding level
    let currentUnderstanding =
      localStorage.getItem(UNDERSTANDING_KEY) || "none";
    // Load conversations
    let conversations = loadJSON(CONVOS_KEY, null);
    if (!conversations) {
      conversations = generateSampleConversations();
      saveJSON(CONVOS_KEY, conversations);
    }
    // Load students list for peer matching
    let students = loadJSON(STUDENTS_KEY, null);
    if (!students) {
      students = generateSampleStudents();
      saveJSON(STUDENTS_KEY, students);
    }

    /*** UI creation ***/
    const widget = document.createElement("div");
    widget.id = "inferno-widget";
    // Header
    const header = document.createElement("div");
    header.className = "inferno-header";
    // Use a live FireAvatar instead of a static flame image.  A small
    // avatar communicates the playful branding while avoiding any
    // border or ring.  We default to a neutral/high understanding
    // colour here since the header icon is purely decorative.
    const flame = createFireAvatar("high", "xs");
    flame.style.marginRight = "8px";
    header.appendChild(flame);
    const title = document.createElement("span");
    title.className = "inferno-title";
    title.textContent = "Study Motivation";
    header.appendChild(title);
    // Collapse toggle to show/hide body
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "inferno-toggle";
    toggleBtn.textContent = "-";
    toggleBtn.addEventListener("click", () => {
      const collapsed = widget.classList.toggle("collapsed");
      toggleBtn.textContent = collapsed ? "+" : "-";
    });
    // Mode segmented control: Student | Instructor
    const modeContainer = document.createElement("div");
    modeContainer.className = "inferno-mode-toggle";
    const studentTab = document.createElement("button");
    studentTab.textContent = "Student";
    studentTab.className = "inferno-mode-btn";
    if (role === "student") studentTab.classList.add("active");
    studentTab.addEventListener("click", () => {
      if (role !== "student") {
        localStorage.setItem(ROLE_KEY, "student");
        window.location.reload();
      }
    });
    const instructorTab = document.createElement("button");
    instructorTab.textContent = "Instructor";
    instructorTab.className = "inferno-mode-btn";
    if (role === "instructor") instructorTab.classList.add("active");
    instructorTab.addEventListener("click", () => {
      if (role !== "instructor") {
        localStorage.setItem(ROLE_KEY, "instructor");
        window.location.reload();
      }
    });
    modeContainer.appendChild(studentTab);
    modeContainer.appendChild(instructorTab);
    header.appendChild(modeContainer);
    header.appendChild(toggleBtn);
    widget.appendChild(header);
    // Body
    const body = document.createElement("div");
    body.className = "inferno-body";
    widget.appendChild(body);

    // Avatar container and fire avatar.  Use a custom SVG with gradient and pulsing glow.
    const avatarContainer = document.createElement("div");
    avatarContainer.className = "inferno-avatar avatar-reset";
    // Create an initial avatar element based on the current understanding.  The
    // avatar wrapper will be updated when the understanding level changes.
    let avatarElement = createFireAvatar(currentUnderstanding || "none", "lg");
    avatarContainer.appendChild(avatarElement);
    body.appendChild(avatarContainer);

    // Panels container (Daily Tasks & Channel)
    const tasksPanel = document.createElement("div");
    tasksPanel.className = "inferno-panel tasks-panel";
    const tasksHeader = document.createElement("div");
    tasksHeader.className = "inferno-panel-header";
    const tasksIcon = document.createElement("span");
    tasksIcon.className = "inferno-panel-icon";
    tasksIcon.textContent = "📅";
    const tasksTitle = document.createElement("span");
    tasksTitle.className = "inferno-panel-title";
    tasksTitle.textContent = "Daily Tasks";
    const tasksArrow = document.createElement("span");
    tasksArrow.className = "inferno-panel-arrow";
    tasksArrow.textContent = "▾";
    tasksHeader.appendChild(tasksIcon);
    tasksHeader.appendChild(tasksTitle);
    tasksHeader.appendChild(tasksArrow);
    tasksPanel.appendChild(tasksHeader);
    const tasksBody = document.createElement("div");
    tasksBody.className = "inferno-panel-body";
    tasksPanel.appendChild(tasksBody);
    body.appendChild(tasksPanel);
    // Toggle tasks panel
    tasksHeader.addEventListener("click", () => {
      const collapsed = tasksPanel.classList.toggle("collapsed");
      tasksArrow.textContent = collapsed ? "▸" : "▾";
    });

    // Status text
    const statusText = document.createElement("p");
    statusText.className = "inferno-status";
    tasksBody.appendChild(statusText);
    // Progress bar
    const progressContainer = document.createElement("div");
    progressContainer.className = "inferno-progress";
    const progressBar = document.createElement("div");
    progressBar.className = "inferno-progress-bar";
    progressContainer.appendChild(progressBar);
    tasksBody.appendChild(progressContainer);
    // Task list
    const taskList = document.createElement("ul");
    taskList.className = "inferno-task-list";
    tasksBody.appendChild(taskList);
    // Understanding prompt
    const understandingPrompt = document.createElement("p");
    understandingPrompt.className = "inferno-understanding-prompt";
    understandingPrompt.textContent =
      "What is your level of understanding? Please click an emoji.";
    tasksBody.appendChild(understandingPrompt);
    // Emoji buttons for understanding
    const understandingDiv = document.createElement("div");
    understandingDiv.className = "inferno-signals";
    [
      { type: "low", emoji: "😕", title: "Low Understanding" },
      { type: "medium", emoji: "😐", title: "Medium Understanding" },
      { type: "high", emoji: "😊", title: "High Understanding" },
    ].forEach((sig) => {
      const btn = document.createElement("button");
      btn.className = "inferno-signal-btn";
      btn.title = sig.title;
      btn.textContent = sig.emoji;
      btn.addEventListener("click", () => {
        currentUnderstanding = sig.type;
        localStorage.setItem(UNDERSTANDING_KEY, currentUnderstanding);
        updateAvatarColour();
        updateMatchSection();
        // Send signal to background for aggregation
        chrome.runtime.sendMessage({ type: "signal", signal: sig.type });
        // Brief highlight effect
        btn.classList.add("active");
        setTimeout(() => btn.classList.remove("active"), 600);
      });
      understandingDiv.appendChild(btn);
    });
    tasksBody.appendChild(understandingDiv);
    // Link to assignments page
    const viewAll = document.createElement("a");
    viewAll.className = "inferno-view-all";
    viewAll.textContent = "View all assignments →";
    viewAll.href = window.location.origin + "/assignments";
    viewAll.target = "_blank";
    tasksBody.appendChild(viewAll);

    // Peer matching section
    const matchSection = document.createElement("div");
    matchSection.className = "inferno-match-section";
    tasksBody.appendChild(matchSection);

    // Channel (messaging) panel
    const channelPanel = document.createElement("div");
    channelPanel.className = "inferno-panel channel-panel";
    const channelHeader = document.createElement("div");
    channelHeader.className = "inferno-panel-header";
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
    // Channel panel content: a brief preview and an open button
    const channelPreview = document.createElement("p");
    channelPreview.textContent = "Direct messages (click to open)";
    channelPreview.style.fontSize = "14px";
    channelPreview.style.textAlign = "center";
    channelBody.appendChild(channelPreview);
    channelHeader.addEventListener("click", () => {
      // toggle collapsed state for preview; arrow rotates
      const collapsed = channelPanel.classList.toggle("collapsed");
      channelArrow.textContent = collapsed ? "▸" : "▾";
    });
    channelBody.addEventListener("click", () => {
      // When clicking Channel, show the chat view in place of tasks
      showChatView();
    });

    // --- New chat panel (embedded in widget instead of overlay) ---
    // The chat panel will replace the tasks and channel panels when active.
    const chatPanel = document.createElement("div");
    chatPanel.className = "inferno-chat-panel inferno-panel";
    chatPanel.style.display = "none";
    body.appendChild(chatPanel);
    // Chat header with back button and title
    const chatHeader = document.createElement("div");
    chatHeader.className = "inferno-chat-header inferno-panel-header";
    const chatBack = document.createElement("span");
    chatBack.className = "inferno-chat-back";
    chatBack.textContent = "←";
    chatBack.addEventListener("click", () => {
      showTasksView();
    });
    const chatTitle = document.createElement("span");
    chatTitle.className = "inferno-chat-title";
    chatTitle.textContent = "Messages";
    chatHeader.appendChild(chatBack);
    chatHeader.appendChild(chatTitle);
    chatPanel.appendChild(chatHeader);
    // Threads list container
    const chatThreads = document.createElement("div");
    chatThreads.className = "inferno-thread-list";
    chatPanel.appendChild(chatThreads);
    // Conversation view container (messages + input)
    const chatConversation = document.createElement("div");
    chatConversation.className = "inferno-chat-conversation";
    chatConversation.style.display = "none";
    chatPanel.appendChild(chatConversation);

    // Append widget to the document
    document.body.appendChild(widget);

    /*** Rendering functions for student view ***/
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
          saveJSON(TASKS_KEY, tasks);
          updateProgress();
          updateAvatarScale();
          // send tasks status to background for instructor summarising
          chrome.runtime.sendMessage({ type: "tasksStatus", tasks });
          li.classList.toggle("completed", checkbox.checked);
        });
        const label = document.createElement("label");
        label.htmlFor = checkbox.id;
        // Show title with points and due date
        let dueStr = "";
        if (task.dueDate) {
          const due = new Date(task.dueDate);
          if (!isNaN(due.getTime())) {
            dueStr = due.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            });
          }
        }
        const meta = [];
        if (task.points !== undefined && task.points !== null)
          meta.push(`${task.points} pts`);
        if (dueStr) meta.push(`due ${dueStr}`);
        const metaText = meta.length > 0 ? ` (${meta.join(", ")})` : "";
        label.innerHTML = `${task.title}<span class="inferno-task-meta">${metaText}</span>`;
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
    }
    function updateAvatarScale() {
      const total = tasks.length;
      const completed = tasks.filter((t) => t.completed).length;
      const percent = total > 0 ? completed / total : 0;
      const scale = 0.6 + percent * 0.4;
      if (avatarElement) {
        avatarElement.style.transform = `scale(${scale})`;
      }
    }
    function updateAvatarColour() {
      // Replace the inner SVG to update gradient colours based on current understanding.
      // Create a new avatar element and swap its inner HTML to preserve the wrapper.
      if (!avatarElement) return;
      const newAvatar = createFireAvatar(currentUnderstanding || "none", "lg");
      // Preserve the existing class for animation
      avatarElement.innerHTML = newAvatar.innerHTML;
      // Update the glow colour custom property
      const ringColour =
        understandingColours[currentUnderstanding] || understandingColours.none;
      avatarElement.style.setProperty("--avatar-color", ringColour);
    }
    function updateMatchSection() {
      // Provide peer recommendations based on understanding level
      matchSection.innerHTML = "";
      const title = document.createElement("div");
      title.style.fontWeight = "600";
      title.style.marginTop = "12px";
      title.style.marginBottom = "6px";
      title.style.fontSize = "14px";
      title.textContent = "Peer Recommendations:";
      matchSection.appendChild(title);
      // Determine target groups
      let targets = [];
      if (currentUnderstanding === "low") {
        // recommend high
        targets = students.filter((s) => s.understanding === "high");
      } else if (currentUnderstanding === "medium") {
        // recommend medium or high
        targets = students.filter(
          (s) => s.understanding === "medium" || s.understanding === "high"
        );
      } else if (currentUnderstanding === "high") {
        // recommend low
        targets = students.filter((s) => s.understanding === "low");
      } else {
        matchSection.appendChild(
          document.createTextNode(
            "Select your understanding level to see peers."
          )
        );
        return;
      }
      if (targets.length === 0) {
        matchSection.appendChild(
          document.createTextNode("No matching peers found.")
        );
        return;
      }
      const list = document.createElement("ul");
      list.className = "inferno-peer-list";
      targets.forEach((t) => {
        const li = document.createElement("li");
        li.className = "inferno-peer";
        // Use FireAvatar.Dot instead of a plain colour dot
        const dot = createFireAvatar(t.understanding, "xs");
        dot.style.marginRight = "6px";
        const nameSpan = document.createElement("span");
        nameSpan.textContent = t.name;
        nameSpan.style.marginRight = "6px";
        const helpBtn = document.createElement("button");
        helpBtn.textContent = "Message";
        helpBtn.className = "inferno-peer-message";
        helpBtn.addEventListener("click", () => {
          // open conversation with this peer directly in chat view
          showChatView(t.name);
        });
        li.appendChild(dot);
        li.appendChild(nameSpan);
        li.appendChild(helpBtn);
        list.appendChild(li);
      });
      matchSection.appendChild(list);
    }

    /*** Channel modal functions ***/
    let channelOverlay = null;
    function openChannelModal(targetName) {
      // Create overlay if not exists
      if (channelOverlay) {
        // Already open: maybe open a specific thread if targetName provided
        if (targetName) openConversationByName(targetName);
        return;
      }
      channelOverlay = document.createElement("div");
      channelOverlay.className = "inferno-overlay";
      const modal = document.createElement("div");
      modal.className = "inferno-modal";
      channelOverlay.appendChild(modal);
      document.body.appendChild(channelOverlay);
      // Modal header
      const modalHeader = document.createElement("div");
      modalHeader.className = "inferno-modal-header";
      const modalTitle = document.createElement("span");
      modalTitle.className = "inferno-modal-title";
      modalTitle.textContent = "Messages";
      const modalClose = document.createElement("button");
      modalClose.className = "inferno-modal-close";
      modalClose.textContent = "✕";
      modalClose.addEventListener("click", closeChannelModal);
      modalHeader.appendChild(modalTitle);
      modalHeader.appendChild(modalClose);
      modal.appendChild(modalHeader);
      // Threads view container
      const threadsView = document.createElement("div");
      threadsView.className = "inferno-threads-view";
      modal.appendChild(threadsView);
      // Conversation view container (hidden initially)
      const convoView = document.createElement("div");
      convoView.className = "inferno-convo-view";
      convoView.style.display = "none";
      modal.appendChild(convoView);

      // Render thread list
      function renderThreads() {
        threadsView.innerHTML = "";
        if (conversations.length === 0) {
          const empty = document.createElement("div");
          empty.className = "inferno-threads-empty";
          empty.textContent = "No conversations yet.";
          threadsView.appendChild(empty);
          return;
        }
        conversations.forEach((thread) => {
          const threadDiv = document.createElement("div");
          threadDiv.className = "inferno-thread";
          const title = document.createElement("div");
          title.className = "inferno-thread-title";
          title.textContent = thread.title;
          const lastMsg = thread.messages[thread.messages.length - 1];
          const preview = document.createElement("div");
          preview.className = "inferno-thread-preview";
          preview.textContent = lastMsg
            ? `${lastMsg.sender}: ${lastMsg.text.slice(0, 30)}`
            : "";
          const unreadBadge = document.createElement("span");
          unreadBadge.className = "inferno-unread-badge";
          if (thread.unread > 0) {
            unreadBadge.textContent = thread.unread;
            unreadBadge.style.display = "inline-block";
          } else {
            unreadBadge.style.display = "none";
          }
          threadDiv.appendChild(title);
          threadDiv.appendChild(preview);
          threadDiv.appendChild(unreadBadge);
          threadDiv.addEventListener("click", () =>
            openConversation(thread.id)
          );
          threadsView.appendChild(threadDiv);
        });
      }
      function openConversation(threadId) {
        // Find thread by id
        const thread = conversations.find((c) => c.id === threadId);
        if (!thread) return;
        // Mark unread as zero
        thread.unread = 0;
        saveJSON(CONVOS_KEY, conversations);
        renderThreads();
        // Hide threads view, show convo view
        threadsView.style.display = "none";
        convoView.style.display = "flex";
        convoView.innerHTML = "";
        // Header with back button and title
        const convoHeader = document.createElement("div");
        convoHeader.className = "inferno-convo-header";
        const backBtn = document.createElement("button");
        backBtn.className = "inferno-back-btn";
        backBtn.textContent = "←";
        backBtn.addEventListener("click", () => {
          convoView.style.display = "none";
          threadsView.style.display = "block";
        });
        const nameSpan = document.createElement("span");
        nameSpan.textContent = thread.title;
        nameSpan.style.fontWeight = "600";
        convoHeader.appendChild(backBtn);
        convoHeader.appendChild(nameSpan);
        convoView.appendChild(convoHeader);
        // Messages container
        const convoMessages = document.createElement("div");
        convoMessages.className = "inferno-convo-messages";
        thread.messages.forEach((m) => {
          const msgDiv = document.createElement("div");
          msgDiv.className = "inferno-convo-message";
          msgDiv.classList.add(m.sender === "Me" ? "me" : "them");
          msgDiv.textContent = m.text;
          convoMessages.appendChild(msgDiv);
        });
        convoView.appendChild(convoMessages);
        // Input area
        const convoInputContainer = document.createElement("div");
        convoInputContainer.className = "inferno-convo-input";
        const convoInput = document.createElement("input");
        convoInput.type = "text";
        convoInput.placeholder = "Type a message...";
        const convoSend = document.createElement("button");
        convoSend.textContent = "Send";
        convoSend.addEventListener("click", () => {
          const text = convoInput.value.trim();
          if (!text) return;
          const newMsg = { sender: "Me", text, time: Date.now() };
          thread.messages.push(newMsg);
          saveJSON(CONVOS_KEY, conversations);
          // Append to UI
          const msgDiv = document.createElement("div");
          msgDiv.className = "inferno-convo-message";
          msgDiv.classList.add("me");
          msgDiv.textContent = text;
          convoMessages.appendChild(msgDiv);
          convoMessages.scrollTop = convoMessages.scrollHeight;
          convoInput.value = "";
        });
        convoInputContainer.appendChild(convoInput);
        convoInputContainer.appendChild(convoSend);
        convoView.appendChild(convoInputContainer);
      }
      function openConversationByName(name) {
        // Search for conversation with participant matching name; create if not found
        let thread = conversations.find((c) => c.participants.includes(name));
        if (!thread) {
          // Create new conversation
          const id = "c" + Date.now();
          thread = {
            id,
            title: name,
            participants: ["Me", name],
            unread: 0,
            messages: [],
          };
          conversations.push(thread);
          saveJSON(CONVOS_KEY, conversations);
        }
        openConversation(thread.id);
      }
      // Kick off by rendering threads; if targetName specified, open that conversation
      renderThreads();
      if (targetName) {
        openConversationByName(targetName);
      }
    }
    function closeChannelModal() {
      if (channelOverlay) {
        channelOverlay.remove();
        channelOverlay = null;
      }
    }

    /*** Chat view functions (embedded) ***/
    function showChatView(initialName) {
      // Hide tasks and channel panels
      tasksPanel.style.display = "none";
      channelPanel.style.display = "none";
      matchSection.style.display = "none";
      // Show chat panel
      // Show chat panel using flex layout to allow full-height chat view
      chatPanel.style.display = "flex";
      // Render threads list
      renderThreadList();
      // If a specific name is provided (from peer match), open that conversation
      if (initialName) {
        openConversationByNameInPanel(initialName);
      }
    }
    function showTasksView() {
      // Hide chat panel
      chatPanel.style.display = "none";
      // Show tasks and channel panels
      tasksPanel.style.display = "";
      channelPanel.style.display = "";
      matchSection.style.display = "";
    }
    // Render the list of threads in the chat panel
    function renderThreadList() {
      chatThreads.innerHTML = "";
      if (conversations.length === 0) {
        const empty = document.createElement("div");
        empty.className = "inferno-threads-empty";
        empty.textContent = "No conversations yet.";
        chatThreads.appendChild(empty);
        return;
      }
      conversations.forEach((thread) => {
        const threadItem = document.createElement("div");
        threadItem.className = "inferno-thread-item";
        const titleSpan = document.createElement("span");
        titleSpan.className = "inferno-thread-title";
        titleSpan.textContent = thread.title;
        const previewSpan = document.createElement("span");
        previewSpan.className = "inferno-thread-preview";
        const lastMsg = thread.messages[thread.messages.length - 1];
        previewSpan.textContent = lastMsg
          ? `${lastMsg.sender}: ${lastMsg.text.slice(0, 30)}`
          : "";
        const unreadBadge = document.createElement("span");
        unreadBadge.className = "inferno-unread-badge";
        if (thread.unread > 0) {
          unreadBadge.textContent = thread.unread;
          unreadBadge.style.display = "inline-block";
        } else {
          unreadBadge.style.display = "none";
        }
        threadItem.appendChild(titleSpan);
        threadItem.appendChild(previewSpan);
        threadItem.appendChild(unreadBadge);
        threadItem.addEventListener("click", () =>
          openConversationInPanel(thread.id)
        );
        chatThreads.appendChild(threadItem);
      });
      // Ensure conversation view is hidden when returning to thread list
      chatConversation.style.display = "none";
    }
    function openConversationInPanel(threadId) {
      const thread = conversations.find((c) => c.id === threadId);
      if (!thread) return;
      // mark unread as zero and save
      thread.unread = 0;
      saveJSON(CONVOS_KEY, conversations);
      renderThreadList();
      // Clear conversation view
      chatConversation.innerHTML = "";
      chatConversation.style.display = "flex";
      chatThreads.style.display = "none";
      // Build conversation header
      const convoHeader = document.createElement("div");
      convoHeader.className = "inferno-chat-convo-header";
      const backBtn = document.createElement("button");
      backBtn.className = "inferno-back-btn";
      backBtn.textContent = "←";
      backBtn.setAttribute("aria-label", "Back");
      backBtn.addEventListener("click", () => {
        chatThreads.style.display = "block";
        chatConversation.style.display = "none";
      });
      const nameSpan = document.createElement("span");
      nameSpan.textContent = thread.title;
      nameSpan.style.fontWeight = "600";
      // Optional presence dot (always green in prototype)
      const presence = document.createElement("span");
      presence.className = "inferno-presence-dot";
      presence.title = "Online";
      convoHeader.appendChild(backBtn);
      convoHeader.appendChild(nameSpan);
      convoHeader.appendChild(presence);
      chatConversation.appendChild(convoHeader);
      // Messages feed (scrollable)
      const messagesDiv = document.createElement("div");
      messagesDiv.className = "inferno-chat-messages";
      // Helper to format a timestamp as HH:MM
      function fmt(ts) {
        const d = new Date(ts);
        const hh = d.getHours().toString().padStart(2, "0");
        const mm = d.getMinutes().toString().padStart(2, "0");
        return `${hh}:${mm}`;
      }
      thread.messages.forEach((m) => {
        const msgDiv = document.createElement("div");
        msgDiv.className = "inferno-chat-message";
        msgDiv.classList.add(m.sender === "Me" ? "me" : "them");
        const textSpan = document.createElement("span");
        textSpan.textContent = m.text;
        const tsSpan = document.createElement("span");
        tsSpan.className = "inferno-chat-timestamp";
        tsSpan.textContent = fmt(m.time);
        msgDiv.appendChild(textSpan);
        msgDiv.appendChild(tsSpan);
        messagesDiv.appendChild(msgDiv);
      });
      chatConversation.appendChild(messagesDiv);
      // Composer (textarea + send)
      const composer = document.createElement("div");
      composer.className = "inferno-chat-input";
      const textarea = document.createElement("textarea");
      textarea.rows = 1;
      textarea.placeholder = "Type a message...";
      textarea.setAttribute("aria-label", "Message input");
      const sendBtn = document.createElement("button");
      sendBtn.textContent = "Send";
      sendBtn.setAttribute("aria-label", "Send message");
      composer.appendChild(textarea);
      composer.appendChild(sendBtn);
      chatConversation.appendChild(composer);
      // Scroll to latest message
      setTimeout(() => {
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }, 0);
      // Function to send message
      function sendMessage() {
        const text = textarea.value.trim();
        if (!text) return;
        const newMsg = { sender: "Me", text, time: Date.now() };
        thread.messages.push(newMsg);
        saveJSON(CONVOS_KEY, conversations);
        const msgDiv = document.createElement("div");
        msgDiv.className = "inferno-chat-message me";
        const textSpan = document.createElement("span");
        textSpan.textContent = newMsg.text;
        const tsSpan = document.createElement("span");
        tsSpan.className = "inferno-chat-timestamp";
        tsSpan.textContent = fmt(newMsg.time);
        msgDiv.appendChild(textSpan);
        msgDiv.appendChild(tsSpan);
        messagesDiv.appendChild(msgDiv);
        textarea.value = "";
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }
      sendBtn.addEventListener("click", sendMessage);
      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }
    function openConversationByNameInPanel(name) {
      // Search or create conversation by participant name
      let thread = conversations.find((c) => c.participants.includes(name));
      if (!thread) {
        const id = "c" + Date.now();
        thread = {
          id,
          title: name,
          participants: ["Me", name],
          unread: 0,
          messages: [],
        };
        conversations.push(thread);
        saveJSON(CONVOS_KEY, conversations);
      }
      openConversationInPanel(thread.id);
    }

    /*** Initialise ***
     * Render initial tasks, progress and avatar colour/scale, update match
     * recommendations and send current tasks to background.  Listen for
     * messages from background if needed in future.
     */
    renderTasks();
    updateProgress();
    updateAvatarScale();
    updateAvatarColour();
    updateMatchSection();
    // Notify background of tasks and current understanding
    chrome.runtime.sendMessage({ type: "tasksStatus", tasks });
    if (currentUnderstanding && currentUnderstanding !== "none") {
      chrome.runtime.sendMessage({
        type: "signal",
        signal: currentUnderstanding,
      });
    }
  }

  /*** Instructor View Implementation ***/
  function initInstructorPanel() {
    // Load sample or saved students and conversations
    let students = loadJSON(STUDENTS_KEY, null);
    if (!students) {
      students = generateSampleStudents();
      saveJSON(STUDENTS_KEY, students);
    }
    let conversations = loadJSON(CONVOS_KEY, null);
    if (!conversations) {
      conversations = generateSampleConversations();
      saveJSON(CONVOS_KEY, conversations);
    }

    // Root instructor panel
    const widget = document.createElement("div");
    widget.id = "inferno-instructor-widget";
    widget.className = "inferno-instructor-widget";

    /** Header section */
    const header = document.createElement("div");
    header.className = "inferno-header";
    // Flame icon: use a live FireAvatar instead of a static image.  This
    // retains a playful touch while matching the student view.  Use
    // the "high" colour for consistency.
    const flame = createFireAvatar("high", "xs");
    flame.style.marginRight = "8px";
    header.appendChild(flame);
    // Title
    const titleSpan = document.createElement("span");
    titleSpan.className = "inferno-title";
    titleSpan.textContent = "Instructor View";
    header.appendChild(titleSpan);
    // Mode segmented control
    const modeContainer = document.createElement("div");
    modeContainer.className = "inferno-mode-toggle";
    const studentTab = document.createElement("button");
    studentTab.textContent = "Student";
    studentTab.className = "inferno-mode-btn";
    if (role === "student") studentTab.classList.add("active");
    studentTab.addEventListener("click", () => {
      if (role !== "student") {
        localStorage.setItem(ROLE_KEY, "student");
        window.location.reload();
      }
    });
    const instructorTab = document.createElement("button");
    instructorTab.textContent = "Instructor";
    instructorTab.className = "inferno-mode-btn";
    if (role === "instructor") instructorTab.classList.add("active");
    instructorTab.addEventListener("click", () => {
      if (role !== "instructor") {
        localStorage.setItem(ROLE_KEY, "instructor");
        window.location.reload();
      }
    });
    modeContainer.appendChild(studentTab);
    modeContainer.appendChild(instructorTab);
    header.appendChild(modeContainer);
    // Menu button (ellipsis)
    const menuBtn = document.createElement("button");
    menuBtn.className = "inferno-menu-btn";
    menuBtn.textContent = "⋯";
    menuBtn.title = "Options";
    header.appendChild(menuBtn);
    // Simple dropdown menu container
    const menuDropdown = document.createElement("div");
    menuDropdown.className = "inferno-menu-dropdown";
    menuDropdown.style.display = "none";
    ["Broadcast", "Export CSV"].forEach((itemText) => {
      const item = document.createElement("div");
      item.className = "inferno-menu-item";
      item.textContent = itemText;
      item.addEventListener("click", () => {
        menuDropdown.style.display = "none";
        if (itemText === "Broadcast") {
          // Toggle broadcast composer visibility
          broadcastContainer.style.display =
            broadcastContainer.style.display === "none" ? "" : "none";
        } else if (itemText === "Export CSV") {
          // For prototype, export students to CSV string and prompt download
          const csvRows = [];
          csvRows.push("Name,Understanding,Grade,TasksCompleted,TasksTotal");
          students.forEach((s) => {
            csvRows.push(
              `${s.name},${s.understanding},${s.grade},${s.tasksCompleted},${s.tasksTotal}`
            );
          });
          const csvContent = csvRows.join("\n");
          const blob = new Blob([csvContent], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = "students.csv";
          link.click();
        }
      });
      menuDropdown.appendChild(item);
    });
    header.appendChild(menuDropdown);
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menuDropdown.style.display =
        menuDropdown.style.display === "none" ? "block" : "none";
    });
    // Hide dropdown on click outside
    document.addEventListener("click", (e) => {
      if (!menuBtn.contains(e.target)) {
        menuDropdown.style.display = "none";
      }
    });
    widget.appendChild(header);

    /** Body container */
    const body = document.createElement("div");
    body.className = "inferno-body";
    widget.appendChild(body);

    /** Students marquee banner */
    const marquee = document.createElement("div");
    marquee.className = "inferno-marquee";
    const marqueeTitle = document.createElement("span");
    marqueeTitle.className = "inferno-marquee-title";
    marqueeTitle.textContent = "STUDENTS";
    marquee.appendChild(marqueeTitle);
    // Add several mini fire avatars for playful effect.  Cycle through
    // different statuses to create a colourful row.
    const flameContainer = document.createElement("span");
    flameContainer.className = "inferno-marquee-flames";
    ["low", "medium", "high", "high"].forEach((statusKey) => {
      const dot = createFireAvatar(statusKey, "xs");
      dot.style.marginLeft = "2px";
      flameContainer.appendChild(dot);
    });
    marquee.appendChild(flameContainer);
    body.appendChild(marquee);

    /** Summary/filter row */
    const summaryRow = document.createElement("div");
    summaryRow.className = "inferno-summary-row";
    // Chips container
    const chipsContainer = document.createElement("div");
    chipsContainer.className = "inferno-chips-container";
    const chips = {};
    ["low", "medium", "high"].forEach((key) => {
      const chip = document.createElement("button");
      chip.className = "inferno-summary-chip";
      chip.setAttribute("data-filter", key);
      // Build inner content: small avatar dot, label, count
      const dot = createFireAvatar(key, "xs");
      dot.classList.add("chip-icon");
      const labelSpan = document.createElement("span");
      labelSpan.className = "chip-label";
      labelSpan.textContent =
        key === "low" ? "Red" : key === "medium" ? "Blue" : "Green";
      const countSpan = document.createElement("span");
      countSpan.className = "chip-count";
      countSpan.textContent = "0";
      // Clear and append
      chip.innerHTML = "";
      chip.appendChild(dot);
      chip.appendChild(labelSpan);
      chip.appendChild(countSpan);
      chip.addEventListener("click", () => {
        chip.classList.toggle("active");
        updateList();
      });
      chips[key] = chip;
      chipsContainer.appendChild(chip);
    });
    summaryRow.appendChild(chipsContainer);
    // Search field
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search…";
    searchInput.className = "inferno-search-input";
    searchInput.addEventListener("input", () => {
      updateList();
    });
    summaryRow.appendChild(searchInput);
    // Sort dropdown
    const sortSelect = document.createElement("select");
    sortSelect.className = "inferno-sort-select";
    ["Progress %", "Name A→Z", "Last Active"].forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      sortSelect.appendChild(o);
    });
    sortSelect.addEventListener("change", () => updateList());
    summaryRow.appendChild(sortSelect);
    body.appendChild(summaryRow);

    /** Students list container */
    const listContainer = document.createElement("div");
    listContainer.className = "inferno-students-list";
    body.appendChild(listContainer);

    /** Pairings suggestions section */
    const pairingsContainer = document.createElement("div");
    pairingsContainer.className = "inferno-pairings";
    body.appendChild(pairingsContainer);

    /** Broadcast composer (hidden by default) */
    const broadcastContainer = document.createElement("div");
    broadcastContainer.className = "inferno-broadcast";
    broadcastContainer.style.display = "none";
    const broadcastHeader = document.createElement("div");
    broadcastHeader.className = "inferno-broadcast-header";
    broadcastHeader.textContent = "Broadcast message";
    broadcastContainer.appendChild(broadcastHeader);
    const broadcastTextarea = document.createElement("textarea");
    broadcastTextarea.className = "inferno-broadcast-textarea";
    broadcastTextarea.rows = 3;
    broadcastTextarea.placeholder =
      "Write a message to send to multiple students...";
    broadcastContainer.appendChild(broadcastTextarea);
    const broadcastButtons = document.createElement("div");
    broadcastButtons.className = "inferno-broadcast-buttons";
    ["Red", "Blue", "All"].forEach((label) => {
      const btn = document.createElement("button");
      btn.className = "inferno-broadcast-btn";
      btn.textContent = `Send to ${label}`;
      btn.addEventListener("click", () => {
        alert(
          `Broadcast sent to ${label} students: ${broadcastTextarea.value}`
        );
        broadcastTextarea.value = "";
      });
      broadcastButtons.appendChild(btn);
    });
    broadcastContainer.appendChild(broadcastButtons);
    body.appendChild(broadcastContainer);

    /** Instructor chat panel (reuse existing chat UI) */
    const chatPanel = document.createElement("div");
    chatPanel.className = "inferno-chat-panel";
    chatPanel.style.display = "none";
    body.appendChild(chatPanel);
    // Chat header
    const chatHeader = document.createElement("div");
    chatHeader.className = "inferno-chat-header";
    const chatBack = document.createElement("span");
    chatBack.className = "inferno-chat-back";
    chatBack.textContent = "←";
    chatBack.addEventListener("click", () => {
      chatPanel.style.display = "none";
      listContainer.style.display = "";
      pairingsContainer.style.display = "";
      broadcastContainer.style.display = broadcastContainer.style.display;
    });
    const chatTitle = document.createElement("span");
    chatTitle.className = "inferno-chat-title";
    chatTitle.textContent = "Messages";
    chatHeader.appendChild(chatBack);
    chatHeader.appendChild(chatTitle);
    chatPanel.appendChild(chatHeader);
    const chatThreads = document.createElement("div");
    chatThreads.className = "inferno-thread-list";
    chatPanel.appendChild(chatThreads);
    const chatConversation = document.createElement("div");
    chatConversation.className = "inferno-chat-conversation";
    chatConversation.style.display = "none";
    chatPanel.appendChild(chatConversation);

    /*** Rendering functions for instructor view ***/
    // Compute counts and update chips counts
    function updateSummaryCounts() {
      const counts = { low: 0, medium: 0, high: 0 };
      students.forEach((s) => {
        if (counts[s.understanding] !== undefined) counts[s.understanding]++;
      });
      ["low", "medium", "high"].forEach((key) => {
        const countSpan = chips[key].querySelector(".chip-count");
        countSpan.textContent = counts[key];
      });
    }
    // Determine active filters from chips
    function getActiveFilters() {
      const active = [];
      ["low", "medium", "high"].forEach((key) => {
        if (chips[key].classList.contains("active")) active.push(key);
      });
      return active;
    }
    // Compare functions for sorting
    function sortStudents(a, b, sortKey) {
      if (sortKey === "Progress %") {
        const pa = a.tasksTotal ? a.tasksCompleted / a.tasksTotal : 0;
        const pb = b.tasksTotal ? b.tasksCompleted / b.tasksTotal : 0;
        return pb - pa;
      } else if (sortKey === "Name A→Z") {
        return a.name.localeCompare(b.name);
      } else if (sortKey === "Last Active") {
        return b.lastActive - a.lastActive;
      }
      return 0;
    }
    // Render list of student cards based on filters, search, sort
    function renderStudentsList() {
      listContainer.innerHTML = "";
      const activeFilters = getActiveFilters();
      const searchVal = searchInput.value.trim().toLowerCase();
      const sortVal = sortSelect.value;
      let filtered = students.filter((s) => {
        const matchFilter =
          activeFilters.length === 0 || activeFilters.includes(s.understanding);
        const matchSearch = s.name.toLowerCase().includes(searchVal);
        return matchFilter && matchSearch;
      });
      filtered.sort((a, b) => sortStudents(a, b, sortVal));
      if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "inferno-empty-list";
        empty.textContent = "No students match the criteria.";
        listContainer.appendChild(empty);
        return;
      }
      filtered.forEach((s) => {
        const card = document.createElement("div");
        card.className = "inferno-student-card";
        // Left: fire avatar with coloured ring.  Use custom SVG just like the student view.
        const avatarWrap = document.createElement("div");
        avatarWrap.className = "inferno-card-avatar avatar-reset";
        const progressRatio = s.tasksTotal
          ? s.tasksCompleted / s.tasksTotal
          : 0;
        const progressPct = Math.round(progressRatio * 100);
        const avatarSizePx = sizeFromProgressPercent(progressPct);
        const avatarEl = createFireAvatar(
          s.understanding || "none",
          avatarSizePx
        );
        avatarWrap.appendChild(avatarEl);
        // No ring: do not set ring colour; glow is applied on the avatar itself
        card.appendChild(avatarWrap);
        // Center: details
        const details = document.createElement("div");
        details.className = "inferno-card-details";
        const nameEl = document.createElement("div");
        nameEl.className = "inferno-card-name";
        nameEl.textContent = s.name;
        details.appendChild(nameEl);
        const meta = document.createElement("div");
        meta.className = "inferno-card-meta";
        // Compute a friendly relative time for last activity
        let metaText = "Recently active";
        if (s.lastActive && !isNaN(new Date(s.lastActive).getTime())) {
          const now = Date.now();
          const diff = now - s.lastActive;
          const diffMin = Math.floor(diff / (1000 * 60));
          if (diffMin < 1) {
            metaText = "Active just now";
          } else if (diffMin < 60) {
            metaText = `Active ${diffMin}m ago`;
          } else {
            const diffH = Math.floor(diffMin / 60);
            if (diffH < 24) {
              metaText = `Active ${diffH}h ago`;
            } else {
              const diffD = Math.floor(diffH / 24);
              metaText = `Active ${diffD}d ago`;
            }
          }
        }
        meta.textContent = metaText;
        details.appendChild(meta);
        // Progress strip
        const progressWrap = document.createElement("div");
        progressWrap.className = "inferno-card-progress";
        const progressInner = document.createElement("div");
        progressInner.className = "inferno-card-progress-inner";
        progressInner.style.width = `${progressPct}%`;
        progressWrap.appendChild(progressInner);
        const progressLabel = document.createElement("span");
        progressLabel.className = "inferno-card-progress-label";
        progressLabel.textContent = `${progressPct}%`;
        progressWrap.appendChild(progressLabel);
        details.appendChild(progressWrap);
        // Badges row
        const badgesRow = document.createElement("div");
        badgesRow.className = "inferno-card-badges";
        if (s.badges && s.badges.extraCredit) {
          const badge = document.createElement("span");
          badge.className = "inferno-card-badge";
          badge.textContent = "Extra Credit";
          badgesRow.appendChild(badge);
        }
        if (s.badges && s.badges.paired) {
          const badge = document.createElement("span");
          badge.className = "inferno-card-badge";
          badge.textContent = "Paired";
          badgesRow.appendChild(badge);
        }
        if (s.badges && s.badges.needsHelp) {
          const badge = document.createElement("span");
          badge.className = "inferno-card-badge";
          badge.textContent = "Needs Help";
          badgesRow.appendChild(badge);
        }
        details.appendChild(badgesRow);
        card.appendChild(details);
        // Right: actions
        const actions = document.createElement("div");
        actions.className = "inferno-card-actions";
        const msgBtn = document.createElement("button");
        msgBtn.className = "inferno-card-action";
        msgBtn.title = `Message ${s.name}`;
        msgBtn.textContent = "💬";
        msgBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openChatWithStudent(s.name);
        });
        const nudgeBtn = document.createElement("button");
        nudgeBtn.className = "inferno-card-action";
        nudgeBtn.title = `Nudge ${s.name}`;
        nudgeBtn.textContent = "🔔";
        nudgeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          alert(`Nudge sent to ${s.name}!`);
        });
        actions.appendChild(msgBtn);
        actions.appendChild(nudgeBtn);
        card.appendChild(actions);
        // Hover effect: tinted background based on status
        card.addEventListener("mouseover", () => {
          card.classList.add("hover");
        });
        card.addEventListener("mouseout", () => {
          card.classList.remove("hover");
        });
        listContainer.appendChild(card);
      });
    }
    // Render pairing suggestions
    function renderPairings() {
      pairingsContainer.innerHTML = "";
      const title = document.createElement("div");
      title.className = "inferno-pairings-title";
      title.textContent = "Suggested Pairings";
      pairingsContainer.appendChild(title);
      // gather lists by status and sort them by progress (descending)
      const redStudents = students.filter((s) => s.understanding === "low");
      const blueStudents = students.filter((s) => s.understanding === "medium");
      const greenStudents = students.filter((s) => s.understanding === "high");
      function progressRatio(s) {
        return s.tasksTotal ? s.tasksCompleted / s.tasksTotal : 0;
      }
      const redSorted = redStudents
        .slice()
        .sort((a, b) => progressRatio(b) - progressRatio(a));
      const blueSorted = blueStudents
        .slice()
        .sort((a, b) => progressRatio(b) - progressRatio(a));
      const greenSorted = greenStudents
        .slice()
        .sort((a, b) => progressRatio(b) - progressRatio(a));

      // Helper to create suggestion rows with actions.  Each source student
      // generates a row listing up to two recommended targets.  The last
      // element of the row contains quick action buttons for messaging and
      // pairing.
      function createSuggestionRows(sourceList, targetList) {
        sourceList.forEach((src) => {
          // Determine targets excluding the source student
          const candidates = targetList.filter((t) => t.id !== src.id);
          if (candidates.length === 0) return;
          const suggestions = candidates.slice(0, 2);
          const row = document.createElement("div");
          row.className = "inferno-pairing-row";
          // Source name with avatar dot
          const left = document.createElement("span");
          left.className = "inferno-pairing-source";
          const srcDot = createFireAvatar(src.understanding, "xs");
          srcDot.style.marginRight = "4px";
          left.appendChild(srcDot);
          const srcName = document.createElement("span");
          srcName.textContent = src.name;
          left.appendChild(srcName);
          row.appendChild(left);
          // Arrow
          const arrow = document.createElement("span");
          arrow.textContent = " → ";
          row.appendChild(arrow);
          // Targets names with avatar dots
          suggestions.forEach((tgt, idx) => {
            const tgtSpan = document.createElement("span");
            tgtSpan.className = "inferno-pairing-target-label";
            const tgtDot = createFireAvatar(tgt.understanding, "xs");
            tgtDot.style.marginRight = "4px";
            tgtSpan.appendChild(tgtDot);
            const tgtName = document.createElement("span");
            tgtName.textContent = tgt.name;
            tgtSpan.appendChild(tgtName);
            row.appendChild(tgtSpan);
            if (idx < suggestions.length - 1) {
              const comma = document.createElement("span");
              comma.textContent = ", ";
              row.appendChild(comma);
            }
          });
          // Actions container
          const actions = document.createElement("div");
          actions.className = "inferno-pairing-actions";
          // Message button opens chat with the first suggestion
          const msgBtn = document.createElement("button");
          msgBtn.className = "inferno-pairing-btn";
          msgBtn.textContent = "Message";
          msgBtn.title = `Message ${src.name} and ${suggestions[0].name}`;
          msgBtn.addEventListener("click", () => {
            openChatWithPair(src.name, suggestions[0].name);
          });
          // Pair button shows toast (prototype)
          const pairBtn = document.createElement("button");
          pairBtn.className = "inferno-pairing-btn";
          pairBtn.textContent = "Create Pair";
          pairBtn.title = `Create pair ${src.name} + ${suggestions[0].name}`;
          pairBtn.addEventListener("click", () => {
            alert("Pair created");
          });
          actions.appendChild(msgBtn);
          actions.appendChild(pairBtn);
          row.appendChild(actions);
          pairingsContainer.appendChild(row);
        });
      }
      // Red → top greens
      createSuggestionRows(redSorted, greenSorted);
      // Blue → top mix of blues and greens
      createSuggestionRows(blueSorted, blueSorted.concat(greenSorted));
      // Green → top reds
      createSuggestionRows(greenSorted, redSorted);
    }
    // Open chat with a single student
    function openChatWithStudent(name) {
      listContainer.style.display = "none";
      pairingsContainer.style.display = "none";
      broadcastContainer.style.display = broadcastContainer.style.display;
      chatPanel.style.display = "flex";
      renderThreadListInstructor();
      openConversationByNameInstructor(name);
    }
    // Open chat with pair of students (for suggestions)
    function openChatWithPair(name1, name2) {
      // For prototype: open individual chat with the first student
      openChatWithStudent(name1);
    }

    /*** Chat functions (reuse from previous implementation) ***/
    function renderThreadListInstructor() {
      chatThreads.innerHTML = "";
      if (conversations.length === 0) {
        const empty = document.createElement("div");
        empty.className = "inferno-threads-empty";
        empty.textContent = "No conversations yet.";
        chatThreads.appendChild(empty);
        return;
      }
      conversations.forEach((thread) => {
        const item = document.createElement("div");
        item.className = "inferno-thread-item";
        const tTitle = document.createElement("span");
        tTitle.className = "inferno-thread-title";
        tTitle.textContent = thread.title;
        const preview = document.createElement("span");
        preview.className = "inferno-thread-preview";
        const lastMsg = thread.messages[thread.messages.length - 1];
        preview.textContent = lastMsg
          ? `${lastMsg.sender}: ${lastMsg.text.slice(0, 30)}`
          : "";
        const unreadBadge = document.createElement("span");
        unreadBadge.className = "inferno-unread-badge";
        if (thread.unread > 0) {
          unreadBadge.textContent = thread.unread;
          unreadBadge.style.display = "inline-block";
        } else {
          unreadBadge.style.display = "none";
        }
        item.appendChild(tTitle);
        item.appendChild(preview);
        item.appendChild(unreadBadge);
        item.addEventListener("click", () =>
          openConversationInstructor(thread.id)
        );
        chatThreads.appendChild(item);
      });
      chatConversation.style.display = "none";
      chatThreads.style.display = "block";
    }
    function openConversationInstructor(threadId) {
      const thread = conversations.find((c) => c.id === threadId);
      if (!thread) return;
      thread.unread = 0;
      saveJSON(CONVOS_KEY, conversations);
      renderThreadListInstructor();
      chatThreads.style.display = "none";
      chatConversation.innerHTML = "";
      chatConversation.style.display = "flex";
      // Disable scrolling on body so the chat occupies the full height
      body.style.overflowY = "hidden";
      // When entering a chat, hide the summary, list, pairings and broadcast
      // sections so the chat can occupy the full height of the panel.  Store
      // their previous display values so they can be restored on back.
      const prevSummaryDisplay = summaryRow.style.display;
      const prevListDisplay = listContainer.style.display;
      const prevPairingsDisplay = pairingsContainer.style.display;
      const prevBroadcastDisplay = broadcastContainer.style.display;
      summaryRow.style.display = "none";
      listContainer.style.display = "none";
      pairingsContainer.style.display = "none";
      broadcastContainer.style.display = "none";
      // Build conversation header
      const headerRow = document.createElement("div");
      headerRow.className = "inferno-chat-convo-header";
      const backBtn = document.createElement("button");
      backBtn.className = "inferno-back-btn";
      backBtn.textContent = "←";
      backBtn.setAttribute("aria-label", "Back");
      backBtn.addEventListener("click", () => {
        // Restore hidden sections when returning to the threads list
        chatConversation.style.display = "none";
        chatThreads.style.display = "block";
        summaryRow.style.display = prevSummaryDisplay || "";
        listContainer.style.display = prevListDisplay || "";
        pairingsContainer.style.display = prevPairingsDisplay || "";
        broadcastContainer.style.display = prevBroadcastDisplay || "none";
        // Restore body scrolling when exiting chat
        body.style.overflowY = "";
      });
      const nSpan = document.createElement("span");
      nSpan.textContent = thread.title;
      nSpan.style.fontWeight = "600";
      // Presence dot (always green in prototype)
      const presence = document.createElement("span");
      presence.className = "inferno-presence-dot";
      presence.title = "Online";
      headerRow.appendChild(backBtn);
      headerRow.appendChild(nSpan);
      headerRow.appendChild(presence);
      chatConversation.appendChild(headerRow);
      // Messages feed
      const messagesDiv = document.createElement("div");
      messagesDiv.className = "inferno-chat-messages";
      function fmt(ts) {
        const d = new Date(ts);
        const hh = d.getHours().toString().padStart(2, "0");
        const mm = d.getMinutes().toString().padStart(2, "0");
        return `${hh}:${mm}`;
      }
      thread.messages.forEach((m) => {
        const mDiv = document.createElement("div");
        mDiv.className = "inferno-chat-message";
        mDiv.classList.add(m.sender === "Me" ? "me" : "them");
        const textSpan = document.createElement("span");
        textSpan.textContent = m.text;
        const tsSpan = document.createElement("span");
        tsSpan.className = "inferno-chat-timestamp";
        tsSpan.textContent = fmt(m.time);
        mDiv.appendChild(textSpan);
        mDiv.appendChild(tsSpan);
        messagesDiv.appendChild(mDiv);
      });
      chatConversation.appendChild(messagesDiv);
      // Composer (textarea + send)
      const composer = document.createElement("div");
      composer.className = "inferno-chat-input";
      const textarea = document.createElement("textarea");
      textarea.rows = 1;
      textarea.placeholder = "Type a message...";
      textarea.setAttribute("aria-label", "Message input");
      const send = document.createElement("button");
      send.textContent = "Send";
      send.setAttribute("aria-label", "Send message");
      composer.appendChild(textarea);
      composer.appendChild(send);
      chatConversation.appendChild(composer);
      // Scroll to bottom initially
      setTimeout(() => {
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }, 0);
      function sendMessage() {
        const text = textarea.value.trim();
        if (!text) return;
        const newMsg = { sender: "Me", text, time: Date.now() };
        thread.messages.push(newMsg);
        saveJSON(CONVOS_KEY, conversations);
        const mDiv = document.createElement("div");
        mDiv.className = "inferno-chat-message me";
        const textSpan = document.createElement("span");
        textSpan.textContent = newMsg.text;
        const tsSpan = document.createElement("span");
        tsSpan.className = "inferno-chat-timestamp";
        tsSpan.textContent = fmt(newMsg.time);
        mDiv.appendChild(textSpan);
        mDiv.appendChild(tsSpan);
        messagesDiv.appendChild(mDiv);
        textarea.value = "";
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }
      send.addEventListener("click", sendMessage);
      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }
    function openConversationByNameInstructor(name) {
      let thread = conversations.find((c) => c.participants.includes(name));
      if (!thread) {
        const id = "c" + Date.now();
        thread = {
          id,
          title: name,
          participants: ["Me", name],
          unread: 0,
          messages: [],
        };
        conversations.push(thread);
        saveJSON(CONVOS_KEY, conversations);
      }
      openConversationInstructor(thread.id);
    }
    // Update list and summary
    function updateList() {
      updateSummaryCounts();
      renderStudentsList();
      renderPairings();
    }
    // Initial render
    updateSummaryCounts();
    renderStudentsList();
    renderPairings();

    // Append panel to body
    document.body.appendChild(widget);
  }
})();
