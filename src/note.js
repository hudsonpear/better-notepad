const { getCurrentWebviewWindow } = window.__TAURI__.webviewWindow;
const { invoke } = window.__TAURI__.core;
const { open, save } = window.__TAURI__.dialog;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow, LogicalPosition, PhysicalPosition, LogicalSize } = window.__TAURI__.window;
const { mkdir, readTextFile, writeTextFile } = window.__TAURI__.fs;
const { appDataDir, join } = window.__TAURI__.path;
const { appLocalDataDir } = window.__TAURI__.path;
const { fs, path, shell } = window.__TAURI__;

const webview = getCurrentWebviewWindow();

const mirrorDiv = document.createElement("div");
mirrorDiv.style.position = "absolute";
mirrorDiv.style.visibility = "hidden";
mirrorDiv.style.whiteSpace = "pre-wrap";
mirrorDiv.style.wordWrap = "break-word";
mirrorDiv.style.top = "0";
mirrorDiv.style.left = "0";
mirrorDiv.style.zIndex = "-9999";
document.body.appendChild(mirrorDiv);

const findInput = document.getElementById("findInput");
const replaceInput = document.getElementById("replaceInput");
const gotoInput = document.getElementById("gotoInput");

const findNextBtn = document.getElementById("findNext");
const findPrevBtn = document.getElementById("findPrev");
const replaceOneBtn = document.getElementById("replaceOne");
const replaceAllBtn = document.getElementById("replaceAll");
const goBtn = document.getElementById("goBtn");
const findCloseBtn = document.getElementById("findClose");
const findCount = document.getElementById("findCount");

const settBtn = document.getElementById('settBtn');

const closedTabsStack = [];

let zoom = 100;
let isDirty = false;
const editorContainer = document.getElementById("editor-container");
let tabsState = new Map(); // tab -> { editor, path, isDirty }
let activeTab = null;
let isMouseDown = false;
let startX = 0;
let startY = 0;
let draggingStarted = false;
let tabCount = 0;
let lineNumbersVisible = true;

const DRAG_THRESHOLD = 5;

const dir = await path.appLocalDataDir();

const ZOOM_FILE = "zoom_state.json";
let zoomCache = {};

const appWindow = getCurrentWindow();

async function initializeWindow() {
  // Validate and restore position
  const saved = localStorage.getItem('windowPosition');
  if (saved) {
    try {
      const { x, y } = JSON.parse(saved);
      // Clamp position to >= 0 (adjust if you want)
      const posX = Math.max(1, x);
      const posY = Math.max(1, y);
      await appWindow.setPosition(new LogicalPosition(posX, posY));
    } 
    catch {
      // ignore invalid data
    }
  }

  // Validate and restore size
  const savedSize = localStorage.getItem('windowSize');
  if (savedSize) {
    try {
      const { width, height } = JSON.parse(savedSize);
      // Clamp size to minimum reasonable values
      const w = Math.max(100, width);
      const h = Math.max(100, height);
      await appWindow.setSize(new LogicalSize(w, h));
    } 
    catch {
      // ignore invalid data
    }
  }

  await appWindow.show();

  let lastNormalPosition = null;
  let lastNormalSize = null;

  appWindow.onMoved(async ({ payload }) => {
    const isMinimized = await appWindow.isMinimized();
    const isMaximized = await appWindow.isMaximized();

    if (!isMinimized && !isMaximized) {
      lastNormalPosition = payload;
      localStorage.setItem('windowPosition', JSON.stringify(payload));
    }
  });

  appWindow.onResized(async ({ payload }) => {
    const isMinimized = await appWindow.isMinimized();
    const isMaximized = await appWindow.isMaximized();

    if (!isMinimized && !isMaximized) {
      const width = Math.max(400, payload.width);
      const height = Math.max(300, payload.height);
      lastNormalSize = { width, height };
      localStorage.setItem('windowSize', JSON.stringify({ width, height }));
    }
  });
  
  if (!activeTab) return;

  renderHighlights();
  syncFindMapHeight(activeTab);
}


// --------------------------------------- 

const openBtn = document.getElementById("openBtn");
const saveBtn = document.getElementById("saveBtn");
const saveAsBtn = document.getElementById("saveAsBtn");
const saveAll = document.getElementById('saveAll');

const resizeGrip = document.getElementById("resize-grip");
resizeGrip.addEventListener('mousedown', (e) => {
  if (e.buttons === 1) { // Check if the primary (left) button is pressed
    webview.startResizeDragging('SouthEast');
  }
});

function getTabCount() {
  return tabsState.size;
}

function getTabIndex(tab) {
  return [...tabsEl.children].indexOf(tab) + 1;
}


// Helpers
function getFileName(path) {
  return path ? path.split(/[/\\]/).pop() : "Untitled.txt";
}

async function updateTitle() {
  if (!activeTab) return;
  const state = tabsState.get(activeTab);
  if (!state) return;
  await webview.setTitle(`${getFileName(state.path)} - Better Notepad`);
}

const newFileBtn = document.getElementById("newFile");

newFileBtn.onclick = async () => {
  noteMenu.classList.toggle('show');
  await createTab("Untitled.txt");
};
/* 
// Open file
openBtn.onclick = async () => {
  noteMenu.classList.toggle('show');
  await openFileFunc();
};

async function openFileFunc() {
  const selected = await open({
    multiple: true,
  });

  if (!selected) return;

  const files = Array.isArray(selected) ? selected : [selected];

  for (const filePath of files) {
    // Check if file is already open
    let existingTab = null;

    for (const [tab, state] of tabsState) {
      if (state.path === filePath) {
        existingTab = tab;
        break;
      }
    }

    if (existingTab) {
      setActiveTab(existingTab); // 👈 switch to it
      continue;
    }
    showLoadingDelayed("Loading files...");
    // Open normally
    const content = await invoke("read_text_file", { path: filePath });
    await createTab(getFileName(filePath), filePath, content);
    hideLoadingDelayed();
  }

}
 */
// Open file
openBtn.onclick = async () => {
  noteMenu.classList.toggle("show");
  await openFileFunc();
};

async function openFileFunc() {
  const selected = await open({
    multiple: true
  });

  if (!selected) return;

  const files = Array.isArray(selected) ? selected : [selected];

  showLoadingDelayed("Loading files...");

  try {
    for (const filePath of files) {
      // Check if file is already open
      let existingTab = null;

      for (const [tab, state] of tabsState) {
        if (state.path === filePath) {
          existingTab = tab;
          break;
        }
      }

      if (existingTab) {
        setActiveTab(existingTab);
        continue;
      }

      const content = await invoke("read_text_file", { path: filePath });
      await createTab(getFileName(filePath), filePath, content);
    }
  } catch (e) {
    console.error("Failed to open file(s):", e);
  } finally {
    hideLoadingDelayed(); // ✅ ALWAYS runs
  }
}


// Save
saveBtn.onclick = async () => {
  noteMenu.classList.toggle('show');
  await saveBtnFunc();
};

async function saveBtnFunc() {
  if (!activeTab) return;
  const state = tabsState.get(activeTab);
  if (!state) return;
  if (!state.path) {
    return await saveAsFunc();
  }

  await invoke("write_text_file", {
    path: state.path,
    content: state.editor.value
  });

  state.isDirty = false;
  updateTitleAndTab();
}

saveAll.onclick = async () => {
  await saveAllFunc();
  noteMenu.classList.remove("show");
};
async function saveAllFunc() {
  // PASS 1: Save As untitled
  for (const state of tabsState.values()) {
    if (!state.isDirty || state.path) continue;

    setActiveTab(state.tab);
    await saveAsBtn.onclick();
    if (!state.path) return; // cancel = stop
  }

  // PASS 2: Save dirty
  for (const state of tabsState.values()) {
    if (!state.isDirty || !state.path) continue;

    await invoke("write_text_file", {
      path: state.path,
      content: state.editor.value
    });

    state.isDirty = false;
  }

  await refreshAllTabTitles();
}

async function refreshAllTabTitles() {
  for (const tab of tabsState.keys()) {
    const state = tabsState.get(tab);
    if (!state) return;
    const mark = state.isDirty ? "*" : "";
    const name = getDisplayName(tab);
    tab.querySelector(".tab-title").textContent = mark + name;
    tab.title = mark + name;
  }

  // also update window title for active tab
  await updateTitleAndTab();
}

// Save As
saveAsBtn.onclick = async () => {
  noteMenu.classList.toggle('show');
  await saveAsFunc();
};

async function saveAsFunc() {
  if (!activeTab) return;
  const filePath = await save({
    filters: [{ name: "Text Files", extensions: ["txt"] }]
  });
  if (!filePath) return;
  const state = tabsState.get(activeTab);
  if (!state) return;
  state.path = filePath;
  await invoke("write_text_file", {
    path: filePath,
    content: state.editor.value
  });
  state.isDirty = false;
  updateTitleAndTab();
  updateStatusFile();
}


document.getElementById("minBtn").onclick = () => {
  webview.minimize();
};

document.getElementById("maxBtn").onclick = async () => {
  const isMax = await webview.isMaximized();
  //isMax ? webview.unmaximize() : webview.maximize();

  if (isMax) {
    webview.unmaximize()
      document.getElementById('menubar_maximize_icon').classList.remove('hidden');
      document.getElementById('menubar_restore_icon').classList.add('hidden');
  } 
  else {
    webview.maximize();
      document.getElementById('menubar_restore_icon').classList.remove('hidden');
      document.getElementById('menubar_maximize_icon').classList.add('hidden');
  }
};

document.getElementById("closeBtn").onclick = () => {
  webview.close();
};

// DRAG TITLEBAR
const dragRegions = [
  document.getElementById("drag-region"),
  document.getElementById("titlebar-spacer")
].filter(Boolean);


dragRegions.forEach(region => {
  region.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    //if (e.target.closest("button, .tab, input")) return;
    if (e.target.closest("button, .tab, input, textarea")) return;

    isMouseDown = true;
    draggingStarted = false;
    startX = e.screenX;
    startY = e.screenY;
  });

  region.addEventListener("mousemove", (e) => {
    if (!isMouseDown || draggingStarted) return;

    const dx = Math.abs(e.screenX - startX);
    const dy = Math.abs(e.screenY - startY);

    if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
      draggingStarted = true;
      webview.startDragging();
    }
  });

  region.addEventListener("dblclick", async (e) => {
    //if (e.target.closest("button, .tab, input")) return;
    if (e.target.closest("button, .tab, input, textarea")) return;

    const isMax = await webview.isMaximized();
    isMax ? webview.unmaximize() : webview.maximize();
  });
});

document.addEventListener("mouseup", () => {
  isMouseDown = false;
  draggingStarted = false;
});

document.addEventListener("mouseleave", () => {
  isMouseDown = false;
  draggingStarted = false;
});

//---- ABOUT ----

