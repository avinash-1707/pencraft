/**
 *
 * Reads the current X11 PRIMARY selection (text highlighted in any app).
 * Uses xclip — must be installed on the system (apt install xclip).
 *
 * Architecture note: this is Linux/X11-specific. For Wayland support,
 * we'd need wl-clipboard. For cross-platform, abstract behind an interface.
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const logger = require("../utils/logger");

const execFileAsync = promisify(execFile);

/**
 * Read the current PRIMARY selection (highlighted text).
 * Falls back to empty string on any error.
 *
 * @returns {Promise<string>}
 */
async function readSelection() {
  try {
    const { stdout } = await execFileAsync(
      "xclip",
      ["-selection", "primary", "-o"],
      {
        timeout: 2000,
        maxBuffer: 512 * 1024, // 512KB cap
      },
    );
    return stdout || "";
  } catch (err) {
    // xclip exits non-zero if PRIMARY selection is empty — this is normal
    logger.debug("selection: xclip returned empty or error:", err.code);
    return "";
  }
}

/**
 * Write text to CLIPBOARD (Ctrl+V paste target, not PRIMARY).
 *
 * @param {string} text
 * @returns {Promise<void>}
 */
async function writeClipboard(text) {
  return new Promise((resolve, reject) => {
    const proc = execFile(
      "xclip",
      ["-selection", "clipboard"],
      { timeout: 2000 },
      (err) => {
        if (err) {
          logger.error("selection: failed to write clipboard:", err.message);
          reject(err);
        } else {
          resolve();
        }
      },
    );

    proc.stdin.write(text, "utf8");
    proc.stdin.end();
  });
}

/**
 * Verify xclip is available. Called at startup to give a clear error
 * instead of a cryptic failure later.
 *
 * @returns {Promise<boolean>}
 */
async function checkXclip() {
  try {
    await execFileAsync("which", ["xclip"]);
    return true;
  } catch {
    return false;
  }
}

module.exports = { readSelection, writeClipboard, checkXclip };
