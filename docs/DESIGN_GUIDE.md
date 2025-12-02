# HeatAQ Design Guide

**Version:** V64
**Last Updated:** November 2025

---

## 1. Design Philosophy

HeatAQ follows a **clean, professional, data-focused** design approach suitable for engineering and energy management applications. The interface prioritizes clarity, efficiency, and professional presentation over decorative elements.

### Core Principles

1. **Clarity First:** Data should be immediately readable and scannable
2. **Professional Aesthetic:** Corporate-friendly, trustworthy appearance
3. **Functional Beauty:** Design elements serve functional purposes
4. **Consistent Experience:** Uniform patterns across all sections
5. **Responsive Design:** Works on desktop, tablet, and mobile

---

## 2. Color Palette

### Primary Colors

| Color | Hex | Usage |
|-------|-----|-------|
| Primary | `#006494` | Buttons, links, active states |
| Primary Dark | `#003554` | Hover states, headers |
| Success | `#52b788` | Positive indicators, confirmations |
| Danger | `#d62828` | Errors, delete actions, warnings |
| Warning | `#f77f00` | Caution states, boiler indicators |
| Info | `#0077b6` | Heat pump indicators, information |

### Neutral Colors

| Color | Hex | Usage |
|-------|-----|-------|
| Neutral 100 | `#f8f9fa` | Page backgrounds, card backgrounds |
| Neutral 200 | `#e9ecef` | Borders, dividers |
| Neutral 300 | `#dee2e6` | Input borders |
| Neutral 600 | `#6c757d` | Muted text, icons |
| Neutral 800 | `#343a40` | Body text |
| Neutral 900 | `#212529` | Headings |

### Chart Colors

| Purpose | Color |
|---------|-------|
| Heat Pump (production) | `#2196F3` (blue) |
| Boiler (production) | `#ff9800` (orange) |
| Heat Demand/Loss | `#d32f2f` (red) |
| Solar Gain | `#ffc107` (yellow) |
| Water Temperature (open) | `#2196F3` (blue) |
| Water Temperature (closed) | `#ef5350` (red) |
| Air Temperature | `#9e9e9e` (gray) |

---

## 3. Typography

### Font Stack

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
             'Helvetica Neue', Arial, sans-serif;
```

This system font stack provides:
- Native feel on each platform
- Fast loading (no external fonts)
- Excellent readability

### Type Scale

| Element | Size | Weight |
|---------|------|--------|
| Page Title (h2) | 1.5rem | 600 |
| Card Header (h3) | 1.1rem | 600 |
| Body Text | 14px | 400 |
| Small Text | 12px | 400 |
| Labels | 13px | 500 |
| Buttons | 14px | 500 |

---

## 4. Layout Structure

### Main Layout

```
+------------------+--------------------------------+
|     SIDEBAR      |        MAIN CONTENT           |
|                  |                                |
|  Logo & Nav      |    Header with User Info      |
|  - Project       |                                |
|  - SimControl    |    Content Section            |
|  - Config        |    - Cards                    |
|  - Schedules     |    - Tables                   |
|                  |    - Forms                    |
|  ADMIN           |    - Charts                   |
|  - Exceptions    |                                |
|  - Weather       |                                |
|  - Users         |                                |
|  - System        |                                |
+------------------+--------------------------------+
```

### Sidebar Width
- Fixed: `240px`
- Contains: Logo, navigation sections

### Content Area
- Max width: `1200px`
- Padding: `30px`
- Background: `#f8f9fa`

---

## 5. Component Patterns

### Elevation System (V64)

Three shadow levels create visual hierarchy:

```css
/* Level 1 - Subtle (hover states, flat cards) */
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.06);

/* Level 2 - Default (cards, dropdowns) */
--shadow-md: 0 2px 4px rgba(0, 0, 0, 0.04), 0 4px 8px rgba(0, 0, 0, 0.06);

/* Level 3 - Elevated (modals, popovers) */
--shadow-lg: 0 8px 16px rgba(0, 0, 0, 0.08), 0 16px 32px rgba(0, 0, 0, 0.08);
```

| Level | Usage |
|-------|-------|
| `shadow-sm` | Flat cards, subtle hover effects |
| `shadow-md` | Default cards, dropdowns |
| `shadow-lg` | Modals, important overlays |

### Cards

Cards are the primary container with hover enhancement:

```css
.card {
    background: white;
    border-radius: var(--radius-md);  /* 8px */
    box-shadow: var(--shadow-md);
    transition: box-shadow 0.2s ease;
    border: 1px solid rgba(0, 0, 0, 0.04);
}

.card:hover {
    box-shadow: var(--shadow-lg);
}
```