const helpGithub = document.getElementById('helpGithub');
helpGithub.onclick = async () => {
  await shell.open('https://github.com/hudsonpear');
};
const aboutBtn = document.getElementById('aboutBtn');
const aboutWindow = document.getElementById('aboutWindow');
const aboutCloseBtn = document.getElementById('aboutCloseBtn');
const copyIcon = document.getElementById("copyIcon");
const theEmail = document.getElementById("theEmail");

copyIcon.onclick = function() {
  const textToCopy = "coolnewtabpage@gmail.com";
  copyToClipboard(textToCopy);
}
theEmail.onclick = function() {
  const textToCopy = "coolnewtabpage@gmail.com";
  copyToClipboard(textToCopy);
}
aboutBtn.onclick = function() {
  noteMenu.classList.toggle('show');
  aboutWindow.classList.toggle('hidden');
}
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } 
  catch (err) {}
}

aboutCloseBtn.addEventListener('click', () => {
  aboutWindow.classList.add('hidden');
});


document.addEventListener("keydown", async (e) => {
  // Ctrl+Shift+T - Reopen closed tab
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "t") {
    e.preventDefault();
    await reopenClosedTab();
    return;
  }

  // Ctrl+N - New file
  if (e.ctrlKey && e.key === "n") {
    e.preventDefault();
    showLoadingDelayed("Loading files...");
    await createTab("Untitled.txt");
    hideLoadingDelayed();
    return;
  }

  // Ctrl+W - Close tab
  if (e.ctrlKey && e.key === "w") {
    e.preventDefault();
    e.stopPropagation();
    await closeTab(activeTab);
    return;
  }

  // Ctrl+O - Open file
  if (e.ctrlKey && e.key === "o") {
    e.preventDefault();
    await openFileFunc();
    return;
  }

  // Ctrl+Shift+Alt+S - Save All
  if (e.ctrlKey && e.shiftKey && e.altKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    await saveAllFunc();
    return;
  }

  // Ctrl+Shift+S - Save As
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    await saveAsFunc();
    return;
  }

  // Ctrl+S - Save
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    await saveBtnFunc();
    return;
  }

  // Ctrl+P - Print
  if (e.ctrlKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    await printFunc();
    return;
  }

  // Zoom controls (require active tab)
  if (activeTab) {
    const state = tabsState.get(activeTab);
    if (state) {
      // Ctrl+0 - Reset zoom
      if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        state.zoom = 100;
        applyTabZoom(state.editor, state.zoom);
        updateZoomStatus();
        return;
      }

      // Ctrl++ - Zoom in
      if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "=" || e.code === "NumpadAdd")) {
        e.preventDefault();
        state.zoom = Math.min(300, state.zoom + 10);
        applyTabZoom(state.editor, state.zoom);
        updateZoomStatus();
        return;
      }

      // Ctrl+- - Zoom out
      if ((e.ctrlKey || e.metaKey) && (e.key === "-" || e.code === "NumpadSubtract")) {
        e.preventDefault();
        state.zoom = Math.max(50, state.zoom - 10);
        applyTabZoom(state.editor, state.zoom);
        updateZoomStatus();
        return;
      }
    }
  }

  // Ctrl+F - Find
  if (e.ctrlKey && e.key === "f") {
    e.preventDefault();
    findPanel.classList.remove("hidden");
    findInput.focus();

    if (activeTab) {
      const state = tabsState.get(activeTab);
      state.findMap.classList.remove("hidden");
      state.isFindOpen = true;
    }
    if (findInput.value) {
      updateFindMatches();
      renderHighlights();
    }
    return;
  }

  // Ctrl+H - Replace
  if (e.ctrlKey && e.key === "h") {
    e.preventDefault();
    findPanel.classList.remove("hidden");
    replaceInput.focus();
    return;
  }

  // F3 - Next/Previous match
  if (e.key === "F3") {
    e.preventDefault();
    if (e.shiftKey) {
      jumpToPrevMatchBeforeCursor();
    } 
    else {
      jumpToMatchAfterCursor();
    }
    return;
  }

  // Ctrl+G - Go to line
  if (e.ctrlKey && e.key === "g") {
    e.preventDefault();
    goToPanel.classList.remove("hidden");
    gotoInput.value = "";
    gotoInput.focus();
    gotoInput.select();
    return;
  }

  // Ctrl+Shift+F
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      findPanel.classList.remove("hidden");
      findInput.focus();

      if (activeTab) {
        const state = tabsState.get(activeTab);
        state.findMap.classList.remove("hidden");
        state.isFindOpen = true;
      }
      if (findInput.value) {
        updateFindMatches();
        renderHighlights();
      }
      return;
  }

  // Ctrl+Shift+G
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "g") {
      e.preventDefault();
      goToPanel.classList.remove("hidden");
      gotoInput.value = "";
      gotoInput.focus();
      gotoInput.select();
      return;
  }

  // Esc - Close panels
  if (e.key === "Escape") {
    findPanel.classList.add("hidden");
    goToPanel.classList.add("hidden");
    clearHighlights();
    if (activeTab) {
      const state = tabsState.get(activeTab);
      state.findMap.classList.add("hidden");
      state.isFindOpen = false;
    }
    return;
  }
});

// ------------ MENU ------------------

const menuBtn = document.getElementById('menuBtn');
const noteMenu = document.getElementById('noteMenu');

// Toggle menu on button click
menuBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // prevent event bubbling
  noteMenu.classList.toggle('show');
});

// Close menu when clicking outside
document.addEventListener('click', (e) => {
  if (!noteMenu.contains(e.target) && !menuBtn.contains(e.target)) {
    noteMenu.classList.remove('show');
  }
}); 

// -------------------TABS-----------------------

const tabsEl = document.getElementById("tabs");
const addTabBtn = document.getElementById("addTab");
const prevBtn = document.getElementById("tabPrev");
const nextBtn = document.getElementById("tabNext");

async function createTab(title = "Untitled.txt", path = null, content = "") {
  const tab = document.createElement("div");
  tab.className = "tab";
  tab.innerHTML = `
    <span class="tab-title interactive">${title}</span>
    <button class="tab-close">✕</button>
  `;

  const wrapper = document.createElement("div");
  wrapper.className = "editor-wrapper";

  const lineNumbers = document.createElement("div");
  lineNumbers.className = "line-numbers";
  lineNumbers.style.display = settingsCache.lineNumbers ? "block" : "none";

  const textarea = document.createElement("textarea");
  textarea.className = "editor";

  const highlightLayer = document.createElement("div");
  highlightLayer.className = "highlightLayer";

  const findMap = document.createElement("div");
  findMap.className = "scroll-find-map";

  const scrollContainer = document.createElement("div");
  scrollContainer.className = "editor-scroll-container";

  scrollContainer.append(textarea, highlightLayer, findMap);
  wrapper.append(lineNumbers, scrollContainer);
  editorContainer.appendChild(wrapper);

  // Link wrapper → tab
  wrapper.tabRef = tab;

  // Word wrap
  if (settingsCache.wordWrap) textarea.classList.add("wrap");

  // Spellcheck
  textarea.spellcheck = !!settingsCache.spellCheck;
  textarea.setAttribute("lang", settingsCache.spellLang || "en-US");

  textarea.value = content;
  textarea.style.display = "none";

  // Reset scroll/caret
  requestAnimationFrame(() => {
    textarea.scrollTop = 0;
    textarea.scrollLeft = 0;
    textarea.selectionStart = 0;
    textarea.selectionEnd = 0;

    highlightLayer.scrollTop = 0;
    highlightLayer.scrollLeft = 0;
    lineNumbers.scrollTop = 0;
  });

  // Zoom
  let initialZoom = path ? getFileZoom(path) : 100;

  // Abort controller
  const controller = new AbortController();
  const signal = controller.signal;

  // Resize observer
  const resizeObserver = new ResizeObserver(() => {
    syncFindMapHeight(tab);
    updateFindScrollbarMarkers();
  });
  resizeObserver.observe(wrapper);

  // Line number updater
  const updateLineNumbers = makeLineNumberUpdater(textarea, lineNumbers);

  // Build line numbers
  const lineCount = (textarea.value.match(/\n/g)?.length || 0) + 1;
  lineNumbers.innerHTML = "";
  for (let i = 1; i <= lineCount; i++) {
    const div = document.createElement("div");
    div.className = "line-number";
    div.textContent = i;
    lineNumbers.appendChild(div);
  }
  // Spacer
  const extra = document.createElement("div");
  extra.className = "line-number";
  extra.innerHTML = "&nbsp;";
  lineNumbers.appendChild(extra);


  syncEditorOffset(tab);

  // Save state
  tabsState.set(tab, {
    tab,
    editor: textarea,
    wrapper,
    lineNumbers,
    highlightLayer,
    findMap,
    path,
    zoom: initialZoom,
    isDirty: false,
    controller,
    resizeObserver,
    updateLineNumbers,
    isFindOpen: false,
  });

  // Tab click
  tab.addEventListener("click", e => {
    if (!e.target.classList.contains("tab-close")) setActiveTab(tab);
  }, { signal });

  // Close button
  tab.querySelector(".tab-close").addEventListener("click", e => {
    e.stopPropagation();
    closeTab(tab);
  }, { signal });

  // Middle click close
  tab.addEventListener("mouseup", e => {
    if (e.button === 1) closeTab(tab);
  }, { signal });

  // Tab indent
  textarea.addEventListener("keydown", e => {
    if (e.key === "Tab" && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      document.execCommand("insertText", false, "  ");
    }
  }, { signal });

  // FINAL UI
  tabsEl.appendChild(tab);
  setActiveTab(tab);
  tab.scrollIntoView({ behavior: "smooth", inline: "nearest" });
  updateNavButtons();
  updateCloseButtons();
  updateZoomStatus();
  renderHighlights();

} //creteTab

const _setActiveTab = setActiveTab;
setActiveTab = function(tab) {
  _setActiveTab(tab);
  updateTotalLines();
};

let highlightTimer;
function renderHighlights() {
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(_renderHighlights, 50);
}

function _renderHighlights() {
  if (!settingsCache.selectResults) return;

  if (!activeTab) return;

  const state = tabsState.get(activeTab);
  if (!state) return;

  const hl = state.highlightLayer;
  const query = findInput.value;

  if (!query) {
    hl.textContent = "";
    return;
  }

  const text = state.editor.value;
  const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(safeQuery, "gi");

  // Mark matches in raw text
  const marked = text.replace(regex, m => `<<<MARK>>>${m}<<<END>>>`);

  // Escape everything
  let escaped = escapeHTML(marked);

  // Restore marks
  escaped = escaped
    .replace(/&lt;&lt;&lt;MARK&gt;&gt;&gt;/g, "<mark>")
    .replace(/&lt;&lt;&lt;END&gt;&gt;&gt;/g, "</mark>");

  hl.innerHTML = escaped;

  const editor = state.editor;
  hl.style.height = editor.clientHeight + "px";
  hl.scrollTop = editor.scrollTop;
  hl.scrollLeft = editor.scrollLeft;
}

