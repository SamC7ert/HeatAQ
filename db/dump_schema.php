<?php
/**
 * Database Schema Dump Script (command line)
 * Generates a complete schema description and saves to db/schema.json / schema.md
 *
 * Usage: php db/dump_schema.php [--push] [--json]
 * From the app: Admin -> System runs the same code in-process
 * (heataq_api action dump_schema -> lib/SchemaDumper.php).
 */

// Command line only: this script must never run from a web request.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/SchemaDumper.php';

$args = $argv ?? [];
$asJson = in_array('--json', $args, true);

try {
    $result = SchemaDumper::dump(Config::getDatabase(), in_array('--push', $args, true));

    if ($asJson) {
        echo json_encode($result);
    } else {
        echo "Schema dumped to:\n";
        echo "  - db/schema.json\n";
        echo "  - db/schema.md\n";
        echo "\nTables found: " . $result['tables'] . "\n";
        if (!empty($result['git'])) {
            echo "\nGit: " . ($result['git']['merged'] ? "Pushed and merged to master" : "Failed") . "\n";
            echo $result['git']['output'] . "\n";
        }
    }
} catch (Exception $e) {
    echo $asJson ? json_encode(['error' => $e->getMessage()]) : "Error: " . $e->getMessage() . "\n";
    exit(1);
}
