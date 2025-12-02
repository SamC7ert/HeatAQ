#!/usr/bin/env python3
"""
Weather Data Downloader v3.6.0 - Sensor Level Support
Uses new Frost API element codes with sensor level parameters
Wind priority: level=2 (2m) → level=10 (10m) → level=default
"""

import requests
import pandas as pd
from datetime import datetime, timedelta
import time
import argparse

# Default client ID
DEFAULT_CLIENT_ID = '2fb113fd-5312-484c-86df-c57c7eaaa943'

# Known Norwegian weather stations
KNOWN_STATIONS = {
    'landvik': 'SN38140',  # CORRECTED from SN37230
    'oslo': 'SN18700',
    'bergen': 'SN50540',
    'trondheim': 'SN68860',
    'stavanger': 'SN44560',
    'kristiansand': 'SN39040',
    'tromsø': 'SN90450',
    'bodø': 'SN76900',
    'ålesund': 'SN61560',
    'torungen': 'SN36200'
}

def parse_date_range(date_range):
    """Parse flexible date range formats"""
    today = datetime.now()
    
    if '-' in date_range:
        start_year, end_year = date_range.split('-')
        start_date = datetime(int(start_year), 1, 1)
        end_date = datetime(int(end_year), 12, 31, 23, 59, 59)
    elif len(date_range) == 4 and date_range.isdigit():
        year = int(date_range)
        start_date = datetime(year, 1, 1)
        end_date = datetime(year, 12, 31, 23, 59, 59)
    else:
        years_back = int(date_range)
        end_date = today
        start_date = today - timedelta(days=365 * years_back)
    
    return start_date, end_date

def get_station_name(station_id):
    """Get readable station name from station ID"""
    for name, sid in KNOWN_STATIONS.items():
        if sid == station_id:
            return name.capitalize()
    return station_id

def generate_filename(station_id, date_range, start_date, end_date):
    """Generate filename: WD_StationName_SNxxxxx_DateRange.csv"""
    station_name = get_station_name(station_id)
    
    if station_name != station_id:
        station_id_clean = station_id.replace(':', '_')
        station_part = f"{station_name}_{station_id_clean}"
    else:
        station_part = station_id.replace(':', '_')
    
    if '-' in date_range:
        date_part = date_range
    elif len(date_range) == 4 and date_range.isdigit():
        date_part = date_range
    else:
        date_part = f"{date_range}y"
    
    return f'WD_{station_part}_{date_part}.csv'

