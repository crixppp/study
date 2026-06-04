/*
Non-negotiables:
- Use requestAnimationFrame + performance.now(); compute elapsed from timestamps.
- Interpolate visible ring proportions for smoothness; underlying totals remain exact.
- Handle tab visibility changes; clamp dt to avoid stutters.
- Buttons use transform/box-shadow for feedback; accessible focus rings.
- Honour prefers-reduced-motion.
*/

const {
  Modes,
  Theme,
  defaultState,
  formatHms,
  getControlState,
  getDisplayTotals,
  getEffectiveMode: getEffectiveModeFromState,
  getRatioInfo,
  getStatusText,
  isActiveMode,
  isTheme,
  normalizeState,
} = window.StudyPieCore;

const STORAGE_KEY = "studypie-state";
const THEME_STORAGE_KEY = "studypie-theme";
const RADIUS = 90;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const STUDY_BASE_ROTATION_DEG = 90;
const CIRCUMFERENCE_STR = CIRCUMFERENCE.toFixed(3);
const STUDY_ROTATION = `rotate(${STUDY_BASE_ROTATION_DEG}deg)`;
const FRAME_CLAMP_MS = 200;
const BASE_LERP = 0.25;
const RESET_HOLD_DURATION_MS = 1200;

const elements = {
  themeToggle: document.getElementById("btnTheme"),
  ringStudy: document.getElementById("ringStudy"),
  ringBreak: document.getElementById("ringBreak"),
  timer: document.getElementById("timer"),
  timerStatus: document.getElementById("timerStatus"),
  studyTotal: document.getElementById("studyTotal"),
  breakTotal: document.getElementById("breakTotal"),
  studyTotalValue: document.querySelector("#studyTotal .total__value"),
  breakTotalValue: document.querySelector("#breakTotal .total__value"),
  btnStudy: document.getElementById("btnStudy"),
  btnBreak: document.getElementById("btnBreak"),
  btnPause: document.getElementById("btnPause"),
  btnReset: document.getElementById("btnReset"),
};

let state = { ...defaultState };
const resetHoldState = {
  active: false,
  startTime: 0,
  frameId: 0,
  pointerId: null,
  completed: false,
  cleanupTimeout: 0,
};
let displayStudyRatio = 0.5;
let lastTimestamp = null;
let sessionStartPerf = 0;
let lastTimerRenderSecond = null;
let lastPersistWall = 0;
let hasVisibleTime = false;
let activeTheme = Theme.LIGHT;
let themeLockedByUser = false;
const colorSchemeMedia = window.matchMedia
  ? window.matchMedia("(prefers-color-scheme: dark)")
  : null;
let prefersReducedMotion = window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : { matches: false };

const motionListener = () => {
  // Sync immediately when preference changes so smoothing respects it.
  if (prefersReducedMotion.matches) {
    renderStatic();
  }
};

if (typeof prefersReducedMotion.addEventListener === "function") {
  prefersReducedMotion.addEventListener("change", motionListener);
} else if (typeof prefersReducedMotion.addListener === "function") {
  prefersReducedMotion.addListener(motionListener);
}

initializeTheme();
loadState();
applyModeClass();
renderStatic();
attachListeners();
requestAnimationFrame(loop);

