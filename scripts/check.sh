#!/bin/bash
# HeatAQ Pre-commit Check Script
# Run: ./scripts/check.sh

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0

echo "========================================"
echo "HeatAQ Pre-commit Checks"
echo "========================================"
echo ""

# 1. Check PHP syntax
echo -e "${YELLOW}[1/5] Checking PHP syntax...${NC}"
for file in $(find . -name "*.php" -not -path "./vendor/*" 2>/dev/null); do
    result=$(php -l "$file" 2>&1)
    if [[ $? -ne 0 ]]; then
        echo -e "${RED}  FAIL: $file${NC}"
        echo "        $result"
        ((ERRORS++))
    fi
done
if [[ $ERRORS -eq 0 ]]; then
    echo -e "${GREEN}  All PHP files OK${NC}"
fi

# 2. Check version consistency
echo ""
echo -e "${YELLOW}[2/5] Checking version consistency...${NC}"
HEADER_VER=$(grep -oP 'V[0-9]+' index.html | head -1)
CACHE_VER=$(grep -oP '\?v=[0-9]+' index.html | head -1 | grep -oP '[0-9]+')

echo "  Header version: $HEADER_VER"
echo "  Cache-bust param: v=$CACHE_VER"

HEADER_NUM=$(echo $HEADER_VER | grep -oP '[0-9]+')
if [[ "$HEADER_NUM" != "$CACHE_VER" ]]; then
    echo -e "${RED}  FAIL: Version mismatch! Header=$HEADER_NUM, Cache=$CACHE_VER${NC}"
    ((ERRORS++))
else
    echo -e "${GREEN}  Versions match${NC}"
fi

# 3. Check for common JS issues
echo ""
echo -e "${YELLOW}[3/5] Checking for undefined references...${NC}"
# Look for common patterns that indicate undefined variables
UNDEF=$(grep -rn "getElementById.*null" assets/js/modules/*.js 2>/dev/null | head -5)
if [[ -n "$UNDEF" ]]; then
    echo -e "${YELLOW}  Warning: Potential null element access:${NC}"
    echo "$UNDEF"
fi

# Check for configId usage (known past issue)
CONFIGID=$(grep -rn '\bconfigId\b' assets/js/modules/*.js 2>/dev/null | grep -v "const configId" | grep -v "let configId" | head -5)
if [[ -n "$CONFIGID" ]]; then
    echo -e "${YELLOW}  Warning: configId usage (check if defined):${NC}"
    echo "$CONFIGID"
fi

echo -e "${GREEN}  JS check complete${NC}"

# 4. Check API endpoint consistency
echo ""
echo -e "${YELLOW}[4/5] Checking API endpoints...${NC}"
# Extract actions called from JS
JS_ACTIONS=$(grep -ohP "action=\w+" assets/js/modules/*.js 2>/dev/null | sort -u | sed 's/action=//')
# Extract actions handled in PHP
PHP_ACTIONS=$(grep -ohP "case '\w+':" api/*.php 2>/dev/null | sed "s/case '//;s/'://" | sort -u)

MISSING=""
for action in $JS_ACTIONS; do
    if ! echo "$PHP_ACTIONS" | grep -q "^${action}$"; then
        MISSING="$MISSING $action"
    fi
done

if [[ -n "$MISSING" ]]; then
    echo -e "${RED}  FAIL: JS calls these actions not found in PHP:$MISSING${NC}"
    ((ERRORS++))
else
    echo -e "${GREEN}  All JS actions have PHP handlers${NC}"
fi

# 5. Check database column references
echo ""
echo -e "${YELLOW}[5/5] Checking database column references...${NC}"
if [[ -f "scripts/validate_columns.php" ]]; then
    COLUMN_OUTPUT=$(php scripts/validate_columns.php 2>&1)
    COLUMN_EXIT=$?
    if [[ $COLUMN_EXIT -ne 0 ]]; then
        echo -e "${RED}  FAIL: Invalid column/table references found${NC}"
        echo "$COLUMN_OUTPUT" | grep -E "^api/|^lib/" | head -10 | while read line; do
            echo -e "  $line"
        done
        ((ERRORS++))
    else
        echo -e "${GREEN}  $COLUMN_OUTPUT${NC}"
    fi
else
    echo -e "${YELLOW}  Skipped: validate_columns.php not found${NC}"
fi

# Summary
echo ""
echo "========================================"
if [[ $ERRORS -eq 0 ]]; then
    echo -e "${GREEN}All checks passed!${NC}"
else
    echo -e "${RED}Found $ERRORS error(s)${NC}"
fi
echo "========================================"

exit $ERRORS
