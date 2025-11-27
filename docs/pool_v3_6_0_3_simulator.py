#!/usr/bin/env python3
"""
POOL ENERGY SIMULATOR V3.6.0.3
V3.5.0: Inan & Atayilmaz (2022) evaporation
V3.5.1: + Solar energy absorption
V3.5.2: + WIND_REDUCTION parameter
V3.5.3: + Hourly solar data from separate file
V3.5.4: + Bowen-ratio convection (replaces VDI 2089 h_conv formula)
V3.5.5: + Config file support, activity factor, configurable solar absorptance, DHW load
V3.5.6.0: + U-value based cover model (replaces reduction factors)
V3.5.6.1: + New water heating structure (pool_refill + shower with physics-based inputs)
V3.5.6.2: + Shower COP 4.5, Open/Closed output format
V3.5.6.3: + Path system (mode/base_dirs), AQ_Sim naming, VERSION constant
V3.5.6.4: + wind_reduction → wind_factor, better display names, shower in Open column
V3.5.6.5: + Fixed predictive control (maintain mode, iterations), auto gzip compression
V3.6.0.0: + ScheduleManager with flexible multi-period scheduling (100% backward compatible)
V3.6.0.1: + Multi-period predictive control - plans next period at each transition
V3.6.0.2: + Transition-based control - all periods handled identically, day/night → open/closed
V3.6.0.3: + Calendar programs with date ranges, priorities, recurring annual periods
"""

import pandas as pd
import numpy as np
import json
import os
import sys
from datetime import datetime, timedelta
from pool_scheduler_v3_6_0_3 import PoolScheduler

# Simulator version
VERSION = "3.6.0.3"
VERSION_SHORT = "3.6.0"  # For filenames

# Config file path (can be overridden by environment variable)
CONFIG_FILE = os.environ.get('CONFIG_FILE', 'config.json')

DEFAULT_CONFIG = {
    "paths": {
        "mode": "claude",
        "base_dirs": {
            "copilot": "/mnt/data",
            "claude": "/home/claude",
            "local": "."
        },
        "inputs": {
            "dir": "",  # relative to base_dir, empty = base_dir itself
            "weather": "WD_Landvik_SN37230_2015-2024.csv",
            "solar": "SOLAR_Landvik_2015-2024_NASA-POWER.csv",
            "ground": "ground_thermal_data_v3_1.csv",
            "tunnel": "tunnel_heat_transfer_lookup_v3_1.csv"
        },
        "outputs": {
            "dir": "/mnt/user-data/outputs",  # absolute path
            "prefix": "AQ_Sim",
            "include_version": True,
            "tag": None
        }
    },
    "pool": {
        "area_m2": 312.5,
        "volume_m3": 625,
        "target_temp": 28.0,
        "min_temp": 26.0,
        "max_temp": 29.0
    },
    "operation": {
        "opening_hours": {
            "start": 10,
            "end": 20
        },
        "closed_days": [],
        "activity_factor": 1.0,
        "cover": {
            "enabled": True,
            "u_value_w_m2_k": 5.0,
            "solar_transmittance": 0.10
        }
    },
    "new_water": {
        "enabled": True,
        "bathers_per_day": 200,
        "pool_refill": {
            "liters_per_bather": 30,
            "cold_water_temp": 5
        },
        "shower": {
            "liters_per_bather": 60,
            "target_temp": 40,
            "hot_water_temp": 70,
            "cold_water_temp": 5,
            "hp_max_temp": 35,
            "connected_to_pool_system": False
        }
    },
    "solar": {
        "absorptance": 0.60
    },
    "weather": {
        "wind_factor": 0.75
    },
    "heating_system": {
        "hp_capacity_kw": 200,
        "boiler_capacity_kw": 200,
        "hp_cop_nominal": 4.6
    },
    "control": {
        "mode": "predictive"
    },
    "economics": {
        "electricity_price_nok_kwh": 1.5
    }
}

def resolve_paths(config):
    """Resolve all file paths based on mode and config"""
    paths_config = config['paths']
    mode = paths_config.get('mode', 'claude')
    
    # Get base directory
    base_dirs = paths_config.get('base_dirs', {})
    base_dir = base_dirs.get(mode, '/home/claude')
    
    # Resolve input paths
    inputs = paths_config.get('inputs', {})
    input_dir = inputs.get('dir', '')
    
    if input_dir:
        full_input_dir = os.path.join(base_dir, input_dir)
    else:
        full_input_dir = base_dir
    
    resolved = {
        'weather_file': os.path.join(full_input_dir, inputs.get('weather', 'WD_Landvik_SN37230_2015-2024.csv')),
        'solar_file': os.path.join(full_input_dir, inputs.get('solar', 'SOLAR_Landvik_2015-2024_NASA-POWER.csv')),
        'ground_file': os.path.join(full_input_dir, inputs.get('ground', 'ground_thermal_data_v3_1.csv')),
        'tunnel_file': os.path.join(full_input_dir, inputs.get('tunnel', 'tunnel_heat_transfer_lookup_v3_1.csv'))
    }
    
    # Resolve schedule file if in advanced mode
    op = config.get('operation', {})
    if op.get('schedule_mode') == 'advanced' and 'schedule_file' in op:
        schedule_file = op['schedule_file']
        if not os.path.isabs(schedule_file):
            resolved['schedule_file'] = os.path.join(full_input_dir, schedule_file)
        else:
            resolved['schedule_file'] = schedule_file
    else:
        resolved['schedule_file'] = None
    
    # Output directory
    outputs = paths_config.get('outputs', {})
    output_dir = outputs.get('dir', '/mnt/user-data/outputs')
    
    # Handle absolute vs relative output paths
    if not os.path.isabs(output_dir):
        output_dir = os.path.join(base_dir, output_dir)
    
    resolved['output_dir'] = output_dir
    
    return resolved

def generate_output_filename(config, file_type='hourly'):
    """Generate output filename based on config
    
    Args:
        config: Configuration dict
        file_type: 'hourly' or 'stats'
    
    Returns:
        Full filename (without path)
    """
    outputs = config['paths'].get('outputs', {})
    prefix = outputs.get('prefix', 'AQ_Sim')
    include_version = outputs.get('include_version', True)
    tag = outputs.get('tag', None)
    
    # Build filename parts
    parts = [prefix]
    
    if file_type == 'hourly':
        parts.append('Hourly')
    elif file_type == 'stats':
        parts.append('Stats')
    
    if include_version:
        parts.append(f'v{VERSION_SHORT.replace(".", "_")}')
    
    if tag:
        # Clean tag: replace spaces/special chars with underscore
        clean_tag = tag.replace(' ', '_').replace('-', '_')
        parts.append(clean_tag)
    
    # Extension
    ext = '.csv' if file_type == 'hourly' else '.json'
    
    return '_'.join(parts) + ext

def load_config(config_file):
    """Load configuration from JSON file or use defaults"""
    if os.path.exists(config_file):
        print(f"✓ Loading config from {config_file}")
        with open(config_file, 'r') as f:
            config = json.load(f)
    else:
        print(f"⚠ Config file not found: {config_file}")
        print("✓ Using default configuration")
        config = DEFAULT_CONFIG.copy()
    
    # Backward compatibility: convert wind_reduction to wind_factor
    if 'weather' in config:
        if 'wind_reduction' in config['weather'] and 'wind_factor' not in config['weather']:
            print(f"✓ Converting wind_reduction ({config['weather']['wind_reduction']}) to wind_factor")
            config['weather']['wind_factor'] = config['weather'].pop('wind_reduction')
    
    # Resolve all paths based on mode
    resolved = resolve_paths(config)
    config['_resolved_paths'] = resolved
    
    return config

def check_files(config):
    """Check that data files exist"""
    missing = []
    paths = config['_resolved_paths']
    
    if not os.path.exists(paths['weather_file']):
        missing.append(f"Weather data: {paths['weather_file']}")
    if not os.path.exists(paths['solar_file']):
        missing.append(f"Solar data: {paths['solar_file']}")
    if not os.path.exists(paths['ground_file']):
        missing.append(f"Ground data: {paths['ground_file']}")
    if not os.path.exists(paths['tunnel_file']):
        missing.append(f"Tunnel data: {paths['tunnel_file']}")
    
    if missing:
        print("ERROR - Missing files:")
        for f in missing:
            print(f"  - {f}")
        sys.exit(1)

