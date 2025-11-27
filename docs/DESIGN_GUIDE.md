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

| Type | Usage | Hover Effect |
|------|-------|--------------|
| Primary | Main actions (Save, Run) | Darkens + shadow |
| Secondary | Alternative actions | Darkens |
| Danger | Destructive actions | Darkens |
| btn-sm | Inline actions | Same as parent |
| btn-lg | Prominent CTAs | Same as parent |

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

## 12. Future Enhancements

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

## 13. Version History

| Version | Changes |
|---------|---------|
| V64 | Sidebar enhancements, elevation system, form consistency |
| V63 | Project management UI, modal styles |
| V62 | Analyse tab, History metrics table |
| V61 | Override table, tolerance split |
| V60 | Chart improvements, water temp colors |
