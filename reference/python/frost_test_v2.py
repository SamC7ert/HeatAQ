#!/usr/bin/env python3
"""
Frost API Tester v2 - New Element Codes & Sensor Levels
Uses CF standard element codes with proper sensor level handling
"""

import requests
import sys
import json
import numpy as np
from datetime import datetime

CLIENT_ID = 'e33548a8-dd28-4828-a87e-39b4f7eb88ce'

def print_header(title):
    print("=" * 70)
    print(title)
    print("=" * 70)

def fetch_frost_observations(station, element, start_date, end_date, level=None, client_id=CLIENT_ID):
    """
    Fetch observations using new element codes
    
    Parameters:
    - station: e.g. 'SN37230'
    - element: CF standard name, e.g. 'wind_speed', 'air_temperature'
    - start_date, end_date: ISO format dates
    - level: sensor level filter, e.g. '2', '10', 'default', or None
    """
    
    endpoint = 'https://frost.met.no/observations/v0.jsonld'
    
    params = {
        'sources': station,
        'elements': element,
        'referencetime': f'{start_date}/{end_date}',
        'timeresolutions': 'PT1H'
    }
    
    if level:
        params['levels'] = level
    
    print_header("FROST API QUERY (NEW ELEMENT CODES)")
    print(f"Station:      {station}")
    print(f"Element:      {element}")
    print(f"Period:       {start_date} to {end_date}")
    print(f"Sensor level: {level if level else 'all available'}")
    print(f"URL:          {endpoint}")
    print()
    
    try:
        r = requests.get(endpoint, params=params, auth=(client_id, ''), timeout=30)
        
        print(f"Status:       {r.status_code}")
        
        if r.status_code != 200:
            print(f"\nERROR RESPONSE:")
            print(r.text[:500])
            return None
        
        data = r.json()
        
        if 'data' not in data:
            print("\nERROR: No 'data' field in response")
            return None
        
        print(f"Records:      {len(data['data'])} timestamps")
        
        # Extract values with metadata
        values = []
        levels_found = set()
        
        for item in data['data']:
            source = item.get('sourceId', 'unknown')
            if 'observations' in item:
                for obs in item['observations']:
                    if 'value' in obs:
                        values.append(obs['value'])
                        # Track sensor level if available
                        if 'level' in obs:
                            level_info = obs['level']
                            if isinstance(level_info, dict):
                                levels_found.add(f"{level_info.get('value', '?')}{level_info.get('unit', '')}")
        
        if levels_found:
            print(f"Levels found: {', '.join(sorted(levels_found))}")
        
        print()
        
        return values
        
    except Exception as e:
        print(f"\nEXCEPTION: {e}")
        return None

def list_available_timeseries(station, element=None, client_id=CLIENT_ID):
    """
    List available time series for a station
    Shows what elements and sensor levels are available
    """
    
    endpoint = 'https://frost.met.no/observations/availableTimeSeries/v0.jsonld'
    
    params = {'sources': station}
    if element:
        params['elements'] = element
    
    print_header(f"AVAILABLE TIME SERIES: {station}")
    
    try:
        r = requests.get(endpoint, params=params, auth=(client_id, ''), timeout=30)
        
        if r.status_code != 200:
            print(f"ERROR: {r.status_code}")
            print(r.text[:500])
            return
        
        data = r.json()
        
        if 'data' not in data:
            print("No data available")
            return
        
        # Group by element
        elements = {}
        for ts in data['data']:
            elem = ts.get('elementId', 'unknown')
            level_info = ts.get('level', {})
            
            level_str = 'no level'
            if isinstance(level_info, dict):
                level_val = level_info.get('value', '')
                level_unit = level_info.get('unit', '')
                level_type = level_info.get('levelType', '')
                if level_val:
                    level_str = f"{level_val}{level_unit} ({level_type})"
            
            time_res = ts.get('timeResolution', 'unknown')
            valid_from = ts.get('validFrom', '')[:10]
            valid_to = ts.get('validTo', '')[:10] if ts.get('validTo') else 'present'
            
            if elem not in elements:
                elements[elem] = []
            
            elements[elem].append({
                'level': level_str,
                'resolution': time_res,
                'period': f"{valid_from} to {valid_to}"
            })
        
        # Print summary
        for elem in sorted(elements.keys()):
            print(f"\n{elem}:")
            for ts in elements[elem]:
                print(f"  Level: {ts['level']:20} Resolution: {ts['resolution']:8} Period: {ts['period']}")
        
        print()
        
    except Exception as e:
        print(f"EXCEPTION: {e}")

def lookup_old_code(old_code, client_id=CLIENT_ID):
    """
    Convert old element code (FM, FF, etc) to new element ID
    """
    
    endpoint = 'https://frost.met.no/elements/v0.jsonld'
    params = {'oldElementCodes': old_code}
    
    print_header(f"ELEMENT CODE LOOKUP: {old_code}")
    
    try:
        r = requests.get(endpoint, params=params, auth=(client_id, ''), timeout=30)
        
        if r.status_code != 200:
            print(f"ERROR: {r.status_code}")
            return
        
        data = r.json()
        
        if 'data' not in data or len(data['data']) == 0:
            print(f"No element found for old code: {old_code}")
            return
        
        print(f"Found {len(data['data'])} element(s):\n")
        
        for elem in data['data']:
            print(f"New ID:      {elem.get('id')}")
            print(f"Name:        {elem.get('name')}")
            print(f"Unit:        {elem.get('unit')}")
            print(f"Description: {elem.get('description')}")
            
            old_codes = elem.get('oldElementCodes', [])
            if old_codes:
                print(f"Old codes:   {', '.join(old_codes)}")
            
            print()
        
    except Exception as e:
        print(f"EXCEPTION: {e}")

