"""Synthetic test data for the PHP/TypeScript engine comparison.

Writes SQL to stdout: two years (2023-12-31 .. 2025-12-31) of hourly weather
for station SN10380 and hourly solar for pool site 5, plus a 'Season'
schedule template (16) with long closures, a summer program, a range
crossing the new year, Easter Monday and fixed-date exceptions.

Apply to a copy of a local test database that has project 7, site 5, pool 1
and schedule templates 13-15 (see sim-ts/README.md):
    python3 sim-ts/test/seed_ts_sim.py | mysql ts_sim
"""
import math
import random
from datetime import datetime, timedelta

random.seed(42)
t, end = datetime(2023, 12, 31, 0), datetime(2026, 1, 1, 0)
rows, srows = [], []
while t < end:
    doy, h = t.timetuple().tm_yday, t.hour
    air = round(6 - 12 * math.cos(2 * math.pi * (doy - 15) / 365) + 4 * math.sin(2 * math.pi * (h - 9) / 24) + random.gauss(0, 2), 2)
    wind = round(max(0, 3 + 2 * math.sin(doy / 7) + random.gauss(0, 1.5)), 2)
    hum = int(min(100, max(25, 75 - 15 * math.sin(2 * math.pi * (h - 9) / 24) + random.gauss(0, 8))))
    tun = 'NULL' if random.random() < 0.5 else round(air + 5, 2)
    rows.append(f"('SN10380','{t:%Y-%m-%d %H:%M:%S}',{air},{wind},NULL,{hum},{tun})")
    daylen = 12 + 6 * math.sin(2 * math.pi * (doy - 80) / 365)
    x = (h + 0.5 - 12) / (daylen / 2)
    sol = 0 if abs(x) >= 1 else max(0, (600 + 500 * math.sin(2 * math.pi * (doy - 80) / 365)) * math.cos(x * math.pi / 2) * random.uniform(0.3, 1))
    srows.append(f"(5,'{t:%Y-%m-%d %H:%M:%S}',{sol:.2f},NULL)")
    t += timedelta(hours=1)

print("DELETE FROM weather_data; DELETE FROM site_solar_hourly;")
for i in range(0, len(rows), 2000):
    print("INSERT INTO weather_data VALUES " + ",".join(rows[i:i + 2000]) + ";")
for i in range(0, len(srows), 2000):
    print("INSERT INTO site_solar_hourly VALUES " + ",".join(srows[i:i + 2000]) + ";")
print("""
INSERT INTO day_schedules (day_schedule_id,name,description,is_operating,is_closed,project_id) VALUES (10,'Closed','',0,1,7),(11,'Evening 27','',1,0,7);
INSERT INTO day_schedule_periods (day_schedule_id, start_time, end_time, target_temp, period_order) VALUES (11,'16:00:00','22:00:00',27.0,1);
INSERT INTO week_schedules (week_schedule_id,name,monday_schedule_id,tuesday_schedule_id,wednesday_schedule_id,thursday_schedule_id,friday_schedule_id,saturday_schedule_id,sunday_schedule_id,project_id) VALUES
 (20,'All closed',10,10,10,10,10,10,10,7),(21,'Summer',1,1,1,1,1,11,11,7),(22,'Xmas',3,3,3,3,3,10,2,7);
INSERT INTO schedule_templates (template_id,name,version,project_id) VALUES (16,'Season','1',7);
INSERT INTO calendar_date_ranges (schedule_template_id,priority,name,start_date,end_date,week_schedule_id,is_active) VALUES
 (16,0,'Default','1970-01-01','2099-12-31',20,1),(16,2,'Summer','2000-06-01','2000-08-31',21,1),(16,3,'Xmas','2000-12-20','2001-01-05',22,1);
INSERT INTO exception_days (id,name,is_fixed,fixed_month,fixed_day,reference_day_id,offset_days) VALUES (50,'Easter Monday',0,NULL,NULL,1,1),(51,'17 May',1,5,17,NULL,NULL),(52,'Midsummer',1,6,23,NULL,NULL);
INSERT INTO schedule_template_exceptions (template_id,exception_day_id,day_schedule_id) VALUES (16,50,10),(16,51,11),(16,52,10),(13,50,2);
INSERT INTO reference_day_dates (reference_day_id,year,date) VALUES (1,2024,'2024-03-31'),(1,2025,'2025-04-20');
""")