function attachListeners() {
  if (elements.themeToggle) {
    elements.themeToggle.addEventListener("click", handleThemeToggleClick);
  }
  elements.btnStudy.addEventListener("click", () => startSession(Modes.STUDY));
  elements.btnBreak.addEventListener("click", () => startSession(Modes.BREAK));
  elements.btnPause.addEventListener("click", togglePause);
  elements.btnReset.addEventListener("pointerdown", handleResetPointerDown);
  elements.btnReset.addEventListener("pointerup", handleResetPointerUp);
  elements.btnReset.addEventListener("pointerleave", handleResetPointerLeave);
  elements.btnReset.addEventListener("pointercancel", handleResetPointerCancel);
  elements.btnReset.addEventListener("lostpointercapture", handleResetPointerCancel);
  elements.btnReset.addEventListener("keydown", handleResetKeyDown);
  elements.btnReset.addEventListener("keyup", handleResetKeyUp);
  elements.btnReset.addEventListener("blur", handleResetBlur);

  window.addEventListener("keydown", handleKeydown);
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

function initializeTheme() {
  const storedTheme = readStoredTheme();
  if (storedTheme) {
    themeLockedByUser = true;
    setTheme(storedTheme, false);
  } else {
    const defaultTheme = colorSchemeMedia && colorSchemeMedia.matches ? Theme.DARK : Theme.LIGHT;
    setTheme(defaultTheme, false);
  }

  if (colorSchemeMedia) {
    if (typeof colorSchemeMedia.addEventListener === "function") {
      colorSchemeMedia.addEventListener("change", handleColorSchemeChange);
    } else if (typeof colorSchemeMedia.addListener === "function") {
      colorSchemeMedia.addListener(handleColorSchemeChange);
    }
  }
}

function handleColorSchemeChange(event) {
  if (themeLockedByUser) {
    return;
  }

  setTheme(event.matches ? Theme.DARK : Theme.LIGHT, false);
}

function handleThemeToggleClick() {
  themeLockedByUser = true;
  toggleTheme();
}

function toggleTheme() {
  const nextTheme = activeTheme === Theme.DARK ? Theme.LIGHT : Theme.DARK;
  setTheme(nextTheme);
}

function setTheme(nextTheme, persist = true) {
  if (!isTheme(nextTheme)) {
    return;
  }

  activeTheme = nextTheme;
  document.body.classList.toggle("theme-dark", nextTheme === Theme.DARK);
  updateThemeToggle();

  if (!persist) {
    return;
  }

  try {
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch (error) {
    // Ignore storage errors (e.g. privacy mode).
  }
}

function updateThemeToggle() {
  if (!elements.themeToggle) {
    return;
  }

  const isDark = activeTheme === Theme.DARK;
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  elements.themeToggle.classList.toggle("theme-toggle--active", isDark);
  elements.themeToggle.setAttribute("aria-pressed", String(isDark));
  elements.themeToggle.setAttribute("aria-label", label);
  elements.themeToggle.setAttribute("title", label);
}

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && isTheme(stored)) {
      return stored;
    }
  } catch (error) {
    // Ignore storage errors (e.g. disabled cookies).
  }

  return null;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      state = normalizeState(data, Date.now());

      if (isActiveMode(state.mode)) {
        syncSessionStartPerf();
      }
    }
  } catch (error) {
    console.error("Failed to parse saved StudyPie state", error);
    state = { ...defaultState };
  }

  const elapsedMs = getCurrentSessionElapsed(Date.now());
  const totals = getDisplayTotals(state, elapsedMs);
  const ratioInfo = getRatioInfo(totals.studyMs, totals.breakMs);
  displayStudyRatio = ratioInfo.studyRatio;
  hasVisibleTime = ratioInfo.hasTime;
}

function syncSessionStartPerf() {
  if (isActiveMode(state.mode)) {
    const elapsed = Math.max(0, Date.now() - state.sessionStart);
    sessionStartPerf = performance.now() - elapsed;
  } else {
    sessionStartPerf = 0;
  }
}

function loop(now) {
  if (lastTimestamp === null) {
    lastTimestamp = now;
  }

  const rawDelta = now - lastTimestamp;
  const clampedDelta = Math.min(rawDelta, FRAME_CLAMP_MS);
  lastTimestamp = now;

  const wallNow = Date.now();
  updateFrame({ wallNow, delta: clampedDelta });

  requestAnimationFrame(loop);
}