def test_wind_sensor_level(station_id, test_date, client_id):
    """
    Test wind_speed element at different sensor levels.
    Priority: 2m → 10m → default → all available
    
    Args:
        station_id: Station ID to test
        test_date: Date to test (datetime object)
        client_id: Frost API client ID
    
    Returns:
        tuple: (level_param, level_m, description)
            e.g., ('2', 2, '2m wind') or ('default', 10, '10m wind (standard)')
    """
    endpoint = 'https://frost.met.no/observations/v0.jsonld'
    
    # Test date range (1 day)
    start = test_date.strftime('%Y-%m-%d')
    end = (test_date + timedelta(days=1)).strftime('%Y-%m-%d')
    
    print("\nTesting wind sensor levels:")
    print("-" * 70)
    
    # Test 2m level first
    print("  Testing level=2 (2m wind)...", end=" ")
    parameters = {
        'sources': station_id,
        'elements': 'wind_speed',
        'levels': '2',
        'referencetime': f'{start}/{end}',
        'timeresolutions': 'PT1H'
    }
    
    try:
        r = requests.get(endpoint, parameters, auth=(client_id, ''), timeout=10)
        if r.status_code == 200:
            json_data = r.json()
            if 'data' in json_data and json_data['data']:
                print("✓ AVAILABLE - Using 2m wind")
                return ('2', 2, '2m wind')
        print("✗ Not available")
    except Exception as e:
        print(f"✗ Error: {e}")
    
    # Test 10m level
    print("  Testing level=10 (10m wind)...", end=" ")
    parameters['levels'] = '10'
    
    try:
        r = requests.get(endpoint, parameters, auth=(client_id, ''), timeout=10)
        if r.status_code == 200:
            json_data = r.json()
            if 'data' in json_data and json_data['data']:
                print("✓ AVAILABLE - Using 10m wind")
                return ('10', 10, '10m wind')
        print("✗ Not available")
    except Exception as e:
        print(f"✗ Error: {e}")
    
    # Test default level
    print("  Testing level=default (standard level)...", end=" ")
    parameters['levels'] = 'default'
    
    try:
        r = requests.get(endpoint, parameters, auth=(client_id, ''), timeout=10)
        if r.status_code == 200:
            json_data = r.json()
            if 'data' in json_data and json_data['data']:
                print("✓ AVAILABLE - Using default level")
                return ('default', None, 'wind (default level)')
        print("✗ Not available")
    except Exception as e:
        print(f"✗ Error: {e}")
    
    # Try without level parameter (all available)
    print("  Testing without level parameter...", end=" ")
    del parameters['levels']
    
    try:
        r = requests.get(endpoint, parameters, auth=(client_id, ''), timeout=10)
        if r.status_code == 200:
            json_data = r.json()
            if 'data' in json_data and json_data['data']:
                print("✓ AVAILABLE - Using all available levels")
                return (None, None, 'wind (all levels)')
        print("✗ Not available")
    except Exception as e:
        print(f"✗ Error: {e}")
    
    # If all failed, default to no level parameter
    print("  WARNING: No wind data found in test, but will try for full download")
    return (None, None, 'wind (assumed available)')

def fetch_weather_data(station_id='SN38140', date_range='10', client_id=DEFAULT_CLIENT_ID):
    """
    Fetch weather data from Norwegian Meteorological Institute
    Uses sensor level testing to determine optimal wind measurement
    """
    
    endpoint = 'https://frost.met.no/observations/v0.jsonld'
    
    # Parse date range
    start_date, end_date = parse_date_range(date_range)
    
    station_name = get_station_name(station_id)
    print(f"\nFetching weather data from {station_name} ({station_id})")
    print(f"Period: {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}")
    print("=" * 70)
    
    # Test which wind sensor level to use
    level_param, level_m, level_desc = test_wind_sensor_level(
        station_id, start_date, client_id
    )
    
    # Build element list
    elements = [
        'air_temperature',
        'wind_speed',
        'wind_from_direction',
        'relative_humidity',
        'surface_downwelling_shortwave_flux_in_air'
    ]
    
    elements_query = ','.join(elements)
    
    print(f"\nQuery configuration:")
    print(f"  Wind element: wind_speed")
    print(f"  Wind level: {level_param if level_param else 'all available'} ({level_desc})")
    print(f"  Full query: {elements_query}")
    print("=" * 70)
    
    # Create metadata
    metadata = {
        'station_id': station_id,
        'station_name': station_name,
        'start_date': start_date.strftime('%Y-%m-%d'),
        'end_date': end_date.strftime('%Y-%m-%d'),
        'wind_element': 'wind_speed',
        'wind_level_param': level_param,
        'wind_level_m': level_m,
        'wind_description': level_desc
    }
    
    all_data = []
    current_date = start_date
    
    print("\nDownloading data:")
    print("-" * 70)
    
    while current_date < end_date:
        # Fetch one month at a time
        month_end = current_date + timedelta(days=30)
        if month_end > end_date:
            month_end = end_date
        
        parameters = {
            'sources': station_id,
            'elements': elements_query,
            'referencetime': f'{current_date.strftime("%Y-%m-%d")}/{month_end.strftime("%Y-%m-%d")}',
            'timeresolutions': 'PT1H'
        }
        
        # Add level parameter if specified
        if level_param:
            parameters['levels'] = level_param
        
        print(f"  {current_date.strftime('%Y-%m-%d')} to {month_end.strftime('%Y-%m-%d')}...", end=" ")
        
        try:
            r = requests.get(endpoint, parameters, auth=(client_id, ''), timeout=30)
            
            if r.status_code == 200:
                json_data = r.json()
                if 'data' in json_data and json_data['data']:
                    all_data.extend(json_data['data'])
                    print(f"✓ {len(json_data['data'])} obs")
                else:
                    print("No data")
            elif r.status_code == 401 or r.status_code == 403:
                print(f"ERROR - Authentication failed")
                break
            elif r.status_code == 404:
                print(f"ERROR - Station not found")
                break
            else:
                print(f"ERROR {r.status_code}")
                
        except requests.exceptions.RequestException as e:
            print(f"Network error: {e}")
            
        current_date = month_end
        time.sleep(0.3)
    
    return all_data, metadata

