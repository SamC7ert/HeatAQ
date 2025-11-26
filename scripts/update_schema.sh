#!/bin/bash
# Update schema and commit to git
# Run from project root: ./scripts/update_schema.sh

cd "$(dirname "$0")/.." || exit 1

echo "Dumping schema..."
php db/dump_schema.php

if [ $? -ne 0 ]; then
    echo "Schema dump failed"
    exit 1
fi

echo "Checking for changes..."
git add db/schema.json db/schema.md

if git diff --cached --quiet; then
    echo "No schema changes to commit"
    exit 0
fi

echo "Committing..."
git commit -m "Auto-update database schema $(date +%Y-%m-%d)"

echo "Pushing..."
git push

echo "Done!"
