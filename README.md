# StudyPie

**StudyPie** is a minimal, responsive web app for tracking study and break sessions.  
It visualises the proportion of study vs break time as a smooth, animated ring with a central timer.

---

## Features
- 🎨 **Minimal design** with aesthetic colours:
  - Study: Red `#f73d3f`
  - Break: Green `#b9e7b1`
  - Light background for contrast
- ⏱️ **Central timer** showing the current session duration
- 🔴🟢 **Dynamic ring** that grows in real-time to reflect proportions of total study vs break time
- 📊 **Totals displayed** for both study and break, updated live
- 🎛️ **Controls**:
  - Start Study
  - Start Break
  - Pause / Resume
  - Reset
- 💾 **Persistence** with `localStorage` (totals and current state survive page refresh)
- ⚡ **Smooth animations** at 60 FPS, no jitter
- ♿ **Accessibility**: semantic buttons, keyboard shortcuts, `aria-live` timer

---

## Keyboard Shortcuts
- **S** → Start Study  
- **B** → Start Break  
- **Space** → Pause / Resume  
- **R** → Reset  
