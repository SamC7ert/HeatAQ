# Pool Scheduler: Python vs PHP Comparison

## Summary

The PHP scheduler is a faithful port of the Python scheduler with identical core logic. However, there are **4 potential issues** to address.

---

## ISSUES FOUND

### 1. **CRITICAL: Holiday Table Column Name Mismatch**

| Python (line 340) | PHP (line 304) |
|-------------------|----------------|
| `SELECT year, easter_date` | `SELECT year, easter_sunday` |

**Impact:** One version will fail if column name doesn't match.

**Fix needed:** Verify actual database column name and update both to match.

---

### 2. **MEDIUM: is_recurring Flag Ignored in PHP**

| Python (line 271) | PHP (line 237) |
|-------------------|----------------|
| `'is_recurring': bool(row['is_recurring'])` | `'is_recurring' => true  // Hardcoded` |

**Impact:** PHP ignores the `is_recurring` flag from database - all date ranges treated as recurring.

**Fix:** Read from database:
```php
'is_recurring' => isset($row['is_recurring']) ? (bool) $row['is_recurring'] : true
```

---

### 3. **LOW: Country Filter Missing in PHP**

| Python (line 342) | PHP (line 303-307) |
|-------------------|-------------------|
| `WHERE country = 'NO'` | No country filter |

**Impact:** PHP loads all holiday dates regardless of country. Usually not a problem if only one country in DB.

---

### 4. **LOW: Error Handling Difference in getPeriods**

| Python (line 484-485) | PHP (line 485-488) |
|-----------------------|-------------------|
| Raises `ValueError` if schedule not found | Returns empty array `[]` |

**Impact:** PHP silently treats unknown schedules as "closed". Python fails loudly.

---

## LOGIC COMPARISON (✓ = Identical)

| Feature | Python | PHP | Status |
|---------|--------|-----|--------|
| Priority resolution order | Exceptions → Date Ranges → Base Week | Same | ✓ |
| Day of week mapping | weekday() 0-6 | format('N')-1 0-6 | ✓ |
| Date range comparison | Tuple comparison | Array comparison | ✓ |
| Year-crossing ranges | OR logic | OR logic | ✓ |
| Easter calculation algorithm | Anonymous Gregorian | Anonymous Gregorian | ✓ |
| Easter-relative holidays | offset from easter_date | offset from easter_date | ✓ |
| Fixed holidays | month/day match | month/day match | ✓ |
| Period time matching | from <= hour < to | from <= hour < to | ✓ |
| Overnight period handling | hour >= from OR hour < to | Same | ✓ |

---

## HIGH-LEVEL SCHEDULER PRINCIPLES

### 1. Priority-Based Schedule Resolution

```
HIGHEST → Exception Days (holidays)
       → Date Ranges (calendar programs) - sorted by priority DESC
       → Base Week Schedule (template default)
LOWEST → First available schedule (fallback)
```

### 2. Three-Tier Schedule Architecture

```
SCHEDULE TEMPLATE
├── base_week_schedule_id → Default weekly pattern
│
├── DAY SCHEDULES (define operating hours)
│   ├── "Normal"   → periods: [{from: 9, to: 21, target: 28°C}]
│   ├── "Weekend"  → periods: [{from: 10, to: 18, target: 28°C}]
│   └── "Closed"   → periods: []
│
├── WEEK SCHEDULES (map weekdays to day schedules)
│   ├── "Normal Week"  → Mon-Fri: Normal, Sat-Sun: Weekend
│   └── "Summer Week"  → Mon-Sun: Extended
│
├── DATE RANGES (when to use which week schedule)
│   ├── "Summer" (Jun 25 - Aug 15) → Summer Week (priority: 50)
│   └── "Maintenance" (specific dates) → Closed Week (priority: 90)
│
└── EXCEPTION DAYS (override everything)
    ├── Fixed: Christmas (Dec 25) → Closed
    └── Moving: Good Friday (Easter - 2) → Closed
```

### 3. Period Matching Logic

```
For each period in day's schedule:

  NORMAL PERIOD (from < to):
    Example: 9-21 (9am to 9pm)
    Match: from <= current_hour < to

  OVERNIGHT PERIOD (from > to):
    Example: 22-6 (10pm to 6am)
    Match: current_hour >= from OR current_hour < to
```

### 4. Holiday Types

```
FIXED HOLIDAYS:
  - Stored as month/day (e.g., 12/25 for Christmas)
  - Same date every year

MOVING HOLIDAYS (Easter-relative):
  - Stored as offset from Easter Sunday
  - Easter calculated using Anonymous Gregorian algorithm
  - Examples:
    - Good Friday: Easter - 2
    - Easter Monday: Easter + 1
    - Ascension Day: Easter + 39
    - Whit Monday: Easter + 50
```

### 5. Year-Crossing Date Ranges

```
NORMAL RANGE (from <= to):
  Example: Jun 25 - Aug 15
  Match: (6,25) <= (current_month, current_day) <= (8,15)

YEAR-CROSSING RANGE (from > to):
  Example: Dec 20 - Jan 5
  Match: (current >= Dec 20) OR (current <= Jan 5)
```

---

## RECOMMENDED FIXES

### Fix 1: Holiday Column Name
```php
// In PHP loadHolidayDates(), try both column names:
$stmt = $this->db->prepare("
    SELECT year,
           COALESCE(easter_date, easter_sunday) as easter_date
    FROM holiday_reference_days
    ORDER BY year
");
```

### Fix 2: is_recurring Flag
```php
// In PHP loadDateRanges(), read from DB:
'is_recurring' => isset($row['is_recurring']) ? (bool) $row['is_recurring'] : true
```

---

## VALIDATION TEST DATES

To verify both schedulers produce identical results:

| Date | Expected Schedule | Reason |
|------|-------------------|--------|
| 2024-03-15 (Fri) | Normal | Regular weekday |
| 2024-03-16 (Sat) | Weekend | Regular weekend |
| 2024-07-15 (Mon) | Summer/Extended | Summer date range |
| 2024-12-25 (Wed) | Closed | Fixed holiday |
| 2024-03-29 (Fri) | Closed | Good Friday (Easter-2) |
| 2024-04-01 (Mon) | Closed | Easter Monday (Easter+1) |
| 2024-12-31 (Tue) | Check range | Year-crossing test |
| 2024-01-01 (Mon) | Check range | Year-crossing test |
