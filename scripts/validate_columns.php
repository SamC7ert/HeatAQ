#!/usr/bin/env php
<?php
/**
 * Database Column Validator
 * Validates SQL queries in PHP files against db/schema.json
 *
 * Usage: php scripts/validate_columns.php [--verbose]
 */

$verbose = in_array('--verbose', $argv) || in_array('-v', $argv);

// Load schema
$schemaPath = __DIR__ . '/../db/schema.json';
if (!file_exists($schemaPath)) {
    echo "ERROR: schema.json not found at $schemaPath\n";
    exit(1);
}

$schema = json_decode(file_get_contents($schemaPath), true);
if (!$schema || !isset($schema['tables'])) {
    echo "ERROR: Invalid schema.json format\n";
    exit(1);
}

// Build lookup tables
$validTables = [];
$validColumns = [];  // table => [columns]
$allColumns = [];    // All column names across all tables

foreach ($schema['tables'] as $tableName => $tableInfo) {
    $validTables[] = $tableName;
    $validColumns[$tableName] = [];
    foreach ($tableInfo['columns'] as $col) {
        $validColumns[$tableName][] = $col['name'];
        $allColumns[$col['name']] = true;
    }
}

// Find PHP files to scan
$phpFiles = [];
$dirs = ['api', 'lib'];
foreach ($dirs as $dir) {
    $path = __DIR__ . '/../' . $dir;
    if (is_dir($path)) {
        foreach (glob("$path/*.php") as $file) {
            $phpFiles[] = $file;
        }
    }
}

$errors = [];
$warnings = [];

foreach ($phpFiles as $file) {
    $content = file_get_contents($file);
    $lines = explode("\n", $content);
    $relPath = basename(dirname($file)) . '/' . basename($file);

    foreach ($lines as $lineNum => $line) {
        $lineNo = $lineNum + 1;

        // Skip comments
        $trimmed = trim($line);
        if (str_starts_with($trimmed, '//') || str_starts_with($trimmed, '*') || str_starts_with($trimmed, '/*')) {
            continue;
        }

        // Pattern 1: Table.column references (e.g., "p.pool_id", "pools.name")
        if (preg_match_all('/\b([a-z_]+)\.([a-z_]+)\b/i', $line, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $alias = strtolower($match[1]);
                $column = strtolower($match[2]);

                // Skip common non-table patterns
                if (in_array($alias, ['$this', 'self', 'parent', '$row', '$data', '$result', '$config'])) {
                    continue;
                }
                // Skip file extensions and paths
                if (in_array($column, ['php', 'js', 'json', 'html', 'css', 'sql', 'md', 'txt', 'log'])) {
                    continue;
                }
                // Skip PHP object access patterns
                if (preg_match('/\$\w+\s*->\s*' . preg_quote($alias, '/') . '\s*\./i', $line)) {
                    continue;
                }

                // If alias matches a table name exactly, validate the column
                if (in_array($alias, $validTables)) {
                    if (!in_array($column, $validColumns[$alias])) {
                        $errors[] = [
                            'file' => $relPath,
                            'line' => $lineNo,
                            'message' => "Invalid column '$column' for table '$alias'",
                            'context' => trim($line)
                        ];
                    }
                }
            }
        }

        // Pattern 2: FROM/JOIN/INTO table references
        // These keywords reliably indicate a table name follows, regardless of multi-line SQL
        // Skip lines with ON DUPLICATE KEY UPDATE or ON UPDATE (timestamp triggers)
        // Skip lines that are clearly not SQL (comments, exception messages, array values)
        $looksLikeSql = preg_match('/SELECT|INSERT|UPDATE|DELETE|WHERE|LEFT|RIGHT|INNER|ORDER|GROUP|HAVING/i', $line)
                     || preg_match('/^\s*FROM\s+/i', $line)  // Line starting with FROM (multi-line SQL)
                     || preg_match('/^\s*(?:LEFT|RIGHT|INNER|CROSS)?\s*JOIN\s+/i', $line);  // Line starting with JOIN

        // Not SQL: exception messages, return strings, array assignments with 'from'
        $notSql = preg_match('/throw new|Exception\(|\'source\'|\/\/.*from/i', $line);

        if ($looksLikeSql && !$notSql && !preg_match('/ON\s+(DUPLICATE\s+KEY\s+)?UPDATE/i', $line)) {

            // Match FROM table, JOIN table, INTO table
            if (preg_match_all('/\b(?:FROM|JOIN|INTO)\s+([a-z_][a-z0-9_]*)\b/i', $line, $matches)) {
                foreach ($matches[1] as $table) {
                    $table = strtolower($table);
                    // Skip SQL keywords
                    $skipWords = ['dual', 'information_schema', 'set', 'values', 'select', 'where'];
                    if (!in_array($table, $validTables) && !in_array($table, $skipWords)) {
                        if (!preg_match('/\$/', $line)) {
                            $errors[] = [
                                'file' => $relPath,
                                'line' => $lineNo,
                                'message' => "Unknown table '$table'",
                                'context' => trim($line)
                            ];
                        }
                    }
                }
            }

            // UPDATE at start of SQL statement
            if (preg_match('/^\s*["\']?\s*UPDATE\s+([a-z_][a-z0-9_]*)\b/i', $line, $match) ||
                preg_match('/\$\w+\s*=\s*["\']UPDATE\s+([a-z_][a-z0-9_]*)\b/i', $line, $match)) {
                $table = strtolower($match[1]);
                if (!in_array($table, $validTables)) {
                    $errors[] = [
                        'file' => $relPath,
                        'line' => $lineNo,
                        'message' => "Unknown table '$table'",
                        'context' => trim($line)
                    ];
                }
            }
        }

        // Pattern 3: Explicit table.column in SQL (most reliable)
        // e.g., pools.pool_id, day_schedules.name
        if (preg_match('/\b(?:SELECT|WHERE|AND|OR|ON|SET|ORDER BY)\b/i', $line)) {
            if (preg_match_all('/\b([a-z_]+)\.([a-z_]+)\b/', $line, $matches, PREG_SET_ORDER)) {
                foreach ($matches as $match) {
                    $table = strtolower($match[1]);
                    $column = strtolower($match[2]);

                    // Only validate if the prefix is a known table name
                    if (in_array($table, $validTables)) {
                        if (!in_array($column, $validColumns[$table])) {
                            $errors[] = [
                                'file' => $relPath,
                                'line' => $lineNo,
                                'message' => "Column '$table.$column' does not exist (valid: " . implode(', ', array_slice($validColumns[$table], 0, 5)) . "...)",
                                'context' => trim($line)
                            ];
                        }
                    }
                }
            }
        }
    }
}

// Output results
if (empty($errors) && empty($warnings)) {
    echo "All column references validated against schema.json\n";
    echo "Checked " . count($phpFiles) . " PHP files, " . count($validTables) . " tables\n";
    exit(0);
}

if (!empty($errors)) {
    echo "\n=== ERRORS ===\n";
    foreach ($errors as $err) {
        echo "\n{$err['file']}:{$err['line']}: {$err['message']}\n";
        echo "  > {$err['context']}\n";
    }
}

if (!empty($warnings) && $verbose) {
    echo "\n=== WARNINGS ===\n";
    foreach ($warnings as $warn) {
        echo "\n{$warn['file']}:{$warn['line']}: {$warn['message']}\n";
        echo "  > {$warn['context']}\n";
    }
}

echo "\n";
echo "Found " . count($errors) . " error(s)";
if ($verbose) {
    echo ", " . count($warnings) . " warning(s)";
}
echo "\n";

exit(count($errors) > 0 ? 1 : 0);