class PoolEnergySystemV56:
    """Version 3.6.0 with flexible scheduling via ScheduleManager"""
    
    def __init__(self, config):
        self.config = config
        check_files(config)
        
        # Initialize PoolScheduler
        schedule_file = config['_resolved_paths'].get('schedule_file')
        self.scheduler = PoolScheduler(config, schedule_file)
        
        self.load_thermal_data()
        self.load_solar_data()
        
        # Calculate thermal mass from volume
        mass_kg = config['pool']['volume_m3'] * 1000
        self.thermal_mass_rate = mass_kg * 4186 / 3600000  # kWh/K
        
        self.daily_plan = None
        self.day_plan = None
        
    def load_thermal_data(self):
        """Load ground and tunnel data from CSV files"""
        try:
            ground_file = self.config['_resolved_paths']['ground_file']
            ground_df = pd.read_csv(ground_file, comment='#')
            if 'year' in ground_df.columns:
                year3 = ground_df[ground_df['year'] == 3].iloc[0] if 3 in ground_df['year'].values else ground_df[ground_df['year'] == ground_df['year'].max()].iloc[0]
                self.ground_temps = {
                    'T_surface_pool': year3['T_surface_pool'],
                    'T_surface_tunnel': year3['T_surface_tunnel'],
                    'q_pool_W_m2': year3['q_pool_W/m2'],
                    'Q_tunnel_kW': year3['Q_tunnel_kW']
                }
            else:
                self.ground_temps = {'T_surface_pool': 25.4, 'T_surface_tunnel': 21.6, 
                                    'q_pool_W_m2': 1.51, 'Q_tunnel_kW': -0.25}
            
            tunnel_file = self.config['_resolved_paths']['tunnel_file']
            self.tunnel_df = pd.read_csv(tunnel_file, comment='#')
            
        except Exception as e:
            print(f"Warning: Could not load thermal data: {e}")
            self.ground_temps = {'T_surface_pool': 25.4, 'T_surface_tunnel': 21.6, 
                                'q_pool_W_m2': 1.51, 'Q_tunnel_kW': -0.25}
            self.tunnel_df = None
    
    def load_solar_data(self):
        """Load hourly solar radiation data from CSV file"""
        try:
            solar_file = self.config['_resolved_paths']['solar_file']
            solar_df = pd.read_csv(solar_file)
            solar_df['time'] = pd.to_datetime(solar_df['time'], utc=True)
            self.solar_data = solar_df.set_index('time')
            print(f"✓ Loaded solar data: {len(self.solar_data)} hours")
        except Exception as e:
            print(f"WARNING: Could not load solar data: {e}")
            self.solar_data = None
    
    def get_tunnel_temp(self, T_outdoor):
        """Use tunnel data from CSV if available"""
        if hasattr(self, 'tunnel_df') and self.tunnel_df is not None:
            temps = self.tunnel_df['T_outdoor_C'].values
            idx = np.argmin(np.abs(temps - T_outdoor))
            return self.tunnel_df.iloc[idx]['T_tunnel_with_C']
        else:
            return max(T_outdoor + 10.5, 2.0)
    
    def is_pool_open(self, timestamp):
        """Check if pool is open using ScheduleManager"""
        return self.scheduler.is_open(timestamp)
    
    def is_covered(self, timestamp):
        """Pool cover usage - cover is on when pool is closed"""
        if not self.config['operation']['cover']['enabled']:
            return False
        return not self.is_pool_open(timestamp)
    
    def calculate_cop(self, T_outdoor):
        """COP for ground-source heat pump"""
        return self.config['heating_system']['hp_cop_nominal']
    
    def calculate_evaporation(self, T_water, T_air, wind_speed, humidity, is_open):
        """Evaporation loss using Inan & Atayilmaz (2022) for outdoor pools
        
        Args:
            is_open: True if pool is open (apply activity factor)
        
        Returns: (Q_evap, P_water, P_air) tuple
        """
        # Saturation vapor pressure (Magnus formula) - in Pa
        P_water = 611.2 * np.exp(17.67 * T_water / (T_water + 243.5))
        P_air = 611.2 * np.exp(17.67 * T_air / (T_air + 243.5))
        
        # Effective wind speed with wind factor (exposure factor)
        wind_factor = self.config['weather'].get('wind_factor', 
                      self.config['weather'].get('wind_reduction', 0.75))  # backward compat
        v_eff = wind_speed * wind_factor
        
        # Vapor pressure difference in Pa
        delta_P = P_water - P_air * (humidity / 100)
        
        # Inan & Atayilmaz (2022): E = (0.28 + 0.784*v) * (Δp)^0.695 / L_v
        L_v = 2454000  # J/kg (latent heat of vaporization)
        
        # Evaporation rate per unit area [kg/(m²·s)]
        E_per_m2 = (0.28 + 0.784 * v_eff) * (delta_P ** 0.695) / L_v
        
        # Apply activity factor if pool is open
        if is_open:
            activity_factor = self.config['operation']['activity_factor']
            E_per_m2 *= activity_factor
        
        # Total evaporation rate [kg/s]
        E_total = E_per_m2 * self.config['pool']['area_m2']
        
        # Heat loss [kW]
        Q_evap = E_total * L_v / 1000
        
        # Return Q_evap and vapor pressures for Bowen ratio calculation
        P_air_actual = P_air * (humidity / 100)
        return Q_evap, P_water, P_air_actual
    
    def calculate_convection(self, T_water, T_air, Q_evap, P_water, P_air):
        """Convection loss using Bowen ratio method"""
        c_p = 1005  # J/(kg·K)
        p_atm = 101325  # Pa
        L_v = 2454000  # J/kg
        
        delta_T = T_water - T_air
        delta_P = P_water - P_air
        
        if abs(delta_P) < 1.0:
            delta_P = 1.0 if delta_P >= 0 else -1.0
        
        Bo = (c_p * p_atm) / (0.622 * L_v) * delta_T / delta_P
        Q_conv = Bo * Q_evap
        
        return max(0, Q_conv)
    
    def calculate_radiation(self, T_water, T_air):
        """Radiation loss"""
        sigma = 5.67e-8
        epsilon = 0.95
        T_w_K = T_water + 273.15
        T_sky_K = (T_air - 10) + 273.15
        Q_rad = sigma * epsilon * self.config['pool']['area_m2'] * (T_w_K**4 - T_sky_K**4) / 1000
        return max(0, Q_rad)
    
    def calculate_solar_gain(self, ghi):
        """Solar energy gain from GHI
        ghi: Global horizontal irradiance [W/m²]
        Returns: Q_solar [kW]
        """
        alpha = self.config['solar']['absorptance']
        Q_solar = ghi * alpha * self.config['pool']['area_m2'] / 1000
        return Q_solar
    
    def calculate_structural_losses(self, T_water, T_tunnel):
        """Structural heat losses"""
        losses = {}
        area = self.config['pool']['area_m2']
        
        # Floor losses
        q_pool = self.ground_temps['q_pool_W_m2']
        losses['floor'] = q_pool * area * (T_water - 5) / (28 - 5) / 1000
        
        # Wall losses (need wall area - assume from config or calculate)
        # For now, use simplified approach
        wall_area = 150  # m² - should be in config
        u_walls = 0.58  # W/(m²·K)
        losses['walls'] = u_walls * wall_area * (T_water - T_tunnel) / 1000
        
        return losses
    
    def calculate_new_water_load(self, timestamp, T_pool):
        """Calculate new water heating loads from physics-based inputs
        
        Returns: (Q_pool_refill, Q_shower_thermal, Q_shower_electric)
        - Q_pool_refill: Always added to pool heating demand [kW]
        - Q_shower_thermal: Thermal load if separate system [kW]
        - Q_shower_electric: Electric load if connected to pool system [kW]
        """
        nw_config = self.config.get('new_water', {})
        
        if not nw_config.get('enabled', False):
            return 0.0, 0.0, 0.0
        
        # Only load during opening hours
        if not self.is_pool_open(timestamp):
            return 0.0, 0.0, 0.0
        
        bathers_per_day = nw_config.get('bathers_per_day', 200)
        
        # Calculate total opening hours for the day
        date = timestamp.date()
        periods = self.scheduler.get_periods(date)
        hours_open = 0
        for period in periods:
            if period['from'] < period['to']:
                hours_open += period['to'] - period['from']
            else:
                # Overnight period
                hours_open += 24 - period['from'] + period['to']
        
        # POOL REFILL: Always through pool heating system
        refill_config = nw_config.get('pool_refill', {})
        liters_refill = refill_config.get('liters_per_bather', 30)
        T_cold = refill_config.get('cold_water_temp', 5)
        
        # Thermal energy per bather: m × c × ΔT
        # m = liters (kg), c = 4.186 kJ/(kg·K), result in kWh
        thermal_per_bather_refill = (liters_refill * 4.186 * (T_pool - T_cold)) / 3600
        
        # Average power over opening hours
        Q_pool_refill = (bathers_per_day * thermal_per_bather_refill) / hours_open
        
        # SHOWER WATER
        shower_config = nw_config.get('shower', {})
        liters_shower = shower_config.get('liters_per_bather', 60)
        T_shower_target = shower_config.get('target_temp', 40)
        T_hot = shower_config.get('hot_water_temp', 70)
        T_hp_max = shower_config.get('hp_max_temp', 35)
        connected = shower_config.get('connected_to_pool_system', False)
        
        # Mixing calculation: How much hot water at T_hot needed to mix with cold at T_cold to get T_target
        # m_hot × T_hot + m_cold × T_cold = total × T_target
        # m_hot + m_cold = total
        # Solving: m_hot = total × (T_target - T_cold) / (T_hot - T_cold)
        liters_hot = liters_shower * (T_shower_target - T_cold) / (T_hot - T_cold)
        
        if not connected:
            # Separate heating system: track thermal energy needed to heat hot water portion
            thermal_per_bather_shower = (liters_hot * 4.186 * (T_hot - T_cold)) / 3600
            Q_shower_thermal = (bathers_per_day * thermal_per_bather_shower) / hours_open
            Q_shower_electric = 0.0
        else:
            # Connected to pool system: two-stage heating
            # Phase 1: Heat from T_cold to T_hp_max using heat pump
            thermal_phase1 = (liters_hot * 4.186 * (T_hp_max - T_cold)) / 3600
            
            # COP for HP heating to 35°C (realistic for ground-source HP)
            cop_shower = 4.5
            electric_phase1 = thermal_phase1 / cop_shower
            
            # Phase 2: Heat from T_hp_max to T_hot using electric resistance
            thermal_phase2 = (liters_hot * 4.186 * (T_hot - T_hp_max)) / 3600
            electric_phase2 = thermal_phase2  # COP = 1.0 for electric resistance
            
            electric_per_bather = electric_phase1 + electric_phase2
            Q_shower_electric = (bathers_per_day * electric_per_bather) / hours_open
            Q_shower_thermal = 0.0
        
        return Q_pool_refill, Q_shower_thermal, Q_shower_electric
    
    def calculate_cover_u_effective(self, u_rated, wind_speed):
        """Calculate effective U-value for cover with wind correction
        
        Args:
            u_rated: Rated U-value from testing [W/(m²·K)]
            wind_speed: Wind speed at cover surface [m/s]
        
        Returns:
            u_effective: Wind-corrected U-value [W/(m²·K)]
        
        Method:
        - U_rated assumes natural convection (h_nat ≈ 7 W/(m²·K))
        - Wind increases top surface heat transfer
        - h_wind = 5.7 + 3.8*v (empirical for flat surface)
        - U_eff = 1/(1/U_rated - 1/h_nat + 1/h_wind)
        """
        # Apply wind factor to wind speed
        wind_factor = self.config['weather'].get('wind_factor', 
                      self.config['weather'].get('wind_reduction', 0.75))  # backward compat
        v_eff = wind_speed * wind_factor
        
        # Natural convection coefficient assumed in rated U-value
        h_natural = 7.0  # W/(m²·K) - typical for horizontal surface
        
        # Forced convection coefficient with wind (empirical)
        h_wind = 5.7 + 3.8 * v_eff  # W/(m²·K)
        
        # Calculate effective U-value
        # Resistance model: R_total = R_water + R_material + R_air
        # Change only the air-side resistance
        try:
            u_effective = 1.0 / (1.0/u_rated - 1.0/h_natural + 1.0/h_wind)
        except ZeroDivisionError:
            u_effective = u_rated
        
        # Ensure U_effective >= U_rated (wind can only increase heat loss)
        u_effective = max(u_effective, u_rated)
        
        return u_effective
    
    def calculate_heat_demand(self, T_water, weather_row, timestamp):
        """Calculate total heat demand for one hour"""
        T_outdoor = weather_row['temperature']
        T_tunnel = self.get_tunnel_temp(T_outdoor)
        T_air = T_outdoor
        wind = weather_row['wind_speed']
        humidity = weather_row.get('humidity', 70)
        ghi = weather_row.get('ghi', 0)
        hour = timestamp.hour
        
        # Check if pool is open (for activity factor)
        is_open = self.is_pool_open(timestamp)
        
        # Evaporation with activity factor
        Q_evap, P_water, P_air = self.calculate_evaporation(T_water, T_air, wind, humidity, is_open)
        Q_conv = self.calculate_convection(T_water, T_air, Q_evap, P_water, P_air)
        Q_rad = self.calculate_radiation(T_water, T_air)
        Q_solar = self.calculate_solar_gain(ghi)
        
        is_covered = self.is_covered(timestamp)
        u_effective = 0.0  # Initialize
        
        if is_covered:
            # U-value method with wind correction: Q = U_eff × A × ΔT
            u_rated = self.config['operation']['cover'].get('u_value_w_m2_k', 5.0)
            u_effective = self.calculate_cover_u_effective(u_rated, wind)
            area = self.config['pool']['area_m2']
            Q_surface_covered = u_effective * area * (T_water - T_air) / 1000  # kW
            
            # Replace surface losses with U-value calculation
            Q_evap = 0
            Q_conv = 0
            Q_rad = 0
            Q_surface_loss = Q_surface_covered
            
            # Solar gain reduced by cover transmittance
            solar_transmittance = self.config['operation']['cover'].get('solar_transmittance', 0.10)
            Q_solar *= solar_transmittance
        else:
            Q_surface_loss = Q_evap + Q_conv + Q_rad
        
        struct = self.calculate_structural_losses(T_water, T_tunnel)
        Q_pool_refill, Q_shower_thermal, Q_shower_electric = self.calculate_new_water_load(timestamp, T_water)
        
        # Pool refill always added to pool demand
        # Shower electric added if connected to pool system
        # Shower thermal tracked separately if NOT connected
        Q_losses = Q_surface_loss + struct['floor'] + struct['walls']
        Q_net = Q_losses + Q_pool_refill + Q_shower_electric - Q_solar
        
        return {
            'Q_total': Q_net,
            'Q_losses': Q_losses,
            'Q_solar': Q_solar,
            'Q_pool_refill': Q_pool_refill,
            'Q_shower_thermal': Q_shower_thermal,
            'Q_shower_electric': Q_shower_electric,
            'Q_evap': Q_evap,
            'Q_conv': Q_conv,
            'Q_rad': Q_rad,
            'Q_floor': struct['floor'],
            'Q_walls': struct['walls'],
            'covered': is_covered,
            'pool_open': is_open,
            'T_tunnel': T_tunnel,
            'u_effective': u_effective
        }
    
    def plan_period_opening(self, current_idx, T_water, weather_df, current_period):
        """Calculate heating plan at period opening"""
        pool_config = self.config['pool']
        hp_config = self.config['heating_system']
        
        # Calculate period duration using scheduler helper
        period_hours = self.scheduler.get_period_duration(current_period)
        
        # Calculate total demand for the opening period (actual duration)
        day_demand_total = 0
        for i in range(period_hours):
            if current_idx + i >= len(weather_df):
                break
            row = weather_df.iloc[current_idx + i]
            timestamp = row['timestamp']
            demand = self.calculate_heat_demand(T_water, row, timestamp)
            day_demand_total += demand['Q_total']
        
        # Calculate available energy: temperature buffer + HP capacity
        temp_excess = max(0, T_water - pool_config['target_temp'])
        energy_buffer = temp_excess * self.thermal_mass_rate
        
        hp_capacity = hp_config['hp_capacity_kw']
        hp_available = hp_capacity * period_hours
        total_available = energy_buffer + hp_available
        
        # Your logic: if we have enough total capacity, use average HP
        if total_available >= day_demand_total:
            # We have a positive balance - spread HP evenly
            hp_rate = (day_demand_total - energy_buffer) / period_hours
            # Make sure it's within bounds
            hp_rate = max(0, min(hp_rate, hp_capacity))
            boiler_rate = 0
        else:
            # Not enough capacity even with HP at max - need boiler
            hp_rate = hp_capacity
            energy_shortfall = day_demand_total - total_available
            boiler_rate = energy_shortfall / period_hours
        
        # DEBUG: Print for 2024-01-01
        timestamp = weather_df.iloc[current_idx]['timestamp']
        if timestamp.year == 2024 and timestamp.month == 1 and timestamp.day == 1:
            print(f"DEBUG plan_day_opening at {timestamp}:")
            print(f"  Period duration: {period_hours} hours")
            print(f"  T_water: {T_water:.2f}°C")
            print(f"  Day demand total: {day_demand_total:.1f} kWh")
            print(f"  Energy buffer: {energy_buffer:.1f} kWh")
            print(f"  Total available: {total_available:.1f} kWh")
            print(f"  hp_rate: {hp_rate:.1f} kW")
            print(f"  boiler_rate: {boiler_rate:.1f} kW")
        
        return {
            'hp_rate_day': hp_rate,
            'boiler_rate_day': boiler_rate,
            'temp_start': T_water,
            'day_demand': day_demand_total,
            'energy_buffer': energy_buffer,
            'case': 1 if boiler_rate == 0 else 2
        }
    
    def find_next_opening(self, current_time, periods):
        """Find next opening time from current time
        
        Returns: (datetime, period) or (None, None)
        """
        current_date = current_time.date()
        current_hour = current_time.hour
        
        # Check remaining periods today
        for period in periods:
            if period['from'] > current_hour:
                next_time = current_time.replace(hour=period['from'], minute=0, second=0, microsecond=0)
                return next_time, period
        
        # Check tomorrow
        tomorrow = current_date + timedelta(days=1)
        tomorrow_periods = self.scheduler.get_periods(tomorrow)
        if tomorrow_periods:
            next_time = datetime.combine(tomorrow, datetime.min.time())
            next_time = next_time.replace(hour=tomorrow_periods[0]['from'], tzinfo=current_time.tzinfo)
            return next_time, tomorrow_periods[0]
        
        return None, None
    
    def forecast_next_day(self, current_idx, T_water_current, weather_df):
        """Forecast next day demand with iterative temperature convergence"""
        current_time = weather_df.iloc[current_idx]['timestamp']
        current_hour = current_time.hour
        current_date = current_time.date()
        
        # Find next opening time using ScheduleManager
        hours_to_open = 0
        check_date = current_date
        found_opening = False
        
        for day_offset in range(2):  # Check today and tomorrow
            periods = self.scheduler.get_periods(check_date)
            for period in periods:
                open_hour = period['from']
                
                if day_offset == 0:
                    # Today: only consider periods after current hour
                    if open_hour > current_hour:
                        hours_to_open = open_hour - current_hour
                        found_opening = True
                        break
                else:
                    # Tomorrow: first period
                    hours_to_open = 24 - current_hour + open_hour
                    found_opening = True
                    break
            
            if found_opening:
                break
            
            check_date += timedelta(days=1)
        
        if not found_opening:
            # No opening found in next 2 days, skip forecasting
            return 0, 0
        
        T_sim = T_water_current
        night_losses = 0
        for i in range(hours_to_open):
            if current_idx + i >= len(weather_df):
                break
            row = weather_df.iloc[current_idx + i]
            timestamp = row['timestamp']
            demand = self.calculate_heat_demand(T_sim, row, timestamp)
            night_losses += demand['Q_total']
        
        forecast_start = current_idx + hours_to_open
        
        # Iterative approach: Start with 28.4°C average, iterate to converge
        T_avg = 28.4  # Initial guess halfway between target and typical preheat
        
        for iteration in range(3):  # 2-3 iterations for convergence
            day_demand = []
            
            for i in range(10):
                if forecast_start + i >= len(weather_df):
                    break
                row = weather_df.iloc[forecast_start + i]
                timestamp = row['timestamp']
                # Use average temperature for heat loss calculation
                demand = self.calculate_heat_demand(T_avg, row, timestamp)
                day_demand.append(demand['Q_total'])
            
            # After calculating demand, update T_avg for next iteration
            # Assume we start day at target_night (will be ~29°C) and end near 28°C
            # New average estimate based on demand/supply balance
            if iteration < 2:  # Don't update on last iteration
                total_demand = sum(day_demand)
                hp_capacity = self.config['heating_system']['hp_capacity_kw']
                
                # Rough estimate: if demand > supply, temp drops more
                if total_demand > hp_capacity * 10:
                    # Temperature will drop more, lower the average
                    T_avg = max(28.0, T_avg - 0.1)
                else:
                    # Temperature stable or rising, increase average slightly
                    T_avg = min(28.8, T_avg + 0.05)
        
        total_day_demand = sum(day_demand)
        avg_hour_demand = total_day_demand / len(day_demand) if day_demand else 0
        
        return {
            'total_demand': total_day_demand,
            'avg_hour_demand': avg_hour_demand,
            'night_losses': night_losses,
            'hours_to_open': hours_to_open,
            'T_avg_used': T_avg  # Store for debugging
        }
    
    def plan_closed_period(self, current_idx, T_water, weather_df, timestamp):
        """Calculate plan for closed period - uses scheduler to find next opening"""
        pool_config = self.config['pool']
        hp_config = self.config['heating_system']
        
        # Use scheduler to get next opening info
        date = timestamp.date()
        periods = self.scheduler.get_periods(date)
        next_info = self.scheduler.get_next_opening_info(timestamp, periods)
        
        if not next_info:
            # No next opening found - use reactive control
            return None
        
        hours_to_open = next_info['hours_until']
        next_period = next_info['period']
        
        # Calculate night losses using better temperature estimate
        # Use average between current and expected target for more accurate losses
        T_avg_estimate = (T_water + min(T_water + 2, pool_config['max_temp'])) / 2
        night_losses = 0
        for i in range(hours_to_open):
            if current_idx + i >= len(weather_df):
                break
            row = weather_df.iloc[current_idx + i]
            timestamp = row['timestamp']
            demand = self.calculate_heat_demand(T_avg_estimate, row, timestamp)
            night_losses += demand['Q_total']
        
        forecast_start = current_idx + hours_to_open
        
        # ITERATION 1: Use target temp to determine initial case and target_night
        T_estimate = pool_config['target_temp']  # 28.0°C
        
        day_demand = []
        for i in range(10):
            if forecast_start + i >= len(weather_df):
                break
            row = weather_df.iloc[forecast_start + i]
            timestamp = row['timestamp']
            demand = self.calculate_heat_demand(T_estimate, row, timestamp)
            day_demand.append(demand['Q_total'])
        
        total_day_demand = sum(day_demand)
        avg_demand = total_day_demand / len(day_demand) if day_demand else 0
        
        # Determine initial case and target_night
        hp_capacity = hp_config['hp_capacity_kw']
        boiler_capacity = hp_config['boiler_capacity_kw']
        target = pool_config['target_temp']
        
        if avg_demand <= hp_capacity:
            case = 1
            target_night = target
            day_hp_power = avg_demand
            day_boiler_power = 0
        elif avg_demand <= hp_capacity + self.thermal_mass_rate:
            case = 2
            extra_temp = (avg_demand - hp_capacity) * 10 / self.thermal_mass_rate
            target_night = min(target + extra_temp, pool_config['max_temp'])
            day_hp_power = hp_capacity
            day_boiler_power = 0
        elif avg_demand <= hp_capacity + boiler_capacity:
            case = 3
            target_night = pool_config['max_temp']
            day_hp_power = hp_capacity
            day_boiler_power = avg_demand - hp_capacity
        else:
            case = 4
            target_night = pool_config['max_temp']
            day_hp_power = hp_capacity
            day_boiler_power = boiler_capacity
        
        # ITERATION 2: Refine with better temperature estimate using hour-by-hour simulation
        # Simulate the day to get more accurate demand
        T_sim_day = target_night  # Start day at target night temperature
        day_demand = []
        
        for i in range(10):
            if forecast_start + i >= len(weather_df):
                break
            row = weather_df.iloc[forecast_start + i]
            timestamp = row['timestamp']
            
            # Calculate demand at current simulated temperature
            demand = self.calculate_heat_demand(T_sim_day, row, timestamp)
            day_demand.append(demand['Q_total'])
            
            # Update temperature based on balance (simplified)
            # Assume we have HP at full capacity during day
            Q_demand = demand['Q_total']
            Q_supplied = hp_capacity  # Assume HP runs at full capacity
            Q_net = Q_supplied - Q_demand
            
            # Temperature change from net heat
            delta_T = Q_net / self.thermal_mass_rate  # °C change in 1 hour
            T_sim_day = T_sim_day + delta_T
            
            # Constrain temperature to reasonable bounds
            T_sim_day = max(pool_config['min_temp'], min(T_sim_day, pool_config['max_temp']))
        
        total_day_demand = sum(day_demand)
        avg_demand = total_day_demand / len(day_demand) if day_demand else 0
        
        # Re-determine case and target_night with refined demand
        if avg_demand <= hp_capacity:
            case = 1
            target_night = target
            day_hp_power = avg_demand
            day_boiler_power = 0
        elif avg_demand <= hp_capacity + self.thermal_mass_rate:
            case = 2
            extra_temp = (avg_demand - hp_capacity) * 10 / self.thermal_mass_rate
            target_night = min(target + extra_temp, pool_config['max_temp'])
            day_hp_power = hp_capacity
            day_boiler_power = 0
        elif avg_demand <= hp_capacity + boiler_capacity:
            case = 3
            target_night = pool_config['max_temp']
            day_hp_power = hp_capacity
            day_boiler_power = avg_demand - hp_capacity
        else:
            case = 4
            target_night = pool_config['max_temp']
            day_hp_power = hp_capacity
            day_boiler_power = boiler_capacity
        
        # ITERATION 3: Final refinement with updated target_night
        # Re-simulate day starting at the newly determined target_night
        T_sim_day = target_night
        day_demand_final = []
        
        for i in range(10):
            if forecast_start + i >= len(weather_df):
                break
            row = weather_df.iloc[forecast_start + i]
            timestamp = row['timestamp']
            
            # Calculate demand at current simulated temperature
            demand = self.calculate_heat_demand(T_sim_day, row, timestamp)
            day_demand_final.append(demand['Q_total'])
            
            # Update temperature based on expected heating
            Q_demand = demand['Q_total']
            Q_supplied = day_hp_power + day_boiler_power  # Use planned heating rates
            Q_net = Q_supplied - Q_demand
            
            # Temperature change
            delta_T = Q_net / self.thermal_mass_rate
            T_sim_day = T_sim_day + delta_T
            T_sim_day = max(pool_config['min_temp'], min(T_sim_day, pool_config['max_temp']))
        
        # Use the final refined demand for a last check
        total_day_demand_final = sum(day_demand_final)
        avg_demand_final = total_day_demand_final / len(day_demand_final) if day_demand_final else 0
        
        # If demand is significantly different, adjust target slightly
        if case == 2 and avg_demand_final > hp_capacity + 5:  # Need more buffer
            # Increase target temperature slightly
            extra_temp = (avg_demand_final - hp_capacity) * 10 / self.thermal_mass_rate
            target_night = min(target + extra_temp + 0.2, pool_config['max_temp'])  # Add 0.2°C buffer
        
        # Calculate night heating requirements
        temp_rise = max(0, target_night - T_water)
        hours_available = hours_to_open  # Define hours_available first
        
        # For planning purposes, estimate losses more accurately:
        # If we heat from T_water to target_night, average temp during heating is:
        T_avg_heating = (T_water + target_night) / 2
        
        # Calculate losses at average temperature during heating period
        losses_per_hour = 0
        for i in range(min(hours_to_open, 5)):  # Sample a few hours
            if current_idx + i >= len(weather_df):
                break
            row = weather_df.iloc[current_idx + i]
            timestamp = row['timestamp']
            demand = self.calculate_heat_demand(T_avg_heating, row, timestamp)
            losses_per_hour += demand['Q_total']
        if losses_per_hour > 0:
            losses_per_hour = losses_per_hour / min(hours_to_open, 5)
        
        # Energy needed includes temp rise plus losses during heating
        energy_for_temp = temp_rise * self.thermal_mass_rate
        
        # Calculate required heating hours and start time
        if temp_rise > 0.1:  # Need to heat
            # Power available for heating after covering losses
            net_heating_power = max(0, hp_capacity - losses_per_hour)
            if net_heating_power > 0:
                hours_for_temp_rise = energy_for_temp / net_heating_power
                # Add buffer for higher losses as temp rises
                hours_hp_needed = min(hours_available, hours_for_temp_rise * 1.2)
            else:
                hours_hp_needed = hours_available  # Need full time
            
            # Also account for losses during waiting period
            wait_hours = max(0, hours_available - hours_hp_needed)
            if wait_hours > 0:
                # Losses during wait at current temp
                wait_losses = 0
                for i in range(int(wait_hours)):
                    if current_idx + i >= len(weather_df):
                        break
                    row = weather_df.iloc[current_idx + i]
                    timestamp = row['timestamp']
                    demand = self.calculate_heat_demand(T_water, row, timestamp)
                    wait_losses += demand['Q_total']
                # Add wait losses to energy needed
                total_energy_needed = energy_for_temp + wait_losses + losses_per_hour * hours_hp_needed
            else:
                total_energy_needed = energy_for_temp + losses_per_hour * hours_hp_needed
        else:
            # Just maintain
            total_energy_needed = losses_per_hour * hours_available
            hours_hp_needed = total_energy_needed / hp_capacity if hp_capacity > 0 else hours_available
        
        # Determine if we need boiler
        hp_energy_available = hp_capacity * hours_available
        
        if total_energy_needed <= hp_energy_available:
            # HP sufficient - calculate optimal start time
            start_hp_in = max(0, hours_available - hours_hp_needed)
            start_boiler_in = None
            night_hp_power = hp_capacity
            night_boiler_power = 0
        else:
            # Need boiler too
            start_hp_in = 0  # Start HP immediately
            hp_contribution = hp_capacity * hours_available
            boiler_energy_needed = total_energy_needed - hp_contribution
            hours_boiler_needed = boiler_energy_needed / boiler_capacity
            start_boiler_in = max(0, hours_available - hours_boiler_needed)
            night_hp_power = hp_capacity
            night_boiler_power = boiler_capacity
        
        return {
            'case': case,
            'target_night': target_night,
            'day_hp_power': day_hp_power,
            'day_boiler_power': day_boiler_power,
            'start_hp_in': start_hp_in,
            'start_boiler_in': start_boiler_in,
            'night_hp_power': night_hp_power,
            'night_boiler_power': night_boiler_power,
            'hours_to_open': hours_available,
            'forecast_demand': avg_demand,
            'energy_needed': total_energy_needed
        }
    
    def execute_control(self, current_idx, T_water, weather_df, timestamp):
        """Execute control based on transition-driven planning
        
        V3.6.0.2: Agnostic to day/night, treats all periods identically
        - At CLOSE transition: plan closed period
        - At OPEN transition: plan open period
        - During execution: follow plan
        """
        pool_config = self.config['pool']
        hp_config = self.config['heating_system']
        control_mode = self.config['control']['mode']
        
        demand = self.calculate_heat_demand(T_water, weather_df.iloc[current_idx], timestamp)
        Q_demand = demand['Q_total']
        cop = self.calculate_cop(weather_df.iloc[current_idx]['temperature'])
        
        hour = timestamp.hour
        date = timestamp.date()
        
        # Reactive control mode
        if control_mode == 'reactive':
            temp_error = pool_config['target_temp'] - T_water
            if T_water < pool_config['target_temp']:
                Q_recovery = min(temp_error * self.thermal_mass_rate, 200)
                Q_needed = Q_demand + Q_recovery
            else:
                Q_recovery = 0
                Q_needed = Q_demand
            
            Q_hp = min(Q_needed, hp_config['hp_capacity_kw'])
            Q_boiler = min(Q_needed - Q_hp, hp_config['boiler_capacity_kw'])
            
            return {
                'Q_needed': Q_needed,
                'Q_hp': Q_hp,
                'Q_boiler': Q_boiler,
                'Q_delivered': Q_hp + Q_boiler,
                'Q_unmet': max(0, Q_needed - Q_hp - Q_boiler),
                'cop': cop,
                'hp_electric': Q_hp / cop if cop > 0 else 0,
                'mode': 'reactive',
                'case': 0,
                'preheat': False
            }
        
        # Predictive control - get schedule info
        periods = self.scheduler.get_periods(date)
        
        if not periods:
            # No periods - use simple thermostat
            temp_error = pool_config['target_temp'] - T_water
            if T_water < pool_config['target_temp']:
                Q_recovery = min(temp_error * self.thermal_mass_rate, 200)
                Q_needed = Q_demand + Q_recovery
            else:
                Q_recovery = 0
                Q_needed = Q_demand
            
            Q_hp = min(Q_needed, hp_config['hp_capacity_kw'])
            Q_boiler = min(Q_needed - Q_hp, hp_config['boiler_capacity_kw'])
            
            return {
                'Q_needed': Q_needed,
                'Q_hp': Q_hp,
                'Q_boiler': Q_boiler,
                'Q_delivered': Q_hp + Q_boiler,
                'Q_unmet': max(0, Q_needed - Q_hp - Q_boiler),
                'cop': cop,
                'hp_electric': Q_hp / cop if cop > 0 else 0,
                'mode': 'no_periods',
                'case': 0,
                'preheat': False
            }
        
        # Check for transitions and trigger planning
        transitions = self.scheduler.get_daily_transitions(date)
        
        for transition in transitions:
            if hour == transition['time']:
                if transition['type'] == 'open':
                    # CLOSED → OPEN transition - ALWAYS create new plan for this period
                    for period in periods:
                        if period['from'] == hour:
                            self.open_plan = self.plan_period_opening(current_idx, T_water, weather_df, period)
                            break
                
                elif transition['type'] == 'close':
                    # OPEN → CLOSED transition - ALWAYS create new plan
                    self.closed_plan = self.plan_closed_period(current_idx, T_water, weather_df, timestamp)
        
        # Initialize plans if first hour of simulation
        if not hasattr(self, 'open_plan'):
            self.open_plan = None
        if not hasattr(self, 'closed_plan'):
            self.closed_plan = None
        
        # Check current status using scheduler
        current_period_info = self.scheduler.get_current_period_info(timestamp, periods)
        
        if current_period_info:
            # OPEN PERIOD - use open plan
            if self.open_plan is None:
                # First time in open period, create plan
                self.open_plan = self.plan_period_opening(current_idx, T_water, weather_df, current_period_info['period'])
            
            plan = self.open_plan
            Q_needed = Q_demand
            Q_hp = min(plan['hp_rate_day'], hp_config['hp_capacity_kw'])
            Q_boiler = min(plan['boiler_rate_day'], hp_config['boiler_capacity_kw'])
            
            if Q_boiler > 0:
                mode = f"open_case{plan.get('case', 1)}_hp+boiler"
            else:
                mode = f"open_case{plan.get('case', 1)}_hp"
            
            preheat = False
        
        else:
            # CLOSED PERIOD - use closed plan
            if self.closed_plan is None:
                # First time in closed period, create plan
                self.closed_plan = self.plan_closed_period(current_idx, T_water, weather_df, timestamp)
            
            if self.closed_plan is None:
                # No next opening found - simple maintain
                Q_needed = Q_demand
                Q_hp = min(Q_demand, hp_config['hp_capacity_kw'])
                Q_boiler = 0
                mode = 'closed_no_plan'
                preheat = False
            else:
                plan = self.closed_plan
                
                # Calculate hours since plan was made
                # Find most recent close time
                last_close_hour = None
                for period in reversed(periods):
                    if period['to'] <= hour:
                        last_close_hour = period['to']
                        break
                
                # If no close found today, check yesterday
                if last_close_hour is None:
                    yesterday = date - timedelta(days=1)
                    yesterday_periods = self.scheduler.get_periods(yesterday)
                    if yesterday_periods:
                        last_close_hour = yesterday_periods[-1]['to']
                        plan_time = timestamp.replace(hour=last_close_hour, minute=0, second=0, microsecond=0) - pd.Timedelta(days=1)
                    else:
                        plan_time = timestamp.replace(hour=0, minute=0, second=0, microsecond=0)
                else:
                    plan_time = timestamp.replace(hour=last_close_hour, minute=0, second=0, microsecond=0)
                
                hours_since_plan = (timestamp - plan_time).total_seconds() / 3600
                hours_remaining = plan['hours_to_open'] - hours_since_plan
                
                # Check if HP should be active (fractional hour handling)
                hp_start_hour = int(np.floor(plan['start_hp_in']))
                hp_fractional = plan['start_hp_in'] - hp_start_hour
                
                if hours_since_plan >= plan['start_hp_in']:
                    hp_active = True
                    power_factor = 1.0
                elif hours_since_plan >= hp_start_hour:
                    hp_active = True
                    power_factor = 1.0 - hp_fractional
                else:
                    hp_active = False
                    power_factor = 0.0
                
                # Check if boiler should be active
                if plan['start_boiler_in'] is not None:
                    boiler_start_hour = int(np.floor(plan['start_boiler_in']))
                    boiler_fractional = plan['start_boiler_in'] - boiler_start_hour
                    
                    if hours_since_plan >= plan['start_boiler_in']:
                        boiler_active = True
                        boiler_power_factor = 1.0
                    elif hours_since_plan >= boiler_start_hour:
                        boiler_active = True
                        boiler_power_factor = 1.0 - boiler_fractional
                    else:
                        boiler_active = False
                        boiler_power_factor = 0.0
                else:
                    boiler_active = False
                    boiler_power_factor = 0.0
                
                temp_error = plan['target_night'] - T_water
                
                # Calculate needed power
                if hp_active and temp_error > 0.1 and hours_remaining > 0:
                    # Heating mode
                    energy_needed = temp_error * self.thermal_mass_rate
                    Q_recovery = energy_needed / hours_remaining
                    Q_recovery = max(0, min(Q_recovery, 400))
                    Q_needed = Q_demand + Q_recovery
                    preheat = True
                    
                    if boiler_active:
                        mode = f"closed_case{plan['case']}_heat_hp+boiler"
                    else:
                        mode = f"closed_case{plan['case']}_heat_hp"
                
                elif hp_active and hours_remaining > 0:
                    # Maintain/recalc mode
                    temp_still_needed = plan['target_night'] - T_water
                    
                    if temp_still_needed > 0.05:
                        # Still need to heat
                        energy_for_temp = temp_still_needed * self.thermal_mass_rate
                        energy_for_losses = Q_demand * hours_remaining
                        total_energy = energy_for_temp + energy_for_losses
                        Q_required = total_energy / hours_remaining
                        Q_needed = Q_required
                        preheat = True
                        mode = f"closed_case{plan['case']}_heat_recalc"
                    else:
                        # Target reached
                        Q_needed = Q_demand
                        preheat = False
                        mode = f"closed_case{plan['case']}_maintain"
                    
                    if boiler_active:
                        mode = mode.replace('_hp', '_hp+boiler') if '_hp' in mode else mode + '_hp+boiler'
                
                else:
                    # Waiting or no time remaining
                    Q_needed = Q_demand
                    preheat = False
                    mode = f"closed_case{plan['case']}_wait"
                
                # Apply power
                if hp_active:
                    Q_hp = min(Q_needed, plan['night_hp_power'] * power_factor)
                    if boiler_active:
                        Q_boiler = min(Q_needed - Q_hp, plan['night_boiler_power'] * boiler_power_factor)
                    else:
                        Q_boiler = 0
                else:
                    Q_hp = min(Q_demand, hp_config['hp_capacity_kw'])
                    Q_boiler = 0
        
        Q_delivered = Q_hp + Q_boiler
        Q_unmet = max(0, Q_needed - Q_delivered)
        
        # Get case from plan
        case = 0
        if current_period_info and self.open_plan:
            case = self.open_plan.get('case', 1)
        elif not current_period_info and self.closed_plan:
            case = self.closed_plan.get('case', 0)
        
        return {
            'Q_needed': Q_needed,
            'Q_hp': Q_hp,
            'Q_boiler': Q_boiler,
            'Q_delivered': Q_delivered,
            'Q_unmet': Q_unmet,
            'cop': cop,
            'hp_electric': Q_hp / cop if cop > 0 else 0,
            'mode': mode,
            'case': case,
            'preheat': preheat
        }

    
    def simulate_year(self):
        """Run year simulation with V3.5.6.3"""
        print(f"\nSTARTING SIMULATION V{VERSION}...")
        
        weather_file = self.config['_resolved_paths']['weather_file']
        df = pd.read_csv(weather_file, comment='#')
        df['timestamp'] = pd.to_datetime(df['time'], utc=True)
        
        # Merge solar data if available
        if self.solar_data is not None:
            df = df.set_index('timestamp').join(self.solar_data[['solar_radiation_w_m2']], how='left')
            df = df.reset_index()
            df['ghi'] = df['solar_radiation_w_m2'].fillna(0)
            print(f"✓ Merged solar data: {df['ghi'].notna().sum()} hours with solar data")
        else:
            if 'solar_radiation' in df.columns:
                df['ghi'] = df['solar_radiation'].fillna(0)
            else:
                df['ghi'] = 0
            print("⚠ Using fallback solar data (zeros)")
        
        T_water = self.config['pool']['target_temp']
        
        results = []
        
        for idx, row in df.iterrows():
            if idx % 1000 == 0:
                print(f"  Hour {idx+1}/{len(df)} - T_water: {T_water:.2f}°C")
            
            timestamp = row['timestamp']
            
            control = self.execute_control(idx, T_water, df, timestamp)
            demand = self.calculate_heat_demand(T_water, row, timestamp)
            
            dt = 3600
            Q_net = control['Q_delivered'] - demand['Q_total']
            dT = Q_net * dt * 1000 / (self.config['pool']['volume_m3'] * 1000 * 4186)
            T_water_new = T_water + dT
            T_water_new = max(self.config['pool']['min_temp'] - 1, 
                            min(self.config['pool']['max_temp'], T_water_new))
            
            results.append({
                'timestamp': timestamp,
                'temperature': row['temperature'],
                'wind_speed': row['wind_speed'],
                'humidity': row.get('humidity', 70),
                'ghi': row.get('ghi', 0),
                'tunnel_temp': demand['T_tunnel'],
                'water_temp': T_water_new,
                'covered': demand['covered'],
                'pool_open': demand['pool_open'],
                'u_effective': demand['u_effective'],
                'evaporation': demand['Q_evap'],
                'convection': demand['Q_conv'],
                'radiation': demand['Q_rad'],
                'solar_gain': demand['Q_solar'],
                'pool_refill': demand['Q_pool_refill'],
                'shower_thermal': demand['Q_shower_thermal'],
                'shower_electric': demand['Q_shower_electric'],
                'floor': demand['Q_floor'],
                'walls': demand['Q_walls'],
                'total_loss': demand['Q_losses'],
                'net_demand': demand['Q_total'],
                'Q_needed': control['Q_needed'],
                'Q_hp': control['Q_hp'],
                'Q_boiler': control['Q_boiler'],
                'Q_delivered': control['Q_delivered'],
                'Q_unmet': control['Q_unmet'],
                'cop': control['cop'],
                'hp_electric': control['hp_electric'],
                'boiler_electric': control['Q_boiler'],
                'total_electric': control['hp_electric'] + control['Q_boiler'],
                'control_mode': control['mode'],
                'control_case': control['case'],
                'preheat': control['preheat']
            })
            
            T_water = T_water_new
        
        results_df = pd.DataFrame(results)
        stats = self.calculate_statistics(results_df)
        
        return results_df, stats
    
    def calculate_statistics(self, results_df):
        """Calculate comprehensive statistics"""
        
        results_df['year'] = results_df['timestamp'].dt.year
        n_years = results_df['year'].nunique()
        
        # Separate open and closed hours
        open_df = results_df[results_df['pool_open'] == True]
        closed_df = results_df[results_df['pool_open'] == False]
        
        # Annual totals (MWh)
        annual_MWh = {
            'evaporation': results_df['evaporation'].sum() / 1000,
            'convection': results_df['convection'].sum() / 1000,
            'radiation': results_df['radiation'].sum() / 1000,
            'solar_gain': results_df['solar_gain'].sum() / 1000,
            'pool_refill': results_df['pool_refill'].sum() / 1000,
            'shower_thermal': results_df['shower_thermal'].sum() / 1000,
            'shower_electric': results_df['shower_electric'].sum() / 1000,
            'floor': results_df['floor'].sum() / 1000,
            'walls': results_df['walls'].sum() / 1000,
            'total_loss': results_df['total_loss'].sum() / 1000,
            'net_demand': results_df['net_demand'].sum() / 1000,
            'hp_thermal': results_df['Q_hp'].sum() / 1000,
            'boiler_thermal': results_df['Q_boiler'].sum() / 1000,
            'unmet': results_df['Q_unmet'].sum() / 1000,
            'hp_electric': results_df['hp_electric'].sum() / 1000,
            'total_electric': results_df['total_electric'].sum() / 1000,
        }
        
        # Open hours breakdown (MWh)
        open_MWh = {
            'evaporation': open_df['evaporation'].sum() / 1000,
            'convection': open_df['convection'].sum() / 1000,
            'radiation': open_df['radiation'].sum() / 1000,
            'solar_gain': open_df['solar_gain'].sum() / 1000,
            'pool_refill': open_df['pool_refill'].sum() / 1000,
            'shower_electric': open_df['shower_electric'].sum() / 1000,
            'floor': open_df['floor'].sum() / 1000,
            'walls': open_df['walls'].sum() / 1000,
            'total_loss': open_df['total_loss'].sum() / 1000,
            'hp_thermal': open_df['Q_hp'].sum() / 1000,
            'boiler_thermal': open_df['Q_boiler'].sum() / 1000,
            'unmet': open_df['Q_unmet'].sum() / 1000,
            'hp_electric': open_df['hp_electric'].sum() / 1000,
            'total_electric': open_df['total_electric'].sum() / 1000,
        }
        
        # Closed hours breakdown (MWh)
        closed_MWh = {
            'evaporation': closed_df['evaporation'].sum() / 1000,
            'convection': closed_df['convection'].sum() / 1000,
            'radiation': closed_df['radiation'].sum() / 1000,
            'solar_gain': closed_df['solar_gain'].sum() / 1000,
            'floor': closed_df['floor'].sum() / 1000,
            'walls': closed_df['walls'].sum() / 1000,
            'total_loss': closed_df['total_loss'].sum() / 1000,
            'hp_thermal': closed_df['Q_hp'].sum() / 1000,
            'boiler_thermal': closed_df['Q_boiler'].sum() / 1000,
            'unmet': closed_df['Q_unmet'].sum() / 1000,
            'hp_electric': closed_df['hp_electric'].sum() / 1000,
            'total_electric': closed_df['total_electric'].sum() / 1000,
        }
        
        electricity_price = self.config['economics']['electricity_price_nok_kwh']
        costs = {
            'hp_cost_NOK': annual_MWh['hp_electric'] * 1000 * electricity_price,
            'boiler_cost_NOK': annual_MWh['boiler_thermal'] * 1000 * electricity_price,
            'total_cost_NOK': annual_MWh['total_electric'] * 1000 * electricity_price,
        }
        
        results_df['date'] = results_df['timestamp'].dt.date
        days_below_27 = results_df[results_df['water_temp'] < 27]['date'].nunique()
        days_below_26 = results_df[results_df['water_temp'] < 26]['date'].nunique()
        
        violations = {
            'water_min': results_df['water_temp'].min(),
            'water_mean': results_df['water_temp'].mean(),
            'water_max': results_df['water_temp'].max(),
            'hours_below_27': (results_df['water_temp'] < 27).sum(),
            'hours_below_26': (results_df['water_temp'] < 26).sum(),
            'days_below_27': days_below_27,
            'days_below_26': days_below_26,
        }
        
        # Activity factor usage
        hours_open = results_df['pool_open'].sum()
        hours_closed = (~results_df['pool_open']).sum()
        
        activity = {
            'hours_open': hours_open,
            'hours_closed': hours_closed,
            'percent_open': hours_open / len(results_df) * 100,
        }
        
        predictive = {
            'preheat_hours': results_df['preheat'].sum(),
            'case1_hours': (results_df['control_case'] == 1).sum(),
            'case2_hours': (results_df['control_case'] == 2).sum(),
            'case3_hours': (results_df['control_case'] == 3).sum(),
            'case4_hours': (results_df['control_case'] == 4).sum(),
        }
        
        cop_stats = {
            'mean_when_running': results_df[results_df['cop'] > 0]['cop'].mean(),
            'hours_running': (results_df['cop'] > 0).sum(),
        }
        
        capacity = {
            'max_demand': results_df['Q_needed'].max(),
            'hours_hp_only': (results_df['Q_boiler'] == 0).sum(),
            'hours_with_boiler': (results_df['Q_boiler'] > 0).sum(),
            'hours_unmet': (results_df['Q_unmet'] > 0).sum(),
        }
        
        stats = {
            'n_years': n_years,
            'annual_MWh': annual_MWh,
            'open_MWh': open_MWh,
            'closed_MWh': closed_MWh,
            'costs': costs,
            'violations': violations,
            'activity': activity,
            'predictive': predictive,
            'cop': cop_stats,
            'capacity': capacity,
            'config': self.config
        }
        
        return stats
    
    def print_summary(self, stats):
        """Print comprehensive summary in standard format"""
        hp_cap = self.config['heating_system']['hp_capacity_kw']
        boiler_cap = self.config['heating_system']['boiler_capacity_kw']
        control_mode = self.config['control']['mode']
        cover = "Yes" if self.config['operation']['cover']['enabled'] else "No"
        n_years = stats['n_years']
        activity_factor = self.config['operation']['activity_factor']
        solar_abs = self.config['solar']['absorptance']
        wind_factor = self.config['weather'].get('wind_factor', 
                      self.config['weather'].get('wind_reduction', 0.75))  # backward compat
        
        print("\n" + "="*80)
        print(f"POOL ENERGY SYSTEM V{VERSION}")
        print("="*80)
        print(f"Capacity:          {hp_cap} kW HP + {boiler_cap} kW boiler")
        print(f"Control:           {control_mode}")
        print(f"Target temp:       {self.config['pool']['target_temp']:.1f}°C")
        print(f"Cover:             {cover}")
        print(f"Activity factor:   {activity_factor:.2f}")
        print(f"Solar absorption:  {solar_abs*100:.0f}% of incident radiation")
        print(f"Wind exposure:     {wind_factor*100:.0f}% (shelter effect {(1-wind_factor)*100:.0f}%)")
        print(f"Simulation period: {n_years} years")
        print("="*80)
        print()
        
        annual = stats['annual_MWh']
        open_mwh = stats['open_MWh']
        closed_mwh = stats['closed_MWh']
        act = stats['activity']
        
        # Per-year values
        yr = n_years
        
        # Check if shower is connected
        nw_config = self.config.get('new_water', {})
        shower_enabled = nw_config.get('enabled', False)
        shower_connected = False
        if shower_enabled:
            shower_config = nw_config.get('shower', {})
            shower_connected = shower_config.get('connected_to_pool_system', False)
        
        # Opening hours per day
        hours_open_per_day = act['hours_open'] / yr / 365
        hours_closed_per_day = act['hours_closed'] / yr / 365
        
        print(f"System Thermal Need       Open          Closed        Total")
        print(f"(MWh/year):               ({hours_open_per_day:.0f}h/day)      ({hours_closed_per_day:.0f}h/day)")
        print("-"*80)
        print(f"{'Evaporation':<25} {open_mwh['evaporation']/yr:>12.1f}  {closed_mwh['evaporation']/yr:>12.1f}  {annual['evaporation']/yr:>12.1f}")
        print(f"{'Convection':<25} {open_mwh['convection']/yr:>12.1f}  {closed_mwh['convection']/yr:>12.1f}  {annual['convection']/yr:>12.1f}")
        print(f"{'Radiation':<25} {open_mwh['radiation']/yr:>12.1f}  {closed_mwh['radiation']/yr:>12.1f}  {annual['radiation']/yr:>12.1f}")
        print(f"{'Floor':<25} {open_mwh['floor']/yr:>12.1f}  {closed_mwh['floor']/yr:>12.1f}  {annual['floor']/yr:>12.1f}")
        print(f"{'Walls':<25} {open_mwh['walls']/yr:>12.1f}  {closed_mwh['walls']/yr:>12.1f}  {annual['walls']/yr:>12.1f}")
        print(f"{'Solar gain':<25} {-open_mwh['solar_gain']/yr:>12.1f}  {-closed_mwh['solar_gain']/yr:>12.1f}  {-annual['solar_gain']/yr:>12.1f}")
        print("-"*80)
        print(f"{'Total loss':<25} {open_mwh['total_loss']/yr:>12.1f}  {closed_mwh['total_loss']/yr:>12.1f}  {annual['total_loss']/yr:>12.1f}")
        
        # Per hour averages
        avg_open_kw = open_mwh['total_loss'] * 1000 / act['hours_open']
        avg_closed_kw = closed_mwh['total_loss'] * 1000 / act['hours_closed']
        print(f"{'  per hour (kW)':<25} {avg_open_kw:>12.1f}  {avg_closed_kw:>12.1f}")
        print()
        
        print(f"{'Pool Water Heating':<25} {open_mwh['pool_refill']/yr:>12.1f}  {0.0:>12.1f}  {annual['pool_refill']/yr:>12.1f}")
        if shower_connected:
            print(f"{'Shower Water Heating':<25} {open_mwh['shower_electric']/yr:>12.1f}  {0.0:>12.1f}  {annual['shower_electric']/yr:>12.1f}")
        print("-"*80)
        
        # Total system need
        if shower_connected:
            total_need = (open_mwh['total_loss'] + open_mwh['pool_refill'] + open_mwh['shower_electric']) / yr + closed_mwh['total_loss'] / yr
        else:
            total_need = (open_mwh['total_loss'] + open_mwh['pool_refill']) / yr + closed_mwh['total_loss'] / yr
        
        print(f"{'Total System Need':<25} {'':<12}  {'':<12}  {total_need:>12.1f}")
        print()
        
        print(f"{'Heat Pump':<25} {open_mwh['hp_thermal']/yr:>12.1f}  {closed_mwh['hp_thermal']/yr:>12.1f}  {annual['hp_thermal']/yr:>12.1f}")
        print(f"{'Boiler':<25} {open_mwh['boiler_thermal']/yr:>12.1f}  {closed_mwh['boiler_thermal']/yr:>12.1f}  {annual['boiler_thermal']/yr:>12.1f}")
        print("-"*80)
        print(f"{'Total delivered':<25} {(open_mwh['hp_thermal'] + open_mwh['boiler_thermal'])/yr:>12.1f}  {(closed_mwh['hp_thermal'] + closed_mwh['boiler_thermal'])/yr:>12.1f}  {(annual['hp_thermal'] + annual['boiler_thermal'])/yr:>12.1f}")
        print(f"{'Unmet need':<25} {open_mwh['unmet']/yr:>12.1f}  {closed_mwh['unmet']/yr:>12.1f}  {annual['unmet']/yr:>12.1f}")
        print()
        
        print("Electricity used:")
        print(f"{'Heat pump':<25} {open_mwh['hp_electric']/yr:>12.1f}  {closed_mwh['hp_electric']/yr:>12.1f}  {annual['hp_electric']/yr:>12.1f}")
        print(f"{'Boiler':<25} {open_mwh['boiler_thermal']/yr:>12.1f}  {closed_mwh['boiler_thermal']/yr:>12.1f}  {annual['boiler_thermal']/yr:>12.1f}")
        print("-"*80)
        print(f"{'Total System Electricity':<25} {open_mwh['total_electric']/yr:>12.1f}  {closed_mwh['total_electric']/yr:>12.1f}  {annual['total_electric']/yr:>12.1f}")
        
        if not shower_connected and shower_enabled:
            print(f"{'Shower heating (separate)':<25} {'':<12}  {'':<12}  {annual['shower_thermal']/yr:>12.1f}")
            print("-"*80)
            total_facility = annual['total_electric']/yr + annual['shower_thermal']/yr
            print(f"{'Total Electricity use':<25} {'':<12}  {'':<12}  {total_facility:>12.1f}")
        else:
            print("-"*80)
        
        print()
        
        viol = stats['violations']
        print(f"TEMPERATURE:")
        print(f"  Min/Avg/Max:      {viol['water_min']:.2f} / {viol['water_mean']:.2f} / {viol['water_max']:.2f}°C")
        print(f"  Days < 27°C:      {viol['days_below_27']:>8d}")
        print(f"  Days < 26°C:      {viol['days_below_26']:>8d}")
        print()