Card variants:
- `.card-flat` - Uses `shadow-sm`, elevates to `shadow-md` on hover
- `.card-elevated` - Uses `shadow-lg` (for prominent content)

### Buttons

#### Button Types & Colors (Updated V129)
| Type | Label | Color | Hex | Usage |
|------|-------|-------|-----|-------|
| Add/New | + New, + Add | Light Green | `#90EE90` | Create new items (all "+" buttons) |
| Update | Update Data | Yellow | `#FFD700` | Fetch/update data actions |
| Primary | Save | Blue | `#006494` | Save changes |
| Danger | Delete | Red | `#d62828` | Destructive actions |
| Secondary | Cancel | Gray | `#6c757d` | Cancel/close dialogs |

**Note:** All buttons with "+" prefix (+ New, + Add, + Add Station, etc.) use light green styling with black text for visual consistency.

#### Button Placement Convention
```
Action buttons (right-aligned):        [Save] [Delete]
Inline create (with input):            [Name___________] [+ New]
```

- **Save** and **Delete** are always grouped together, right-aligned
- **+ New** appears next to input fields for inline creation
- Destructive button (Delete) always rightmost in group

#### Button Sizing
| Class | Usage |
|-------|-------|
| btn-sm | Inline actions, table rows |
| (default) | Standard forms |
| btn-lg | Prominent CTAs |

Button press effect: `transform: translateY(1px)` on `:active`

### Form Controls (V64)

Enhanced inputs with consistent styling:

```css
.form-control {
    padding: 10px 12px;
    border: 1.5px solid var(--neutral-300);
    border-radius: var(--radius-sm);  /* 4px */
    transition: border-color 0.15s, box-shadow 0.15s;
}

.form-control:hover {
    border-color: var(--neutral-400);
}

.form-control:focus {
    border-color: var(--primary);
    box-shadow: var(--focus-ring);  /* 3px blue glow */
}
```

### Input Groups

For inputs with unit suffixes (kW, °C, etc.):

```html
<div class="input-group">
    <input type="number" class="form-control" value="125">
    <span class="input-group-text">kW</span>
</div>
```

### Form Tables

Configuration forms use table layout for label-value alignment:

```html
<table class="data-table form-table">
    <tr>
        <td><label>Pool Volume</label></td>
        <td><input type="number" ...></td>
    </tr>
</table>
```

### Data Tables

For displaying structured data:

```css
.data-table {
    width: 100%;
    border-collapse: collapse;
}

.data-table td {
    padding: 8px;
    border-bottom: 1px solid #eee;
}

.data-table .compact td {
    padding: 5px;
}
```

---

## 6. Tab Navigation

SimControl uses a tab-based interface:

```css
.sim-tabs {
    display: flex;
    gap: 5px;
    border-bottom: 2px solid #eee;
    margin-bottom: 20px;
}

.sim-tab {
    padding: 10px 20px;
    border: none;
    background: transparent;
    cursor: pointer;
}

.sim-tab.active {
    border-bottom: 2px solid var(--primary);
    color: var(--primary);
}
```

---

## 7. Chart Guidelines

### Weekly Charts (Debug)

Two-chart layout showing:
1. **Production Chart:** Heat pump + boiler output vs demand
2. **Weather Chart:** Temperature + wind speed

### Best Practices

- Use `stepped: 'middle'` for demand lines
- Label axes clearly
- Include gridlines at regular intervals (6h, 12h, 18h)
- Use consistent colors across all charts
- Include legend when multiple series

---

## 8. Responsive Behavior

### Breakpoints

| Breakpoint | Target |
|------------|--------|
| < 768px | Mobile |
| 768-1024px | Tablet |
| > 1024px | Desktop |

### Mobile Adaptations

- Sidebar collapses to hamburger menu
- Cards stack vertically
- Tables scroll horizontally
- Form fields go full-width

---

## 9. Icons

HeatAQ uses emoji icons for simplicity:

| Icon | Usage |
|------|-------|
| 📋 | Project |
| ▶️ | SimControl |
| ⚙️ | Configuration |
| 📅 | Schedules |
| 🎄 | Exception Days |
| 🌤️ | Weather |
| 👥 | Users |
| 🔧 | System |
| 🔍 | Debug |
| 🏊 | Pool/Logo |

---

## 10. Sidebar Design (V64)

### Visual Enhancement

The sidebar uses a gradient background with enhanced navigation:

```css
.sidebar {
    background: linear-gradient(180deg, var(--primary-dark) 0%, #002a40 100%);
    box-shadow: 2px 0 15px rgba(0,0,0,0.15);
}

.sidebar-header {
    background: linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.05));
}
```

### Navigation Item States

| State | Visual Treatment |
|-------|------------------|
| Default | Transparent background |
| Hover | Light background + 4px left shift + icon scale |
| Active | Light background + orange left border + dot indicator |

