#!/usr/bin/env python3
"""
COLD WEEK ANALYZER V3.6.0.1
Analyzes predictive control performance during coldest/highest demand weeks
Finds 7-day periods with highest heat demand with 2-day context (11-day view)
Features properly aligned dual y-axis for temperature and wind speed
V3.6.0.1: Updated for multi-period schedules, enhanced period visualization
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.ticker import FixedLocator
from datetime import datetime, timedelta
import os
import sys

def find_highest_demand_weeks(df, scenario_name=""):
    """Find highest heat demand 7-day consecutive period per year with 2-day context
    
    Handles year boundaries properly - if the highest demand week is at the beginning
    of the year (e.g., Jan 1-7), it will pull context days from the previous year's data.
    """
    highest_weeks = {}
    
    for year in df['timestamp'].dt.year.unique():
        year_df = df[df['timestamp'].dt.year == year].copy()
        year_df = year_df.reset_index(drop=True)
        
        window = 168  # 7 days
        if len(year_df) < window:
            continue
            
        # Rolling 7-day average HEAT DEMAND (not temperature)
        year_df['demand_7day_avg'] = year_df['total_loss'].rolling(window=window, center=False).mean()
        
        # Find HIGHEST demand period
        highest_idx = year_df['demand_7day_avg'].idxmax()
        
        # Core 7-day period
        core_start = max(0, highest_idx - window + 1)
        core_end = min(len(year_df), core_start + window)
        
        # Add 2 days (48h) context on each side
        context_before = 48
        context_after = 48
        
        # For context, we need to look in the full dataframe, not just year_df
        # Get the actual timestamp range
        core_start_timestamp = year_df.iloc[core_start]['timestamp']
        core_end_timestamp = year_df.iloc[core_end - 1]['timestamp']
        
        # Find these timestamps in the full dataframe
        full_core_start_idx = df[df['timestamp'] == core_start_timestamp].index[0]
        full_core_end_idx = df[df['timestamp'] == core_end_timestamp].index[0] + 1
        
        # Now get extended range with context from full dataframe
        extended_start = max(0, full_core_start_idx - context_before)
        extended_end = min(len(df), full_core_end_idx + context_after)
        
        # Get full dataset with context (may cross year boundaries)
        week_data = df.iloc[extended_start:extended_end].copy()
        week_data = week_data.reset_index(drop=True)
        
        # Find where core period starts/ends in the extended data
        core_start_in_extended = week_data[week_data['timestamp'] == core_start_timestamp].index[0]
        core_end_in_extended = week_data[week_data['timestamp'] == core_end_timestamp].index[0] + 1
        
        if len(week_data) >= 24:  # At least 1 day
            core_data = week_data.iloc[core_start_in_extended:core_end_in_extended]
            
            highest_weeks[year] = {
                'week': week_data['timestamp'].min().isocalendar().week,
                'avg_loss': core_data['net_demand'].mean(),  # Changed from total_loss to net_demand
                'max_loss': core_data['net_demand'].max(),   # Changed from total_loss to net_demand
                'avg_temp': core_data['temperature'].mean(),
                'min_temp': core_data['temperature'].min(),
                'start_date': week_data['timestamp'].min(),
                'end_date': week_data['timestamp'].max(),
                'core_start_date': core_data['timestamp'].min(),
                'core_end_date': core_data['timestamp'].max(),
                'hours': len(core_data),
                'total_hours': len(week_data),
                'core_start_idx': core_start_in_extended,
                'core_end_idx': core_end_in_extended,
                'data': week_data
            }
    
    return highest_weeks

def plot_high_demand_week_v356(week_data, year, week_info, scenario_name):
    """Visualize 11-day period with V3.6.0 predictive control details"""
    fig, axes = plt.subplots(4, 1, figsize=(18, 14), sharex=True)
    
    hours = range(len(week_data))
    core_start = week_info['core_start_idx']
    core_end = week_info['core_end_idx']
    
    # 1. WATER TEMPERATURE
    ax1 = axes[0]
    ax1.plot(hours, week_data['water_temp'], 'b-', label='Water temp', linewidth=2.5)
    ax1.axhline(y=28, color='g', linestyle='--', alpha=0.7, label='Target', linewidth=2)
    ax1.axhline(y=27, color='orange', linestyle=':', alpha=0.5, label='Min acceptable', linewidth=1.5)
    ax1.axhline(y=26, color='r', linestyle=':', alpha=0.5, label='Critical', linewidth=1.5)
    ax1.axhline(y=30, color='purple', linestyle=':', alpha=0.5, label='Preheat max', linewidth=1.5)
    
    ax1.fill_between(hours, 26, 27, alpha=0.2, color='orange')
    ax1.fill_between(hours, 25, 26, alpha=0.3, color='red')
    ax1.fill_between(hours, 28, 30, alpha=0.1, color='purple')
    
    ax1.axvspan(core_start, core_end, alpha=0.1, color='yellow', label='Core 7 days')
    
    ax1.set_ylabel('Water Temperature (°C)', fontsize=12, fontweight='bold')
    ax1.set_ylim(25.5, 30.5)
    ax1.legend(loc='upper right', ncol=6, fontsize=14, framealpha=0.5)  # Added 50% transparency
    ax1.grid(True, alpha=0.3)
    ax1.set_title(f'{scenario_name} - Year {year} - 11-Day View (2d + 7d core + 2d) - Highest Heat Demand Period', 
                 fontsize=13, fontweight='bold')
    
    for i in range(len(week_data)):
        if week_data.iloc[i]['covered']:
            ax1.axvspan(i, i+1, alpha=0.1, color='blue')
    
    for i in range(len(week_data)):
        if week_data.iloc[i].get('preheat', False):
            ax1.axvspan(i, i+1, alpha=0.15, color='purple')
    
    min_temp = week_data['water_temp'].min()
    max_temp = week_data['water_temp'].max()
    ax1.text(0.02, 0.95, f'Min: {min_temp:.2f}°C\nMax: {max_temp:.2f}°C', 
             transform=ax1.transAxes, 
             bbox=dict(boxstyle='round', facecolor='white', alpha=0.8))
    
    # 2. WEATHER CONDITIONS (Temperature + Wind combined) - FIXED ALIGNMENT
    ax2 = axes[1]
    ax2_wind = ax2.twinx()
    
    # PROPER ALIGNMENT METHOD:
    # Plot everything on temperature axis first
    ax2.plot(hours, week_data['temperature'], 'b-', label='Outdoor temp', linewidth=2)
    ax2.axhline(y=0, color='b', linestyle=':', alpha=0.3)
    ax2.axvline(x=core_start, color='gray', linestyle=':', alpha=0.5)
    ax2.axvline(x=core_end, color='gray', linestyle=':', alpha=0.5)
    ax2.set_ylabel('Temperature (°C)', fontsize=12, fontweight='bold', color='blue')
    ax2.tick_params(axis='y', labelcolor='blue')
    ax2.legend(loc='upper left', fontsize=14, framealpha=0.5)  # Added 50% transparency
    ax2.set_title(f'Weather - Core 7d: Avg {week_info["avg_temp"]:.1f}°C, Min {week_info["min_temp"]:.1f}°C')
    ax2.grid(True, alpha=0.3)
    
    # Plot wind data
    wind_factor = 0.535  # From config  
    ax2_wind.plot(hours, week_data['wind_speed'], 'c-', label='Wind speed', linewidth=1.5, alpha=0.7)
    ax2_wind.plot(hours, week_data['wind_speed'] * wind_factor, 'c--', label=f'Effective ({wind_factor*100:.0f}%)', linewidth=1.5, alpha=0.7)
    
    # Force a full render to get actual ticks
    plt.tight_layout()
    fig.canvas.draw()
    
    # Now get the ACTUAL rendered ticks
    temp_ticks = ax2.get_yticks()
    temp_ylim = ax2.get_ylim()
    
    # Filter to only visible ticks
    visible_temp_ticks = [t for t in temp_ticks if temp_ylim[0] <= t <= temp_ylim[1]]
    
    # 4. Calculate wind data range
    wind_data = week_data['wind_speed']
    wind_min_data = wind_data.min()
    wind_max_data = wind_data.max()
    
    # Add some padding to the data range
    wind_range = wind_max_data - wind_min_data
    if wind_range < 0.1:
        wind_range = 1.0
    
    # 5. Create nice wind tick values
    num_ticks = len(visible_temp_ticks)
    
    # Calculate ideal range and step
    if wind_min_data > 0.5:
        wind_tick_start = 0.0  # Always start from 0 for clarity
    else:
        wind_tick_start = 0.0
    
    # Need to cover from 0 to max wind
    ideal_range = wind_max_data - wind_tick_start
    ideal_step = ideal_range / (num_ticks - 1)
    
    # Round step to nice value - use smaller increments for better precision
    if ideal_step < 0.15:
        step = 0.1
    elif ideal_step < 0.25:
        step = 0.2
    elif ideal_step < 0.35:
        step = 0.25
    elif ideal_step < 0.45:
        step = 0.4
    elif ideal_step < 0.55:
        step = 0.5
    elif ideal_step < 0.65:
        step = 0.6
    elif ideal_step < 0.85:
        step = 0.75
    elif ideal_step < 0.9:
        step = 0.8
    elif ideal_step < 1.1:
        step = 1.0
    elif ideal_step < 1.3:
        step = 1.2
    elif ideal_step < 1.6:
        step = 1.5
    elif ideal_step < 1.8:
        step = 1.75
    elif ideal_step < 2.2:
        step = 2.0
    elif ideal_step < 2.7:
        step = 2.5
    elif ideal_step < 3.5:
        step = 3.0
    elif ideal_step < 4.5:
        step = 4.0
    elif ideal_step < 5.5:
        step = 5.0
    else:
        step = 10.0
    
    # Generate wind ticks starting from 0
    wind_ticks = [wind_tick_start + i * step for i in range(num_ticks)]
    
    # Ensure we cover the max wind speed
    while wind_ticks[-1] < wind_max_data:
        # Increase step size
        step = step * 1.2
        wind_ticks = [wind_tick_start + i * step for i in range(num_ticks)]
    
    # 6. Calculate relative positions of temperature ticks in their axis
    temp_range = temp_ylim[1] - temp_ylim[0]
    temp_positions = [(t - temp_ylim[0]) / temp_range for t in visible_temp_ticks]
    
    # 7. Calculate wind axis limits so wind ticks appear at same relative positions
    # We need: (wind_tick[i] - wind_ylim[0]) / (wind_ylim[1] - wind_ylim[0]) = temp_positions[i]
    
    # Using first and last tick positions to determine the wind axis limits
    if len(temp_positions) > 1:
        # Two equations:
        # wind_ticks[0] = wind_ylim[0] + temp_positions[0] * (wind_ylim[1] - wind_ylim[0])
        # wind_ticks[-1] = wind_ylim[0] + temp_positions[-1] * (wind_ylim[1] - wind_ylim[0])
        
        # Solving for wind_ylim:
        p0 = temp_positions[0]
        p1 = temp_positions[-1]
        w0 = wind_ticks[0]
        w1 = wind_ticks[-1]
        
        if p1 != p0:  # Should always be true if we have multiple ticks
            wind_ylim_range = (w1 - w0) / (p1 - p0)
            wind_ylim_0 = w0 - p0 * wind_ylim_range
            wind_ylim_1 = wind_ylim_0 + wind_ylim_range
        else:
            # Shouldn't happen, but handle gracefully
            margin = abs(wind_ticks[-1] - wind_ticks[0]) * 0.1 + 1
            wind_ylim_0 = min(wind_ticks) - margin
            wind_ylim_1 = max(wind_ticks) + margin
    else:
        # Single tick - center it
        margin = 2
        wind_ylim_0 = wind_ticks[0] - margin
        wind_ylim_1 = wind_ticks[0] + margin
    
    # 8. Apply the calculated limits and ticks
    ax2_wind.set_ylim(wind_ylim_0, wind_ylim_1)
    ax2_wind.set_yticks(wind_ticks)
    
    # Format tick labels with appropriate precision
    # Check if step requires 2 decimals (has .25, .75 component)
    step_fraction = step - int(step)
    needs_two_decimals = abs(step_fraction - 0.25) < 0.01 or abs(step_fraction - 0.75) < 0.01
    
    if needs_two_decimals:
        wind_labels = [f'{v:.2f}' for v in wind_ticks]
    else:
        wind_labels = [f'{v:.1f}' for v in wind_ticks]
    ax2_wind.set_yticklabels(wind_labels)
    
    # Force matplotlib to show all ticks
    ax2_wind.yaxis.set_major_locator(FixedLocator(wind_ticks))
    
    ax2_wind.set_ylabel('Wind Speed (m/s)', fontsize=12, fontweight='bold', color='cyan')
    ax2_wind.tick_params(axis='y', labelcolor='cyan')
    ax2_wind.legend(loc='upper right', fontsize=14, framealpha=0.5)  # Added 50% transparency
    
    # 3. PRODUCTION
    ax3 = axes[2]
    
    ax3.fill_between(hours, 0, week_data['Q_hp'], 
                    label=f'HP ({week_data["Q_hp"].mean():.0f} kW avg)', 
                    color='green', alpha=0.6)
    ax3.fill_between(hours, week_data['Q_hp'], week_data['Q_hp'] + week_data['Q_boiler'], 
                    label=f'Boiler ({week_data["Q_boiler"].mean():.0f} kW avg)', 
                    color='red', alpha=0.6)
    
    # Show actual heat loss from pool (not control demand which includes preheating)
    # total_loss = surface losses + structural losses, net_demand includes new water
    ax3.plot(hours, week_data['net_demand'], 'k-', label='Heat loss', linewidth=2, alpha=0.8)
    
    ax3.axvline(x=core_start, color='gray', linestyle=':', alpha=0.5)
    ax3.axvline(x=core_end, color='gray', linestyle=':', alpha=0.5)
    ax3.set_ylabel('Production (kW)', fontsize=12, fontweight='bold')
    ax3.legend(loc='upper right', fontsize=14, framealpha=0.5)  # Added 50% transparency
    ax3.grid(True, alpha=0.3)
    ax3.set_title(f'Energy Production - Core 7d: Avg loss {week_info["avg_loss"]:.0f} kW, Max {week_info["max_loss"]:.0f} kW')
    
    # 4. ELECTRICITY (without COP line)
    ax4 = axes[3]
    
    ax4.fill_between(hours, 0, week_data['hp_electric'], 
                    label='HP electric', color='lightgreen', alpha=0.5)
    ax4.fill_between(hours, week_data['hp_electric'], week_data['total_electric'], 
                    label='Boiler', color='salmon', alpha=0.5)
    ax4.axvline(x=core_start, color='gray', linestyle=':', alpha=0.5)
    ax4.axvline(x=core_end, color='gray', linestyle=':', alpha=0.5)
    ax4.set_ylabel('Electricity (kW)', fontsize=12, fontweight='bold')
    ax4.set_xlabel('Hours from start', fontsize=13, fontweight='bold')
    ax4.legend(loc='upper left', fontsize=14, framealpha=0.5)  # Added 50% transparency
    ax4.grid(True, alpha=0.3)
    
    # Add COP text box
    ax4.text(0.98, 0.95, 'Heat Pump COP = 4.6', 
             transform=ax4.transAxes,
             bbox=dict(boxstyle='round', facecolor='lightblue', alpha=0.8),
             fontsize=11, fontweight='bold',
             verticalalignment='top', horizontalalignment='right')
    
    tick_interval = 24
    ax4.set_xticks(range(0, len(hours), tick_interval))
    day_labels = []
    for i in range(0, len(hours), tick_interval):
        if i < len(week_data):
            ts = week_data.iloc[i]['timestamp']
            if i == core_start:
                day_labels.append(f"▼ {ts.strftime('%a %d.%m')}")
            elif i == core_end:
                day_labels.append(f"▲ {ts.strftime('%a %d.%m')}")
            else:
                day_labels.append(ts.strftime('%a %d.%m'))
    ax4.set_xticklabels(day_labels, fontsize=11, fontweight='bold')
    
    plt.tight_layout()
    return fig

def analyze_scenario(csv_file, scenario_name, aggregate_hours=None):
    """Analyze a single scenario
    
    Args:
        csv_file: Path to hourly CSV
        scenario_name: Scenario identifier
        aggregate_hours: If set, aggregate to N-hourly data before analysis (e.g., 3 for 3-hourly)
    """
    print(f"\n{'='*70}")
    print(f"ANALYZING: {scenario_name}")
    if aggregate_hours:
        print(f"Data aggregated to {aggregate_hours}-hourly")
    print(f"{'='*70}")
    
    if not os.path.exists(csv_file):
        print(f"ERROR: File not found: {csv_file}")
        return None
    
    df = pd.read_csv(csv_file)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    
    # Convert boolean columns (stored as strings in CSV)
    if 'covered' in df.columns:
        df['covered'] = df['covered'].map({'True': True, 'False': False, True: True, False: False})
    if 'pool_open' in df.columns:
        df['pool_open'] = df['pool_open'].map({'True': True, 'False': False, True: True, False: False})
    if 'preheat' in df.columns:
        df['preheat'] = df['preheat'].map({'True': True, 'False': False, True: True, False: False})
    
    # Optional: Aggregate to reduce data volume
    if aggregate_hours and aggregate_hours > 1:
        print(f"  Aggregating from hourly to {aggregate_hours}-hourly...")
        df = df.set_index('timestamp').resample(f'{aggregate_hours}H').agg({
            'water_temp': 'mean',
            'temperature': 'mean',
            'wind_speed': 'mean',
            'Q_hp': 'mean',
            'Q_boiler': 'mean',
            'Q_needed': 'sum',
            'Q_delivered': 'sum',
            'Q_unmet': 'sum',
            'hp_electric': 'sum',
            'total_electric': 'sum',
            'total_loss': 'mean',
            'covered': 'any',
            'preheat': 'any'
        }).reset_index()
        print(f"  Original: {len(pd.read_csv(csv_file))} rows → Aggregated: {len(df)} rows ({len(df)/len(pd.read_csv(csv_file))*100:.1f}%)")
    
    # Find highest demand weeks
    highest_weeks = find_highest_demand_weeks(df, scenario_name)
    
    print(f"\nHighest heat demand 7-day period per year:")
    print("-"*70)
    year_summary = []
    for year in sorted(highest_weeks.keys()):
        info = highest_weeks[year]
        start = info['start_date'].strftime('%Y-%m-%d')
        end = info['end_date'].strftime('%m-%d')
        core_start = info['core_start_date'].strftime('%m-%d')
        core_end = info['core_end_date'].strftime('%m-%d')
        print(f"{year}: {start} to {end} ({info['total_hours']:3d}h total)")
        print(f"      Core: {core_start} to {core_end} ({info['hours']:3d}h) - Avg loss: {info['avg_loss']:5.0f} kW, Max: {info['max_loss']:5.0f} kW")
        print(f"      Weather: Avg {info['avg_temp']:5.1f}°C, Min {info['min_temp']:5.1f}°C")
        year_summary.append((year, info['avg_loss'], info['max_loss']))
    
    # Find three highest demand years
    year_summary.sort(key=lambda x: x[1], reverse=True)
    three_highest = [y[0] for y in year_summary[:3]]
    
    print(f"\nThree highest demand years: {', '.join(map(str, three_highest))}")
    print("="*70)
    
    # Generate plots
    summary_data = []
    
    for year in three_highest:
        print(f"\nGenerating 11-day visualization for year {year}...")
        week_info = highest_weeks[year]
        week_data = week_info['data']
        
        fig = plot_high_demand_week_v356(week_data, year, week_info, scenario_name)
        
        scenario_suffix = scenario_name.replace(' ', '_').replace('-', '_').upper()
        output_file = f'/mnt/user-data/outputs/peak_demand_week_{year}_{scenario_suffix}.png'
        plt.savefig(output_file, dpi=150, bbox_inches='tight')
        plt.close()
        print(f"  ✔ Saved: {output_file}")
        
        # Core period statistics
        core_data = week_data.iloc[week_info['core_start_idx']:week_info['core_end_idx']]
        preheat_hours = core_data['preheat'].sum() if 'preheat' in core_data.columns else 0
        
        summary_data.append({
            'Year': year,
            'Start': week_info['core_start_date'].strftime('%m-%d'),
            'Hours': week_info['hours'],
            'Avg loss': f"{week_info['avg_loss']:.0f} kW",
            'Max loss': f"{week_info['max_loss']:.0f} kW",
            'Avg °C': f"{week_info['avg_temp']:.1f}",
            'Min °C': f"{week_info['min_temp']:.1f}",
            'Electricity': f"{core_data['total_electric'].sum():.0f} kWh",
            'HP %': f"{(core_data['Q_hp'].sum() / core_data['Q_delivered'].sum() * 100):.0f}%" if core_data['Q_delivered'].sum() > 0 else "N/A",
            'Min water': f"{core_data['water_temp'].min():.2f}°C",
            'Hours <27°C': (core_data['water_temp'] < 27).sum(),
            'Preheat hrs': preheat_hours,
            'Unmet': f"{core_data['Q_unmet'].sum():.0f} kWh"
        })
    
    # Print summary
    print("\n" + "="*70)
    print(f"SUMMARY - HIGHEST DEMAND 7-DAY PERIODS (CORE) - {scenario_name}")
    print("="*70)
    summary_df = pd.DataFrame(summary_data)
    print(summary_df.to_string(index=False))
    
    return summary_data

# Main program
if __name__ == "__main__":
    import json
    import argparse
    
    print("="*70)
    print("COLD WEEK ANALYZER V3.6.0.1")
    print("Highest Heat Demand Period Analysis")
    print("100kW HP + 200kW Boiler")
    print("="*70)
    
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Analyze cold week performance')
    parser.add_argument('--config', type=str, help='Config file to read output tags from')
    parser.add_argument('--file', type=str, action='append', help='CSV file to analyze (can specify multiple)')
    parser.add_argument('--name', type=str, action='append', help='Scenario name for each file (must match --file count)')
    args = parser.parse_args()
    
    scenarios = []
    
    # Method 1: Use explicit file/name pairs from command line
    if args.file:
        if args.name and len(args.name) != len(args.file):
            print("ERROR: Number of --name arguments must match number of --file arguments")
            sys.exit(1)
        
        for i, csv_file in enumerate(args.file):
            name = args.name[i] if args.name else f"Scenario {i+1}"
            scenarios.append((name, csv_file))
    
    # Method 2: Read from config file
    elif args.config:
        if not os.path.exists(args.config):
            print(f"ERROR: Config file not found: {args.config}")
            sys.exit(1)
        
        with open(args.config, 'r') as f:
            config = json.load(f)
        
        # Construct filename from config
        output_dir = config['paths']['outputs']['dir']
        prefix = config['paths']['outputs']['prefix']
        tag = config['paths']['outputs'].get('tag', '')
        
        # Build filename pattern
        if tag:
            csv_file = f"{output_dir}/{prefix}_Hourly_v3_6_0_{tag}.csv"
        else:
            csv_file = f"{output_dir}/{prefix}_Hourly_v3_6_0.csv"
        
        # Determine scenario name from config
        schedule_mode = config['operation'].get('schedule_mode', 'simple')
        control_mode = config['control'].get('mode', 'predictive')
        
        if schedule_mode == 'advanced':
            name = f"Multi-Period {control_mode.capitalize()}"
        else:
            name = f"Single-Period {control_mode.capitalize()}"
        
        scenarios.append((name, csv_file))
        print(f"Using config: {args.config}")
        print(f"  File: {csv_file}")
        print(f"  Name: {name}")
    
    # Method 3: Default (legacy behavior)
    else:
        print("No --config or --file specified, using default legacy filenames")
        scenarios = [
            ('Single-Period Predictive', '/mnt/user-data/outputs/AQ_Sim_Hourly_v3_6_0_2024_v360_predictive.csv'),
            ('Two-Period Predictive', '/mnt/user-data/outputs/AQ_Sim_Hourly_v3_6_0_2024_2per_predictive.csv'),
        ]
    
    all_summaries = {}
    
    for scenario_name, csv_file in scenarios:
        summary = analyze_scenario(csv_file, scenario_name)
        if summary:
            all_summaries[scenario_name] = summary
    
    print("\n" + "="*70)
    print("✔ ANALYSIS COMPLETE")
    print("="*70)
    print("\nGenerated visualization files in /mnt/user-data/outputs/")
    if all_summaries:
        print(f"Analyzed {len(all_summaries)} scenario(s)")
        print("Compare peak demand weeks to assess control strategy performance.")