def main():
    """Main entry point"""
    
    # Load configuration
    config = load_config(CONFIG_FILE)
    
    # Create system
    system = PoolEnergySystemV56(config)
    
    try:
        # Run simulation
        results, stats = system.simulate_year()
        
        # Add metadata to stats
        stats['metadata'] = {
            'simulator_version': VERSION,
            'run_timestamp': datetime.now().isoformat(),
            'config_file': CONFIG_FILE
        }
        
        system.print_summary(stats)
        
        # Save outputs
        output_dir = config['_resolved_paths']['output_dir']
        os.makedirs(output_dir, exist_ok=True)
        
        # Generate filenames based on config
        csv_filename = generate_output_filename(config, 'hourly')
        json_filename = generate_output_filename(config, 'stats')
        
        output_csv = os.path.join(output_dir, csv_filename)
        output_json = os.path.join(output_dir, json_filename)
        
        results.to_csv(output_csv, index=False)
        
        # Also save compressed version automatically
        compressed_csv = output_csv + '.gz'
        results.to_csv(compressed_csv, index=False, compression='gzip')
        
        with open(output_json, 'w') as f:
            json.dump(stats, f, indent=2, default=str)
        
        # Calculate file sizes
        csv_size = os.path.getsize(output_csv) / 1024 / 1024
        gz_size = os.path.getsize(compressed_csv) / 1024 / 1024
        
        print("\n✓ Files saved:")
        print(f"  - {csv_filename} ({csv_size:.1f} MB)")
        print(f"  - {csv_filename}.gz ({gz_size:.1f} MB, {gz_size/csv_size*100:.0f}% of original)")
        print(f"  - {json_filename}")
    
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