def print_statistics(values, element):
    """Print statistics for retrieved values"""
    
    if not values or len(values) == 0:
        print("\nâœ— NO DATA RECEIVED")
        return
    
    values = np.array(values)
    
    print_header("STATISTICS")
    print(f"Element:  {element}")
    print(f"Count:    {len(values)} observations")
    print(f"Average:  {np.mean(values):.3f}")
    print(f"Median:   {np.median(values):.3f}")
    print(f"Std dev:  {np.std(values):.3f}")
    print(f"Min:      {np.min(values):.3f}")
    print(f"Max:      {np.max(values):.3f}")
    print("=" * 70)

def main():
    if len(sys.argv) < 2:
        print_header("FROST API TESTER V2 - NEW ELEMENT CODES")
        print("\nCommands:\n")
        
        print("1. FETCH OBSERVATIONS:")
        print("   python3 frost_test_v2.py fetch STATION ELEMENT START END [LEVEL] [CLIENT_ID]")
        print("\n   Examples:")
        print("   python3 frost_test_v2.py fetch SN37230 wind_speed 2024-01-01 2024-12-31")
        print("   python3 frost_test_v2.py fetch SN37230 wind_speed 2024-01-01 2024-12-31 2")
        print("   python3 frost_test_v2.py fetch SN37230 wind_speed 2024-01-01 2024-12-31 default")
        print("   python3 frost_test_v2.py fetch SN37230 air_temperature 2024-06-01 2024-06-30 2")
        
        print("\n2. LIST AVAILABLE TIME SERIES:")
        print("   python3 frost_test_v2.py list STATION [ELEMENT] [CLIENT_ID]")
        print("\n   Examples:")
        print("   python3 frost_test_v2.py list SN37230")
        print("   python3 frost_test_v2.py list SN37230 wind_speed")
        
        print("\n3. LOOKUP OLD ELEMENT CODE:")
        print("   python3 frost_test_v2.py lookup OLD_CODE [CLIENT_ID]")
        print("\n   Examples:")
        print("   python3 frost_test_v2.py lookup FM")
        print("   python3 frost_test_v2.py lookup FF")
        print("   python3 frost_test_v2.py lookup FM2")
        
        print("\nCommon new element codes:")
        print("  wind_speed                      - Wind speed (standard)")
        print("  air_temperature                 - Air temperature")
        print("  sum(precipitation_amount PT1H)  - Hourly precipitation")
        print("  relative_humidity               - Relative humidity")
        print("  surface_air_pressure            - Air pressure")
        
        print("\nSensor level parameter:")
        print("  <number>  - Specific level (e.g. 2, 10)")
        print("  default   - Standard level only")
        print("  (omit)    - All available levels")
        print()
        sys.exit(0)
    
    command = sys.argv[1].lower()
    
    if command == 'fetch':
        if len(sys.argv) < 6:
            print("ERROR: fetch requires STATION ELEMENT START END [LEVEL] [CLIENT_ID]")
            sys.exit(1)
        
        station = sys.argv[2]
        element = sys.argv[3]
        start_date = sys.argv[4]
        end_date = sys.argv[5]
        level = sys.argv[6] if len(sys.argv) > 6 else None
        client_id = sys.argv[7] if len(sys.argv) > 7 else CLIENT_ID
        
        # Don't pass level if it's actually a client_id
        if level and len(level) > 10:
            client_id = level
            level = None
        
        values = fetch_frost_observations(station, element, start_date, end_date, level, client_id)
        print_statistics(values, element)
    
    elif command == 'list':
        if len(sys.argv) < 3:
            print("ERROR: list requires STATION [ELEMENT] [CLIENT_ID]")
            sys.exit(1)
        
        station = sys.argv[2]
        element = sys.argv[3] if len(sys.argv) > 3 else None
        client_id = sys.argv[4] if len(sys.argv) > 4 else CLIENT_ID
        
        # Check if element is actually client_id
        if element and len(element) > 10 and '-' in element:
            client_id = element
            element = None
        
        list_available_timeseries(station, element, client_id)
    
    elif command == 'lookup':
        if len(sys.argv) < 3:
            print("ERROR: lookup requires OLD_CODE [CLIENT_ID]")
            sys.exit(1)
        
        old_code = sys.argv[2]
        client_id = sys.argv[3] if len(sys.argv) > 3 else CLIENT_ID
        
        lookup_old_code(old_code, client_id)
    
    else:
        print(f"Unknown command: {command}")
        print("Use: fetch, list, or lookup")
        sys.exit(1)

if __name__ == "__main__":
    main()