function updateFrame({ wallNow, delta }) {
  const activeMode = getEffectiveMode();
  const elapsedMs = getCurrentSessionElapsed(wallNow);
  const { studyMs: studyDisplayMs, breakMs: breakDisplayMs } = getDisplayTotals(state, elapsedMs);

  updateTotals(studyDisplayMs, breakDisplayMs);
  updateTimerDisplay(elapsedMs, activeMode);
  updateStatus();

  const ratioInfo = getRatioInfo(studyDisplayMs, breakDisplayMs);
  syncDisplayRatio(ratioInfo.studyRatio, delta, ratioInfo.hasTime);
  renderRing(displayStudyRatio, ratioInfo.hasTime);

  persistState(true, wallNow);
}

function syncDisplayRatio(targetRatio, delta, hasTime) {
  if (!hasTime) {
    displayStudyRatio = targetRatio;
    hasVisibleTime = false;
    return;
  }

  if (prefersReducedMotion.matches) {
    displayStudyRatio = targetRatio;
    hasVisibleTime = true;
    return;
  }

  if (!hasVisibleTime) {
    displayStudyRatio = targetRatio;
    hasVisibleTime = true;
    return;
  }

  const frameRatio = delta / (1000 / 60);
  const lerpFactor = 1 - Math.pow(1 - BASE_LERP, Math.max(frameRatio, 0));
  displayStudyRatio += (targetRatio - displayStudyRatio) * lerpFactor;
  hasVisibleTime = true;
}

function renderRing(ratio, hasTime = true) {
  const clampedRatio = Math.min(1, Math.max(0, ratio));
  const studyLength = hasTime ? clampedRatio * CIRCUMFERENCE : 0;
  const breakLength = hasTime ? (1 - clampedRatio) * CIRCUMFERENCE : 0;

  elements.ringStudy.style.transform = STUDY_ROTATION;
  elements.ringStudy.style.strokeDasharray = CIRCUMFERENCE_STR;
  elements.ringStudy.style.strokeDashoffset = (CIRCUMFERENCE - studyLength).toFixed(3);

  const breakRotation = STUDY_BASE_ROTATION_DEG + clampedRatio * 360;
  elements.ringBreak.style.transform = `rotate(${breakRotation}deg)`;
  elements.ringBreak.style.strokeDasharray = CIRCUMFERENCE_STR;
  elements.ringBreak.style.strokeDashoffset = (CIRCUMFERENCE - breakLength).toFixed(3);
}

function updateTotals(studyMs, breakMs) {
  if (elements.studyTotalValue) {
    elements.studyTotalValue.textContent = formatHms(studyMs);
  } else if (elements.studyTotal) {

    elements.studyTotal.textContent = `Study time:\n${formatHms(studyMs)}`;
  }

  if (elements.breakTotalValue) {
    elements.breakTotalValue.textContent = formatHms(breakMs);
  } else if (elements.breakTotal) {
    elements.breakTotal.textContent = `Break time:\n${formatHms(breakMs)}`;
  }
}

function updateTimerDisplay(elapsedMs, activeMode) {
  let displayedMs = elapsedMs;
  if (!activeMode) {
    displayedMs = 0;
  }
  const seconds = Math.floor(displayedMs / 1000);
  if (seconds === lastTimerRenderSecond && activeMode) {
    return;
  }
  lastTimerRenderSecond = activeMode ? seconds : null;
  elements.timer.textContent = formatHms(displayedMs);
}

function updateStatus() {
  if (elements.timerStatus) {
    elements.timerStatus.textContent = getStatusText(state);
  }
}

function updateControls() {
  const controlState = getControlState(state);
  setControlButtonState(elements.btnStudy, controlState.study);
  setControlButtonState(elements.btnBreak, controlState.break);
  setControlButtonState(elements.btnPause, controlState.pause);
  updateResetButtonState();
}