```css
.nav-item:hover {
    background: rgba(255,255,255,0.08);
    padding-left: 24px;  /* Slides right on hover */
}

.nav-item.active::after {
    /* Orange dot indicator */
    content: '';
    background: #f77f00;
    border-radius: 50%;
    box-shadow: 0 0 8px rgba(247, 127, 0, 0.5);
}
```

---

## 11. Modern UI Trends Applied

### Clean White Space
- Generous padding in cards (20px)
- Clear separation between sections
- Breathing room around form elements

### Elevation System (NEW)
Three-level shadow hierarchy creates depth:
- `shadow-sm` - Subtle, for hover states
- `shadow-md` - Default cards
- `shadow-lg` - Modals, elevated content

### Micro-interactions (NEW)
- Card hover: elevates from `shadow-md` to `shadow-lg`
- Button press: `translateY(1px)` for tactile feedback
- Nav item hover: slides right 4px + icon scales
- Input focus: blue glow ring

### Rounded Corners
- Cards: `8px` (--radius-md)
- Modals: `12px` (--radius-lg)
- Buttons: `4px` (--radius-sm)
- Inputs: `4px` (--radius-sm)

### Color Indicators
- Blue for heat pump (efficient)
- Orange for boiler (backup)
- Red for issues/closed states
- Green for success/positive

### Interactive Feedback
- Hover states on all clickable elements
- Focus rings on form inputs (3px blue glow)
- Loading states for async operations
- Modal backdrop blur effect

---

## 12. Loading States (V65)

### Skeleton Loaders

Animated placeholder content while data loads:

```css
.skeleton {
    background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: var(--radius-sm);
}

@keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}
```

| Component | Skeleton Treatment |
|-----------|-------------------|
| Card content | Gray bars matching text lines |
| Table rows | Full-width row placeholders |
| Charts | Centered spinner with dimmed background |

### Button Loading State

```css
.btn.loading {
    position: relative;
    color: transparent;
    pointer-events: none;
}

.btn.loading::after {
    content: '';
    position: absolute;
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}
```

---

## 13. Status Badges (V65)

### Badge Styles

```css
.badge {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
    gap: 5px;
}

.badge-success { background: #d4edda; color: #155724; }
.badge-danger  { background: #f8d7da; color: #721c24; }
.badge-warning { background: #fff3cd; color: #856404; }
.badge-info    { background: #cce5ff; color: #004085; }
.badge-secondary { background: #e9ecef; color: #495057; }
```

### Simulation Status Badges

| Status | Badge | Icon |
|--------|-------|------|
| Running | Blue + pulse animation | Spinner |
| Completed | Green | Checkmark |
| Failed | Red | X |
| Queued | Gray | Clock |

### Run State Indicator

The Simulate/Calculate button changes color based on state:

| State | Color | Meaning |
|-------|-------|---------|
| Green | `--success` | Results are current, no changes made |
| Red/Orange | `--warning` | Parameters changed, re-run needed |

```css
.btn-run.current {
    background: var(--success);
}

.btn-run.stale {
    background: var(--warning);
    animation: pulse-attention 2s infinite;
}
```

---

## 14. Chart Enhancements (V65)

### Custom Tooltips

```javascript
tooltip: {
    backgroundColor: 'white',
    titleColor: '#333',
    bodyColor: '#666',
    borderColor: '#ddd',
    borderWidth: 1,
    cornerRadius: 8,
    padding: 12,
    boxShadow: true,
    callbacks: {
        label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} kW`
    }
}
```

### Crosshair Plugin

Vertical line following cursor across chart:

```javascript
// Draw vertical line at hover position
afterDraw: (chart) => {
    if (chart.tooltip?.opacity) {
        const x = chart.tooltip.caretX;
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, chart.chartArea.top);
        ctx.lineTo(x, chart.chartArea.bottom);
        ctx.stroke();
    }
}
```

### Gradient Fills

Subtle gradient under line charts:

```javascript
const gradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
gradient.addColorStop(0, 'rgba(33, 150, 243, 0.2)');
gradient.addColorStop(1, 'rgba(33, 150, 243, 0)');