/* function escapeHTML(str) {
  return str.replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
} */
function escapeHTML(str) {
  if (!str) return "";

  return str
    .replace(/\0/g, '') // remove null bytes
    .replace(/[&<>"']/g, m => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[m]));
}

function makeLineNumberUpdater(textarea, lineNumbers) {
  let lastLineCount = (textarea.value.match(/\n/g)?.length || 0) + 1;
  let timer;

  return function updateLineNumbers() {
    if (!lineNumbersVisible || lineNumbers.style.display === "none") return;

    clearTimeout(timer);
    timer = setTimeout(() => {
      const value = textarea.value;
      const lineCount = (value.match(/\n/g)?.length || 0) + 1;
      if (lineCount === lastLineCount) return;

      if (lineCount > lastLineCount) {
        const frag = document.createDocumentFragment();
        for (let i = lastLineCount + 1; i <= lineCount; i++) {
          const div = document.createElement("div");
          div.className = "line-number";
          div.textContent = i;
          frag.appendChild(div);
        }
        lineNumbers.insertBefore(frag, lineNumbers.lastChild);
      } else {
        while (lineNumbers.children.length > lineCount + 1) {
          lineNumbers.children[lineNumbers.children.length - 2].remove();
        }
      }

      lastLineCount = lineCount;
    }, 20); // 20ms = feels instant but avoids spam
  };
}


tabsEl.addEventListener("wheel", (event) => {
  event.preventDefault();
  const scrollAmount = event.deltaY > 0 ? 50 : -50;
  tabsEl.scrollBy({ left: scrollAmount, behavior: "smooth" });
}, { passive: false });

/* function setActiveTab(tab) {
  if (!tab) return;
  if (activeTab === tab) return;

  if (activeTab && tabsState.has(activeTab)) {
    const prevState = tabsState.get(activeTab);
    prevState.wrapper.style.display = "none";
    prevState.editor.style.display = "none";  // hide textarea too
    activeTab.classList.remove("active");
  }

  activeTab = tab;
  activeTab.classList.add("active");

  const state = tabsState.get(tab);
  state.wrapper.style.display = "flex";  // show wrapper
  state.editor.style.display = "block";  // show textarea
  //state.editor.focus();

  isDirty = state.isDirty;

  updateTitleAndTab();
  applyTabZoom(state.editor, state.zoom);
  if (state.path) setFileZoom(state.path, state.zoom);
  updateZoomStatus();
  updateWordCharCount();
  updateCursorStatus();
  updateStatusFile();

  if (!document.activeElement.closest("#findPanel")) {
    //state.editor.focus();
  }
  if (findInput.value) {
    updateFindMatches();
    renderHighlights();
  }

  syncEditorOffset(tab);
} // setActiveTab
 */

function setActiveTab(tab) {
  if (!tab) return;
  if (activeTab === tab) return;

  // Save previous tab scroll
  if (activeTab && tabsState.has(activeTab)) {
    const prevState = tabsState.get(activeTab);

    prevState.scrollTop = prevState.editor.scrollTop;
    prevState.scrollLeft = prevState.editor.scrollLeft;

    prevState.wrapper.style.display = "none";
    prevState.editor.style.display = "none";
    activeTab.classList.remove("active");
  }

  activeTab = tab;
  activeTab.classList.add("active");

  const state = tabsState.get(tab);
  state.wrapper.style.display = "flex";
  state.editor.style.display = "block";

  // Restore scroll
  if (state.scrollTop !== undefined) {
    state.editor.scrollTop = state.scrollTop;
    state.editor.scrollLeft = state.scrollLeft || 0;
  }

  state.editor.focus({ preventScroll: true });

  isDirty = state.isDirty;

  updateTitleAndTab();
  applyTabZoom(state.editor, state.zoom);
  if (state.path) setFileZoom(state.path, state.zoom);
  updateZoomStatus();
  updateWordCharCount();
  updateCursorStatus();
  updateStatusFile();

  if ( findInput.value || !findPanel.classList.contains('hidden') ) {
    updateFindMatches();
    renderHighlights();
  }

  syncEditorOffset(tab);
}

function confirmClose(tab) {
  return new Promise(resolve => {
    const modal = document.getElementById("closeConfirm");
    const text = document.getElementById("closeConfirmText");

    modal.classList.remove("hidden");
    text.textContent = `Save changes to ${getDisplayName(tab)}?`;

    const save = document.getElementById("closeSaveBtn");
    const dont = document.getElementById("closeDontSaveBtn");
    const cancel = document.getElementById("closeCancelBtn");

    // Restore labels
    save.textContent = "Save";
    dont.textContent = "Don't Save";

    function cleanup(result) {
      modal.classList.add("hidden");
      save.onclick = dont.onclick = cancel.onclick = null;
      resolve(result);
    }

    save.onclick = () => cleanup("save");
    dont.onclick = () => cleanup("discard");
    cancel.onclick = () => cleanup("cancel");
  });
}

async function closeTab(tab) {
  const state = tabsState.get(tab);

  if (state.isDirty) {
    setActiveTab(tab);
    const result = await confirmClose(tab);
    if (result === "cancel") return;
    if (result === "save") {
      await saveBtnFunc();
      if (state.isDirty) return;
    }
  }

  const count = getTabCount();
  //if (getTabCount() <= 1) return;
  if (count === 0) {
    // Safety net: recreate a tab
    await createTab("Untitled.txt");
    return;
  }

  if (count === 1) {
    // Prevent closing last tab
    return;
  }

  const isClosingActive = tab === activeTab;
  const nextTab = isClosingActive
    ? tab.nextElementSibling || tab.previousElementSibling
    : null;

  // ---- SAVE CLOSED TAB FOR REOPEN ----
  closedTabsStack.push({
    title: getDisplayName(tab),
    path: state.path,
    content: state.editor.value,
    zoom: state.zoom,
    isDirty: state.isDirty
  });

  // limit history (optional)
  if (closedTabsStack.length > 20) {
    closedTabsStack.shift();
  }

  // ---- CLEANUP ----
  state.controller.abort();
  state.resizeObserver.disconnect();

  // ✅ Remove from DOM and state
  state.wrapper.remove();
  tab.remove();
  tabsState.delete(tab);

  if (isClosingActive && nextTab) setActiveTab(nextTab);

  updateNavButtons();
  updateCloseButtons();
}

function updateCloseButtons() {
  document.querySelectorAll(".tab-close").forEach(btn => {
    btn.disabled = getTabCount() <= 1;
  });
}

addTabBtn.addEventListener("click", async () => {
  await createTab(`Untitled.txt`);
});

function updateNavButtons() {
  const canScroll = tabsEl.scrollWidth > tabsEl.clientWidth;
  prevBtn.classList.toggle("hidden", !canScroll);
  nextBtn.classList.toggle("hidden", !canScroll);
}

prevBtn.addEventListener("click", () => {
  tabsEl.scrollBy({ left: -150, behavior: "smooth" });
});

nextBtn.addEventListener("click", () => {
  tabsEl.scrollBy({ left: 150, behavior: "smooth" });
});

tabsEl.addEventListener("scroll", updateNavButtons);

let resizeTimer;

window.addEventListener("resize", () => {
  if (!activeTab) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderHighlights, 50);
  syncFindMapHeight(activeTab);
  updateNavButtons();
  syncEditorOffset(activeTab);
});

async function updateTitleAndTab() {
  if (!activeTab) return;

  const state = tabsState.get(activeTab);
  const mark = state.isDirty ? "*" : "";
  const name = getDisplayName(activeTab);
  const title = `${mark}${name}`;

  // window title
  await webview.setTitle(`${title} - Better Notepad`);

  // tab title
  const tabTitle = activeTab.querySelector(".tab-title");
  tabTitle.textContent = title;
  activeTab.title = title;
}

function getDisplayName(tab) {
  const state = tabsState.get(tab);
  const index = [...tabsEl.children].indexOf(tab) + 1;
  if (state.path) {
    return getFileName(state.path);
  }
  return `Untitled ${index}.txt`;
}

document.addEventListener('keydown', (e) => {
  const isCtrlTab = (e.ctrlKey || e.metaKey) && e.key === 'Tab';
  if (isCtrlTab) {
    e.preventDefault();
    const tabs = [...document.querySelectorAll('.tab')];
    const activeIndex = tabs.findIndex(tab => tab.classList.contains('active'));
    const nextIndex = (activeIndex + 1) % tabs.length;
    setActiveTab(tabs[nextIndex]);  // <-- call your function here
  }
});

document.getElementById('toggleLineNumbersBtn').addEventListener('click', () => {
  lineNumbersVisible = !lineNumbersVisible;
  for (const state of tabsState.values()) {
    state.lineNumbers.style.display = lineNumbersVisible ? 'block' : 'none';
  }
});

// --------------- STATUSBAR --------------------

const statusFile = document.getElementById("status-file");
const statusLines = document.getElementById("status-lines");
const statusChars = document.getElementById("status-chars");
const statusWords = document.getElementById("status-words");

function updateWordCharCount() {
  if (!activeTab) return;
  const state = tabsState.get(activeTab);
  const editor = state.editor;
  let text;
  if (editor.selectionStart !== editor.selectionEnd) {
    text = editor.value.slice(editor.selectionStart, editor.selectionEnd);
  } 
  else {
    text = editor.value;
  }
  const chars = text.length;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  statusChars.textContent = `Chars: ${chars}`;
  statusWords.textContent = `Words: ${words}`;
}
 
// Update cursor line + column
// Pure function - testable
function calculateCursorPosition(text, selectionStart) {
  const lines = text.slice(0, selectionStart).split("\n");
  return { line: lines.length, col: lines[lines.length - 1].length + 1 };
}
// Impure wrapper
function updateCursorStatus() {
  if (!activeTab) return;
  const state = tabsState.get(activeTab);
  const { line, col } = calculateCursorPosition(state.editor.value, state.editor.selectionStart);
  statusLines.textContent = `Line ${line}, Col ${col}`;
}

function updateStatusFile() {
  if (!activeTab) return;
  const state = tabsState.get(activeTab);
  statusFile.textContent = shortenPath(state.path);
}

function shortenPath(path, max = 190) {
  if (!path) return "Untitled (not saved)";
  if (path.length <= max) return path;
  return "…" + path.slice(-max);
}
const statusTotalLines = document.getElementById("status-total-lines");

function updateTotalLines() {
  if (!activeTab) return;
  const state = tabsState.get(activeTab);
  const total = (state.editor.value.match(/\n/g) || []).length + 1;
  statusTotalLines.textContent = `Lines: ${total}`;
}

//------------ ZOOM --------------

document.addEventListener("wheel", e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  if (!activeTab) return;
  const state = tabsState.get(activeTab);
  // Change zoom
  state.zoom += e.deltaY < 0 ? 10 : -10;
  state.zoom = Math.max(50, Math.min(300, state.zoom));
  // Apply zoom
  applyTabZoom(state.editor, state.zoom);
  // Save zoom per file
  if (state.path) setFileZoom(state.path, state.zoom);
  updateZoomStatus();
}, { passive: false });

function updateZoomStatus() {
  if (!activeTab) return;
  const state = tabsState.get(activeTab);
  document.getElementById("status-zoom").textContent = state.zoom + "%";
}