def data_to_csv(all_data, metadata, station_id, date_range):
    """Convert API data to CSV with metadata header"""
    
    if not all_data:
        print("\nNo data to convert!")
        return None
    
    print("\n" + "=" * 70)
    print("Processing downloaded data...")
    print("-" * 70)
    
    rows = []
    for item in all_data:
        time_str = item['referenceTime']
        
        temp = None
        wind_speed = None
        wind_direction = None
        humidity = None
        solar_radiation = None
        
        for obs in item['observations']:
            element_id = obs['elementId']
            value = obs['value']
            
            if element_id == 'air_temperature':
                temp = value
            elif element_id == 'wind_speed':
                wind_speed = value
            elif element_id == 'wind_from_direction':
                wind_direction = value
            elif element_id == 'relative_humidity':
                humidity = value
            elif element_id == 'surface_downwelling_shortwave_flux_in_air':
                solar_radiation = value
        
        rows.append({
            'time': time_str,
            'temperature': temp,
            'wind_speed': wind_speed,
            'wind_direction': wind_direction,
            'humidity': humidity,
            'solar_radiation': solar_radiation
        })
    
    df = pd.DataFrame(rows)
    df['time'] = pd.to_datetime(df['time'])
    df = df.sort_values('time')
    df = df.drop_duplicates(subset=['time'])
    
    start_date, end_date = parse_date_range(date_range)
    filename = generate_filename(station_id, date_range, start_date, end_date)
    
    # Create metadata header
    header_parts = [
        f"Station: {metadata['station_name']} ({metadata['station_id']})",
        f"Period: {metadata['start_date']} to {metadata['end_date']}",
        f"Wind: {metadata['wind_description']}"
    ]
    metadata_line = "# " + " | ".join(header_parts)
    
    # Save CSV
    with open(filename, 'w') as f:
        f.write(metadata_line + '\n')
        df.to_csv(f, index=False)
    
    print(f"\n✓ Data saved to: {filename}")
    print(f"  Total observations: {len(df)} hours")
    print(f"  Period: {df['time'].min()} to {df['time'].max()}")
    print(f"  Metadata: {metadata_line}")
    
    return df

