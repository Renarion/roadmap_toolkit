(() => {
  "use strict";

  const STORAGE_KEY = "roadmap_toolkit_v1";
  const LOADER_MS = 450;
  const DEFAULT_TITLE = "Roadmap";

  // Category row backgrounds — brand teal gradient (see colorSectionBands()).
  const SECTION_BRAND = {
    strong: "#0f766e",
    soft: "#d8f3ef",
    deep: "#0b5f59",
  };

  // Task bar colors on the Gantt chart (edit here).
  const CHART_COLORS = {
    taskFill: "#0f766e",
    taskStroke: "#084c47",
    grid: "#d7e0e6",
    axis: "#8aa0ad",
  };

  const EXAMPLE = {
    title: "Планы Q3 2026",
    tasks: [
      {
        category: "Снижение SCV",
        name: "Детекция аномалий",
        start: "2026-07-01",
        end: "2026-08-15",
      },
      {
        category: "Снижение SCV",
        name: "Правила по телефонам",
        start: "2026-07-10",
        end: "2026-08-10",
      },
      {
        category: "AI автоматизация",
        name: "AI-детектив",
        start: "2026-07-15",
        end: "2026-08-15",
      },
    ],
  };

  /** @type {{ id: string, category: string, name: string, start: string, end: string }[]} */
  let tasks = [];
  let hasBuiltOnce = false;
  let lastMermaidCode = "";
  let renderToken = 0;

  const els = {
    title: document.getElementById("diagram-title"),
    titleError: document.getElementById("title-error"),
    tasksContainer: document.getElementById("tasks-container"),
    formError: document.getElementById("form-error"),
    addTaskBtn: document.getElementById("add-task-btn"),
    buildBtn: document.getElementById("build-btn"),
    loadExampleBtn: document.getElementById("load-example-btn"),
    clearAllBtn: document.getElementById("clear-all-btn"),
    resultSection: document.getElementById("result-section"),
    diagramContainer: document.getElementById("diagram-container"),
    renderError: document.getElementById("render-error"),
    loader: document.getElementById("loader-overlay"),
    downloadSvgBtn: document.getElementById("download-svg-btn"),
    downloadPngBtn: document.getElementById("download-png-btn"),
    copyMermaidBtn: document.getElementById("copy-mermaid-btn"),
    copyToast: document.getElementById("copy-toast"),
    taskTemplate: document.getElementById("task-template"),
    mermaidImportInput: document.getElementById("mermaid-import-input"),
    mermaidImportBtn: document.getElementById("mermaid-import-btn"),
    mermaidImportError: document.getElementById("mermaid-import-error"),
    mermaidImportNote: document.getElementById("mermaid-import-note"),
  };

  function uid() {
    return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function createEmptyTask(overrides = {}) {
    return {
      id: uid(),
      category: "",
      name: "",
      start: "",
      end: "",
      ...overrides,
    };
  }

  function sanitizeMermaidText(text) {
    return String(text ?? "")
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/[;#{}|\\]/g, " ")
      .replace(/:/g, " — ")
      .replace(/["'`]/g, "")
      .replace(/&/g, " and ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function truncateLabel(text, maxLen) {
    const safe = sanitizeMermaidText(text);
    if (!safe) return "";
    if (safe.length <= maxLen) return safe;
    return `${safe.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
  }

  function daysBetween(startIso, endIso) {
    const start = new Date(`${startIso}T00:00:00`);
    const end = new Date(`${endIso}T00:00:00`);
    return Math.max(1, Math.round((end - start) / 86400000) + 1);
  }

  function estimateChartLayout(taskList) {
    const labels = taskList.flatMap((task) => [
      truncateLabel(task.category, 36),
      truncateLabel(task.name, 40),
    ]);
    const longest = labels.reduce((max, label) => Math.max(max, label.length), 8);
    // More room for larger section/task labels.
    const leftPadding = Math.min(460, Math.max(220, longest * 11 + 36));

    const starts = taskList.map((task) => task.start).sort();
    const ends = taskList.map((task) => task.end).sort();
    const spanDays = daysBetween(starts[0], ends[ends.length - 1]);

    const scrollEl = document.getElementById("diagram-scroll");
    const pageBudget = Math.min(window.innerWidth - 32, 1560);
    const available = Math.max(
      1180,
      (scrollEl?.clientWidth || 0) - 4,
      pageBudget - 48
    );

    // Fit the timeline into the visible width to reduce horizontal scrolling.
    const timelineBudget = Math.max(820, available - leftPadding - 32);
    let pxPerDay;
    if (spanDays <= 100) {
      pxPerDay = Math.min(16, Math.max(10, timelineBudget / spanDays));
    } else if (spanDays <= 180) {
      pxPerDay = Math.min(13, Math.max(8, timelineBudget / spanDays));
    } else {
      pxPerDay = Math.min(10, Math.max(6, timelineBudget / spanDays));
    }

    const contentWidth = Math.ceil(leftPadding + spanDays * pxPerDay + 32);
    const useWidth = Math.min(available, contentWidth);

    return { leftPadding, useWidth };
  }

  function slugifyFilename(text) {
    const base = String(text || DEFAULT_TITLE)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);

    return base || "roadmap";
  }

  function showLoader(visible) {
    els.loader.hidden = !visible;
    els.loader.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function setFormError(message) {
    if (!message) {
      els.formError.hidden = true;
      els.formError.textContent = "";
      return;
    }
    els.formError.hidden = false;
    els.formError.textContent = message;
  }

  function setRenderError(message) {
    if (!message) {
      els.renderError.hidden = true;
      els.renderError.textContent = "";
      return;
    }
    els.renderError.hidden = false;
    els.renderError.textContent = message;
  }

  function clearFieldErrors() {
    els.titleError.hidden = true;
    els.titleError.textContent = "";
    els.title.closest(".field")?.classList.remove("has-error");

    els.tasksContainer.querySelectorAll(".field").forEach((field) => {
      field.classList.remove("has-error");
    });
    els.tasksContainer.querySelectorAll("[data-error]").forEach((node) => {
      node.hidden = true;
      node.textContent = "";
    });
  }

  function setTaskFieldError(taskId, fieldName, message) {
    const card = els.tasksContainer.querySelector(`[data-task-id="${taskId}"]`);
    if (!card) return;
    const input = card.querySelector(`[data-field="${fieldName}"]`);
    const error = card.querySelector(`[data-error="${fieldName}"]`);
    const periodField = card.querySelector(".field-period");
    if (fieldName === "start" || fieldName === "end") {
      periodField?.classList.add("has-error");
    } else if (input) {
      input.closest(".field")?.classList.add("has-error");
    }
    if (error) {
      error.hidden = false;
      error.textContent = message;
    }
  }

  function formatDisplayDate(isoDate) {
    if (!isoDate) return "";
    const [year, month, day] = isoDate.split("-");
    if (!year || !month || !day) return isoDate;
    return `${day}.${month}.${year}`;
  }

  function formatRangeLabel(start, end) {
    if (start && end) return `${formatDisplayDate(start)} — ${formatDisplayDate(end)}`;
    if (start) return `${formatDisplayDate(start)} — …`;
    return "Выберите период";
  }

  function updateRangeLabel(card) {
    const start = card.querySelector('[data-field="start"]').value;
    const end = card.querySelector('[data-field="end"]').value;
    const label = card.querySelector("[data-range-label]");
    const trigger = card.querySelector("[data-action='open-range']");
    if (!label || !trigger) return;
    label.textContent = formatRangeLabel(start, end);
    trigger.classList.toggle("is-placeholder", !(start && end));
  }

  function updateRangeDraftLabel(card) {
    const label = card.querySelector("[data-range-label]");
    const trigger = card.querySelector("[data-action='open-range']");
    if (!label || !trigger) return;
    label.textContent = formatRangeLabel(rangePicker.draftStart, rangePicker.draftEnd);
    trigger.classList.toggle("is-placeholder", !rangePicker.draftStart);
  }

  function getRangePickerCard() {
    if (!rangePicker.taskId) return null;
    return els.tasksContainer.querySelector(`[data-task-id="${rangePicker.taskId}"]`);
  }

  const MONTH_NAMES = [
    "Январь",
    "Февраль",
    "Март",
    "Апрель",
    "Май",
    "Июнь",
    "Июль",
    "Август",
    "Сентябрь",
    "Октябрь",
    "Ноябрь",
    "Декабрь",
  ];

  const rangePicker = {
    taskId: null,
    viewYear: new Date().getFullYear(),
    viewMonth: new Date().getMonth(),
    draftStart: "",
    draftEnd: "",
    suppressOutsideClose: false,
  };

  function toIsoDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function parseIsoDate(iso) {
    if (!iso) return null;
    const date = new Date(`${iso}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function closeRangePicker() {
    const popover = document.getElementById("date-range-popover");
    if (!popover) return;
    popover.hidden = true;
    rangePicker.taskId = null;
    rangePicker.draftStart = "";
    rangePicker.draftEnd = "";
    rangePicker.suppressOutsideClose = false;
  }

  function applyRangeDraftToTask() {
    if (!rangePicker.taskId) return;
    const card = getRangePickerCard();
    if (!card) return;

    let start = rangePicker.draftStart;
    let end = rangePicker.draftEnd;
    if (start && end && end < start) {
      [start, end] = [end, start];
    }

    card.querySelector('[data-field="start"]').value = start;
    card.querySelector('[data-field="end"]').value = end;
    updateRangeLabel(card);
    syncTaskFromDom(rangePicker.taskId);
    saveToLocalStorage();
  }

  function handleRangeDaySelect(iso, event) {
    event.preventDefault();
    event.stopPropagation();

    if (!rangePicker.draftStart || (rangePicker.draftStart && rangePicker.draftEnd)) {
      rangePicker.draftStart = iso;
      rangePicker.draftEnd = "";
    } else {
      rangePicker.draftEnd = iso;
      if (rangePicker.draftEnd < rangePicker.draftStart) {
        const tmp = rangePicker.draftStart;
        rangePicker.draftStart = rangePicker.draftEnd;
        rangePicker.draftEnd = tmp;
      }
    }

    const card = getRangePickerCard();
    if (card) updateRangeDraftLabel(card);
    renderRangeCalendar();

    if (rangePicker.draftStart && rangePicker.draftEnd) {
      applyRangeDraftToTask();
    }
  }

  function positionRangePicker(anchor, popover) {
    const rect = anchor.getBoundingClientRect();
    const popWidth = popover.offsetWidth || 320;
    const popHeight = popover.offsetHeight || 360;
    let left = rect.left;
    let top = rect.bottom + 8;
    if (left + popWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - popWidth - 8);
    }
    if (top + popHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - popHeight - 8);
    }
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  function renderRangeCalendar() {
    const grid = document.getElementById("range-day-grid");
    const monthLabel = document.getElementById("range-month-label");
    const stepLabel = document.getElementById("range-step-label");
    if (!grid || !monthLabel || !stepLabel) return;

    monthLabel.textContent = `${MONTH_NAMES[rangePicker.viewMonth]} ${rangePicker.viewYear}`;
    if (!rangePicker.draftStart) {
      stepLabel.textContent = "Выберите дату начала";
    } else if (!rangePicker.draftEnd) {
      stepLabel.textContent = "Выберите дату окончания";
    } else {
      stepLabel.textContent = `${formatDisplayDate(rangePicker.draftStart)} — ${formatDisplayDate(rangePicker.draftEnd)}`;
    }

    grid.replaceChildren();

    const firstOfMonth = new Date(rangePicker.viewYear, rangePicker.viewMonth, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday-first
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(firstOfMonth.getDate() - startOffset);

    let startIso = rangePicker.draftStart;
    let endIso = rangePicker.draftEnd;
    if (startIso && endIso && endIso < startIso) {
      [startIso, endIso] = [endIso, startIso];
    }

    for (let i = 0; i < 42; i += 1) {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + i);
      const iso = toIsoDate(day);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = String(day.getDate());
      btn.dataset.date = iso;

      if (day.getMonth() !== rangePicker.viewMonth) {
        btn.classList.add("is-outside");
      }
      if (startIso && iso === startIso) btn.classList.add("is-start");
      if (endIso && iso === endIso) btn.classList.add("is-end");
      if (startIso && endIso && iso > startIso && iso < endIso) {
        btn.classList.add("is-in-range");
      }

      btn.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

      btn.addEventListener("click", (event) => {
        handleRangeDaySelect(iso, event);
      });

      grid.appendChild(btn);
    }
  }

  function openRangePicker(taskId, anchor) {
    const card = els.tasksContainer.querySelector(`[data-task-id="${taskId}"]`);
    const popover = document.getElementById("date-range-popover");
    if (!card || !popover) return;

    if (!popover.hidden && rangePicker.taskId === taskId) {
      positionRangePicker(anchor, popover);
      return;
    }

    if (!popover.hidden && rangePicker.taskId && rangePicker.taskId !== taskId) {
      applyRangeDraftToTask();
      closeRangePicker();
    }

    rangePicker.suppressOutsideClose = true;
    rangePicker.taskId = taskId;

    const start = card.querySelector('[data-field="start"]').value;
    const end = card.querySelector('[data-field="end"]').value;
    rangePicker.draftStart = start;
    rangePicker.draftEnd = end;

    const seed = parseIsoDate(start) || new Date();
    rangePicker.viewYear = seed.getFullYear();
    rangePicker.viewMonth = seed.getMonth();

    renderRangeCalendar();
    popover.hidden = false;
    positionRangePicker(anchor, popover);

    window.setTimeout(() => {
      rangePicker.suppressOutsideClose = false;
    }, 0);
  }

  function bindRangePickerControls() {
    const popover = document.getElementById("date-range-popover");
    if (!popover || popover.dataset.bound === "1") return;
    popover.dataset.bound = "1";

    popover.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });

    popover.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    document.getElementById("range-prev-month")?.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });

    document.getElementById("range-next-month")?.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });

    document.getElementById("range-prev-month")?.addEventListener("click", (event) => {
      event.stopPropagation();
      rangePicker.viewMonth -= 1;
      if (rangePicker.viewMonth < 0) {
        rangePicker.viewMonth = 11;
        rangePicker.viewYear -= 1;
      }
      renderRangeCalendar();
    });

    document.getElementById("range-next-month")?.addEventListener("click", (event) => {
      event.stopPropagation();
      rangePicker.viewMonth += 1;
      if (rangePicker.viewMonth > 11) {
        rangePicker.viewMonth = 0;
        rangePicker.viewYear += 1;
      }
      renderRangeCalendar();
    });

    document.getElementById("range-clear-btn")?.addEventListener("click", (event) => {
      event.stopPropagation();
      rangePicker.draftStart = "";
      rangePicker.draftEnd = "";
      const card = getRangePickerCard();
      if (card) updateRangeDraftLabel(card);
      renderRangeCalendar();
    });

    document.getElementById("range-done-btn")?.addEventListener("click", (event) => {
      event.stopPropagation();
      applyRangeDraftToTask();
      closeRangePicker();
    });

    document.addEventListener(
      "mousedown",
      (event) => {
        if (popover.hidden || rangePicker.suppressOutsideClose) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (popover.contains(target)) return;
        if (target.closest("[data-action='open-range']")) return;

        // Stay open until the end date is picked.
        if (rangePicker.draftStart && !rangePicker.draftEnd) return;

        applyRangeDraftToTask();
        closeRangePicker();
      },
      true
    );

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !popover.hidden) {
        applyRangeDraftToTask();
        closeRangePicker();
      }
    });
  }

  function syncTaskFromDom(taskId) {
    const card = els.tasksContainer.querySelector(`[data-task-id="${taskId}"]`);
    const task = tasks.find((item) => item.id === taskId);
    if (!card || !task) return;

    task.category = card.querySelector('[data-field="category"]').value;
    task.name = card.querySelector('[data-field="name"]').value;
    task.start = card.querySelector('[data-field="start"]').value;
    task.end = card.querySelector('[data-field="end"]').value;
  }

  function syncAllFromDom() {
    tasks.forEach((task) => syncTaskFromDom(task.id));
  }

  function renderTasks() {
    closeRangePicker();
    els.tasksContainer.replaceChildren();

    tasks.forEach((task, index) => {
      const fragment = els.taskTemplate.content.cloneNode(true);
      const card = fragment.querySelector(".task-card");
      card.dataset.taskId = task.id;
      card.querySelector(".task-number").textContent = String(index + 1);

      const categoryInput = card.querySelector('[data-field="category"]');
      const nameInput = card.querySelector('[data-field="name"]');
      const startInput = card.querySelector('[data-field="start"]');
      const endInput = card.querySelector('[data-field="end"]');

      categoryInput.value = task.category;
      nameInput.value = task.name;
      startInput.value = task.start;
      endInput.value = task.end;
      updateRangeLabel(card);

      card.addEventListener("input", () => {
        syncTaskFromDom(task.id);
        saveToLocalStorage();
      });

      card.querySelector('[data-action="open-range"]').addEventListener("mousedown", (event) => {
        event.stopPropagation();
      });

      card.querySelector('[data-action="open-range"]').addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        rangePicker.suppressOutsideClose = true;
        openRangePicker(task.id, event.currentTarget);
      });

      card.querySelector('[data-action="remove"]').addEventListener("click", () => {
        removeTask(task.id);
      });

      card.querySelector('[data-action="duplicate"]').addEventListener("click", () => {
        duplicateTask(task.id);
      });

      els.tasksContainer.appendChild(fragment);
    });
  }

  function addTask(overrides = {}) {
    syncAllFromDom();
    tasks.push(createEmptyTask(overrides));
    renderTasks();
    saveToLocalStorage();

    const lastCard = els.tasksContainer.lastElementChild;
    lastCard?.querySelector('[data-field="category"]')?.focus();
  }

  function removeTask(taskId) {
    syncAllFromDom();
    tasks = tasks.filter((task) => task.id !== taskId);
    if (tasks.length === 0) {
      tasks.push(createEmptyTask());
    }
    renderTasks();
    saveToLocalStorage();
  }

  function duplicateTask(taskId) {
    syncAllFromDom();
    const source = tasks.find((task) => task.id === taskId);
    if (!source) return;

    const index = tasks.findIndex((task) => task.id === taskId);
    const clone = createEmptyTask({
      category: source.category,
      name: source.name,
      start: source.start,
      end: source.end,
    });
    tasks.splice(index + 1, 0, clone);
    renderTasks();
    saveToLocalStorage();
  }

  function collectFormData() {
    syncAllFromDom();
    const titleRaw = els.title.value.trim();
    return {
      title: titleRaw || DEFAULT_TITLE,
      titleProvided: Boolean(titleRaw),
      tasks: tasks.map((task) => ({
        id: task.id,
        category: task.category.trim(),
        name: task.name.trim(),
        start: task.start,
        end: task.end,
      })),
    };
  }

  function validateTasks(data) {
    clearFieldErrors();
    setFormError("");

    const errors = [];

    if (!data.titleProvided && !els.title.value.trim()) {
      // Title is optional and falls back to DEFAULT_TITLE — no hard error.
    }

    if (!data.tasks.length) {
      setFormError("Добавьте хотя бы одну задачу");
      return { ok: false, errors: ["empty"] };
    }

    const filledTasks = data.tasks.filter(
      (task) => task.category || task.name || task.start || task.end
    );

    if (filledTasks.length === 0) {
      setFormError("Добавьте хотя бы одну задачу");
      data.tasks.forEach((task) => {
        setTaskFieldError(task.id, "category", "Заполните задачу");
        setTaskFieldError(task.id, "name", "Заполните задачу");
      });
      return { ok: false, errors: ["empty"] };
    }

    data.tasks.forEach((task) => {
      const hasAny = task.category || task.name || task.start || task.end;
      if (!hasAny) return;

      if (!task.category) {
        setTaskFieldError(task.id, "category", "Укажите категорию");
        errors.push("category");
      }
      if (!task.name) {
        setTaskFieldError(task.id, "name", "Укажите название задачи");
        errors.push("name");
      }
      if (!task.start) {
        setTaskFieldError(task.id, "start", "Укажите дату начала");
        errors.push("start");
      }
      if (!task.end) {
        setTaskFieldError(task.id, "end", "Укажите дату окончания");
        errors.push("end");
      }
      if (task.start && task.end && task.end < task.start) {
        setTaskFieldError(task.id, "end", "Дата окончания не может быть раньше начала");
        errors.push("range");
      }
    });

    if (errors.length) {
      setFormError("Исправьте выделенные поля и попробуйте снова");
      return { ok: false, errors };
    }

    return {
      ok: true,
      data: {
        title: data.title,
        tasks: filledTasks,
      },
    };
  }

  function generateMermaidCode(title, taskList) {
    const safeTitle = truncateLabel(title, 60) || DEFAULT_TITLE;
    const { leftPadding, useWidth } = estimateChartLayout(taskList);
    const sections = new Map();

    taskList.forEach((task) => {
      const sectionName = truncateLabel(task.category, 36) || "Без категории";
      if (!sections.has(sectionName)) {
        sections.set(sectionName, []);
      }
      sections.get(sectionName).push(task);
    });

    const lines = [
      `%%{init: {"gantt": {"useWidth": ${useWidth}, "leftPadding": ${leftPadding}, "rightPadding": 40, "useMaxWidth": false, "barHeight": 30, "barGap": 12, "fontSize": 16, "sectionFontSize": 16, "topPadding": 68, "titleTopMargin": 30, "gridLineStartPadding": 28}} }%%`,
      "gantt",
      `    title ${safeTitle}`,
      "    dateFormat YYYY-MM-DD",
      "    axisFormat %d.%m",
      "    todayMarker off",
      "",
    ];

    sections.forEach((sectionTasks, sectionName) => {
      lines.push(`    section ${sectionName}`);
      sectionTasks.forEach((task) => {
        const taskName = truncateLabel(task.name, 40) || "Задача";
        // Mermaid end date is exclusive for day-level ranges; keep inclusive UX by adding one day.
        const endExclusive = addOneDay(task.end);
        lines.push(`    ${taskName} :${task.start}, ${endExclusive}`);
      });
      lines.push("");
    });

    return lines.join("\n").trim() + "\n";
  }

  function addOneDay(isoDate) {
    const date = new Date(`${isoDate}T00:00:00`);
    date.setDate(date.getDate() + 1);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function subtractOneDay(isoDate) {
    const date = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) return isoDate;
    date.setDate(date.getDate() - 1);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const DURATION_RE = /^(\d+)([dhwm])$/i;
  const TASK_STATUS_RE = /^(done|active|crit|milestone)$/i;

  function stripMermaidInitBlock(code) {
    return String(code ?? "").replace(/%%\{init:[\s\S]*?\}%%/g, "").trim();
  }

  function addDurationInclusive(startIso, durationToken) {
    const match = durationToken.match(DURATION_RE);
    if (!match) return startIso;

    const amount = Number.parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    let days = amount;
    if (unit === "w") days = amount * 7;
    if (unit === "h") days = Math.max(1, Math.ceil(amount / 24));
    if (unit === "m") days = amount * 30;

    const date = new Date(`${startIso}T00:00:00`);
    date.setDate(date.getDate() + days - 1);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function parseTaskMeta(meta) {
    const parts = meta
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    if (!parts.length) return null;
    if (parts.some((part) => /^after\b/i.test(part))) return null;

    const cleaned = parts.filter((part) => {
      if (TASK_STATUS_RE.test(part)) return false;
      if (ISO_DATE_RE.test(part) || DURATION_RE.test(part)) return true;
      return false;
    });

    const dates = cleaned.filter((part) => ISO_DATE_RE.test(part));
    const durations = cleaned.filter((part) => DURATION_RE.test(part));

    if (dates.length >= 2) {
      const start = dates[0];
      const endRaw = dates[dates.length - 1];
      let end = subtractOneDay(endRaw);
      if (end < start) {
        end = endRaw;
      }
      return { start, end };
    }

    if (dates.length === 1 && durations.length >= 1) {
      return {
        start: dates[0],
        end: addDurationInclusive(dates[0], durations[0]),
      };
    }

    return null;
  }

  function parseMermaidGantt(code) {
    const skipped = [];
    const lines = stripMermaidInitBlock(code)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("%%"));

    let title = DEFAULT_TITLE;
    let currentSection = "";
    const parsedTasks = [];

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower === "gantt") continue;
      if (lower.startsWith("title ")) {
        title = line.slice(6).trim() || DEFAULT_TITLE;
        continue;
      }
      if (
        lower.startsWith("dateformat") ||
        lower.startsWith("axisformat") ||
        lower.startsWith("todaymarker") ||
        lower.startsWith("excludes") ||
        lower.startsWith("inclusiveenddates")
      ) {
        continue;
      }

      if (/^section\s+/i.test(line)) {
        currentSection = line.replace(/^section\s+/i, "").trim();
        continue;
      }

      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) continue;

      const name = line.slice(0, colonIndex).trim();
      const meta = line.slice(colonIndex + 1).trim();
      if (!name) continue;

      const parsed = parseTaskMeta(meta);
      if (!parsed) {
        skipped.push(name);
        continue;
      }

      parsedTasks.push({
        category: currentSection,
        name,
        start: parsed.start,
        end: parsed.end,
      });
    }

    return { title, tasks: parsedTasks, skipped };
  }

  function setMermaidImportError(message) {
    if (!message) {
      els.mermaidImportError.hidden = true;
      els.mermaidImportError.textContent = "";
      return;
    }
    els.mermaidImportError.hidden = false;
    els.mermaidImportError.textContent = message;
  }

  function setMermaidImportNote(message) {
    if (!message) {
      els.mermaidImportNote.hidden = true;
      els.mermaidImportNote.textContent = "";
      return;
    }
    els.mermaidImportNote.hidden = false;
    els.mermaidImportNote.textContent = message;
  }

  async function handleMermaidImport() {
    const code = els.mermaidImportInput.value.trim();
    setMermaidImportError("");
    setMermaidImportNote("");

    if (!code) {
      setMermaidImportError("Вставьте код Mermaid");
      return;
    }

    const parsed = parseMermaidGantt(code);

    if (parsed.tasks.length) {
      els.title.value = parsed.title;
      tasks = parsed.tasks.map((task) =>
        createEmptyTask({
          category: task.category,
          name: task.name,
          start: task.start,
          end: task.end,
        })
      );
      renderTasks();
      clearFieldErrors();
      setFormError("");

      if (parsed.skipped.length) {
        setMermaidImportNote(
          `Импортировано ${parsed.tasks.length} задач. Не удалось разобрать: ${parsed.skipped.join(", ")}.`
        );
      }
    } else {
      setMermaidImportNote(
        "Задачи из кода не распознаны — диаграмма будет построена без обновления полей."
      );
    }

    showLoader(true);
    await wait(LOADER_MS);

    const ok = await renderRoadmap(code);
    showLoader(false);

    if (!ok) return;

    hasBuiltOnce = true;
    els.buildBtn.textContent = "Обновить roadmap";
    els.resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    saveToLocalStorage();
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function renderRoadmap(mermaidCode) {
    const token = ++renderToken;
    setRenderError("");
    els.diagramContainer.replaceChildren();
    els.resultSection.hidden = false;

    const renderId = `roadmap-${Date.now()}-${token}`;
    const holder = document.createElement("div");
    holder.className = "mermaid-host";
    holder.id = renderId;
    els.diagramContainer.appendChild(holder);

    try {
      const { svg } = await mermaid.render(`${renderId}-svg`, mermaidCode);
      if (token !== renderToken) return false;
      // SVG comes from Mermaid; safe enough when securityLevel is strict.
      holder.innerHTML = svg;
      lastMermaidCode = mermaidCode;
      emphasizeAxisDates();
      emphasizeDiagramText();
      styleTaskBars();
      colorSectionBands();
      wrapTaskBarLabels();
      fitDiagramWidth();
      return true;
    } catch (error) {
      console.error(error);
      if (token !== renderToken) return false;
      els.diagramContainer.replaceChildren();
      setRenderError(
        "Не удалось построить диаграмму. Проверьте названия и даты задач"
      );
      lastMermaidCode = "";
      return false;
    }
  }

  function fitDiagramWidth() {
    const svg = els.diagramContainer.querySelector("svg");
    if (!svg) return;

    const size = measureSvgSize(svg);
    els.diagramContainer.style.minWidth = `${size.width}px`;
    svg.setAttribute("width", String(size.width));
    svg.setAttribute("height", String(size.height));
    if (!svg.getAttribute("viewBox")) {
      svg.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
    }
    svg.style.maxWidth = "none";
    svg.style.width = `${size.width}px`;
    svg.style.height = `${size.height}px`;
  }

  function emphasizeAxisDates() {
    const svg = els.diagramContainer.querySelector("svg");
    if (!svg) return;
    svg.querySelectorAll(".tick text, g.grid .tick text").forEach((node) => {
      node.setAttribute("font-size", "16");
      node.setAttribute("font-weight", "600");
    });
  }

  function emphasizeDiagramText() {
    const svg = els.diagramContainer.querySelector("svg");
    if (!svg) return;

    svg.querySelectorAll("text.sectionTitle, .sectionTitle").forEach((node) => {
      node.setAttribute("font-size", "16");
      node.setAttribute("font-weight", "700");
    });

    svg
      .querySelectorAll(
        "text.taskText, text.taskTextOutsideLeft, text.taskTextOutsideRight, .taskText, .taskTextOutsideLeft, .taskTextOutsideRight"
      )
      .forEach((node) => {
        node.setAttribute("font-size", "15");
        node.setAttribute("font-weight", "600");
      });

    // Title sits above the chart; give it a bit more breathing room visually.
    svg.querySelectorAll("text.titleText, .titleText").forEach((node) => {
      node.setAttribute("font-size", "20");
      node.setAttribute("font-weight", "700");
    });
  }

  function styleTaskBars() {
    const svg = els.diagramContainer.querySelector("svg");
    if (!svg) return;

    const fill = CHART_COLORS.taskFill;
    const stroke = CHART_COLORS.taskStroke;

    svg.querySelectorAll("rect").forEach((rect) => {
      if (!isTaskRect(rect)) return;

      const fillAttr = String(rect.getAttribute("fill") || "").toLowerCase();
      if (!rect.getAttribute("fill") || fillAttr === "none") {
        rect.setAttribute("fill", fill);
      }
      rect.setAttribute("stroke", stroke);
      rect.setAttribute("stroke-width", "1.75");
      rect.setAttribute("rx", "2");
      rect.setAttribute("ry", "2");
    });
  }

  function isTaskRect(rect) {
    const cls = String(rect.getAttribute("class") || "");
    const fillAttr = String(rect.getAttribute("fill") || "").toLowerCase();
    return (
      /\btask\b/i.test(cls) ||
      fillAttr === CHART_COLORS.taskFill.toLowerCase() ||
      fillAttr === "#0b5f59" ||
      fillAttr === "#5b8a84"
    );
  }

  function colorSectionBands() {
    const svg = els.diagramContainer.querySelector("svg");
    if (!svg) return;

    const gradientIds = ensureSectionGradients(svg);
    const sectionRects = [...svg.querySelectorAll("rect")].filter((rect) => {
      const cls = String(rect.getAttribute("class") || "");
      return /section/i.test(cls) && !isTaskRect(rect);
    });

    const paint = (rects) => {
      rects.forEach((rect, index) => {
        rect.setAttribute("fill", `url(#${gradientIds[index % gradientIds.length]})`);
        rect.setAttribute("stroke", "none");
      });
    };

    if (sectionRects.length) {
      paint(sectionRects);
      return;
    }

    const candidates = [...svg.querySelectorAll("rect")].filter((rect) => {
      if (isTaskRect(rect)) return false;
      const width = Number(rect.getAttribute("width") || 0);
      const height = Number(rect.getAttribute("height") || 0);
      return width > 200 && height > 20;
    });

    paint(
      candidates.sort(
        (a, b) => Number(a.getAttribute("y") || 0) - Number(b.getAttribute("y") || 0)
      )
    );
  }

  function ensureSectionGradients(svg) {
    const NS = "http://www.w3.org/2000/svg";
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS(NS, "defs");
      svg.insertBefore(defs, svg.firstChild);
    }

    defs.querySelectorAll("[id^='rt-section-grad-']").forEach((node) => node.remove());

    const variants = [
      [
        { color: SECTION_BRAND.strong, opacity: 0.62 },
        { color: SECTION_BRAND.soft, opacity: 0.48 },
      ],
      [
        { color: SECTION_BRAND.soft, opacity: 0.92 },
        { color: "#ffffff", opacity: 0.2 },
      ],
    ];

    const ids = [];

    variants.forEach((stops, index) => {
      const id = `rt-section-grad-${index}`;
      ids.push(id);

      const gradient = document.createElementNS(NS, "linearGradient");
      gradient.setAttribute("id", id);
      gradient.setAttribute("x1", "0");
      gradient.setAttribute("y1", "0");
      gradient.setAttribute("x2", "0");
      gradient.setAttribute("y2", "1");

      stops.forEach((stop, stopIndex) => {
        const stopEl = document.createElementNS(NS, "stop");
        stopEl.setAttribute("offset", stopIndex === 0 ? "0%" : "100%");
        stopEl.setAttribute("stop-color", stop.color);
        stopEl.setAttribute("stop-opacity", String(stop.opacity));
        gradient.appendChild(stopEl);
      });

      defs.appendChild(gradient);
    });

    return ids;
  }

  function measureTextWidth(svg, text, fontSize, fontWeight) {
    const probe = document.createElementNS("http://www.w3.org/2000/svg", "text");
    probe.setAttribute("font-size", String(fontSize));
    probe.setAttribute("font-weight", String(fontWeight));
    probe.setAttribute("font-family", "DM Sans, Segoe UI, sans-serif");
    probe.textContent = text;
    svg.appendChild(probe);
    let width = 0;
    try {
      width = probe.getComputedTextLength();
    } catch (_) {
      width = text.length * fontSize * 0.56;
    }
    probe.remove();
    return width;
  }

  function wrapWordsToWidth(svg, text, maxWidth, fontSize, fontWeight) {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [""];

    const lines = [];
    let current = "";

    const fits = (value) => measureTextWidth(svg, value, fontSize, fontWeight) <= maxWidth;

    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (fits(candidate) || !current) {
        if (!current && !fits(word)) {
          // Hard-wrap an oversized token.
          let chunk = "";
          for (const ch of word) {
            const next = chunk + ch;
            if (chunk && !fits(next)) {
              lines.push(chunk);
              chunk = ch;
            } else {
              chunk = next;
            }
          }
          current = chunk;
        } else {
          current = candidate;
        }
      } else {
        lines.push(current);
        current = word;
      }
    });

    if (current) lines.push(current);
    return lines;
  }

  function shiftSvgBelow(svg, fromY, delta) {
    if (delta <= 0) return;

    svg.querySelectorAll("*").forEach((node) => {
      ["y", "y1", "y2"].forEach((attr) => {
        if (!node.hasAttribute(attr)) return;
        const value = Number(node.getAttribute(attr));
        if (Number.isFinite(value) && value >= fromY - 0.01) {
          node.setAttribute(attr, String(value + delta));
        }
      });

      const transform = node.getAttribute("transform");
      if (transform && /translate\(/i.test(transform)) {
        node.setAttribute(
          "transform",
          transform.replace(/translate\(([^,]+),\s*([^)]+)\)/i, (_, x, y) => {
            const ty = Number(y);
            if (!Number.isFinite(ty) || ty < fromY - 0.01) {
              return `translate(${x}, ${y})`;
            }
            return `translate(${x}, ${ty + delta})`;
          })
        );
      }
    });
  }

  function growSectionAround(svg, barY, extra) {
    if (extra <= 0) return;
    svg.querySelectorAll("rect").forEach((rect) => {
      if (isTaskRect(rect)) return;
      const y = Number(rect.getAttribute("y") || 0);
      const h = Number(rect.getAttribute("height") || 0);
      if (!Number.isFinite(y) || !Number.isFinite(h)) return;
      if (y <= barY + 1 && y + h >= barY + 4) {
        rect.setAttribute("height", String(h + extra));
      }
    });
  }

  function wrapTaskBarLabels() {
    const svg = els.diagramContainer.querySelector("svg");
    if (!svg) return;

    const LINE_HEIGHT = 17;
    const PAD_X = 12;
    const PAD_Y = 10;
    const FONT_SIZE = 15;
    const FONT_WEIGHT = 600;

    const bars = [...svg.querySelectorAll("rect")]
      .filter(isTaskRect)
      .sort(
        (a, b) =>
          Number(a.getAttribute("y") || 0) - Number(b.getAttribute("y") || 0)
      );

    const labels = [
      ...svg.querySelectorAll(
        "text.taskText, text.taskTextOutsideLeft, text.taskTextOutsideRight"
      ),
    ];

    bars.forEach((rect) => {
      const x = Number(rect.getAttribute("x") || 0);
      const y = Number(rect.getAttribute("y") || 0);
      const w = Number(rect.getAttribute("width") || 0);
      const h = Number(rect.getAttribute("height") || 0);
      if (!(w > 0 && h > 0)) return;

      const cx = x + w / 2;
      const cy = y + h / 2;

      let label = null;
      let best = Infinity;
      labels.forEach((textNode) => {
        if (textNode.dataset.wrapped === "1") return;
        const tx = Number(textNode.getAttribute("x") || 0);
        const ty = Number(textNode.getAttribute("y") || 0);
        const dy = Math.abs(ty - cy);
        const dx = Math.abs(tx - cx);
        if (dy > h + 10) return;
        const score = dy * 3 + dx * 0.05;
        if (score < best) {
          best = score;
          label = textNode;
        }
      });

      if (!label) return;

      const raw = (label.textContent || "").replace(/\s+/g, " ").trim();
      if (!raw) return;

      const maxWidth = Math.max(36, w - PAD_X * 2);
      const lines = wrapWordsToWidth(svg, raw, maxWidth, FONT_SIZE, FONT_WEIGHT);
      const newH = Math.max(h, lines.length * LINE_HEIGHT + PAD_Y);
      const extra = newH - h;

      if (extra > 0) {
        // Push everything under this bar, then expand the bar itself.
        shiftSvgBelow(svg, y + h - 0.05, extra);
        growSectionAround(svg, y, extra);
        rect.setAttribute("height", String(newH));
      }

      while (label.firstChild) label.removeChild(label.firstChild);
      label.setAttribute("class", "taskText");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "central");
      label.setAttribute("font-size", String(FONT_SIZE));
      label.setAttribute("font-weight", String(FONT_WEIGHT));
      label.setAttribute("fill", "#ffffff");
      label.setAttribute("x", String(cx));

      const blockHeight = (lines.length - 1) * LINE_HEIGHT;
      const firstY = y + newH / 2 - blockHeight / 2;
      label.setAttribute("y", String(firstY));

      lines.forEach((line, index) => {
        const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
        tspan.setAttribute("x", String(cx));
        tspan.setAttribute("y", String(firstY + index * LINE_HEIGHT));
        tspan.textContent = line;
        label.appendChild(tspan);
      });

      label.dataset.wrapped = "1";
    });

    // Grow SVG canvas after vertical expansions.
    try {
      const bbox = svg.getBBox();
      const width = Math.ceil(Math.max(bbox.x + bbox.width, Number(svg.getAttribute("width") || 0)));
      const height = Math.ceil(Math.max(bbox.y + bbox.height + 12, Number(svg.getAttribute("height") || 0)));
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    } catch (_) {
      /* ignore */
    }
  }

  function measureSvgSize(svg) {
    const viewBox = svg.viewBox?.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
      return {
        width: Math.ceil(viewBox.width),
        height: Math.ceil(viewBox.height),
      };
    }

    let width = 0;
    let height = 0;

    const attrWidth = Number.parseFloat(svg.getAttribute("width") || "");
    const attrHeight = Number.parseFloat(svg.getAttribute("height") || "");
    if (Number.isFinite(attrWidth) && attrWidth > 0) width = attrWidth;
    if (Number.isFinite(attrHeight) && attrHeight > 0) height = attrHeight;

    const styleWidth = Number.parseFloat(svg.style.width || "");
    const styleHeight = Number.parseFloat(svg.style.height || "");
    if (Number.isFinite(styleWidth) && styleWidth > 0) width = Math.max(width, styleWidth);
    if (Number.isFinite(styleHeight) && styleHeight > 0) height = Math.max(height, styleHeight);

    try {
      const bbox = svg.getBBox();
      if (bbox.width > 0) width = Math.max(width, Math.ceil(bbox.x + bbox.width + 8));
      if (bbox.height > 0) height = Math.max(height, Math.ceil(bbox.y + bbox.height + 8));
    } catch (_) {
      /* ignore */
    }

    return {
      width: Math.ceil(Math.max(width, 1100)),
      height: Math.ceil(Math.max(height, 240)),
    };
  }

  function prepareExportSvg(svg) {
    const size = measureSvgSize(svg);
    const clone = svg.cloneNode(true);
    const originalViewBox = svg.getAttribute("viewBox");

    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("width", String(size.width));
    clone.setAttribute("height", String(size.height));
    clone.setAttribute(
      "viewBox",
      originalViewBox || `0 0 ${size.width} ${size.height}`
    );
    clone.removeAttribute("style");
    clone.style.cssText = `width:${size.width}px;height:${size.height}px;max-width:none;background:#ffffff;`;

    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", "0");
    bg.setAttribute("y", "0");
    bg.setAttribute("width", String(size.width));
    bg.setAttribute("height", String(size.height));
    bg.setAttribute("fill", "#ffffff");
    clone.insertBefore(bg, clone.firstChild);

    const serializer = new XMLSerializer();
    const source = `<?xml version="1.0" encoding="UTF-8"?>\n${serializer.serializeToString(clone)}`;
    return { source, width: size.width, height: size.height };
  }

  async function handleBuild() {
    const collected = collectFormData();
    const validation = validateTasks(collected);
    if (!validation.ok) return;

    const mermaidCode = generateMermaidCode(
      validation.data.title,
      validation.data.tasks
    );

    showLoader(true);
    await wait(LOADER_MS);

    const ok = await renderRoadmap(mermaidCode);
    showLoader(false);

    if (!ok) return;

    hasBuiltOnce = true;
    els.buildBtn.textContent = "Обновить roadmap";
    els.resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    saveToLocalStorage();
  }

  function getSvgElement() {
    return els.diagramContainer.querySelector("svg");
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadSVG() {
    const svg = getSvgElement();
    if (!svg) {
      setRenderError("Сначала постройте roadmap");
      return;
    }

    const title = els.title.value.trim() || DEFAULT_TITLE;
    const filename = `${slugifyFilename(title)}-roadmap.svg`;
    const { source } = prepareExportSvg(svg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    triggerDownload(blob, filename);
  }

  function downloadPNG() {
    const svg = getSvgElement();
    if (!svg) {
      setRenderError("Сначала постройте roadmap");
      return;
    }

    const title = els.title.value.trim() || DEFAULT_TITLE;
    const filename = `${slugifyFilename(title)}-roadmap.png`;
    const { source, width, height } = prepareExportSvg(svg);
    const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const image = new Image();
    image.onload = () => {
      try {
        const scale = 2;
        const exportWidth = Math.max(1, width, image.naturalWidth || 0);
        const exportHeight = Math.max(1, height, image.naturalHeight || 0);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(exportWidth * scale);
        canvas.height = Math.round(exportHeight * scale);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.drawImage(image, 0, 0, exportWidth, exportHeight);

        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (!blob) {
            setRenderError("Не удалось сохранить PNG. Попробуйте скачать SVG.");
            return;
          }
          triggerDownload(blob, filename);
        }, "image/png");
      } catch (error) {
        console.error(error);
        URL.revokeObjectURL(url);
        setRenderError("Не удалось сохранить PNG. Попробуйте скачать SVG.");
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      setRenderError("Не удалось сохранить PNG. Попробуйте скачать SVG.");
    };

    image.src = url;
  }

  async function copyMermaidCode() {
    if (!lastMermaidCode) {
      setRenderError("Сначала постройте roadmap");
      return;
    }

    try {
      await navigator.clipboard.writeText(lastMermaidCode);
      els.copyToast.hidden = false;
      window.setTimeout(() => {
        els.copyToast.hidden = true;
      }, 1800);
    } catch (error) {
      console.error(error);
      window.prompt("Скопируйте код вручную:", lastMermaidCode);
    }
  }

  function saveToLocalStorage() {
    syncAllFromDom();
    const payload = {
      title: els.title.value,
      tasks: tasks.map(({ category, name, start, end }) => ({
        category,
        name,
        start,
        end,
      })),
      mermaidImport: els.mermaidImportInput.value,
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn("localStorage unavailable", error);
    }
  }

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return false;

      els.title.value = typeof data.title === "string" ? data.title : "";
      // Diagram is not restored automatically; keep the primary button as "build".
      hasBuiltOnce = false;
      els.buildBtn.textContent = "Построить roadmap";

      const loadedTasks = Array.isArray(data.tasks) ? data.tasks : [];
      tasks = loadedTasks.map((task) =>
        createEmptyTask({
          category: String(task.category || ""),
          name: String(task.name || ""),
          start: String(task.start || ""),
          end: String(task.end || ""),
        })
      );

      if (!tasks.length) {
        tasks = [createEmptyTask()];
      }

      if (typeof data.mermaidImport === "string") {
        els.mermaidImportInput.value = data.mermaidImport;
      }

      return true;
    } catch (error) {
      console.warn("Failed to restore localStorage", error);
      return false;
    }
  }

  function resetToInitialState() {
    els.title.value = "";
    tasks = [createEmptyTask()];
    hasBuiltOnce = false;
    lastMermaidCode = "";
    renderToken += 1;
    els.buildBtn.textContent = "Построить roadmap";
    els.resultSection.hidden = true;
    els.diagramContainer.replaceChildren();
    els.mermaidImportInput.value = "";
    setMermaidImportError("");
    setMermaidImportNote("");
    setFormError("");
    setRenderError("");
    clearFieldErrors();
    renderTasks();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  function clearAll() {
    const confirmed = window.confirm(
      "Вы уверены? Все введенные задачи будут удалены"
    );
    if (!confirmed) return;
    resetToInitialState();
  }

  function loadExample() {
    els.title.value = EXAMPLE.title;
    tasks = EXAMPLE.tasks.map((task) => createEmptyTask(task));
    renderTasks();
    saveToLocalStorage();
    setFormError("");
    clearFieldErrors();
  }

  function initMermaid() {
    if (typeof mermaid === "undefined") {
      setFormError(
        "Не удалось загрузить библиотеку диаграмм. Проверьте подключение к интернету."
      );
      return false;
    }

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: {
        fontFamily: "DM Sans, Segoe UI, sans-serif",
        primaryColor: "#d8f3ef",
        primaryTextColor: "#152028",
        primaryBorderColor: CHART_COLORS.taskFill,
        lineColor: CHART_COLORS.axis,
        sectionBkgColor: "rgba(15, 118, 110, 0.48)",
        altSectionBkgColor: "rgba(216, 243, 239, 0.82)",
        gridColor: CHART_COLORS.grid,
        taskBkgColor: CHART_COLORS.taskFill,
        taskBorderColor: CHART_COLORS.taskStroke,
        taskTextColor: "#ffffff",
        taskTextLightColor: "#ffffff",
        taskTextOutsideColor: "#152028",
        taskTextDarkColor: "#152028",
        activeTaskBkgColor: "#0b5f59",
        activeTaskBorderColor: "#063d39",
        doneTaskBkgColor: "#5b8a84",
        doneTaskBorderColor: "#3f6c67",
        critBkgColor: "#b42318",
        critBorderColor: "#912018",
        todayLineColor: "#152028",
      },
      themeCSS: `
        .task { stroke: ${CHART_COLORS.taskStroke} !important; stroke-width: 1.75px !important; }
        rect.task { stroke: ${CHART_COLORS.taskStroke} !important; stroke-width: 1.75px !important; }
        .section0 { fill: rgba(15, 118, 110, 0.48) !important; }
        .section1 { fill: rgba(216, 243, 239, 0.82) !important; }
      `,
      gantt: {
        titleTopMargin: 30,
        barHeight: 30,
        barGap: 12,
        topPadding: 68,
        leftPadding: 220,
        rightPadding: 40,
        gridLineStartPadding: 28,
        fontSize: 16,
        sectionFontSize: 16,
        numberSectionStyles: 2,
        useMaxWidth: false,
      },
    });

    return true;
  }

  function bindEvents() {
    els.addTaskBtn.addEventListener("click", () => addTask());
    els.buildBtn.addEventListener("click", () => {
      handleBuild().catch((error) => {
        console.error(error);
        showLoader(false);
        setRenderError(
          "Не удалось построить диаграмму. Проверьте названия и даты задач"
        );
      });
    });
    els.loadExampleBtn.addEventListener("click", loadExample);
    els.clearAllBtn.addEventListener("click", clearAll);
    els.downloadSvgBtn.addEventListener("click", downloadSVG);
    els.downloadPngBtn.addEventListener("click", downloadPNG);
    els.copyMermaidBtn.addEventListener("click", () => {
      copyMermaidCode().catch(console.error);
    });
    els.mermaidImportBtn.addEventListener("click", () => {
      handleMermaidImport().catch((error) => {
        console.error(error);
        showLoader(false);
        setMermaidImportError("Не удалось построить диаграмму из Mermaid-кода");
      });
    });
    els.mermaidImportInput.addEventListener("input", saveToLocalStorage);
    els.title.addEventListener("input", saveToLocalStorage);
  }

  function init() {
    const ready = initMermaid();
    bindEvents();
    bindRangePickerControls();

    const restored = loadFromLocalStorage();
    if (!restored) {
      tasks = [createEmptyTask()];
    }

    renderTasks();

    if (!ready) {
      els.buildBtn.disabled = true;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