//------------------------------------

async function loadZoomFile() {
  try {
    const dir = await path.appLocalDataDir();
    const file = await path.join(dir, ZOOM_FILE);
    const data = await fs.readTextFile(file);
    zoomCache = JSON.parse(data);
  } 
  catch {
    zoomCache = {};
  }
}

async function saveZoomFile() {
  const dir = await path.appLocalDataDir();
  const file = await path.join(dir, ZOOM_FILE);
  await fs.writeTextFile(file, JSON.stringify(zoomCache, null, 2), {
    createDirs: true // 👈 auto mkdir
  });
}

function normalizePath(p) {
  return p.toLowerCase();
}

function getFileZoom(filePath) {
  return zoomCache[normalizePath(filePath)] ?? 100;
}

let zoomSaveTimer = null;

function setFileZoom(filePath, zoom) {
  const key = normalizePath(filePath);

  if (zoom === 100) {
    // Default zoom → remove from cache
    if (key in zoomCache) {
      delete zoomCache[key];
    }
  } 
  else {
    zoomCache[key] = zoom;
  }

  clearTimeout(zoomSaveTimer);
  zoomSaveTimer = setTimeout(saveZoomFile, 300);
}

/* 
function applyTabZoom(textarea, percent) {
  const baseSize = 14;
  const size = baseSize * (percent / 100);
  const lh = size * 1.1;
  textarea.style.fontSize = size + "px";
  textarea.style.lineHeight = lh + "px";
  if (!activeTab) return;
  const state = tabsState.get(activeTab);
  //if (state?.lineNumbers) {
  if (lineNumbersVisible) {
    state.lineNumbers.style.fontSize = size + "px";
    state.lineNumbers.style.lineHeight = lh + "px";
  }
  if (state?.path) {
    setFileZoom(state.path, percent);
  }
  if (state?.highlightLayer) {
    state.highlightLayer.style.fontSize = size + "px";
    state.highlightLayer.style.lineHeight = lh + "px";
  }
  renderHighlights();
  syncFindMapHeight();
} */

function applyTabZoom(textarea, percent) {
  if (!activeTab) return;
  const state = tabsState.get(activeTab);
  if (!state) return;

  const baseSize = getBaseFontSize();   // 🔥 dynamic
  const size = baseSize * (percent / 100);
  const lineHeight = size * 1.1;

  textarea.style.fontSize = size + "px";
  textarea.style.lineHeight = lineHeight + "px";

  if (state.lineNumbers) {
    state.lineNumbers.style.fontSize = size + "px";
    state.lineNumbers.style.lineHeight = lineHeight + "px";
  }

  if (state.highlightLayer) {
    state.highlightLayer.style.fontSize = size + "px";
    state.highlightLayer.style.lineHeight = lineHeight + "px";
  }

  if (state.path) {
    setFileZoom(state.path, percent);
  }

  renderHighlights();
  syncFindMapHeight();
}


const zoomResetBtn = document.getElementById("zoomResetBtn");
zoomResetBtn.addEventListener("click", () => {
  if (!activeTab) return;
  const state = tabsState.get(activeTab);
  state.zoom = 100;
  applyTabZoom(state.editor, state.zoom);
  updateZoomStatus();
});

function getBaseFontSize() {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--editor-font-size")
    .trim();

  return parseFloat(value) || 14;
}

// ------------------MENU--------------- 

const openLocation = document.getElementById('openLocation');

openLocation.addEventListener("click", async () => {
  noteMenu.classList.toggle('show');
 if (!activeTab) return;
  await revealCurrentFile();
});

async function revealCurrentFile() {
  const state = tabsState.get(activeTab);
  if (!state?.path) return;
  await invoke("reveal_file", { path: state.path });
}

window.addEventListener("beforeunload", (e) => {
  const dirty = [...tabsState.values()].some(s => s.isDirty);
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

let forceClose = false;

await appWindow.onCloseRequested(async (event) => {
  if (forceClose) return;
  const dirty = [...tabsState.values()].some(s => s.isDirty);
  if (!dirty) return;
  event.preventDefault();
  const res = await confirmExitApp();
  if (res === "save-all") {
    await saveAllFunc();
    forceClose = true;
    await appWindow.close();
  }
  if (res === "discard") {
    forceClose = true;
    await appWindow.close();
  }
});

function confirmExitApp() {
  return new Promise(resolve => {
    const modal = document.getElementById("closeConfirm");
    const text = document.getElementById("closeConfirmText");
    modal.classList.remove("hidden");
    text.textContent = "You have unsaved files. What do you want to do?";
    const save = document.getElementById("closeSaveBtn");
    const dont = document.getElementById("closeDontSaveBtn");
    const cancel = document.getElementById("closeCancelBtn");
    function cleanup(result) {
      modal.classList.add("hidden");
      save.onclick = dont.onclick = cancel.onclick = null;
      resolve(result);
    }
    // Rename meanings for exit
    save.textContent = "Save All";
    dont.textContent = "Don't Save";
    save.onclick = () => cleanup("save-all");
    dont.onclick = () => cleanup("discard");
    cancel.onclick = () => cleanup("cancel");
  });
}

// --- Print Button ---

const printBtn = document.getElementById('printBtn');

printBtn.addEventListener('click', async () => {
  noteMenu.classList.toggle('show');
  await printFunc();
});

async function printFunc() {
  /*   
  if (!activeTab) return;
  const state = tabsState.get(activeTab);

  let filePath = state.path;

  // If file not saved → create temp file
  if (!filePath) {
    const tempDir = await path.appLocalDataDir();
    filePath = await path.join(tempDir, "temp_print.txt");

    await fs.writeTextFile(filePath, state.editor.value, {
      createDirs: true
    });
  }

  await invoke("open_file_print_dialog", { path: filePath })
    .catch(console.error); 

  */
    
  window.print();
}

// -----------HIGHLIGHT SYSTEM-----------------------------

const findPanel = document.getElementById("findPanel");
const goToPanel = document.getElementById('goToPanel');
const gotoClose = document.getElementById('gotoClose');
gotoClose.addEventListener('click', async () => {
  goToPanel.classList.add("hidden");
});

const findBtn = document.getElementById('findBtn');

findBtn.addEventListener('click', async () => {
  noteMenu.classList.toggle('show');
  findPanel.classList.remove("hidden");
  findInput.focus();
  if (activeTab) {
    const state = tabsState.get(activeTab);
    state.findMap.classList.remove("hidden");
    state.isFindOpen = true;
  }
  if (findInput.value) {
    updateFindMatches();
    renderHighlights();
    //selectMatch(false);
  }
});

const goToBtn = document.getElementById('goToBtn');
goToBtn.addEventListener("click", () => {
  noteMenu.classList.toggle('show');
  goToPanel.classList.remove("hidden");
});

findCloseBtn.onclick = () => {
  findPanel.classList.add("hidden");
  clearHighlights();
  if (activeTab) {
    const state = tabsState.get(activeTab);
    state.findMap.classList.add("hidden");
    state.isFindOpen = false;
  }
};

let findMatches = [];
let findIndex = 0;

[findInput, replaceInput, gotoInput].forEach(input => {
  input.spellcheck = false;
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("autocapitalize", "off");
});

/* function updateFindMatches() {
  if (!activeTab) return;
  const state = tabsState.get(activeTab);
  if (!state) return;
  const text = state.editor.value;
  const query = findInput.value;
  if (!query) {
    findCount.textContent = "";
    return;
  }
  findMatches = [];
  findIndex = 0;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let pos = 0;
  while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
    findMatches.push(pos);
    pos += lowerQuery.length;
  }
  findCount.textContent = `${findMatches.length} matches`;
} */
function updateFindMatches() {
  if (!activeTab) return;

  const state = tabsState.get(activeTab);
  if (!state) return;

  const text = state.editor.value;
  const query = findInput.value;

  // 🔒 EMPTY QUERY = FULL RESET
  if (!query) {
    findMatches = [];
    findIndex = 0;
    findCount.textContent = "";
    clearHighlights();
    updateFindScrollbarMarkers();
    return;
  }

  findMatches = [];
  findIndex = 0;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  let pos = 0;
  while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
    findMatches.push(pos);
    pos += lowerQuery.length;
  }

  findCount.textContent =
  findMatches.length === 1
    ? "1 match"
    : `${findMatches.length} matches`;

}


function selectMatch(focusEditor = true) {
  if (!activeTab || !findMatches.length) return;
  const state = tabsState.get(activeTab);
  if (!state) return;
  const query = findInput.value;
  const pos = findMatches[findIndex];
  if (focusEditor) state.editor.focus();
  state.editor.selectionStart = pos;
  state.editor.selectionEnd = pos + query.length;
  // Vertical scroll
  const before = state.editor.value.slice(0, pos);
  const line = before.split("\n").length;
  const lineHeight = parseFloat(getComputedStyle(state.editor).lineHeight);
  state.editor.scrollTop = (line - 1) * lineHeight;
  // Horizontal scroll
  fastScrollCaret(state.editor);
}

findNextBtn.onclick = () => {
  jumpToMatchAfterCursor();
};

findPrevBtn.onclick = () => {
  if (!findMatches.length) return;
  jumpToPrevMatchBeforeCursor();
};

replaceOneBtn.onclick = () => {
  if (!findMatches.length) return;
  const state = tabsState.get(activeTab);
  if (!state) return;
  const query = findInput.value;
  const repl = replaceInput.value;
  const pos = findMatches[findIndex];
  // Focus editor FIRST
  state.editor.focus();
  // Select match
  state.editor.selectionStart = pos;
  state.editor.selectionEnd = pos + query.length;
  // Replace (undo-safe)
  document.execCommand("insertText", false, repl);
  markDirty(state);
  updateFindMatches();
  renderHighlights();
};

replaceAllBtn.onclick = () => {
  if (!activeTab) return;
  const state = tabsState.get(activeTab);
  if (!state) return;
  const query = findInput.value;
  const repl = replaceInput.value;
  if (!query) return;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "gi"); // g = all, i = ignore case
  const text = state.editor.value.replace(regex, repl);
  state.editor.select();
  document.execCommand("insertText", false, text);
  markDirty(state);
  updateFindMatches();
  renderHighlights();
};

function markDirty(state) {
  if (!state.isDirty) {
    state.isDirty = true;
    updateTitleAndTab();
  }
}

goBtn.onclick = async () => {
  if (!activeTab) return;
  const state = tabsState.get(activeTab);
  if (!state) return;
  const line = parseInt(gotoInput.value);
  if (!line || line < 1) return;
  const lines = state.editor.value.split("\n");
  let pos = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    pos += lines[i].length + 1;
  }
  state.editor.focus();
  setTimeout(() => {
    state.editor.selectionStart = pos;
    state.editor.selectionEnd = pos;
  }, 0);
  // IMPORTANT: wait for focus
  await new Promise(r => requestAnimationFrame(r));
  state.editor.selectionStart = pos;
  state.editor.selectionEnd = pos;
  // Scroll line into view
  const lineHeight = parseFloat(getComputedStyle(state.editor).lineHeight);
  state.editor.scrollTop = (line - 1) * lineHeight;
};


