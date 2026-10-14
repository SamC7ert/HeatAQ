<?php
/**
 * Database schema dump: writes db/schema.json and db/schema.md (tables,
 * columns, indexes, row counts), optionally committing them to git.
 *
 * Runs inside the web request (heataq_api action dump_schema / export_schema)
 * on the app's own PDO connection. It used to be started as a separate
 * command-line `php` process, but on the host the CLI PHP has no PDO
 * extension ("Class PDO not found"). db/dump_schema.php is the CLI wrapper.
 */
class SchemaDumper {
    /**
     * @param PDO  $pdo
     * @param bool $pushToGit commit db/schema.* to the db-schema-update branch,
     *                        merge it into master and push
     * @return array ['status','tables','json_path','md_path'(,'git')]
     */
    public static function dump(PDO $pdo, $pushToGit = false) {
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $dbDir = dirname(__DIR__) . '/db';

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
        $jsonPath = $dbDir . '/schema.json';
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

        $mdPath = $dbDir . '/schema.md';
        file_put_contents($mdPath, $md);

        // Check if git push requested
        $gitResult = null;

        if ($pushToGit) {
            $projectRoot = dirname($dbDir);
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
            $output = (string) shell_exec($fullCommand);

            $merged = strpos($output, 'fatal') === false && strpos($output, 'CONFLICT') === false;
            $gitResult = [
                'pushed' => $merged,
                'merged' => $merged,
                'branch' => $branch,
                'output' => $output
            ];
        }


        $response = [
            'status' => 'success',
            'tables' => count($schema['tables']),
            'json_path' => 'db/schema.json',
            'md_path' => 'db/schema.md'
        ];
        if ($gitResult) {
            $response['git'] = $gitResult;
        }
        return $response;
    }
}