function setControlButtonState(button, nextState) {
  if (!button || !nextState) {
    return;
  }

  button.textContent = nextState.label;
  button.classList.toggle("is-active", Boolean(nextState.pressed));
  button.setAttribute("aria-pressed", String(Boolean(nextState.pressed)));
  button.disabled = Boolean(nextState.disabled);

  if (button.disabled) {
    button.setAttribute("aria-disabled", "true");
  } else {
    button.removeAttribute("aria-disabled");
  }
}

function updateResetButtonState() {
  if (!elements.btnReset) {
    return;
  }

  const label = resetHoldState.active
    ? "Keep Holding"
    : resetHoldState.completed
      ? "Reset Done"
      : "Hold Reset";
  const ariaLabel = resetHoldState.active
    ? "Keep holding to reset. Release to cancel."
    : "Hold to reset all study and break time.";

  elements.btnReset.textContent = label;
  elements.btnReset.setAttribute("aria-label", ariaLabel);
}

function getCurrentSessionElapsed(wallNow) {
  const effectiveMode = getEffectiveMode();
  if (!effectiveMode) {
    return 0;
  }
  if (state.mode === Modes.PAUSED) {
    return state.carriedSessionMs;
  }
  if (sessionStartPerf) {
    const perfElapsed = Math.max(0, performance.now() - sessionStartPerf);
    return state.carriedSessionMs + perfElapsed;
  }
  const sinceStart = Math.max(0, wallNow - state.sessionStart);
  return state.carriedSessionMs + sinceStart;
}

function getEffectiveMode() {
  return getEffectiveModeFromState(state);
}

