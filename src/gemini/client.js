/**
 *
 * Singleton Gemini client. Initialized once at app startup so the first
 * user request has zero SDK cold-start overhead.
 *
 * Architecture:
 *   - One GoogleGenerativeAI instance (warm)
 *   - One GenerativeModel per active mode (lazily cached)
 *   - Streaming-first: yields chunks via AsyncGenerator
 *   - Timeout wrapper around the stream
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("../config/app");
const logger = require("../utils/logger");

class GeminiClient {
  constructor() {
    this._sdk = null;
    this._modelCache = new Map(); // mode.id → GenerativeModel
    this._initialized = false;
  }

  /**
   * Called once at app startup. Safe to call multiple times.
   * Throws if API key is missing so the main process can surface the error.
   */
  init() {
    if (this._initialized) return;

    if (!config.gemini.apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not configured. Please set it in your .env file.",
      );
    }

    this._sdk = new GoogleGenerativeAI(config.gemini.apiKey);
    this._initialized = true;
    logger.info("GeminiClient initialized. Model:", config.gemini.model);
  }

  /**
   * Returns a cached GenerativeModel for the given prompt mode.
   * The model is configured with the mode's system prompt.
   *
   * @param {string} modeId — matches config.prompts.modes[*].id
   */
  _getModel(modeId) {
    if (this._modelCache.has(modeId)) {
      return this._modelCache.get(modeId);
    }

    const mode = config.prompts.modes.find((m) => m.id === modeId);
    if (!mode) throw new Error(`Unknown prompt mode: "${modeId}"`);

    const model = this._sdk.getGenerativeModel({
      model: config.gemini.model,
      systemInstruction: mode.system,
      generationConfig: config.gemini.generationConfig,
    });

    this._modelCache.set(modeId, model);
    logger.debug("GeminiClient: cached model for mode:", modeId);
    return model;
  }

  /**
   * Stream improved text for the given input and mode.
   *
   * @param {string} text     — raw input text
   * @param {string} modeId   — prompt mode id (default: 'improve')
   * @yields {string}         — incremental text chunks
   *
   * Usage:
   *   for await (const chunk of client.streamGenerate(text, 'improve')) {
   *     process(chunk);
   *   }
   */
  async *streamGenerate(text, modeId = config.prompts.default) {
    if (!this._initialized) this.init();

    const model = this._getModel(modeId);
    logger.debug(
      "GeminiClient: streaming generation. mode=%s length=%d",
      modeId,
      text.length,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, config.gemini.timeoutMs);

    try {
      const result = await model.generateContentStream(text);

      for await (const chunk of result.stream) {
        const part = chunk.text();
        if (part) yield part;
      }
    } catch (err) {
      if (err.name === "AbortError") {
        throw new Error(
          "Gemini request timed out after " + config.gemini.timeoutMs + "ms",
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Non-streaming convenience wrapper. Returns full text when streaming
   * is not needed (e.g. clipboard replace without live preview).
   *
   * @param {string} text
   * @param {string} modeId
   * @returns {Promise<string>}
   */
  async generate(text, modeId = config.prompts.default) {
    let result = "";
    for await (const chunk of this.streamGenerate(text, modeId)) {
      result += chunk;
    }
    return result;
  }

  /** Expose available modes so the renderer can render mode picker */
  getModes() {
    return config.prompts.modes;
  }

  /** Expose default mode id */
  getDefaultMode() {
    return config.prompts.default;
  }
}

// Singleton — shared across all IPC handlers
const geminiClient = new GeminiClient();
module.exports = geminiClient;
