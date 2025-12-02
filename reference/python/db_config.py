#!/usr/bin/env python3
"""
HeatAQ Database Configuration
Loads database credentials from environment file or environment variables
"""

import os
from pathlib import Path


def load_env_file(env_path):
    """
    Load configuration from .env style file

    Args:
        env_path: Path to the env file

    Returns:
        Dict of key-value pairs
    """
    config = {}

    if not os.path.exists(env_path):
        return config

    with open(env_path, 'r') as f:
        for line in f:
            line = line.strip()
            # Skip comments and empty lines
            if not line or line.startswith(';') or line.startswith('#'):
                continue
            # Parse key=value
            if '=' in line:
                key, value = line.split('=', 1)
                config[key.strip()] = value.strip()

    return config


def get_db_config():
    """
    Get database configuration from multiple possible sources:
    1. Environment variables (for production/docker)
    2. database.env file in simulator directory
    3. database.env file in parent directory
    4. config_heataq/database.env (production path)

    Returns:
        Dict with DB_HOST, DB_NAME, DB_USER, DB_PASS
    """
    # Check environment variables first
    if all(os.environ.get(k) for k in ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS']):
        return {
            'DB_HOST': os.environ['DB_HOST'],
            'DB_NAME': os.environ['DB_NAME'],
            'DB_USER': os.environ['DB_USER'],
            'DB_PASS': os.environ['DB_PASS'],
            'APP_ENV': os.environ.get('APP_ENV', 'development'),
            'APP_DEBUG': os.environ.get('APP_DEBUG', 'true').lower() == 'true'
        }

    # Try multiple file locations
    possible_paths = [
        # Local development
        Path(__file__).parent / 'database.env',
        Path(__file__).parent.parent / 'database.env',
        # Production paths
        Path('/config_heataq/database.env'),
        Path.home() / 'config_heataq' / 'database.env',
    ]

    for env_path in possible_paths:
        if env_path.exists():
            config = load_env_file(str(env_path))
            if config.get('DB_HOST'):
                print(f"✓ Loaded config from {env_path}")
                return {
                    'DB_HOST': config.get('DB_HOST'),
                    'DB_NAME': config.get('DB_NAME'),
                    'DB_PASS': config.get('DB_PASS'),
                    'DB_USER': config.get('DB_USER'),
                    'APP_ENV': config.get('APP_ENV', 'development'),
                    'APP_DEBUG': config.get('APP_DEBUG', 'true').lower() == 'true'
                }

    raise FileNotFoundError(
        "Database configuration not found. Please create database.env file or set environment variables."
    )


# Database configuration singleton
_db_config = None

def get_config():
    """Get cached database configuration"""
    global _db_config
    if _db_config is None:
        _db_config = get_db_config()
    return _db_config
