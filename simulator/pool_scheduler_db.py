#!/usr/bin/env python3
"""
POOL SCHEDULER V4.0.0 - Database Backend
Flexible pool scheduling with calendar programs and priority-based date ranges

Based on V3.6.0.3, ported to read from MySQL database instead of JSON files.

Database tables used:
- day_schedules: Named daily schedules (Normal, Weekend, Closed)
- day_schedule_periods: Time periods within each schedule
- week_schedules: Weekly patterns mapping days to day_schedules
- calendar_date_ranges: Date range rules with priorities
- calendar_exception_days: Holiday and special day overrides
- schedule_templates: Overall template configuration
- holiday_reference_days: Pre-calculated holiday dates (Easter, etc.)
"""

from datetime import datetime, timedelta
from db_connection import DatabaseConnection, get_db


class PoolSchedulerDB:
    """
    Database-backed pool schedule manager.

    Manages pool operating schedules with support for:
    - Named daily schedules (Normal, Weekend, Closed, etc.)
    - Calendar programs with date ranges and priorities
    - Holiday exceptions (fixed dates and Easter-relative)
    - Day-specific assignments (Mon-Sun via week_schedules)
    """

    def __init__(self, site_id='arendal_aquatic', template_id=None, db=None):
        """
        Initialize schedule manager from database

        Args:
            site_id: Site identifier (default: 'arendal_aquatic')
            template_id: Schedule template ID (optional, uses default for site)
            db: Optional DatabaseConnection instance
        """
        self.site_id = site_id
        self.db = db or DatabaseConnection()
        self._owns_db = db is None

        # Load configuration from database
        self.template = self._load_template(template_id)
        self.template_id = self.template['template_id']

        # Load schedules and programs
        self.schedules = self._load_day_schedules()
        self.week_schedules = self._load_week_schedules()
        self.date_ranges = self._load_date_ranges()
        self.exception_days = self._load_exception_days()
        self.holiday_dates = self._load_holiday_dates()

        print(f"✓ Loaded schedule template: {self.template['name']}")
        print(f"  - {len(self.schedules)} day schedules")
        print(f"  - {len(self.week_schedules)} week schedules")
        print(f"  - {len(self.date_ranges)} date range rules")
        print(f"  - {len(self.exception_days)} exception days")

    def _load_template(self, template_id=None):
        """Load schedule template from database"""
        if template_id:
            query = """
                SELECT * FROM schedule_templates
                WHERE template_id = %s
            """
            result = self.db.execute_one(query, (template_id,))
        else:
            query = """
                SELECT * FROM schedule_templates
                WHERE site_id = %s
                LIMIT 1
            """
            result = self.db.execute_one(query, (self.site_id,))

        if not result:
            raise ValueError(f"No schedule template found for site: {self.site_id}")

        return result

    def _load_day_schedules(self):
        """
        Load all day schedules with their periods

        Returns:
            Dict mapping schedule name to schedule data:
            {
                "Normal": {
                    "id": 1,
                    "description": "Standard weekday",
                    "periods": [
                        {"from": 9, "to": 14, "target_temp": 28.0},
                        ...
                    ]
                },
                ...
            }
        """
        # Load base schedules
        query = """
            SELECT day_schedule_id, name, description
            FROM day_schedules
            WHERE site_id = %s
            ORDER BY name
        """
        rows = self.db.execute(query, (self.site_id,))

        schedules = {}
        for row in rows:
            schedules[row['name']] = {
                'id': row['day_schedule_id'],
                'description': row['description'] or '',
                'periods': []
            }

        # Load periods for each schedule
        query = """
            SELECT
                ds.name as schedule_name,
                dsp.start_time,
                dsp.end_time,
                dsp.target_temp,
                dsp.min_temp,
                dsp.max_temp,
                dsp.period_order
            FROM day_schedule_periods dsp
            JOIN day_schedules ds ON dsp.day_schedule_id = ds.day_schedule_id
            WHERE ds.site_id = %s
            ORDER BY ds.name, dsp.period_order, dsp.start_time
        """
        periods = self.db.execute(query, (self.site_id,))

        for period in periods:
            schedule_name = period['schedule_name']
            if schedule_name in schedules:
                # Convert TIME to hour integer
                start_time = period['start_time']
                end_time = period['end_time']

                # Handle timedelta objects from MySQL TIME type
                if hasattr(start_time, 'total_seconds'):
                    start_hour = int(start_time.total_seconds() // 3600)
                else:
                    start_hour = start_time.hour if hasattr(start_time, 'hour') else int(start_time)

                if hasattr(end_time, 'total_seconds'):
                    end_hour = int(end_time.total_seconds() // 3600)
                else:
                    end_hour = end_time.hour if hasattr(end_time, 'hour') else int(end_time)

                schedules[schedule_name]['periods'].append({
                    'from': start_hour,
                    'to': end_hour,
                    'target_temp': float(period['target_temp']),
                    'min_temp': float(period['min_temp']) if period['min_temp'] else None,
                    'max_temp': float(period['max_temp']) if period['max_temp'] else None
                })

        return schedules

    def _load_week_schedules(self):
        """
        Load week schedules mapping days to day_schedules

        Returns:
            Dict mapping week schedule ID to daily assignments:
            {
                1: {
                    "name": "Normal Week",
                    "days": {
                        "mon": "Normal",
                        "tue": "Normal",
                        ...
                    }
                },
                ...
            }
        """
        query = """
            SELECT
                ws.week_schedule_id,
                ws.name,
                d1.name as monday,
                d2.name as tuesday,
                d3.name as wednesday,
                d4.name as thursday,
                d5.name as friday,
                d6.name as saturday,
                d7.name as sunday
            FROM week_schedules ws
            LEFT JOIN day_schedules d1 ON ws.monday_schedule_id = d1.day_schedule_id
            LEFT JOIN day_schedules d2 ON ws.tuesday_schedule_id = d2.day_schedule_id
            LEFT JOIN day_schedules d3 ON ws.wednesday_schedule_id = d3.day_schedule_id
            LEFT JOIN day_schedules d4 ON ws.thursday_schedule_id = d4.day_schedule_id
            LEFT JOIN day_schedules d5 ON ws.friday_schedule_id = d5.day_schedule_id
            LEFT JOIN day_schedules d6 ON ws.saturday_schedule_id = d6.day_schedule_id
            LEFT JOIN day_schedules d7 ON ws.sunday_schedule_id = d7.day_schedule_id
            WHERE ws.site_id = %s
        """
        rows = self.db.execute(query, (self.site_id,))

        week_schedules = {}
        for row in rows:
            week_schedules[row['week_schedule_id']] = {
                'name': row['name'],
                'days': {
                    'mon': row['monday'],
                    'tue': row['tuesday'],
                    'wed': row['wednesday'],
                    'thu': row['thursday'],
                    'fri': row['friday'],
                    'sat': row['saturday'],
                    'sun': row['sunday']
                }
            }

        return week_schedules

    def _load_date_ranges(self):
        """
        Load calendar date ranges (programs)

        Returns:
            List of date range dicts sorted by priority (highest first):
            [
                {
                    "id": 1,
                    "name": "Summer",
                    "priority": 50,
                    "week_schedule_id": 2,
                    "start_month": 6, "start_day": 25,
                    "end_month": 8, "end_day": 15,
                    "is_recurring": True
                },
                ...
            ]
        """
        query = """
            SELECT
                id,
                name,
                priority,
                week_schedule_id,
                start_date,
                end_date,
                is_recurring,
                is_active
            FROM calendar_date_ranges
            WHERE schedule_template_id = %s AND is_active = 1
            ORDER BY priority DESC
        """
        rows = self.db.execute(query, (self.template_id,))

        date_ranges = []
        for row in rows:
            start_date = row['start_date']
            end_date = row['end_date']

            date_ranges.append({
                'id': row['id'],
                'name': row['name'],
                'priority': row['priority'] or 0,
                'week_schedule_id': row['week_schedule_id'],
                'start_month': start_date.month,
                'start_day': start_date.day,
                'end_month': end_date.month,
                'end_day': end_date.day,
                'is_recurring': bool(row['is_recurring'])
            })

        return date_ranges

    def _load_exception_days(self):
        """
        Load calendar exception days (holidays)

        Returns:
            List of exception day dicts:
            [
                {
                    "id": 1,
                    "name": "Christmas Day",
                    "day_schedule_id": 3,
                    "day_schedule_name": "Closed",
                    "fixed_month": 12,
                    "fixed_day": 25,
                    "is_moving": False,
                    "easter_offset": None,
                    "priority": 100
                },
                ...
            ]
        """
        query = """
            SELECT
                ce.id,
                ce.name,
                ce.day_schedule_id,
                ds.name as day_schedule_name,
                ce.fixed_month,
                ce.fixed_day,
                ce.is_moving,
                ce.easter_offset_days,
                ce.priority
            FROM calendar_exception_days ce
            LEFT JOIN day_schedules ds ON ce.day_schedule_id = ds.day_schedule_id
            WHERE ce.schedule_template_id = %s
            ORDER BY ce.priority DESC
        """
        rows = self.db.execute(query, (self.template_id,))

        exceptions = []
        for row in rows:
            exceptions.append({
                'id': row['id'],
                'name': row['name'],
                'day_schedule_id': row['day_schedule_id'],
                'day_schedule_name': row['day_schedule_name'],
                'fixed_month': row['fixed_month'],
                'fixed_day': row['fixed_day'],
                'is_moving': bool(row['is_moving']),
                'easter_offset': row['easter_offset_days'],
                'priority': row['priority'] or 50
            })

        return exceptions

    def _load_holiday_dates(self):
        """
        Load pre-calculated holiday reference dates (Easter, etc.)

        Returns:
            Dict mapping year to Easter date:
            {2024: datetime.date(2024, 3, 31), ...}
        """
        query = """
            SELECT year, easter_date
            FROM holiday_reference_days
            WHERE country = 'NO'
            ORDER BY year
        """
        rows = self.db.execute(query)

        holidays = {}
        for row in rows:
            holidays[row['year']] = row['easter_date']

        return holidays

    def _get_easter_date(self, year):
        """Get Easter date for a given year"""
        if year in self.holiday_dates:
            return self.holiday_dates[year]

        # Fallback: Calculate Easter using Anonymous Gregorian algorithm
        a = year % 19
        b = year // 100
        c = year % 100
        d = b // 4
        e = b % 4
        f = (b + 8) // 25
        g = (b - f + 1) // 3
        h = (19 * a + b - d - g + 15) % 30
        i = c // 4
        k = c % 4
        l = (32 + 2 * e + 2 * i - h - k) % 7
        m = (a + 11 * h + 22 * l) // 451
        month = (h + l - 7 * m + 114) // 31
        day = ((h + l - 7 * m + 114) % 31) + 1

        from datetime import date
        return date(year, month, day)

    def get_schedule_for_date(self, date):
        """
        Find which daily schedule to use for a given date.
        Checks exception days first, then date ranges, then base schedule.

        Args:
            date: datetime.date object

        Returns:
            Schedule name (string) e.g., "Normal", "Weekend", "Closed"
        """
        # 1. Check exception days (holidays) - highest priority
        exception = self._check_exception_days(date)
        if exception:
            return exception['day_schedule_name']

        # 2. Check date ranges (programs)
        for date_range in self.date_ranges:
            if self._date_in_range(date, date_range):
                week_schedule = self.week_schedules.get(date_range['week_schedule_id'])
                if week_schedule:
                    weekday_short = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
                    dow = weekday_short[date.weekday()]
                    schedule_name = week_schedule['days'].get(dow)
                    if schedule_name:
                        return schedule_name

        # 3. Fall back to base week schedule from template
        base_week_id = self.template.get('base_week_schedule_id')
        if base_week_id and base_week_id in self.week_schedules:
            week_schedule = self.week_schedules[base_week_id]
            weekday_short = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
            dow = weekday_short[date.weekday()]
            schedule_name = week_schedule['days'].get(dow)
            if schedule_name:
                return schedule_name

        # 4. Last resort: use first available schedule
        if self.schedules:
            return list(self.schedules.keys())[0]

        raise ValueError(f"No schedule found for date {date}")

    def _check_exception_days(self, date):
        """
        Check if date matches any exception day (holiday)

        Args:
            date: datetime.date object

        Returns:
            Exception dict if match found, None otherwise
        """
        for exc in self.exception_days:
            if exc['is_moving'] and exc['easter_offset'] is not None:
                # Easter-relative holiday
                easter = self._get_easter_date(date.year)
                holiday_date = easter + timedelta(days=exc['easter_offset'])
                if date == holiday_date:
                    return exc
            elif exc['fixed_month'] and exc['fixed_day']:
                # Fixed date holiday
                if date.month == exc['fixed_month'] and date.day == exc['fixed_day']:
                    return exc

        return None

    def _date_in_range(self, date, date_range):
        """
        Check if date falls within a date range.
        Supports recurring annual ranges and year-crossing ranges.

        Args:
            date: datetime.date object
            date_range: Dict with start/end month/day

        Returns:
            True if date is in range
        """
        if date_range.get('is_recurring', True):
            # Compare (month, day) tuples for annual ranges
            from_md = (date_range['start_month'], date_range['start_day'])
            to_md = (date_range['end_month'], date_range['end_day'])
            current_md = (date.month, date.day)

            if from_md <= to_md:
                # Normal range: Jun 25 - Aug 15
                return from_md <= current_md <= to_md
            else:
                # Year-crossing range: Dec 20 - Jan 5
                return current_md >= from_md or current_md <= to_md

        return False

    def get_periods(self, date):
        """
        Get all operating periods for a given date.

        Args:
            date: datetime.date object

        Returns:
            List of period dicts: [{"from": hour, "to": hour, "target_temp": temp}, ...]
            Empty list if pool is closed all day
        """
        schedule_name = self.get_schedule_for_date(date)

        if schedule_name not in self.schedules:
            raise ValueError(f"Schedule '{schedule_name}' not found")

        schedule = self.schedules[schedule_name]
        return schedule.get('periods', [])

    def get_current_temperature(self, dt):
        """
        Get target temperature for a specific datetime.

        Args:
            dt: datetime object

        Returns:
            Target temperature (float) or None if pool is closed
        """
        date = dt.date()
        hour = dt.hour

        periods = self.get_periods(date)

        for period in periods:
            if period['from'] < period['to']:
                # Normal case: 10-20
                if period['from'] <= hour < period['to']:
                    return period['target_temp']
            else:
                # Overnight case: 22-6
                if hour >= period['from'] or hour < period['to']:
                    return period['target_temp']

        return None

    def is_open(self, dt):
        """
        Check if pool is open at a specific datetime.

        Args:
            dt: datetime object

        Returns:
            True if open, False if closed
        """
        return self.get_current_temperature(dt) is not None

    def get_daily_transitions(self, date):
        """
        Get all temperature transitions for a day.

        Args:
            date: datetime.date object

        Returns:
            List of transition dicts sorted by time
        """
        periods = self.get_periods(date)

        if not periods:
            return []

        transitions = []
        last_target = None

        for period in periods:
            transitions.append({
                "time": period['from'],
                "type": "open",
                "target_temp": period['target_temp'],
                "from_temp": last_target
            })

            transitions.append({
                "time": period['to'],
                "type": "close",
                "target_temp": None,
                "from_temp": period['target_temp']
            })

            last_target = period['target_temp']

        transitions.sort(key=lambda t: t['time'])
        return transitions

    def find_next_opening(self, dt):
        """
        Find next pool opening time from a given datetime.

        Args:
            dt: datetime object

        Returns:
            Tuple: (next_opening_datetime, target_temp) or (None, None)
        """
        current_date = dt.date()
        current_hour = dt.hour

        # Check remaining transitions today
        transitions = self.get_daily_transitions(current_date)
        for trans in transitions:
            if trans['type'] == 'open' and trans['time'] > current_hour:
                opening_dt = datetime.combine(current_date, datetime.min.time()).replace(hour=trans['time'])
                return opening_dt, trans['target_temp']

        # Check next 30 days
        for day_offset in range(1, 31):
            next_date = current_date + timedelta(days=day_offset)
            transitions = self.get_daily_transitions(next_date)

            for trans in transitions:
                if trans['type'] == 'open':
                    opening_dt = datetime.combine(next_date, datetime.min.time()).replace(hour=trans['time'])
                    return opening_dt, trans['target_temp']

        return None, None

    def get_current_period(self, dt):
        """
        Get the current period info if pool is open.

        Args:
            dt: datetime object

        Returns:
            Period dict or None if closed
        """
        date = dt.date()
        hour = dt.hour

        periods = self.get_periods(date)

        for period in periods:
            if period['from'] < period['to']:
                if period['from'] <= hour < period['to']:
                    return period
            else:
                if hour >= period['from'] or hour < period['to']:
                    return period

        return None

    def get_period_duration(self, period):
        """Calculate duration of a period in hours"""
        if period['from'] < period['to']:
            return period['to'] - period['from']
        else:
            return (24 - period['from']) + period['to']

    def close(self):
        """Close database connection if we own it"""
        if self._owns_db and self.db:
            self.db.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


def test_scheduler_db():
    """Test database-backed scheduler"""
    print("\n" + "=" * 70)
    print("POOL SCHEDULER V4.0.0 (Database Backend) TEST")
    print("=" * 70)

    try:
        with PoolSchedulerDB() as scheduler:
            # Test dates
            test_dates = [
                datetime(2024, 3, 15),   # Normal Friday
                datetime(2024, 3, 16),   # Normal Saturday
                datetime(2024, 7, 1),    # Summer Monday
                datetime(2024, 12, 25),  # Christmas
                datetime(2024, 3, 29),   # Good Friday (Easter-relative)
                datetime(2024, 4, 1),    # Easter Monday
            ]

            for dt in test_dates:
                schedule_name = scheduler.get_schedule_for_date(dt.date())
                periods = scheduler.get_periods(dt.date())

                print(f"\n{dt.strftime('%Y-%m-%d (%A)')}: {schedule_name}")
                if periods:
                    for p in periods:
                        print(f"  {p['from']:02d}:00-{p['to']:02d}:00 @ {p['target_temp']}°C")
                else:
                    print("  CLOSED")

    except Exception as e:
        print(f"\n✗ Error: {e}")
        import traceback
        traceback.print_exc()

    print("\n" + "=" * 70)


if __name__ == "__main__":
    test_scheduler_db()
