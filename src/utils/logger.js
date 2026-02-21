const config = require("../config/app");

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[config.log.level] ?? LEVELS.error;

function makeLogger(level) {
  return (...args) => {
    if (LEVELS[level] >= currentLevel) {
      const fn =
        level === "error"
          ? console.error
          : level === "warn"
            ? console.warn
            : console.log;
      fn(`[Pencraft:${level.toUpperCase()}]`, ...args);
    }
  };
}

module.exports = {
  debug: makeLogger("debug"),
  info: makeLogger("info"),
  warn: makeLogger("warn"),
  error: makeLogger("error"),
};
