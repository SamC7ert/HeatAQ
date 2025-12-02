#!/usr/bin/env python3
"""
HeatAQ Database Connection
Provides MySQL database connection for the simulator
"""

import mysql.connector
from mysql.connector import Error
from contextlib import contextmanager
from db_config import get_config


class DatabaseConnection:
    """
    MySQL database connection manager with connection pooling support
    """

    def __init__(self, config=None):
        """
        Initialize database connection

        Args:
            config: Optional config dict. If None, loads from db_config
        """
        self.config = config or get_config()
        self._connection = None

    def connect(self):
        """Establish database connection"""
        if self._connection is None or not self._connection.is_connected():
            try:
                self._connection = mysql.connector.connect(
                    host=self.config['DB_HOST'],
                    database=self.config['DB_NAME'],
                    user=self.config['DB_USER'],
                    password=self.config['DB_PASS'],
                    charset='utf8mb4',
                    autocommit=True
                )
                if self.config.get('APP_DEBUG'):
                    print(f"✓ Connected to database: {self.config['DB_NAME']}")
            except Error as e:
                print(f"✗ Database connection failed: {e}")
                raise

        return self._connection

    def close(self):
        """Close database connection"""
        if self._connection and self._connection.is_connected():
            self._connection.close()
            self._connection = None

    def get_cursor(self, dictionary=True):
        """
        Get database cursor

        Args:
            dictionary: If True, returns rows as dicts instead of tuples

        Returns:
            MySQL cursor
        """
        conn = self.connect()
        return conn.cursor(dictionary=dictionary)

    def execute(self, query, params=None):
        """
        Execute a query and return results

        Args:
            query: SQL query string
            params: Optional query parameters (tuple or dict)

        Returns:
            List of result rows (as dicts)
        """
        cursor = self.get_cursor(dictionary=True)
        try:
            cursor.execute(query, params or ())
            if cursor.description:  # SELECT query
                return cursor.fetchall()
            return []
        finally:
            cursor.close()

    def execute_one(self, query, params=None):
        """
        Execute a query and return single result

        Args:
            query: SQL query string
            params: Optional query parameters

        Returns:
            Single result row (as dict) or None
        """
        results = self.execute(query, params)
        return results[0] if results else None

    def __enter__(self):
        """Context manager entry"""
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit"""
        self.close()


@contextmanager
def get_db():
    """
    Context manager for database connection

    Usage:
        with get_db() as db:
            results = db.execute("SELECT * FROM users")
    """
    db = DatabaseConnection()
    try:
        yield db
    finally:
        db.close()


# Convenience function for quick queries
def query(sql, params=None):
    """
    Execute a query and return results

    Args:
        sql: SQL query string
        params: Optional query parameters

    Returns:
        List of result rows
    """
    with get_db() as db:
        return db.execute(sql, params)


def query_one(sql, params=None):
    """
    Execute a query and return single result

    Args:
        sql: SQL query string
        params: Optional query parameters

    Returns:
        Single result row or None
    """
    with get_db() as db:
        return db.execute_one(sql, params)