def show_statistics(df):
    """Show basic weather statistics"""
    
    if df is None or df.empty:
        return
    
    print(f"\n" + "="*70)
    print("WEATHER STATISTICS:")
    print("="*70)
    
    if 'temperature' in df.columns and df['temperature'].notna().any():
        print(f"🌡️  TEMPERATURE:")
        print(f"   Average: {df['temperature'].mean():.1f}°C")
        print(f"   Min/Max: {df['temperature'].min():.1f}°C / {df['temperature'].max():.1f}°C")
        print(f"   Std dev: {df['temperature'].std():.1f}°C")
    
    if 'wind_speed' in df.columns and df['wind_speed'].notna().any():
        print(f"\n💨 WIND SPEED:")
        print(f"   Average: {df['wind_speed'].mean():.2f} m/s")
        print(f"   Max: {df['wind_speed'].max():.1f} m/s")
        print(f"   Std dev: {df['wind_speed'].std():.2f} m/s")
    
    if 'wind_direction' in df.columns and df['wind_direction'].notna().any():
        print(f"\n🧭 WIND DIRECTION:")
        print(f"   Average: {df['wind_direction'].mean():.0f}° (from north)")
        print(f"   Data coverage: {df['wind_direction'].notna().sum()}/{len(df)} hours")
    
    if 'humidity' in df.columns and df['humidity'].notna().any():
        print(f"\n💧 HUMIDITY:")
        print(f"   Average: {df['humidity'].mean():.1f}%")
        print(f"   Min/Max: {df['humidity'].min():.1f}% / {df['humidity'].max():.1f}%")
    
    if 'solar_radiation' in df.columns and df['solar_radiation'].notna().any():
        print(f"\n☀️ SOLAR RADIATION:")
        print(f"   Average: {df['solar_radiation'].mean():.1f} W/m²")
        print(f"   Max: {df['solar_radiation'].max():.1f} W/m²")
        total_kwh = df['solar_radiation'].sum() / 1000
        print(f"   Total energy: {total_kwh:.0f} kWh/m² (period)")
    
    print(f"\n📊 DATA QUALITY:")
    for col in ['temperature', 'wind_speed', 'wind_direction', 'humidity', 'solar_radiation']:
        if col in df.columns:
            missing = df[col].isna().sum()
            percent = (missing / len(df)) * 100
            print(f"   {col:20} {missing:5}/{len(df)} missing ({percent:4.1f}%)")

def list_stations():
    """List known stations"""
    print("\nKnown weather stations:")
    print("-" * 40)
    for name, station_id in KNOWN_STATIONS.items():
        print(f"  {name:12} : {station_id}")
    print("\nYou can also use station ID directly (e.g., SN12345)")

def main():
    parser = argparse.ArgumentParser(
        description='Weather data downloader v3.6.0 - Sensor level support',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python %(prog)s --station landvik --date 5
  python %(prog)s --station oslo --date 2024
  python %(prog)s --station 18700 --date 2015-2024
  python %(prog)s --list-stations

Wind Selection (NEW in v3.6.0):
  Tests wind_speed element at different sensor levels:
    1. level=2 (2m height) - Preferred for pool simulations
    2. level=10 (10m height) - Standard meteorological height
    3. level=default - Station's standard level
    4. No level parameter - All available levels
  Selection is automatic and documented in CSV header.

Output:
  WD_StationName_SNxxxxx_DateRange.csv
  First line: # Station | Period | Wind: 2m/10m/default
        """
    )
    
    parser.add_argument('--station', '-s', default='landvik',
                       help='Station name or ID (default: landvik)')
    parser.add_argument('--date', '-d', default='10',
                       help='Period: "10"=10y back, "2024"=year, "2015-2024"=range')
    parser.add_argument('--client-id', '-c', default=DEFAULT_CLIENT_ID,
                       help='Frost API client ID')
    parser.add_argument('--list-stations', '-l', action='store_true',
                       help='List known stations')
    
    args = parser.parse_args()
    
    if args.list_stations:
        list_stations()
        return
    
    # Parse station ID
    if args.station.lower() in KNOWN_STATIONS:
        station_id = KNOWN_STATIONS[args.station.lower()]
        print(f"Using station '{args.station}' -> {station_id}")
    elif args.station.isdigit():
        station_id = f"SN{args.station}"
        print(f"Using station: {station_id}")
    elif args.station.upper().startswith('SN'):
        station_id = args.station.upper()
        print(f"Using station: {station_id}")
    else:
        station_id = args.station
        print(f"Using station ID: {station_id}")
    
    print("\n" + "="*70)
    print("WEATHER DATA DOWNLOADER v3.6.0")
    print("Sensor level support (2m → 10m → default → all)")
    print("="*70)
    
    # Fetch data
    data, metadata = fetch_weather_data(station_id, args.date, args.client_id)
    
    if not data:
        print("\n✗ No data fetched. Check station ID and connection.")
        return
    
    # Convert to CSV
    df = data_to_csv(data, metadata, station_id, args.date)
    
    # Show statistics
    show_statistics(df)
    
    print("\n" + "="*70)
    print("✓ DOWNLOAD COMPLETE")
    print("="*70)

if __name__ == "__main__":
    main()
