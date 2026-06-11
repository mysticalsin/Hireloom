---
description: Illustrative data-viz mockup (matplotlib) — to SHOW the user a concept as a real image
---

# /dataviz-mockup — Illustrative data-viz mockup (matplotlib)

To SHOW the user a concept as a real image (eng-ops dashboard, Gantt). Templates: `output/eng-ops-dashboard.py`, `output/gantt-example.py`.

1. `pip3 install matplotlib --quiet` if missing.
2. Write a `.py`: `matplotlib.use("Agg")`; build the figure (KPI cards via `FancyBboxPatch`; bars/lines; tables via `ax.table`); `fig.savefig("<path>.png", dpi=130)`.
3. Run it, then **Read the `.png`** (the Read tool shows it visually) and present.
4. **Always note it's a mockup** — real dashboards would be built in Power BI / Tableau.
