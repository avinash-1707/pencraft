/**
 *
 * All renderer logic. No framework — direct DOM manipulation.
 * Philosophy: minimal, fast, keyboard-first.
 *
 * State machine (simplified):
 *   idle → generating → done
 *              ↓           ↓
 *           error       (idle on next open)
 *
 * IPC bridge: window.pencraft (set by preload/index.js)
 */

"use strict";

// ─── DOM references (cached once) ────────────────────────────────────────────
const app = document.getElementById("app");
const modeTabs = document.getElementById("modeTabs");
const inputText = document.getElementById("inputText");
const generateBtn = document.getElementById("generateBtn");
const generateLbl = generateBtn.querySelector(".generate-label");
const iconSpark = generateBtn.querySelector(".icon-spark");
const iconSpinner = generateBtn.querySelector(".icon-spinner");
const closeBtn = document.getElementById("closeBtn");
const outputSec = document.getElementById("outputSection");
const outputText = document.getElementById("outputText");
const copyBtn = document.getElementById("copyBtn");
const replaceBtn = document.getElementById("replaceBtn");
const errorToast = document.getElementById("errorToast");
const errorMsg = document.getElementById("errorMsg");

// ─── App state ────────────────────────────────────────────────────────────────
const state = {
  modes: [],
  activeMode: "improve",
  isGenerating: false,
  lastResult: "",
  cleanupFns: [], // IPC listener teardowns
};

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadModes();
  setupIPCListeners();
  setupKeyboardShortcuts();
  setupButtonHandlers();

  // Signal main process we're ready
  window.pencraft.send("window:ready");
}

// ─── Load prompt modes from main process ─────────────────────────────────────
async function loadModes() {
  const { modes, defaultMode } = await window.pencraft.invoke("app:get-modes");
  state.modes = modes;
  state.activeMode = defaultMode;

  // Render mode tabs
  modeTabs.innerHTML = "";
  modes.forEach((mode) => {
    const tab = document.createElement("button");
    tab.className = "mode-tab" + (mode.id === defaultMode ? " active" : "");
    tab.dataset.modeId = mode.id;
    tab.setAttribute("role", "tab");
    tab.setAttribute(
      "aria-selected",
      mode.id === defaultMode ? "true" : "false",
    );
    tab.innerHTML = `<span class="mode-tab-icon" aria-hidden="true">${mode.icon}</span>${mode.label}`;
    tab.addEventListener("click", () => setMode(mode.id));
    modeTabs.appendChild(tab);
  });
}

function setMode(modeId) {
  state.activeMode = modeId;
  const mode = state.modes.find((m) => m.id === modeId);

  // Update tab UI
  document.querySelectorAll(".mode-tab").forEach((t) => {
    const active = t.dataset.modeId === modeId;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", active.toString());
  });

  // Update button label
  if (mode) {
    generateLbl.textContent = mode.label;
  }
}

// ─── IPC event listeners ──────────────────────────────────────────────────────
function setupIPCListeners() {
  // Clean up any existing listeners first
  state.cleanupFns.forEach((fn) => fn());
  state.cleanupFns = [];

  // Window show → play entrance animation
  state.cleanupFns.push(
    window.pencraft.on("window:show", () => {
      resetUI();
      requestAnimationFrame(() => {
        app.classList.remove("hidden", "exiting");
        app.classList.add("visible");
      });
    }),
  );

  // Window hide → play exit animation
  state.cleanupFns.push(
    window.pencraft.on("window:hide", () => {
      app.classList.add("exiting");
      app.classList.remove("visible");
    }),
  );

  // Pre-fill from X11 selection
  state.cleanupFns.push(
    window.pencraft.on("window:prefill", ({ text }) => {
      if (text && text.trim()) {
        inputText.value = text.trim();
        autoResizeInput();
      }
      inputText.focus();
      inputText.select();
    }),
  );

  // AI streaming events
  state.cleanupFns.push(
    window.pencraft.on("ai:start", () => {
      state.isGenerating = true;
      hideError();
      showOutput();
      outputText.textContent = "";
      outputText.classList.add("streaming");
      setGeneratingUI(true);
    }),
  );

  state.cleanupFns.push(
    window.pencraft.on("ai:chunk", ({ chunk }) => {
      outputText.textContent += chunk;
      // Auto-scroll output to bottom during streaming
      outputText.scrollTop = outputText.scrollHeight;
    }),
  );

  state.cleanupFns.push(
    window.pencraft.on("ai:done", ({ result }) => {
      state.isGenerating = false;
      state.lastResult = result;
      outputText.classList.remove("streaming");
      setGeneratingUI(false);
    }),
  );

  state.cleanupFns.push(
    window.pencraft.on("ai:error", ({ message }) => {
      state.isGenerating = false;
      outputText.classList.remove("streaming");
      setGeneratingUI(false);
      showError(message);
      // Keep output visible if there's partial content
      if (!outputText.textContent.trim()) {
        hideOutput();
      }
    }),
  );
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Escape → close window
    if (e.key === "Escape") {
      e.preventDefault();
      closeWindow();
      return;
    }

    // Enter (focused in input) → generate
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      document.activeElement === inputText
    ) {
      e.preventDefault();
      triggerGenerate();
      return;
    }

    // Ctrl+Enter → force generate from anywhere
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      triggerGenerate();
      return;
    }

    // Tab → cycle through modes
    if (
      e.key === "Tab" &&
      !e.shiftKey &&
      document.activeElement === inputText
    ) {
      e.preventDefault();
      cycleModes(1);
      return;
    }

    // Shift+Tab → cycle modes backward
    if (e.key === "Tab" && e.shiftKey && document.activeElement === inputText) {
      e.preventDefault();
      cycleModes(-1);
      return;
    }

    // Ctrl+C when output focused → copy
    if (e.key === "c" && e.ctrlKey && document.activeElement !== inputText) {
      if (state.lastResult) {
        copyResult();
      }
    }
  });
}

