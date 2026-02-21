/**
 *
 * Service layer between IPC handlers and the raw Gemini client.
 * Responsibilities:
 *   - Input validation and sanitization
 *   - Concurrency guard (one request at a time)
 *   - Error normalization (Gemini errors → user-friendly messages)
 *   - Result caching (last result for instant re-copy)
 *
 * This abstraction means we can swap Gemini for a local LLM, OpenAI,
 * or any other backend by replacing only this module.
 */

const geminiClient = require("../gemini/client");
const logger = require("../utils/logger");

class AIService {
  constructor() {
    /** Prevent concurrent API calls — protects rate limits and UX */
    this._busy = false;

    /** Cache last successful result for re-copy without re-generation */
    this._lastResult = null;

    /** Reference to active BrowserWindow for streaming IPC events */
    this._window = null;
  }

  /** Called by main process after window is created */
  setWindow(win) {
    this._window = win;
  }

  get isBusy() {
    return this._busy;
  }

  get lastResult() {
    return this._lastResult;
  }

  /**
   * Stream AI generation, pushing chunks to renderer via IPC.
   * The renderer listens on 'ai:chunk' and 'ai:done'/'ai:error'.
   *
   * @param {string} text     — input text
   * @param {string} modeId   — prompt mode
   * @returns {Promise<void>}
   */
  async generate(text, modeId) {
    if (this._busy) {
      logger.warn(
        "AIService: generation already in progress, ignoring request",
      );
      this._sendToRenderer("ai:error", {
        message: "Already generating. Please wait.",
      });
      return;
    }

    const trimmed = (text || "").trim();
    if (!trimmed) {
      this._sendToRenderer("ai:error", {
        message: "No text to improve. Select some text first.",
      });
      return;
    }

    if (trimmed.length > 50_000) {
      this._sendToRenderer("ai:error", {
        message: "Text is too long (max 50,000 characters).",
      });
      return;
    }

    this._busy = true;
    this._sendToRenderer("ai:start", { modeId });

    let accumulated = "";

    try {
      for await (const chunk of geminiClient.streamGenerate(trimmed, modeId)) {
        accumulated += chunk;
        this._sendToRenderer("ai:chunk", { chunk });
      }

      this._lastResult = accumulated;
      this._sendToRenderer("ai:done", { result: accumulated });
      logger.info(
        "AIService: generation complete. chars=%d",
        accumulated.length,
      );
    } catch (err) {
      logger.error("AIService: generation error:", err.message);
      const friendly = this._friendlyError(err);
      this._sendToRenderer("ai:error", { message: friendly });
    } finally {
      this._busy = false;
    }
  }

  /**
   * Map raw Gemini/network errors to user-friendly strings.
   * Never expose raw API keys or internal stack traces to renderer.
   */
  _friendlyError(err) {
    const msg = err.message || "";

    if (
      msg.includes("API_KEY") ||
      msg.includes("api key") ||
      msg.includes("401")
    ) {
      return "Invalid API key. Check your GEMINI_API_KEY in .env";
    }
    if (msg.includes("quota") || msg.includes("429")) {
      return "Rate limit reached. Wait a moment and try again.";
    }
    if (
      msg.includes("timed out") ||
      msg.includes("timeout") ||
      msg.includes("ETIMEDOUT")
    ) {
      return "Request timed out. Check your network connection.";
    }
    if (msg.includes("not configured")) {
      return msg; // Our own clear message
    }
    if (msg.includes("ENOTFOUND") || msg.includes("ECONNREFUSED")) {
      return "No network connection. Check your internet and try again.";
    }

    return "Something went wrong. Please try again.";
  }

  _sendToRenderer(channel, data) {
    if (this._window && !this._window.isDestroyed()) {
      this._window.webContents.send(channel, data);
    }
  }

  /** Expose modes list for IPC query */
  getModes() {
    return geminiClient.getModes();
  }

  getDefaultMode() {
    return geminiClient.getDefaultMode();
  }
}

const aiService = new AIService();
module.exports = aiService;