let lastSearchAnchor = null;

function jumpToPrevMatchBeforeCursor() {
  if (!activeTab || !findMatches.length) return;
  const state = tabsState.get(activeTab);
  if (!state) return;
  const cursor = state.editor.selectionStart;
  if (lastSearchAnchor !== cursor) {
    lastSearchAnchor = cursor;
    let idx = -1;
    for (let i = findMatches.length - 1; i >= 0; i--) {
      if (findMatches[i] < cursor) {
        idx = i;
        break;
      }
    }
    if (idx === -1) idx = findMatches.length - 1;
    findIndex = idx;
  } 
  else {
    findIndex = (findIndex - 1 + findMatches.length) % findMatches.length;
  }
  selectMatch(true);
}

function jumpToMatchAfterCursor() {
  if (!activeTab || !findMatches.length) return;
  const state = tabsState.get(activeTab);
  if (!state) return;
  const cursor = state.editor.selectionEnd;
  // First F3 after moving cursor → anchor to cursor
  if (lastSearchAnchor !== cursor) {
    lastSearchAnchor = cursor;
    let idx = findMatches.findIndex(pos => pos >= cursor);
    if (idx === -1) idx = 0;
    findIndex = idx;
  } 
  // Next F3 presses → just cycle normally
  else {
    findIndex = (findIndex + 1) % findMatches.length;
  }
  selectMatch(true);
}

findInput.addEventListener("input", () => {
  if (!activeTab) return;
  const state = tabsState.get(activeTab);
  if (!state) return;
  updateFindMatches();
  selectMatch(false);
  renderHighlights();
  updateFindScrollbarMarkers();
  if (!findInput.value) {
    state.findMap.classList.add("hidden");
    state.isFindOpen = false;
    clearHighlights();
    updateFindScrollbarMarkers();
  } 
  else {
    state.findMap.classList.remove("hidden");
    state.isFindOpen = true;
  }
});

gotoInput.addEventListener("input", async () => {
  if (!activeTab) return;
  const state = tabsState.get(activeTab);
  if (!state) return;
  let [lineStr, colStr] = gotoInput.value.split(":");
  let line = parseInt(lineStr);
  let col = parseInt(colStr || "1");
  if (!line || line < 1) return;
  const lines = state.editor.value.split("\n");
  if (line > lines.length) return;
  let pos = 0;
  for (let i = 0; i < line - 1; i++) {
    pos += lines[i].length + 1;
  }
  pos += col - 1;
  await new Promise(r => requestAnimationFrame(r));
  state.editor.selectionStart = state.editor.selectionEnd = pos;
  const lineHeight = parseFloat(getComputedStyle(state.editor).lineHeight);
  state.editor.scrollTop = (line - 1) * lineHeight;

    // 🔥 ADD THESE
  state.lineNumbers.scrollTop = state.editor.scrollTop;
  highlightCurrentLine(state.editor);
});

replaceInput.addEventListener("input", () => {
  // do nothing, just keep focus
});

function clearHighlights() {
  for (const state of tabsState.values()) {
    if (state.highlightLayer) {
      state.highlightLayer.innerHTML = "";
    }
  }
}

function syncEditorOffset(tab) {
  const state = tabsState.get(tab);
  if (!state) return;

  // no width hacks needed
  state.editor.style.paddingLeft = "5px";
  state.highlightLayer.style.paddingLeft = "5px";
}


function fastScrollCaret(textarea) {
  const pos = textarea.selectionStart;
  const lineStart = textarea.value.lastIndexOf("\n", pos - 1) + 1;
  const col = pos - lineStart;
  const charWidth = parseFloat(getComputedStyle(textarea).fontSize) * 0.6;
  const caretX = col * charWidth;
  if (caretX < textarea.scrollLeft) {
    textarea.scrollLeft = caretX;
  } 
  else if (caretX > textarea.scrollLeft + textarea.clientWidth) {
    textarea.scrollLeft = caretX - textarea.clientWidth + 20;
  }
}

function updateFindScrollbarMarkers() {
  if (!settingsCache.selectResults) return;
  if (!activeTab) return;
  const state = tabsState.get(activeTab);
  if (!state || !state.isFindOpen) return;
  const editor = state.editor;
  const map = state.findMap;
  const query = findInput.value;
  map.innerHTML = "";
  if (!query) return;
  const text = editor.value;
  const safe = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(safe, "gi");
  let match;
  const positions = [];
  while ((match = regex.exec(text))) positions.push(match.index);
  const mapHeight = map.clientHeight;
  const totalHeight = editor.scrollHeight;
  for (const pos of positions) {
    const pixelY = getPixelY(editor, pos);
    const ratio = pixelY / totalHeight;
    const y = ratio * mapHeight;
    const marker = document.createElement("div");
    marker.className = "scroll-find-marker";
    marker.style.top = y + "px";
    map.appendChild(marker);
  }
}

function syncFindMapHeight(tab) {
  const state = tabsState.get(tab);
  if (!state) return;
  const editor = state.editor;
  const map = state.findMap;
  map.style.height = editor.clientHeight - 12 + "px";
}

function getScrollTopForMatch(editor, pos) {
  const textBefore = editor.value.slice(0, pos);
  const line = textBefore.split("\n").length - 1;
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight);
  return line * lineHeight;
}

function getPixelY(editor, pos) {
  const style = getComputedStyle(editor);
  mirrorDiv.style.font = style.font;
  mirrorDiv.style.lineHeight = style.lineHeight;
  mirrorDiv.style.padding = style.padding;
  mirrorDiv.style.width = editor.clientWidth + "px";
  const before = editor.value.slice(0, pos);
  const after = editor.value.slice(pos);
  mirrorDiv.textContent = before;
  const span = document.createElement("span");
  span.textContent = after[0] || ".";
  mirrorDiv.appendChild(span);
  const y = span.offsetTop;
  mirrorDiv.innerHTML = "";
  return y;
}

// ----------------- EVENT DELEGATIONS ------------------

// Store tab reference on wrapper
function getTabFromEditor(editor) {
  return editor.closest(".editor-wrapper")?.tabRef;
}

function smartDebounce(func, wait, maxWait) {
  let timeout;
  let lastCall = 0;
  
  return function(...args) {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;
    clearTimeout(timeout);
    // If we've waited too long, execute immediately
    if (timeSinceLastCall >= maxWait) {
      lastCall = now;
      func.apply(this, args);
    } else {
      // Otherwise, debounce normally
      timeout = setTimeout(() => {
        lastCall = Date.now();
        func.apply(this, args);
      }, wait);
    }
  };
}

// Create smart debounced versions
const smartUpdateFindMarkers = smartDebounce(
  updateFindScrollbarMarkers,
  150,  // Wait 150ms after last input
  500   // But force update every 500ms max
);

// INPUT (typing)
editorContainer.addEventListener("input", e => {
  if (!e.target.classList.contains("editor")) return;
  const tab = getTabFromEditor(e.target);
  if (!tab) return;
  const state = tabsState.get(tab);
  if (!state) return;
  state.isDirty = true;
  updateTitleAndTab();
  if (!lineNumbersVisible || lineNumbers.style.display === "none") {
    state.updateLineNumbers();
  }
  syncEditorOffset(tab);
  updateCursorStatus();
  updateWordCharCount();
  updateTotalLines();
  // ✅ Smart debounced updates
  if (state.isFindOpen) {
    smartUpdateFindMarkers();
    renderHighlights(); // Keep existing debounce
  }
});

// CLICK (cursor move)
editorContainer.addEventListener("click", e => {
  if (!e.target.classList.contains("editor")) return;
  lastSearchAnchor = null;
  updateCursorStatus();
  updateWordCharCount();
  highlightCurrentLine(e.target);
});

// KEYUP
editorContainer.addEventListener("keyup", e => {
  if (!e.target.classList.contains("editor")) return;
  updateCursorStatus();
  highlightCurrentLine(e.target);
});

// SCROLL (must capture!)
editorContainer.addEventListener("scroll", e => {
  if (!e.target.classList.contains("editor")) return;
  const tab = getTabFromEditor(e.target);
  const state = tabsState.get(tab);
  if (!state) return;
  state.highlightLayer.scrollTop = e.target.scrollTop;
  state.highlightLayer.scrollLeft = e.target.scrollLeft;
  state.lineNumbers.scrollTop = e.target.scrollTop;
  state.lineNumbers.scrollTop = state.editor.scrollTop;
}, true);

function highlightCurrentLine(editor) {
  const tab = getTabFromEditor(editor);
  const state = tabsState.get(tab);
  if (!state) return;
  const lineNumbers = state.lineNumbers;
  const textBeforeCaret = editor.value.slice(0, editor.selectionStart);
  const currentLine = (textBeforeCaret.match(/\n/g) || []).length + 1;
  if (state.lastHighlighted) {
    state.lastHighlighted.classList.remove("highlighted");
  }
  const el = lineNumbers.children[currentLine - 1];
  if (el) {
    el.classList.add("highlighted");
    state.lastHighlighted = el;
  }
}

function getCurrentLineFast(textarea) {
  const textBeforeCaret = textarea.value.slice(0, textarea.selectionStart);
  return (textBeforeCaret.match(/\n/g) || []).length + 1;
}


editorContainer.addEventListener("keydown", e => {
  if (!e.target.classList.contains("editor")) return;
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "x") return;

  const editor = e.target;

  // If text selected → let browser cut normally
  if (editor.selectionStart !== editor.selectionEnd) return;

  e.preventDefault();

  const tab = getTabFromEditor(editor);
  const state = tabsState.get(tab);

  const text = editor.value;
  const pos = editor.selectionStart;

  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  let lineEnd = text.indexOf("\n", pos);
  if (lineEnd === -1) lineEnd = text.length;

  // Select whole line INCLUDING newline
  editor.setSelectionRange(lineStart, Math.min(lineEnd + 1, text.length));

  // Native cut → keeps undo history + clipboard
  document.execCommand("cut");

  // Mark dirty
  if (!state.isDirty) {
    state.isDirty = true;
    updateTitleAndTab();
  }
});

//DRAG WINDOW SYSTEM------------------------------------

const draggableIds = ['dragHandleAbout' , 'dragHandleSett'];
let draggableElements = [];

draggableIds.forEach((id) => {
    const dragHandle = document.getElementById(id);
    const form = dragHandle.parentElement;
    draggableElements.push({ dragHandle, form });
});

draggableElements.forEach((draggable) => {
    let isDraggingWin = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    draggable.dragHandle.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', dragForm);
    document.addEventListener('mouseup', stopDrag);
    function startDrag(e) {
        isDraggingWin = true;
        dragOffsetX = e.pageX - draggable.form.offsetLeft;
        dragOffsetY = e.pageY - draggable.form.offsetTop;
    }
    function dragForm(e) {
        if (isDraggingWin) {
            draggable.form.style.left = e.pageX - dragOffsetX + 'px';
            draggable.form.style.top = e.pageY - dragOffsetY + 'px';
        }
    }
    function stopDrag() {
        isDraggingWin = false;
    }
});

