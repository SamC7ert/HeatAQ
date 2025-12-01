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

    // Check if git push requested
    $pushToGit = isset($_GET['push']) || (isset($argv[1]) && $argv[1] === '--push');
    $gitResult = null;

    if ($pushToGit) {
        $projectRoot = dirname(__DIR__);
        $branch = 'db-schema-update';  // Fixed branch name - no more timestamp proliferation
        $commitMsg = 'Update database schema ' . date('Y-m-d H:i');

        // Run git commands:
        // 1. Commit to schema branch
        // 2. Push schema branch
        // 3. Merge into master
        // 4. Push master
        $commands = [
            "cd " . escapeshellarg($projectRoot),
            "git checkout " . escapeshellarg($branch) . " 2>/dev/null || git checkout -b " . escapeshellarg($branch),
            "git add db/schema.json db/schema.md",
            "git commit -m " . escapeshellarg($commitMsg) . " || echo 'No changes to commit'",
            "git push -u origin " . escapeshellarg($branch),
            "git checkout master",
            "git merge " . escapeshellarg($branch) . " -m " . escapeshellarg("Merge $branch: $commitMsg"),
            "git push origin master"
        ];

        $fullCommand = implode(' && ', $commands) . ' 2>&1';
        $output = shell_exec($fullCommand);

        $merged = strpos($output, 'fatal') === false && strpos($output, 'CONFLICT') === false;
        $gitResult = [
            'pushed' => $merged,
            'merged' => $merged,
            'branch' => $branch,
            'output' => $output
        ];
    }

    // Output result
    if (php_sapi_name() === 'cli') {
        echo "Schema dumped to:\n";
        echo "  - $jsonPath\n";
        echo "  - $mdPath\n";
        echo "\nTables found: " . count($schema['tables']) . "\n";
        if ($gitResult) {
            echo "\nGit: " . ($gitResult['merged'] ? "Pushed and merged to master" : "Failed") . "\n";
            echo $gitResult['output'] . "\n";
        }
    } else {
        header('Content-Type: application/json');
        $response = [
            'status' => 'success',
            'tables' => count($schema['tables']),
            'json_path' => 'db/schema.json',
            'md_path' => 'db/schema.md'
        ];
        if ($gitResult) {
            $response['git'] = $gitResult;
        }
        echo json_encode($response);
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
