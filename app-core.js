(function (global) {
  "use strict";

  const Modes = Object.freeze({
    IDLE: "idle",
    STUDY: "study",
    BREAK: "break",
    PAUSED: "paused",
  });

  const Theme = Object.freeze({
    LIGHT: "light",
    DARK: "dark",
  });

  const defaultState = Object.freeze({
    mode: Modes.IDLE,
    studyTotalMs: 0,
    breakTotalMs: 0,
    sessionStart: 0,
    carriedSessionMs: 0,
    resumeMode: null,
  });

  const activeModes = new Set([Modes.STUDY, Modes.BREAK]);
  const allModes = new Set(Object.values(Modes));
  const allThemes = new Set(Object.values(Theme));

  function isActiveMode(mode) {
    return activeModes.has(mode);
  }

  function isTheme(theme) {
    return allThemes.has(theme);
  }

  function toNonNegativeMs(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0;
  }

  function normalizeState(data, now = Date.now()) {
    const source = data && typeof data === "object" ? data : {};
    const mode = allModes.has(source.mode) ? source.mode : Modes.IDLE;
    const resumeMode = isActiveMode(source.resumeMode)
      ? source.resumeMode
      : mode === Modes.PAUSED
        ? Modes.STUDY
        : null;

    const state = {
      ...defaultState,
      mode,
      studyTotalMs: toNonNegativeMs(source.studyTotalMs),
      breakTotalMs: toNonNegativeMs(source.breakTotalMs),
      sessionStart: toNonNegativeMs(source.sessionStart),
      carriedSessionMs: toNonNegativeMs(source.carriedSessionMs),
      resumeMode,
    };

    if (isActiveMode(state.mode) && state.sessionStart === 0) {
      state.sessionStart = now;
    }

    if (state.mode === Modes.IDLE) {
      state.sessionStart = 0;
      state.carriedSessionMs = 0;
      state.resumeMode = null;
    }

    if (state.mode === Modes.PAUSED) {
      state.sessionStart = 0;
    }

    return state;
  }

  function getEffectiveMode(state) {
    if (!state) {
      return null;
    }

    if (state.mode === Modes.PAUSED) {
      return isActiveMode(state.resumeMode) ? state.resumeMode : null;
    }

    return isActiveMode(state.mode) ? state.mode : null;
  }

  function getDisplayTotals(state, sessionElapsedMs = 0) {
    const elapsedMs = toNonNegativeMs(sessionElapsedMs);
    const effectiveMode = getEffectiveMode(state);
    const studyMs = toNonNegativeMs(state && state.studyTotalMs);
    const breakMs = toNonNegativeMs(state && state.breakTotalMs);

    return {
      studyMs: effectiveMode === Modes.STUDY ? studyMs + elapsedMs : studyMs,
      breakMs: effectiveMode === Modes.BREAK ? breakMs + elapsedMs : breakMs,
    };
  }

  function getRatioInfo(studyMs, breakMs) {
    const safeStudyMs = toNonNegativeMs(studyMs);
    const safeBreakMs = toNonNegativeMs(breakMs);
    const totalMs = safeStudyMs + safeBreakMs;

    if (totalMs <= 0) {
      return {
        hasTime: false,
        studyRatio: 0.5,
        totalMs: 0,
      };
    }

    return {
      hasTime: true,
      studyRatio: Math.min(1, Math.max(0, safeStudyMs / totalMs)),
      totalMs,
    };
  }

  function formatHms(ms) {
    const totalSeconds = Math.floor(toNonNegativeMs(ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((n) => String(n).padStart(2, "0")).join(":");
  }

  function getStatusText(state) {
    if (!state) {
      return "Ready";
    }

    switch (state.mode) {
      case Modes.STUDY:
        return "Studying";
      case Modes.BREAK:
        return "On break";
      case Modes.PAUSED:
        return state.resumeMode === Modes.BREAK ? "Break paused" : "Study paused";
      default:
        return "Ready";
    }
  }

  function getControlState(state) {
    const mode = state && state.mode ? state.mode : Modes.IDLE;
    const effectiveMode = getEffectiveMode(state);
    const isPaused = mode === Modes.PAUSED;
    const isIdle = mode === Modes.IDLE;

    return {
      study: {
        label: isPaused && effectiveMode === Modes.STUDY
          ? "Resume Study"
          : effectiveMode === Modes.STUDY && !isPaused
            ? "Studying"
            : effectiveMode
              ? "Switch to Study"
              : "Start Study",
        pressed: effectiveMode === Modes.STUDY,
      },
      break: {
        label: isPaused && effectiveMode === Modes.BREAK
          ? "Resume Break"
          : effectiveMode === Modes.BREAK && !isPaused
            ? "On Break"
            : effectiveMode
              ? "Switch to Break"
              : "Start Break",
        pressed: effectiveMode === Modes.BREAK,
      },
      pause: {
        label: isPaused ? "Resume" : "Pause",
        pressed: isPaused,
        disabled: isIdle,
      },
    };
  }

  const api = {
    Modes,
    Theme,
    defaultState,
    formatHms,
    getControlState,
    getDisplayTotals,
    getEffectiveMode,
    getRatioInfo,
    getStatusText,
    isActiveMode,
    isTheme,
    normalizeState,
  };

  global.StudyPieCore = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