//SETTINGS WINDOW SYSTEM------------------------------------

const settWindow = document.getElementById('settWindow');
const settCloseBtn = document.getElementById('settCloseBtn');

settCloseBtn.addEventListener('click', () => {
  settWindow.classList.add('hidden');
});

settBtn.addEventListener('click', () => {
  noteMenu.classList.toggle('show');
  settWindow.classList.remove('hidden');
});

const lightdark_mode = document.getElementById('lightdark_mode');
const line_break = document.getElementById('line_break');
const line_numbers = document.getElementById('line_numbers');
const display_statusbar = document.getElementById('display_statusbar');
const select_results = document.getElementById('select_results');

//const darkModeBtn = document.getElementById('darkModeBtn');
const lineBreakBtn = document.getElementById('lineBreakBtn');
const lineNumbersBtn = document.getElementById('lineNumbersBtn');
const statusbarBtn = document.getElementById('statusbarBtn');
const selectResultsBtn = document.getElementById('selectResultsBtn');
const spellCheckBtn = document.getElementById('spellCheckBtn');

const skinSelect = document.getElementById("skinSelect");

async function populateSkinSelect() {
  skinSelect.innerHTML = "";

  // Built-in skins
  const builtInGroup = document.createElement("optgroup");
  builtInGroup.label = "Built-in";

  for (const name in builtInSkins) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name[0].toUpperCase() + name.slice(1);
    builtInGroup.appendChild(opt);
  }

  skinSelect.appendChild(builtInGroup);

  // Custom skins
  const customSkins = await listCustomSkins();
  if (customSkins.length > 0) {
    const customGroup = document.createElement("optgroup");
    customGroup.label = "Custom";

    for (const name of customSkins) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      customGroup.appendChild(opt);
    }

    skinSelect.appendChild(customGroup);
  }

  // Select current skin
  skinSelect.value = settingsCache.skin;
}

const SETTINGS_FILE = "settings.json";
let settingsCache = {
  skin: "dark",
  wordWrap: false,
  spellCheck: false,
  lineNumbers: true,
  statusbar: true,
  selectResults: true,

  fontFamily: "Consolas, monospace",
  fontSize: 14,
  fontWeight: 400
};

//----------------------- SKIN SYSTEM -----------------------

async function ensureSkinFolder() {
  const dir = await appLocalDataDir();
  const skinDir = await join(dir, "skins");

  await mkdir(skinDir, { recursive: true });
}

async function loadSettingsFile() {
  try {
    const dir = await path.appLocalDataDir();
    const file = await path.join(dir, SETTINGS_FILE);
    const data = await fs.readTextFile(file);
    settingsCache = JSON.parse(data);
  }
  catch {
    settingsCache = {
      skin: "dark",
      wordWrap: false,
      spellCheck: false,
      lineNumbers: true,
      statusbar: true,
      selectResults: true,
      fontFamily: "Consolas, monospace",
      fontSize: 14,
      fontWeight: 400
    };
  }
}

async function saveSettingsFile() {
  const dir = await path.appLocalDataDir();
  const file = await path.join(dir, SETTINGS_FILE);
  await fs.writeTextFile(file, JSON.stringify(settingsCache, null, 2), {
    createDirs: true
  });
}

