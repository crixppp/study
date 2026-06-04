const assert = require("node:assert/strict");
const test = require("node:test");

const {
  Modes,
  formatHms,
  getControlState,
  getDisplayTotals,
  getEffectiveMode,
  getRatioInfo,
  getStatusText,
  normalizeState,
} = require("../app-core.js");

test("formatHms clamps and formats elapsed time", () => {
  assert.equal(formatHms(-1), "00:00:00");
  assert.equal(formatHms(999), "00:00:00");
  assert.equal(formatHms(3_723_000), "01:02:03");
});

test("normalizeState repairs invalid saved data", () => {
  const state = normalizeState(
    {
      mode: "mystery",
      studyTotalMs: -20,
      breakTotalMs: "61000",
      sessionStart: 99,
      carriedSessionMs: Number.NaN,
      resumeMode: "paused",
    },
    123_456
  );

  assert.deepEqual(state, {
    mode: Modes.IDLE,
    studyTotalMs: 0,
    breakTotalMs: 61_000,
    sessionStart: 0,
    carriedSessionMs: 0,
    resumeMode: null,
  });
});

test("normalizeState revives active sessions without a start time", () => {
  const state = normalizeState({ mode: Modes.STUDY, sessionStart: 0 }, 123_456);

  assert.equal(state.mode, Modes.STUDY);
  assert.equal(state.sessionStart, 123_456);
  assert.equal(getEffectiveMode(state), Modes.STUDY);
});

test("getDisplayTotals applies current session elapsed to the active mode", () => {
  const totals = getDisplayTotals(
    {
      mode: Modes.BREAK,
      studyTotalMs: 120_000,
      breakTotalMs: 30_000,
      sessionStart: 0,
      carriedSessionMs: 0,
      resumeMode: Modes.BREAK,
    },
    15_000
  );

  assert.deepEqual(totals, {
    studyMs: 120_000,
    breakMs: 45_000,
  });
});

test("getRatioInfo distinguishes an empty ring from a real 50/50 split", () => {
  assert.deepEqual(getRatioInfo(0, 0), {
    hasTime: false,
    studyRatio: 0.5,
    totalMs: 0,
  });

  assert.deepEqual(getRatioInfo(5_000, 5_000), {
    hasTime: true,
    studyRatio: 0.5,
    totalMs: 10_000,
  });
});

test("status and controls reflect paused study sessions", () => {
  const state = normalizeState({
    mode: Modes.PAUSED,
    resumeMode: Modes.STUDY,
    carriedSessionMs: 90_000,
  });

  assert.equal(getStatusText(state), "Study paused");
  assert.deepEqual(getControlState(state), {
    study: {
      label: "Resume Study",
      pressed: true,
    },
    break: {
      label: "Switch to Break",
      pressed: false,
    },
    pause: {
      label: "Resume",
      pressed: true,
      disabled: false,
    },
  });
});
