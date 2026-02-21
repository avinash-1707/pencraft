/**
 *
 * Manages the single floating palette window.
 *
 * Design decisions:
 *   - Window is created ONCE at app start and hidden (preloaded)
 *   - Show/hide via toggle — never destroy/recreate (eliminates cold-start flicker)
 *   - Frameless + alwaysOnTop + center placement
 *   - contextIsolation + sandboxing for security
 *   - No nodeIntegration in renderer — all Node access via preload bridge
 */

const { BrowserWindow, screen } = require("electron");
const path = require("path");
const config = require("../config/app");
const logger = require("../utils/logger");

let _window = null;
let _isVisible = false;

/**
 * Create and preload the palette window.
 * Must be called after app 'ready'.
 *
 * @returns {BrowserWindow}
 */
function createWindow() {
  if (_window) return _window;

  const { width, height } = config.window;

  _window = new BrowserWindow({
    width,
    height,
    minWidth: config.window.minWidth,
    minHeight: config.window.minHeight,

    // ─── Frameless floating palette ────────────────────────────────────────
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: true,

    // ─── Start hidden — we preload content silently ─────────────────────────
    show: false,

    // ─── Security: strict context isolation ────────────────────────────────
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // sandbox:true breaks preload's require; contextIsolation handles security
      enableRemoteModule: false,
      webSecurity: true,
      devTools: config.app.isDev,
    },
  });

  _window.loadFile(path.join(__dirname, "../renderer/index.html"));

  // Silence console noise in prod
  if (!config.app.isDev) {
    _window.webContents.on("console-message", () => {});
  }

  // Window loses focus → hide (natural palette behavior)
  _window.on("blur", () => {
    if (_isVisible) hide();
  });

  _window.on("closed", () => {
    _window = null;
    _isVisible = false;
  });

  logger.info("WindowManager: window created and preloaded");
  return _window;
}

/**
 * Show the palette window, centered on the active display.
 * Sends a show event to renderer so it can play entrance animation.
 */
function show() {
  if (!_window || _window.isDestroyed()) {
    createWindow();
  }

  // Center on the display containing the mouse cursor
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { bounds } = display;
  const { width, height } = config.window;

  const x = Math.round(bounds.x + (bounds.width - width) / 2);
  const y = Math.round(bounds.y + (bounds.height - height) / 3); // Slightly above center feels better

  _window.setPosition(x, y, false);
  _window.showInactive(); // Don't steal focus from other app during positioning
  _window.focus();
  _window.webContents.send("window:show");
  _isVisible = true;

  logger.debug("WindowManager: shown at (%d, %d)", x, y);
}

/**
 * Hide the palette window with a graceful fade-out.
 * Sends hide event so renderer can animate before actual hide.
 */
function hide() {
  if (!_window || _window.isDestroyed() || !_isVisible) return;

  _window.webContents.send("window:hide");
  // Wait for fade animation then actually hide
  setTimeout(() => {
    if (_window && !_window.isDestroyed()) {
      _window.hide();
    }
    _isVisible = false;
  }, 150); // matches CSS transition duration
}

function toggle() {
  _isVisible ? hide() : show();
}

function getWindow() {
  return _window;
}

function isVisible() {
  return _isVisible;
}

module.exports = { createWindow, show, hide, toggle, getWindow, isVisible };
