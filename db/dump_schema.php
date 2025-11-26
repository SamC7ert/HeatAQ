<?php
/**
 * Database Schema Dump Script
 * Generates a complete schema description and saves to db/schema.json
 *
 * Usage: php db/dump_schema.php
 * Or via web: /db/dump_schema.php (if accessible)
 */

require_once __DIR__ . '/../config.php';

try {
    $pdo = Config::getDatabase();
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // Get database name from connection
    $dbName = $pdo->query("SELECT DATABASE()")->fetchColumn();

    $schema = [
        'generated_at' => date('Y-m-d H:i:s'),
        'database' => $dbName,
        'tables' => []
    ];

    // Get all tables
    $tables = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);

    foreach ($tables as $table) {
        $tableInfo = [
            'name' => $table,
            'columns' => [],
            'indexes' => [],
            'row_count' => 0
        ];

        // Get column info
        $columns = $pdo->query("DESCRIBE `$table`")->fetchAll(PDO::FETCH_ASSOC);
        foreach ($columns as $col) {
            $tableInfo['columns'][] = [
                'name' => $col['Field'],
                'type' => $col['Type'],
                'null' => $col['Null'],
                'key' => $col['Key'],
                'default' => $col['Default'],
                'extra' => $col['Extra']
            ];
        }

        // Get indexes
        $indexes = $pdo->query("SHOW INDEX FROM `$table`")->fetchAll(PDO::FETCH_ASSOC);
        $indexMap = [];
        foreach ($indexes as $idx) {
            $keyName = $idx['Key_name'];
            if (!isset($indexMap[$keyName])) {
                $indexMap[$keyName] = [
                    'name' => $keyName,
                    'unique' => !$idx['Non_unique'],
                    'columns' => []
                ];
            }
            $indexMap[$keyName]['columns'][] = $idx['Column_name'];
        }
        $tableInfo['indexes'] = array_values($indexMap);

        // Get row count
        $count = $pdo->query("SELECT COUNT(*) FROM `$table`")->fetchColumn();
        $tableInfo['row_count'] = (int)$count;

        $schema['tables'][$table] = $tableInfo;
    }

    // Save to JSON file
    $jsonPath = __DIR__ . '/schema.json';
    file_put_contents($jsonPath, json_encode($schema, JSON_PRETTY_PRINT));

    // Also create a readable markdown version
    $md = "# Database Schema\n\n";
    $md .= "Generated: {$schema['generated_at']}\n\n";
    $md .= "Database: {$schema['database']}\n\n";

    foreach ($schema['tables'] as $tableName => $table) {
        $md .= "## $tableName\n\n";
        $md .= "Rows: {$table['row_count']}\n\n";
        $md .= "| Column | Type | Null | Key | Default | Extra |\n";
        $md .= "|--------|------|------|-----|---------|-------|\n";
        foreach ($table['columns'] as $col) {
            $default = $col['default'] ?? 'NULL';
            $md .= "| {$col['name']} | {$col['type']} | {$col['null']} | {$col['key']} | $default | {$col['extra']} |\n";
        }
        $md .= "\n";

        if (!empty($table['indexes'])) {
            $md .= "**Indexes:**\n";
            foreach ($table['indexes'] as $idx) {
                $unique = $idx['unique'] ? 'UNIQUE ' : '';
                $cols = implode(', ', $idx['columns']);
                $md .= "- {$unique}`{$idx['name']}` ($cols)\n";
            }
            $md .= "\n";
        }
    }

    $mdPath = __DIR__ . '/schema.md';
    file_put_contents($mdPath, $md);

    // Output result
    if (php_sapi_name() === 'cli') {
        echo "Schema dumped to:\n";
        echo "  - $jsonPath\n";
        echo "  - $mdPath\n";
        echo "\nTables found: " . count($schema['tables']) . "\n";
    } else {
        header('Content-Type: application/json');
        echo json_encode([
            'status' => 'success',
            'tables' => count($schema['tables']),
            'json_path' => 'db/schema.json',
            'md_path' => 'db/schema.md'
        ]);
    }

} catch (Exception $e) {
    if (php_sapi_name() === 'cli') {
        echo "Error: " . $e->getMessage() . "\n";
        exit(1);
    } else {
        header('Content-Type: application/json');
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
}
