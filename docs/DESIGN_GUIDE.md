# HeatAQ Design Guide

**Version:** V63
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

### Cards

Cards are the primary container for content groups.

```css
.card {
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    padding: 20px;
    margin-bottom: 20px;
}
```

### Buttons

| Type | Usage |
|------|-------|
| Primary | Main actions (Save, Run, Create) |
| Secondary | Alternative actions (Cancel, Close) |
| Danger | Destructive actions (Delete) |
| Small (btn-sm) | Inline actions, table rows |

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

## 10. Modern UI Trends Applied

### Clean White Space
- Generous padding in cards (20px)
- Clear separation between sections
- Breathing room around form elements

### Subtle Shadows
- Cards use light shadow: `0 2px 4px rgba(0,0,0,0.05)`
- Modals use deeper shadow: `0 10px 40px rgba(0,0,0,0.2)`

### Rounded Corners
- Cards: `8px`
- Buttons: `4px`
- Inputs: `4px`

### Color Indicators
- Blue for heat pump (efficient)
- Orange for boiler (backup)
- Red for issues/closed states
- Green for success/positive

### Interactive Feedback
- Hover states on all clickable elements
- Focus rings on form inputs
- Loading states for async operations

---

## 11. Future Enhancements

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

## 12. Version History

| Version | Changes |
|---------|---------|
| V63 | Project management UI, modal styles |
| V62 | Analyse tab, History metrics table |
| V61 | Override table, tolerance split |
| V60 | Chart improvements, water temp colors |
