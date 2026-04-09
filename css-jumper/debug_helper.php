<?php
/**
 * CSS Jumper - PHP デバッグヘルパー
 *
 * 使い方:
 *   require_once 'debug_helper.php';
 *
 *   <div <?= php_src() ?>>...</div>
 *   → <div data-php-src="C:/path/to/template.php:42">...</div>
 *
 * Alt+クリックでそのPHPファイルの該当行をVS Codeで開きます。
 *
 * 本番環境では以下の定数を false にすること（属性が出力されなくなります）:
 *   define('CSS_JUMPER_DEBUG', false);
 */

if (!defined('CSS_JUMPER_DEBUG')) {
    // 本番では false に変える
    define('CSS_JUMPER_DEBUG', true);
}

/**
 * data-php-src 属性文字列を返す
 *
 * @param int $depth 呼び出し元をどの深さで取得するか（通常は0でOK）
 * @return string  例: data-php-src="C:/path/to/file.php:42"
 *                     （CSS_JUMPER_DEBUG が false なら空文字）
 */
function php_src($depth = 0) {
    if (!CSS_JUMPER_DEBUG) return '';

    $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, $depth + 1);
    $frame = isset($trace[$depth]) ? $trace[$depth] : $trace[0];

    // Windows バックスラッシュ → スラッシュに統一
    $file = isset($frame['file']) ? str_replace('\\', '/', $frame['file']) : '';
    $line = isset($frame['line']) ? (int)$frame['line'] : 1;

    return 'data-php-src="' . htmlspecialchars($file . ':' . $line, ENT_QUOTES) . '"';
}

/**
 * WordPress テンプレート用ラッパー
 * get_template_part() の前後に呼び出すと、テンプレートファイルへジャンプできる
 *
 * 使い方（WordPress functions.php）:
 *   add_filter('template_include', 'css_jumper_add_php_src');
 *
 * または個別テンプレートで直接使用:
 *   <section <?= php_src() ?>>
 */