function cycleModes(dir) {
  const idx = state.modes.findIndex((m) => m.id === state.activeMode);
  const next = (idx + dir + state.modes.length) % state.modes.length;
  setMode(state.modes[next].id);
}

// ─── Button handlers ──────────────────────────────────────────────────────────
function setupButtonHandlers() {
  generateBtn.addEventListener("click", triggerGenerate);
  closeBtn.addEventListener("click", closeWindow);
  copyBtn.addEventListener("click", copyResult);
  replaceBtn.addEventListener("click", replaceAndClose);
}

// ─── Core actions ─────────────────────────────────────────────────────────────

// Debounce to prevent rapid repeated triggers
let _generateDebounce = null;
function triggerGenerate() {
  if (state.isGenerating) return;
  clearTimeout(_generateDebounce);
  _generateDebounce = setTimeout(() => {
    const text = inputText.value.trim();
    if (!text) {
      showError("Type or paste text to improve first.");
      inputText.focus();
      return;
    }
    window.pencraft.invoke("app:generate", { text, modeId: state.activeMode });
  }, 50);
}

async function copyResult() {
  if (!state.lastResult) return;
  const result = await window.pencraft.invoke("app:copy-result", {
    text: state.lastResult,
  });
  if (result.ok) {
    // Flash button to confirm
    copyBtn.classList.add("success");
    copyBtn.textContent = "✓ Copied";
    setTimeout(() => {
      copyBtn.classList.remove("success");
      copyBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
          <path d="M1 9V2C1 1.44772 1.44772 1 2 1H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        Copy`;
    }, 1500);
  }
}

async function replaceAndClose() {
  if (!state.lastResult) return;
  await window.pencraft.invoke("app:copy-result", { text: state.lastResult });
  closeWindow();
}

function closeWindow() {
  window.pencraft.send("window:close");
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function setGeneratingUI(loading) {
  generateBtn.disabled = loading;
  generateBtn.classList.toggle("loading", loading);
  iconSpark.style.display = loading ? "none" : "";
  iconSpinner.style.display = loading ? "" : "none";
}

function showOutput() {
  outputSec.style.display = "flex";
}

function hideOutput() {
  outputSec.style.display = "none";
  state.lastResult = "";
  outputText.textContent = "";
}

function showError(message) {
  errorMsg.textContent = message;
  errorToast.style.display = "flex";
  // Auto-dismiss after 5s
  setTimeout(hideError, 5000);
}

function hideError() {
  errorToast.style.display = "none";
}

function autoResizeInput() {
  inputText.style.height = "auto";
  inputText.style.height = Math.min(inputText.scrollHeight, 140) + "px";
}

inputText.addEventListener("input", autoResizeInput);

function resetUI() {
  hideError();
  hideOutput();
  setGeneratingUI(false);
  state.isGenerating = false;
  state.lastResult = "";
  // Don't clear input — keep last value, user may want to re-use
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init().catch((err) => {
  console.error("[Pencraft renderer] init error:", err);
});