const builtInSkins = {
  dark: {
    "--scrollbar-bg": "transparent",
    "--scrollbar-thumb-bg": "rgb(75,79,83)",
    "--scroll-thumb-hover-bg": "rgb(90, 90, 90)",
    "--scroll-corner": "rgb(24, 24, 24)",
    "--scroll-track": "#111",
    "--scroll-thumb": "#444",
    "--scroll-bg": "rgb(25, 25, 25)",
    "--scroll-hover-bg": "rgb(50, 50, 50)",

    "--text-color": "white",
    "--editor-bg": "rgb(23,23,23)",
    "--light-bg": "rgb(31,31,31)",

    "--number-bg": "rgb(28,28,28)",
    "--number-color": "rgb(136,136,136)",
    "--number-border": "rgb(40, 40, 40)",

    "--resize-color": "rgba(41, 41, 41, 0.63)",
    "--btn-hover-color": "rgba(255, 255, 255, 0.1)",
    "--btn-hover-color-close": "rgb(196, 43, 28)",

    "--tab-bg": "rgb(26, 26, 26)",
    "--tab-active": "rgb(85, 85, 85)",
    "--tab-close-btn": "rgb(187, 187, 187)",
    "--tab-btn-hover": "rgba(255,255,255,0.1)",
    "--tab-hover": "rgb(35, 35, 35)",
    "--tab-font-color-inactive": "rgb(157, 157, 157)",
    "--tab-font-color-active": "white",
    "--tab-font-weight-active": "bold",

    "--background-color": "rgb(27, 27, 27)",
    "--border-color": "rgb(51,51,51)",
    "--box-shadow-color": "rgba(255, 255, 255, 0.1)",

    "--menu-bg": "rgb(26, 26, 26)",
    "--menu-box-shadow": "rgba(0,0,0,0.2)",
    "--menu-divider": "#4d4d4d",
    "--menu-border": "#4d4d4d",

    "--status-btn": "#aaa",

    "--slider-bg": "#ccc",
    "--slider-bg-checked": "rgb(75, 75, 75)",

    "--email-color": "rgb(0, 132, 255)",
    "--gitbtn-bg": "rgb(59, 59, 59)",
    "--gitbtn-hover": "rgb(73, 72, 71)",
    "--close-btn-hover": "rgb(255, 47, 47)",
    "--highlightmark-color": "rgba(158, 106, 3, 0.75)",
    "--modal-overlay-color": "rgba(0,0,0,.4)"
  },

  light: {
    "--scrollbar-bg": "transparent",
    "--scrollbar-thumb-bg": "rgb(180,180,180)",
    "--scroll-thumb-hover-bg": "rgb(140,140,140)",
    "--scroll-corner": "rgb(240,240,240)",
    "--scroll-track": "#eaeaea",
    "--scroll-thumb": "#b5b5b5",
    "--scroll-bg": "rgb(240,240,240)",
    "--scroll-hover-bg": "rgb(220,220,220)",

    "--text-color": "rgb(30,30,30)",
    "--editor-bg": "rgb(245,245,245)",
    "--light-bg": "rgb(230,230,230)",

    "--number-bg": "rgb(235,235,235)",
    "--number-color": "rgb(120,120,120)",
    "--number-border": "rgb(200,200,200)",

    "--resize-color": "rgba(150,150,150,0.3)",
    "--btn-hover-color": "rgba(0,0,0,0.08)",
    "--btn-hover-color-close": "rgb(196, 43, 28)",

    "--tab-bg": "rgb(235,235,235)",
    "--tab-active": "rgb(200,200,200)",
    "--tab-close-btn": "rgb(100,100,100)",
    "--tab-btn-hover": "rgba(0,0,0,0.1)",
    "--tab-hover": "rgb(220,220,220)",
    "--tab-font-color-inactive": "rgb(157, 157, 157)",
    "--tab-font-color-active": "rgb(30,30,30)",
    "--tab-font-weight-active": "bold",

    "--background-color": "rgb(248, 248, 248)",
    "--border-color": "rgb(210,210,210)",
    "--box-shadow-color": "rgba(0,0,0,0.1)",

    "--menu-bg": "rgb(245,245,245)",
    "--menu-box-shadow": "rgba(0,0,0,0.15)",
    "--menu-divider": "#d0d0d0",
    "--menu-border": "#d0d0d0",

    "--status-btn": "#444",

    "--slider-bg": "#ddd",
    "--slider-bg-checked": "rgb(160,160,160)",


    "--email-color": "rgb(0, 102, 204)",
    "--gitbtn-bg": "rgb(220,220,220)",
    "--gitbtn-hover": "rgb(200,200,200)",
    "--close-btn-hover": "rgb(255, 47, 47)",
    "--highlightmark-color": "rgba(255, 200, 120, 0.7)",
    "--modal-overlay-color": "rgba(0,0,0,.4)"
  },

  darkGrey: {
    "--scrollbar-bg": "transparent",
    "--scrollbar-thumb-bg": "rgb(75,79,83)",
    "--scroll-thumb-hover-bg": "rgb(90, 90, 90)",
    "--scroll-corner": "rgb(50, 50, 50)",
    "--scroll-track": "#111",
    "--scroll-thumb": "#444",
    "--scroll-bg": "rgb(50, 50, 50)",
    "--scroll-hover-bg": "rgb(50, 50, 50)",

    "--text-color": "white",
    "--editor-bg": "rgb(35,35,35)",
    "--light-bg": "rgb(46,46,46)",

    "--number-bg": "rgb(33,33,33)",
    "--number-color": "rgb(136,136,136)",
    "--number-border": "rgb(40, 40, 40)",

    "--resize-color": "rgba(41, 41, 41, 0.63)",
    "--btn-hover-color": "rgba(255, 255, 255, 0.1)",
    "--btn-hover-color-close": "rgb(196, 43, 28)",

    "--tab-bg": "rgb(35, 35, 35)",
    "--tab-active": "rgb(85, 85, 85)",
    "--tab-close-btn": "rgb(187, 187, 187)",
    "--tab-btn-hover": "rgba(255,255,255,0.1)",
    "--tab-hover": "rgb(44, 44, 44)",
    "--tab-font-color-inactive": "rgb(157, 157, 157)",
    "--tab-font-color-active": "white",
    "--tab-font-weight-active": "bold",

    "--background-color": "rgb(38,38,38)",
    "--border-color": "rgb(51,51,51)",
    "--box-shadow-color": "rgba(255, 255, 255, 0.1)",

    "--menu-bg": "rgb(26, 26, 26)",
    "--menu-box-shadow": "rgba(0,0,0,0.2)",
    "--menu-divider": "#4d4d4d",
    "--menu-border": "#4d4d4d",

    "--status-btn": "#aaa",

    "--slider-bg": "#ccc",
    "--slider-bg-checked": "rgb(75, 75, 75)",

    "--email-color": "rgb(0, 132, 255)",
    "--gitbtn-bg": "rgb(59, 59, 59)",
    "--gitbtn-hover": "rgb(73, 72, 71)",
    "--close-btn-hover": "rgb(255, 47, 47)",
    "--highlightmark-color": "rgba(158, 106, 3, 0.75)",
    "--modal-overlay-color": "rgba(0,0,0,.4)"
  },

  lightGrey: {
    "--scrollbar-bg": "transparent",
    "--scrollbar-thumb-bg": "rgb(110,110,110)",
    "--scroll-thumb-hover-bg": "rgb(70,70,70)",
    "--scroll-corner": "rgb(70,70,70)",
    "--scroll-track": "rgb(55,55,55)",
    "--scroll-thumb": "rgb(120,120,120)",
    "--scroll-bg": "rgb(60,60,60)",
    "--scroll-hover-bg": "rgb(90,90,90)",

    "--text-color": "rgb(235,235,235)",
    "--editor-bg": "rgb(60,60,60)",
    "--light-bg": "rgb(75,75,75)",

    "--number-bg": "rgb(65,65,65)",
    "--number-color": "rgb(170,170,170)",
    "--number-border": "rgb(95,95,95)",

    "--resize-color": "rgba(120,120,120,0.35)",
    "--btn-hover-color": "rgba(255,255,255,0.12)",
    "--btn-hover-color-close": "rgb(196, 43, 28)",

    "--tab-bg": "rgb(70,70,70)",
    "--tab-active": "rgb(95,95,95)",
    "--tab-close-btn": "rgb(210,210,210)",
    "--tab-btn-hover": "rgba(255,255,255,0.15)",
    "--tab-hover": "rgb(85,85,85)",
    "--tab-font-color-inactive": "rgb(157, 157, 157)",
    "--tab-font-color-active": "rgb(235,235,235)",
    "--tab-font-weight-active": "bold",

    "--background-color": "rgb(68,68,68)",
    "--border-color": "rgb(100,100,100)",
    "--box-shadow-color": "rgba(0,0,0,0.35)",

    "--menu-bg": "rgb(65,65,65)",
    "--menu-box-shadow": "rgba(0,0,0,0.35)",
    "--menu-divider": "rgb(100,100,100)",
    "--menu-border": "rgb(100,100,100)",

    "--status-btn": "rgb(210,210,210)",

    "--slider-bg": "rgb(120,120,120)",
    "--slider-bg-checked": "rgb(160,160,160)",

    "--email-color": "rgb(120,180,255)",
    "--gitbtn-bg": "rgb(90,90,90)",
    "--gitbtn-hover": "rgb(120,120,120)",
    "--close-btn-hover": "rgb(255, 47, 47)",
    "--highlightmark-color": "rgba(255, 180, 80, 0.6)",
    "--modal-overlay-color": "rgba(0,0,0,.4)"
  },

  nord: {
    "--scrollbar-bg": "transparent",
    "--scrollbar-thumb-bg": "rgb(76, 86, 106)",
    "--scroll-thumb-hover-bg": "rgb(94, 129, 172)",
    "--scroll-corner": "rgb(46, 52, 64)",
    "--scroll-track": "rgb(59, 66, 82)",
    "--scroll-thumb": "rgb(76, 86, 106)",
    "--scroll-bg": "rgb(46, 52, 64)",
    "--scroll-hover-bg": "rgb(67, 76, 94)",

    "--text-color": "rgb(236, 239, 244)",
    "--editor-bg": "rgb(46, 52, 64)",
    "--light-bg": "rgb(59, 66, 82)",

    "--number-bg": "rgb(59, 66, 82)",
    "--number-color": "rgb(216, 222, 233)",
    "--number-border": "rgb(76, 86, 106)",

    "--resize-color": "rgba(76, 86, 106, 0.5)",
    "--btn-hover-color": "rgba(129, 161, 193, 0.2)",
    "--btn-hover-color-close": "rgb(191, 97, 106)",

    "--tab-bg": "rgb(59, 66, 82)",
    "--tab-active": "rgb(76, 86, 106)",
    "--tab-close-btn": "rgb(216, 222, 233)",
    "--tab-btn-hover": "rgba(129, 161, 193, 0.2)",
    "--tab-hover": "rgb(67, 76, 94)",
    "--tab-font-color-inactive": "rgb(157, 157, 157)",
    "--tab-font-color-active": "rgb(236, 239, 244)",
    "--tab-font-weight-active": "bold",

    "--background-color": "rgb(46, 52, 64)",
    "--border-color": "rgb(76, 86, 106)",
    "--box-shadow-color": "rgba(0, 0, 0, 0.3)",

    "--menu-bg": "rgb(59, 66, 82)",
    "--menu-box-shadow": "rgba(0, 0, 0, 0.3)",
    "--menu-divider": "rgb(76, 86, 106)",
    "--menu-border": "rgb(76, 86, 106)",

    "--status-btn": "rgb(216, 222, 233)",

    "--slider-bg": "rgb(76, 86, 106)",
    "--slider-bg-checked": "rgb(136, 192, 208)",

    "--email-color": "rgb(136, 192, 208)",
    "--gitbtn-bg": "rgb(67, 76, 94)",
    "--gitbtn-hover": "rgb(76, 86, 106)",
    "--close-btn-hover": "rgb(191, 97, 106)",
    "--highlightmark-color": "rgba(235, 203, 139, 0.4)",
    "--modal-overlay-color": "rgba(0, 0, 0, 0.5)"
  },
  darkBlue: {
    "--scrollbar-bg": "transparent",
    "--scrollbar-thumb-bg": "rgb(52, 73, 104)",
    "--scroll-thumb-hover-bg": "rgb(71, 96, 136)",
    "--scroll-corner": "rgb(15, 23, 42)",
    "--scroll-track": "rgb(20, 30, 54)",
    "--scroll-thumb": "rgb(52, 73, 104)",
    "--scroll-bg": "rgb(15, 23, 42)",
    "--scroll-hover-bg": "rgb(30, 41, 66)",

    "--text-color": "rgb(226, 232, 240)",
    "--editor-bg": "rgb(15, 23, 42)",
    "--light-bg": "rgb(30, 41, 66)",

    "--number-bg": "rgb(20, 30, 54)",
    "--number-color": "rgb(148, 163, 184)",
    "--number-border": "rgb(52, 73, 104)",

    "--resize-color": "rgba(52, 73, 104, 0.6)",
    "--btn-hover-color": "rgba(96, 165, 250, 0.15)",
    "--btn-hover-color-close": "rgb(239, 68, 68)",

    "--tab-bg": "rgb(20, 30, 54)",
    "--tab-active": "rgb(52, 73, 104)",
    "--tab-close-btn": "rgb(203, 213, 225)",
    "--tab-btn-hover": "rgba(96, 165, 250, 0.2)",
    "--tab-hover": "rgb(30, 41, 66)",
    "--tab-font-color-inactive": "rgb(157, 157, 157)",
    "--tab-font-color-active": "rgb(226, 232, 240)",
    "--tab-font-weight-active": "bold",

    "--background-color": "rgb(15, 23, 42)",
    "--border-color": "rgb(52, 73, 104)",
    "--box-shadow-color": "rgba(59, 130, 246, 0.1)",

    "--menu-bg": "rgb(20, 30, 54)",
    "--menu-box-shadow": "rgba(0, 0, 0, 0.4)",
    "--menu-divider": "rgb(52, 73, 104)",
    "--menu-border": "rgb(52, 73, 104)",

    "--status-btn": "rgb(203, 213, 225)",

    "--slider-bg": "rgb(71, 85, 105)",
    "--slider-bg-checked": "rgb(59, 130, 246)",

    "--email-color": "rgb(96, 165, 250)",
    "--gitbtn-bg": "rgb(30, 41, 66)",
    "--gitbtn-hover": "rgb(52, 73, 104)",
    "--close-btn-hover": "rgb(239, 68, 68)",
    "--highlightmark-color": "rgba(59, 130, 246, 0.3)",
    "--modal-overlay-color": "rgba(0, 0, 0, 0.5)"
  },
  darkPink: {
    "--scrollbar-bg": "transparent",
    "--scrollbar-thumb-bg": "rgb(131, 56, 99)",
    "--scroll-thumb-hover-bg": "rgb(157, 78, 125)",
    "--scroll-corner": "rgb(30, 16, 28)",
    "--scroll-track": "rgb(40, 24, 38)",
    "--scroll-thumb": "rgb(131, 56, 99)",
    "--scroll-bg": "rgb(30, 16, 28)",
    "--scroll-hover-bg": "rgb(56, 33, 52)",

    "--text-color": "rgb(251, 207, 232)",
    "--editor-bg": "rgb(30, 16, 28)",
    "--light-bg": "rgb(45, 28, 42)",

    "--number-bg": "rgb(40, 24, 38)",
    "--number-color": "rgb(232, 121, 184)",
    "--number-border": "rgb(131, 56, 99)",

    "--resize-color": "rgba(131, 56, 99, 0.6)",
    "--btn-hover-color": "rgba(236, 72, 153, 0.2)",
    "--btn-hover-color-close": "rgb(244, 63, 94)",

    "--tab-bg": "rgb(40, 24, 38)",
    "--tab-active": "rgb(131, 56, 99)",
    "--tab-close-btn": "rgb(251, 207, 232)",
    "--tab-btn-hover": "rgba(236, 72, 153, 0.25)",
    "--tab-hover": "rgb(56, 33, 52)",
    "--tab-font-color-inactive": "rgb(157, 157, 157)",
    "--tab-font-color-active": "rgb(251, 207, 232)",
    "--tab-font-weight-active": "bold",

    "--background-color": "rgb(30, 16, 28)",
    "--border-color": "rgb(131, 56, 99)",
    "--box-shadow-color": "rgba(236, 72, 153, 0.15)",

    "--menu-bg": "rgb(40, 24, 38)",
    "--menu-box-shadow": "rgba(0, 0, 0, 0.4)",
    "--menu-divider": "rgb(131, 56, 99)",
    "--menu-border": "rgb(131, 56, 99)",

    "--status-btn": "rgb(251, 207, 232)",

    "--slider-bg": "rgb(157, 78, 125)",
    "--slider-bg-checked": "rgb(236, 72, 153)",

    "--email-color": "rgb(249, 168, 212)",
    "--gitbtn-bg": "rgb(56, 33, 52)",
    "--gitbtn-hover": "rgb(131, 56, 99)",
    "--close-btn-hover": "rgb(244, 63, 94)",
    "--highlightmark-color": "rgba(236, 72, 153, 0.35)",
    "--modal-overlay-color": "rgba(0, 0, 0, 0.5)"
  },
  darkGreen: {
    "--scrollbar-bg": "transparent",
    "--scrollbar-thumb-bg": "rgb(52, 92, 61)",
    "--scroll-thumb-hover-bg": "rgb(74, 124, 86)",
    "--scroll-corner": "rgb(17, 24, 20)",
    "--scroll-track": "rgb(22, 33, 26)",
    "--scroll-thumb": "rgb(52, 92, 61)",
    "--scroll-bg": "rgb(17, 24, 20)",
    "--scroll-hover-bg": "rgb(34, 50, 39)",

    "--text-color": "rgb(220, 252, 231)",
    "--editor-bg": "rgb(17, 24, 20)",
    "--light-bg": "rgb(30, 43, 34)",

    "--number-bg": "rgb(22, 33, 26)",
    "--number-color": "rgb(134, 239, 172)",
    "--number-border": "rgb(52, 92, 61)",

    "--resize-color": "rgba(52, 92, 61, 0.6)",
    "--btn-hover-color": "rgba(74, 222, 128, 0.15)",
    "--btn-hover-color-close": "rgb(239, 68, 68)",

    "--tab-bg": "rgb(22, 33, 26)",
    "--tab-active": "rgb(52, 92, 61)",
    "--tab-close-btn": "rgb(220, 252, 231)",
    "--tab-btn-hover": "rgba(74, 222, 128, 0.2)",
    "--tab-hover": "rgb(34, 50, 39)",
    "--tab-font-color-inactive": "rgb(157, 157, 157)",
    "--tab-font-color-active": "rgb(220, 252, 231)",
    "--tab-font-weight-active": "bold",

    "--background-color": "rgb(17, 24, 20)",
    "--border-color": "rgb(52, 92, 61)",
    "--box-shadow-color": "rgba(74, 222, 128, 0.1)",

    "--menu-bg": "rgb(22, 33, 26)",
    "--menu-box-shadow": "rgba(0, 0, 0, 0.4)",
    "--menu-divider": "rgb(52, 92, 61)",
    "--menu-border": "rgb(52, 92, 61)",

    "--status-btn": "rgb(220, 252, 231)",

    "--slider-bg": "rgb(74, 124, 86)",
    "--slider-bg-checked": "rgb(74, 222, 128)",

    "--email-color": "rgb(134, 239, 172)",
    "--gitbtn-bg": "rgb(34, 50, 39)",
    "--gitbtn-hover": "rgb(52, 92, 61)",
    "--close-btn-hover": "rgb(239, 68, 68)",
    "--highlightmark-color": "rgba(74, 222, 128, 0.3)",
    "--modal-overlay-color": "rgba(0, 0, 0, 0.5)"
  }
};

