Webpage: https://renarion.github.io/roadmap_toolkit/

# Roadmap Toolkit

A static browser tool for building Gantt / roadmap charts. No backend required.

## Quick start

1. Open `index.html` in a browser, or run a local server:

```bash
python3 -m http.server 8080
```

2. Add categories, tasks, and dates.
3. Click **Build roadmap**.
4. Export SVG / PNG if needed.

## GitHub Pages

1. Push the project to a GitHub repository.
2. Go to **Settings → Pages**.
3. Set **Deploy from a branch** → `main` → `/ (root)`.
4. Open `https://<username>.github.io/<repo>/`.

---

## Customization

### 1. Header text

Edit `index.html`, block `<header class="hero">`:

```html
<p class="brand">Roadmap Toolkit</p>
<h1>Your headline</h1>
<p class="hero-lead">Your subtitle</p>
```

Header alignment is controlled in `styles.css` → `.hero` (`text-align: center`).

---

### 2. Diagram colors (task bars, grid, borders)

Edit `script.js` at the top of the file:

```js
const CHART_COLORS = {
  taskFill: "#0f766e",   // task bar fill
  taskStroke: "#084c47", // task bar outline
  grid: "#d7e0e6",       // grid lines
  axis: "#8aa0ad",       // axis / labels
};
```

These values are also passed to Mermaid in `initMermaid()` → `themeVariables` and `themeCSS`.

Task bar outlines are additionally styled in `styleTaskBars()`.

---

### 3. Category backgrounds on the diagram

Edit `script.js`:

```js
const SECTION_PALETTE = [
  "#d8c8f4", // category 1
  "#ffffff", // category 2
  "#ffe39a", // category 3
  "#c6e8d4", // category 4
  "#cfe3fb", // category 5
  "#f7dcc8", // category 6
];
```

This palette is used in three places:

| Location | Purpose |
|----------|---------|
| `colorSectionBands()` | paints row backgrounds after render |
| `initMermaid()` → `themeVariables` | Mermaid default section colors |
| `initMermaid()` → `themeCSS` | `.section0` … `.section3` classes |

After changing colors, rebuild the diagram in the browser.

---

### 4. Page / diagram width

In `styles.css`:

```css
--max: 1560px;      /* max page width (diagram block) */
--form-max: 980px;  /* width of the input form */
```

Timeline scale (how much fits without horizontal scroll) is calculated in `script.js` → `estimateChartLayout()`.
