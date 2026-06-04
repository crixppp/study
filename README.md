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
- 🔴🟢 **Dynamic ring** that stays empty until time is tracked, then grows in real-time to reflect study vs break proportions
- 🧭 **Live status** for ready, study, break, and paused states
- 📊 **Totals displayed** for both study and break, updated live
- 🎛️ **Controls**:
  - Start Study
  - Start Break
  - Pause / Resume with contextual labels
  - Hold Reset
- 💾 **Persistence** with `localStorage` (totals and current state survive page refresh)
- ⚡ **Smooth animations** at 60 FPS, no jitter
- ♿ **Accessibility**: semantic buttons, keyboard shortcuts, `aria-live` timer
- ✅ **Core tests** for state normalization, ratio math, formatting, and control labels

---

## Keyboard Shortcuts
- **S** → Start Study  
- **B** → Start Break  
- **Space** → Pause / Resume  
- **R** → Reset  

---

## Development

Open `index.html` directly or serve the folder with any static file server.

Run the dependency-free test suite:

```bash
npm test
```