function applySkinVars(vars) {
  const base = builtInSkins.dark;

  for (const k in base) {
    document.documentElement.style.setProperty(k, base[k]);
  }
  for (const k in vars) {
    document.documentElement.style.setProperty(k, vars[k]);
  }
}

async function loadSkin(name) {
  //darkModeBtn.checked = (name === "dark");
  //darkModeBtn.checked = (name !== "light");
  if (skinSelect) skinSelect.value = name;

  try {
    if (builtInSkins[name]) {
      applySkinVars(builtInSkins[name]);
      return;
    }

    const dir = await path.appLocalDataDir();
    const file = await path.join(dir, "skins", name + ".json");

    // 🔥 ADD THIS HERE
    if (!(await fs.exists(file))) {
      console.warn("Missing skin:", name);
      settingsCache.skin = "dark";
      await saveSettingsFile();
      applySkinVars(builtInSkins.dark);
      //darkModeBtn.checked = true;
      return;
    }

    const data = JSON.parse(await fs.readTextFile(file));
    applySkinVars(data.vars);
  }
  catch (e) {
    console.error("Skin load failed:", name, e);
    applySkinVars(builtInSkins.dark);
    //darkModeBtn.checked = true;
  }
}

let settingsSaveTimer;

function setSkin(name) {
  settingsCache.skin = name;
  localStorage.setItem("bn_skin", name);
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(saveSettingsFile, 300);
  loadSkin(name);
}

async function refreshSkins() {
  await populateSkinSelect();
}

async function listCustomSkins() {
  const dir = await path.appLocalDataDir();
  const skinDir = await path.join(dir, "skins");

  try {
    const files = await fs.readDir(skinDir);
    return files
      .filter(f => f.name.endsWith(".json"))
      .map(f => f.name.replace(".json",""));
  } 
  catch {
    return [];
  }
}

await loadSettingsFile();
applyFontSettings();
lineNumbersVisible = !!settingsCache.lineNumbers;
await ensureSkinFolder();
await populateSkinSelect();
skinSelect.value = settingsCache.skin || "dark";
await loadSkin(settingsCache.skin || "dark");
document.documentElement.style.visibility = "visible";

const skinsFolderBtn = document.getElementById('skinsFolderBtn');

skinsFolderBtn.onclick = () => invoke("open_skins_folder");

skinSelect.addEventListener("change", () => {
  setSkin(skinSelect.value);
});

function setWordWrap(enabled) {
  settingsCache.wordWrap = enabled;
  localStorage.setItem("bn_wordWrap", enabled ? "1" : "0");

  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(saveSettingsFile, 300);

  applyWordWrapToAllTabs();
}

function applyWordWrapToAllTabs() {
  const wrap = settingsCache.wordWrap;

  for (const state of tabsState.values()) {
    if (wrap) state.editor.classList.add("wrap");
    else state.editor.classList.remove("wrap");
  }
}

lineBreakBtn.addEventListener("change", () => {
  setWordWrap(lineBreakBtn.checked);
});

lineBreakBtn.checked = !!settingsCache.wordWrap;

applyWordWrapToAllTabs();

function setSpellCheck(enabled) {
  settingsCache.spellCheck = enabled;
  localStorage.setItem("bn_spellcheck", enabled ? "1" : "0");

  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(saveSettingsFile, 300);

  applySpellCheckToAllTabs();
}

function applySpellCheckToAllTabs() {
  for (const state of tabsState.values()) {
    state.editor.spellcheck = !!settingsCache.spellCheck;
  }
}

spellCheckBtn.addEventListener("change", () => {
  setSpellCheck(spellCheckBtn.checked);
});

spellCheckBtn.checked = !!settingsCache.spellCheck;
applySpellCheckToAllTabs();

// Load
lineNumbersBtn.checked = lineNumbersVisible;

// Toggle
lineNumbersBtn.addEventListener("change", async () => {
  lineNumbersVisible = lineNumbersBtn.checked;
  settingsCache.lineNumbers = lineNumbersVisible;

  applyLineNumbersToAllTabs();
  await saveSettingsFile();
});

function applyLineNumbersToAllTabs() {
  for (const state of tabsState.values()) {
    state.lineNumbers.style.display = lineNumbersVisible ? "block" : "none";
    syncEditorOffset(state.tab);
  }
}

async function reopenClosedTab() {
  const last = closedTabsStack.pop();
  if (!last) return;
  showLoadingDelayed("Loading files...");
  await createTab(last.title, last.path, last.content);
  hideLoadingDelayed();
  // restore zoom + dirty flag
  const tab = activeTab;
  const state = tabsState.get(tab);

  state.zoom = last.zoom ?? 100;
  applyTabZoom(state.editor, state.zoom);

  if (last.isDirty) {
    state.isDirty = true;
    updateTitleAndTab();
  }
}

// ------ DISPLAY STATUSBAR ---------

const statusbar = document.getElementById("statusbar");

statusbarBtn.addEventListener("change", () => {
  settingsCache.statusbar = statusbarBtn.checked;

  setStatusbarVisible(settingsCache.statusbar);

  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(saveSettingsFile, 300);
});


function setStatusbarVisible(visible) {
  statusbar.classList.toggle("hidden", !visible);
  statusbarBtn.checked = visible;
}

statusbarBtn.checked = settingsCache.statusbar !== false;
setStatusbarVisible(statusbarBtn.checked);

// -------------- SELECT FIND RESULTS TOGGLE --------------------

selectResultsBtn.checked = !!settingsCache.selectResults;

selectResultsBtn.addEventListener("change", () => {
  settingsCache.selectResults = selectResultsBtn.checked;
  localStorage.setItem("bn_selectResults", settingsCache.selectResults ? "1" : "0");

  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(saveSettingsFile, 300);
});

const savedSelect = localStorage.getItem("bn_selectResults");

if (savedSelect !== null) {
  settingsCache.selectResults = savedSelect === "1";
}

// -------------- FONT ---------------

const fontFamilySelect = document.getElementById("fontFamilySelect");
const fontSizeSelect   = document.getElementById("fontSizeSelect");
const fontWeightSelect = document.getElementById("fontWeightSelect");

function applyFontSettings() {
  document.documentElement.style.setProperty(
    "--editor-font-family",
    settingsCache.fontFamily
  );

  document.documentElement.style.setProperty(
    "--editor-font-size",
    settingsCache.fontSize + "px"
  );  

  document.documentElement.style.setProperty(
    "--editor-font-weight",
    settingsCache.fontWeight
  );

  // 🔥 reapply zoom with new base
  if (activeTab) {
    const state = tabsState.get(activeTab);
    applyTabZoom(state.editor, state.zoom);
  }
}

// Load UI values
fontFamilySelect.value = settingsCache.fontFamily;
fontSizeSelect.value = settingsCache.fontSize;
fontWeightSelect.value = settingsCache.fontWeight;

function saveFontSettings() {
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(saveSettingsFile, 300);
}

// Events
fontFamilySelect.addEventListener("change", () => {
  settingsCache.fontFamily = fontFamilySelect.value;
  applyFontSettings();
  saveFontSettings();
});

fontSizeSelect.addEventListener("change", () => {
  settingsCache.fontSize = Number(fontSizeSelect.value);
  applyFontSettings();
  saveFontSettings();
});

fontWeightSelect.addEventListener("change", () => {
  settingsCache.fontWeight = Number(fontWeightSelect.value);
  applyFontSettings();
  saveFontSettings();
});

// ----------- LOADING ------------

const loadingDiv = document.getElementById("loadingDiv");

let loadingTimer = null;

function showLoading(text = "Loading...") {
  if (!loadingDiv) return;
  loadingDiv.querySelector("span").textContent = text;
  loadingDiv.classList.remove("hidden");
}

function hideLoading() {
  if (!loadingDiv) return;
  loadingDiv.classList.add("hidden");
}

function showLoadingDelayed(text = "Loading...", delay = 200) {
  clearTimeout(loadingTimer);

  loadingTimer = setTimeout(() => {
    showLoading(text);
    loadingTimer = null; // 🔑 mark as already shown
  }, delay);
}

function hideLoadingDelayed() {
  // If delay not fired yet → cancel it
  if (loadingTimer) {
    clearTimeout(loadingTimer);
    loadingTimer = null;
    return;
  }

  // If already visible → hide
  hideLoading();
}

// ----------------- INIT ------------------------

(async () => {
  const paths = await invoke("get_opened_file");
  await initializeWindow();
  await loadZoomFile();
  showLoadingDelayed("Loading files...");
  if (paths && paths.length) {
    for (const filePath of paths) {
      const content = await invoke("read_text_file", { path: filePath });
      await createTab(getFileName(filePath), filePath, content);
      hideLoadingDelayed();
    }
  } 
  else {
    await createTab("Untitled.txt");
    hideLoadingDelayed();
  }
  hideLoadingDelayed();
  if (lineNumbersVisible) {
    applyLineNumbersToAllTabs();
  }
  updateTitle();
})();

listen("open-files", async (event) => {
  const paths = event.payload;

  // Nothing to do → DO NOT show loader
  if (!paths || !paths.length) return;

  showLoadingDelayed("Loading files...");

  try {
    for (const filePath of paths.slice(1)) {
      // Check if already open
      let existingTab = null;

      for (const [tab, state] of tabsState) {
        if (state.path === filePath) {
          existingTab = tab;
          break;
        }
      }

      if (existingTab) {
        setActiveTab(existingTab);
        continue;
      }

      const content = await invoke("read_text_file", { path: filePath });
      await createTab(getFileName(filePath), filePath, content);
    }
  } catch (e) {
    console.error("Failed to open files:", e);
  } finally {
    hideLoadingDelayed(); // ✅ ALWAYS runs
  }
});