function persistState(throttled, wallNow) {
  const now = wallNow ?? Date.now();
  if (throttled && now - lastPersistWall < 1000) {
    return;
  }
  lastPersistWall = now;
  try {
    const payload = {
      mode: state.mode,
      studyTotalMs: state.studyTotalMs,
      breakTotalMs: state.breakTotalMs,
      sessionStart: state.sessionStart,
      carriedSessionMs: state.carriedSessionMs,
      resumeMode: state.resumeMode,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error("Failed to persist StudyPie state", error);
  }
}

function startSession(targetMode) {
  if (!isActiveMode(targetMode)) {
    return;
  }

  if (state.mode === Modes.PAUSED && state.resumeMode === targetMode) {
    togglePause();
    return;
  }

  const activeMode = getEffectiveMode();
  if (activeMode === targetMode && state.mode !== Modes.PAUSED) {
    return;
  }

  const wallNow = Date.now();
  commitCurrentSession(wallNow);

  state.mode = targetMode;
  state.resumeMode = targetMode;
  state.sessionStart = wallNow;
  state.carriedSessionMs = 0;
  lastTimerRenderSecond = null;
  syncSessionStartPerf();
  lastTimestamp = null;
  applyModeClass();
  persistState(false, wallNow);
  renderStatic();
}

function commitCurrentSession(wallNow) {
  const effectiveMode = getEffectiveMode();
  if (!effectiveMode) {
    state.carriedSessionMs = 0;
    state.sessionStart = 0;
    return;
  }

  const elapsed = getCurrentSessionElapsed(wallNow);
  if (effectiveMode === Modes.STUDY) {
    state.studyTotalMs += elapsed;
  } else if (effectiveMode === Modes.BREAK) {
    state.breakTotalMs += elapsed;
  }
  state.carriedSessionMs = 0;
  state.sessionStart = 0;
  sessionStartPerf = 0;
  lastTimerRenderSecond = null;
}

function togglePause() {
  if (state.mode === Modes.PAUSED) {
    if (!state.resumeMode) {
      return;
    }
    const wallNow = Date.now();
    state.mode = state.resumeMode;
    state.sessionStart = wallNow;
    syncSessionStartPerf();
    lastTimestamp = null;
    applyModeClass();
    persistState(false, wallNow);
    return;
  }

  if (!isActiveMode(state.mode)) {
    return;
  }

  const wallNow = Date.now();
  const elapsed = Math.max(0, wallNow - state.sessionStart);
  state.carriedSessionMs += elapsed;
  state.mode = Modes.PAUSED;
  state.sessionStart = 0;
  sessionStartPerf = 0;
  lastTimestamp = null;
  applyModeClass();
  persistState(false, wallNow);
}

function handleResetPointerDown(event) {
  if (typeof event.button === "number" && event.button !== 0) {
    return;
  }
  if (resetHoldState.active || resetHoldState.completed) {
    return;
  }
  resetHoldState.pointerId = event.pointerId ?? null;
  if (resetHoldState.pointerId !== null) {
    try {
      elements.btnReset.setPointerCapture(resetHoldState.pointerId);
    } catch (error) {
      // Ignore failures to capture; continue gracefully.
      resetHoldState.pointerId = null;
    }
  }
  beginResetHold();
}

function handleResetPointerUp(event) {
  if (resetHoldState.pointerId !== null && event.pointerId !== resetHoldState.pointerId) {
    return;
  }
  if (resetHoldState.active) {
    cancelResetHold();
    return;
  }
  releaseResetPointerCapture();
}

function handleResetPointerLeave(event) {
  if (resetHoldState.pointerId !== null && event.pointerId !== resetHoldState.pointerId) {
    return;
  }
  if (!resetHoldState.active || resetHoldState.completed) {
    return;
  }
  cancelResetHold();
}

function handleResetPointerCancel(event) {
  if (resetHoldState.pointerId !== null && event.pointerId !== resetHoldState.pointerId) {
    return;
  }
  if (resetHoldState.active) {
    cancelResetHold();
  }
  releaseResetPointerCapture();
}

function handleResetKeyDown(event) {
  if (!isResetActivationKey(event) || event.repeat) {
    return;
  }
  event.preventDefault();
  if (resetHoldState.active || resetHoldState.completed) {
    return;
  }
  beginResetHold();
}

function handleResetKeyUp(event) {
  if (!isResetActivationKey(event)) {
    return;
  }
  event.preventDefault();
  if (resetHoldState.active) {
    cancelResetHold();
  }
}

function handleResetBlur() {
  if (resetHoldState.active) {
    cancelResetHold();
  }
}

function beginResetHold() {
  clearResetHoldCleanup();
  resetHoldState.active = true;
  resetHoldState.completed = false;
  resetHoldState.startTime = performance.now();
  setResetHoldProgress(0);
  elements.btnReset.classList.add("control-btn--holding");
  updateResetButtonState();
  resetHoldState.frameId = requestAnimationFrame(updateResetHoldProgress);
}

function updateResetHoldProgress(now) {
  if (!resetHoldState.active) {
    return;
  }
  const elapsed = Math.max(0, now - resetHoldState.startTime);
  const progress = Math.min(1, elapsed / RESET_HOLD_DURATION_MS);
  setResetHoldProgress(progress);
  if (progress >= 1) {
    finalizeResetHold();
    return;
  }
  resetHoldState.frameId = requestAnimationFrame(updateResetHoldProgress);
}

function finalizeResetHold() {
  resetHoldState.active = false;
  resetHoldState.completed = true;
  if (resetHoldState.frameId) {
    cancelAnimationFrame(resetHoldState.frameId);
    resetHoldState.frameId = 0;
  }
  setResetHoldProgress(1);
  updateResetButtonState();
  releaseResetPointerCapture();
  resetAll();
  scheduleResetHoldCleanup();
}

function cancelResetHold() {
  if (resetHoldState.frameId) {
    cancelAnimationFrame(resetHoldState.frameId);
    resetHoldState.frameId = 0;
  }
  resetHoldState.active = false;
  resetHoldState.completed = false;
  resetHoldState.startTime = 0;
  setResetHoldProgress(0);
  elements.btnReset.classList.remove("control-btn--holding");
  updateResetButtonState();
  releaseResetPointerCapture();
  clearResetHoldCleanup();
}

function scheduleResetHoldCleanup() {
  clearResetHoldCleanup();
  resetHoldState.cleanupTimeout = window.setTimeout(() => {
    resetHoldState.cleanupTimeout = 0;
    resetHoldState.completed = false;
    setResetHoldProgress(0);
    elements.btnReset.classList.remove("control-btn--holding");
    updateResetButtonState();
  }, 180);
}

function clearResetHoldCleanup() {
  if (resetHoldState.cleanupTimeout) {
    clearTimeout(resetHoldState.cleanupTimeout);
    resetHoldState.cleanupTimeout = 0;
  }
}

function releaseResetPointerCapture() {
  if (resetHoldState.pointerId === null) {
    return;
  }
  try {
    elements.btnReset.releasePointerCapture(resetHoldState.pointerId);
  } catch (error) {
    // Ignore errors releasing capture; element may not be capturing.
  }
  resetHoldState.pointerId = null;
}

function setResetHoldProgress(progress) {
  elements.btnReset.style.setProperty("--reset-hold-progress", progress.toFixed(3));
}

function isResetActivationKey(event) {
  return event.key === " " || event.key === "Spacebar" || event.key === "Enter";
}

function requestReset() {
  if (resetHoldState.active) {
    cancelResetHold();
  }
  resetAll();
}

function resetAll() {
  state = { ...defaultState };
  displayStudyRatio = 0.5;
  hasVisibleTime = false;
  lastTimestamp = null;
  sessionStartPerf = 0;
  lastTimerRenderSecond = null;
  applyModeClass();
  persistState(false, Date.now());
  renderStatic();
}

function handleKeydown(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  if (shouldSkipGlobalHotkey(event.target)) {
    return;
  }

  switch (event.key) {
    case "s":
    case "S":
      event.preventDefault();
      startSession(Modes.STUDY);
      break;
    case "b":
    case "B":
      event.preventDefault();
      startSession(Modes.BREAK);
      break;
    case "r":
    case "R":
      event.preventDefault();
      requestReset();
      break;
    case " ":
    case "Spacebar":
      event.preventDefault();
      togglePause();
      break;
    default:
      break;
  }
}

function shouldSkipGlobalHotkey(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  const interactiveSelector =
    "input, textarea, select, button, a[href], [role='button'], [role='link']";
  if (target.closest(interactiveSelector)) {
    return true;
  }

  let current = target;
  while (current) {
    if (current.isContentEditable) {
      return true;
    }
    if (current.hasAttribute("tabindex") && current.tabIndex >= 0) {
      return true;
    }
    current = current.parentElement;
  }

  return false;
}

function handleVisibilityChange() {
  if (document.visibilityState === "visible") {
    lastTimestamp = null;
    syncSessionStartPerf();
  }
}

function applyModeClass() {
  document.body.classList.remove("mode-idle", "mode-study", "mode-break", "mode-paused");
  const modeForClass = state.mode;
  document.body.classList.add(`mode-${modeForClass}`);
  updateStatus();
  updateControls();
}

function renderStatic() {
  const wallNow = Date.now();
  const effectiveMode = getEffectiveMode();
  const elapsedMs = getCurrentSessionElapsed(wallNow);
  const { studyMs: studyDisplayMs, breakMs: breakDisplayMs } = getDisplayTotals(state, elapsedMs);

  updateTotals(studyDisplayMs, breakDisplayMs);
  updateTimerDisplay(elapsedMs, effectiveMode);
  updateStatus();
  updateControls();
  const ratioInfo = getRatioInfo(studyDisplayMs, breakDisplayMs);
  syncDisplayRatio(ratioInfo.studyRatio, 0, ratioInfo.hasTime);
  renderRing(displayStudyRatio, ratioInfo.hasTime);
}
