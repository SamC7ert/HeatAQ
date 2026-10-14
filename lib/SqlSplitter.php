<?php
/**
 * Split a migration file into statements.
 *
 * The migration runner used to strip everything from "--" to the end of the
 * line and then explode(';'), so a ';' or "--" inside a quoted string (e.g. a
 * column COMMENT) cut a statement in half and the migration could never run.
 * This scanner only treats ';' and comments as such outside quotes.
 */
class SqlSplitter {
    /** @return string[] statements without comments, trimmed, non-empty */
    public static function split($sql) {
        $statements = [];
        $current = '';
        $len = strlen($sql);
        $quote = null;  // ', " or ` while inside a quoted string/identifier

        for ($i = 0; $i < $len; $i++) {
            $c = $sql[$i];
            $next = $i + 1 < $len ? $sql[$i + 1] : '';

            if ($quote !== null) {
                $current .= $c;
                if ($c === '\\' && $quote !== '`' && $next !== '') {
                    $current .= $next;  // backslash escape
                    $i++;
                } elseif ($c === $quote) {
                    if ($next === $quote) {  // doubled quote = literal quote
                        $current .= $next;
                        $i++;
                    } else {
                        $quote = null;
                    }
                }
                continue;
            }

            // "-- " / "--" at end of line, and "#": comment to end of line
            if (($c === '-' && $next === '-' && ($i + 2 >= $len || ctype_space($sql[$i + 2]))) || $c === '#') {
                $end = strpos($sql, "\n", $i);
                $i = ($end === false) ? $len : $end - 1;
                continue;
            }
            // /* ... */ block comment
            if ($c === '/' && $next === '*') {
                $end = strpos($sql, '*/', $i + 2);
                $i = ($end === false) ? $len : $end + 1;
                $current .= ' ';
                continue;
            }

            if ($c === "'" || $c === '"' || $c === '`') {
                $quote = $c;
                $current .= $c;
                continue;
            }

            if ($c === ';') {
                if (trim($current) !== '') {
                    $statements[] = trim($current);
                }
                $current = '';
                continue;
            }

            $current .= $c;
        }

        if (trim($current) !== '') {
            $statements[] = trim($current);
        }
        return $statements;
    }
}
