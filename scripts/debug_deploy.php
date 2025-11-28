<?php
/**
 * Git deployment debug script
 * DELETE THIS FILE after debugging (security risk)
 */
header('Content-Type: text/plain');
echo "=== Git Deploy Debug ===\n\n";

echo "Working directory: " . getcwd() . "\n";
echo "Script location: " . __DIR__ . "\n\n";

echo "--- Git Status ---\n";
echo shell_exec('git status 2>&1') . "\n";

echo "--- Remote URL ---\n";
echo shell_exec('git remote -v 2>&1') . "\n";

echo "--- Current HEAD ---\n";
echo shell_exec('git rev-parse HEAD 2>&1') . "\n";

echo "--- Current Branch ---\n";
echo shell_exec('git branch --show-current 2>&1') . "\n";

echo "--- Last 5 Commits ---\n";
echo shell_exec('git log --oneline -5 2>&1') . "\n";

echo "--- Fetch from origin ---\n";
echo shell_exec('git fetch origin master 2>&1') . "\n";

echo "--- Commits behind origin/master ---\n";
echo shell_exec('git log HEAD..origin/master --oneline 2>&1') . "\n";

echo "--- App Version in index.html ---\n";
$index = file_get_contents(__DIR__ . '/../index.html');
if (preg_match('/App Version<\/strong><\/td><td>(V\d+)/', $index, $m)) {
    echo $m[1] . "\n";
} else {
    echo "Could not find version\n";
}