datasets: [{
    fill: true,
    backgroundColor: gradient
}]
```

---

## 15. Simulation Data Persistence (V65)

### Auto-Load Previous Results

When opening SimControl tabs, automatically load last results:

| Tab | Load Behavior |
|-----|---------------|
| Simulate | Load last run parameters + results |
| Debug | Load last debug date/hour + weekly chart |
| Analyse | Load last 5-scenario comparison |
| History | Always fresh from API |

### State Tracking

Track if parameters have changed since last run:

```javascript
SimulationsModule.state = {
    lastRunParams: null,      // Parameters from last successful run
    currentParams: null,      // Current form values
    hasChanges: false,        // true if currentParams !== lastRunParams
    lastResults: null         // Cached results
};
```

### Visual Indicator

```
[Parameters unchanged] → Green "Run Simulation" button
[Parameters changed]   → Orange "Run Simulation" button + "Results outdated" text
```

---

## 16. Site & Project Architecture (V65)

### Data Model

```
Project (1)
  └── Site (1..n)
        ├── name
        ├── latitude
        ├── longitude
        ├── weather_station_id
        └── Pool (1..n)
              ├── name
              ├── volume
              ├── surface_area
              └── configuration
```

### Project Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│ PROJECT: Hisøy Swim Club                          [+ New]   │
│ Energy optimization for outdoor swimming facility           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  SITES                                                      │
│  ┌──────────────────────┐  ┌──────────────────────┐        │
│  │ 📍 Main Facility     │  │ 📍 [+ Add Site]      │        │
│  │ Arendal, Norway      │  │                      │        │
│  │ 58.4615°N, 8.7725°E  │  └──────────────────────┘        │
│  │ ┌──────────────────┐ │                                  │
│  │ │ 🗺️ Map Preview   │ │                                  │
│  │ │                  │ │                                  │
│  │ └──────────────────┘ │                                  │
│  │ Weather: SN44560     │                                  │
│  │ Solar: 1050 kWh/m²/yr│                                  │
│  │                      │                                  │
│  │ POOLS:               │                                  │
│  │ • Main Pool (625m³)  │                                  │
│  │ • Kids Pool (45m³)   │                                  │
│  │ [Edit] [+ Add Pool]  │                                  │
│  └──────────────────────┘                                  │
│                                                             │
│  PROJECT SUMMARY                    RECENT SIMULATIONS      │
│  ┌────────────────────┐            ┌────────────────────┐  │
│  │ Total Pools: 2     │            │ • 2024 Benchmark   │  │
│  │ Total Volume: 670m³│            │ • Winter Test      │  │
│  │ HP Capacity: 125kW │            │ • Solar Study      │  │
│  └────────────────────┘            └────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Site Card Component

```html
<div class="site-card card">
    <div class="site-header">
        <h4>📍 Main Facility</h4>
        <span class="site-location">Arendal, Norway</span>
    </div>
    <div class="site-map">
        <!-- Google Maps Static Image -->
        <img src="https://maps.googleapis.com/maps/api/staticmap?
            center=58.4615,8.7725&zoom=14&size=280x150&markers=..." />
    </div>
    <div class="site-details">
        <div class="detail-row">
            <span class="label">Coordinates</span>
            <span class="value">58.4615°N, 8.7725°E</span>
        </div>
        <div class="detail-row">
            <span class="label">Weather Station</span>
            <span class="value">SN44560 (Torungen)</span>
        </div>
        <div class="detail-row">
            <span class="label">Annual Solar</span>
            <span class="value">1,050 kWh/m²/yr</span>
        </div>
    </div>
    <div class="site-pools">
        <h5>Pools</h5>
        <ul class="pool-list">
            <li>Main Pool <span class="pool-volume">625 m³</span></li>
            <li>Kids Pool <span class="pool-volume">45 m³</span></li>
        </ul>
        <button class="btn btn-sm btn-secondary">+ Add Pool</button>
    </div>
</div>
```

### Solar Data Display

Based on latitude, show estimated annual solar radiation:

| Latitude | Annual Solar (kWh/m²) |
|----------|----------------------|
| 58°N (Arendal) | ~1,050 |
| 60°N (Oslo) | ~980 |
| 63°N (Trondheim) | ~850 |
| 70°N (Tromsø) | ~700 |

### Weather Station Connection

When site coordinates are set:
1. Show nearby weather stations from database
2. Allow selection or auto-select nearest
3. Display station distance from site
4. Show data availability range

---

## 17. Future Enhancements

### Consider Adding:
1. **Dark Mode:** Toggle for reduced eye strain
2. **Custom Themes:** Brand color customization
3. **Animated Transitions:** Subtle page transitions
4. **Data Visualization:** More chart types (gauges, sparklines)
5. **Accessibility:** WCAG 2.1 AA compliance

### Design Resources:
- Tailwind CSS design patterns
- Stripe Dashboard for inspiration
- Linear App for clean interfaces
- Figma for prototyping

---

## 18. Version History

| Version | Changes |
|---------|---------|
| V65 | Loading states, status badges, chart improvements, simulation state, site architecture |
| V64 | Sidebar enhancements, elevation system, form consistency |
| V63 | Project management UI, modal styles |
| V62 | Analyse tab, History metrics table |
| V61 | Override table, tolerance split |
| V60 | Chart improvements, water temp colors |
