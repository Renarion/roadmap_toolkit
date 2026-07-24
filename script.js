(() => {
  "use strict";

  const STORAGE_KEY = "roadmap_toolkit_v1";
  const LOADER_MS = 450;
  const DEFAULT_TITLE = "Roadmap";

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
    const leftPadding = Math.min(420, Math.max(200, longest * 10 + 32));

    const starts = taskList.map((task) => task.start).sort();
    const ends = taskList.map((task) => task.end).sort();
    const spanDays = daysBetween(starts[0], ends[ends.length - 1]);
    // Wider timeline so bars and labels stay readable.
    const pxPerDay = spanDays > 120 ? 16 : spanDays > 60 ? 22 : 28;
    const useWidth = Math.max(1280, Math.ceil(leftPadding + spanDays * pxPerDay + 160));

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
    if (input) input.closest(".field")?.classList.add("has-error");
    if (error) {
      error.hidden = false;
      error.textContent = message;
    }
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

      card.addEventListener("input", () => {
        syncTaskFromDom(task.id);
        saveToLocalStorage();
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
      `%%{init: {"gantt": {"useWidth": ${useWidth}, "leftPadding": ${leftPadding}, "rightPadding": 40, "useMaxWidth": false, "barHeight": 30, "barGap": 10, "fontSize": 13, "sectionFontSize": 14, "topPadding": 55, "gridLineStartPadding": 28}} }%%`,
      "gantt",
      `    title ${safeTitle}`,
      "    dateFormat YYYY-MM-DD",
      "    axisFormat %d.%m",
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
        primaryBorderColor: "#0f766e",
        lineColor: "#8aa0ad",
        sectionBkgColor: "#f3faf8",
        altSectionBkgColor: "#ffffff",
        gridColor: "#d7e0e6",
        taskBkgColor: "#0f766e",
        taskTextColor: "#ffffff",
        taskTextLightColor: "#ffffff",
        taskTextOutsideColor: "#152028",
        taskTextDarkColor: "#152028",
        activeTaskBkgColor: "#0b5f59",
        activeTaskBorderColor: "#084c47",
        doneTaskBkgColor: "#5b8a84",
        doneTaskBorderColor: "#3f6c67",
        critBkgColor: "#b42318",
        critBorderColor: "#912018",
        todayLineColor: "#152028",
      },
      gantt: {
        titleTopMargin: 24,
        barHeight: 30,
        barGap: 10,
        topPadding: 55,
        leftPadding: 200,
        rightPadding: 40,
        gridLineStartPadding: 28,
        fontSize: 13,
        sectionFontSize: 14,
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
    els.title.addEventListener("input", saveToLocalStorage);
  }

  function init() {
    const ready = initMermaid();
    bindEvents();

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
