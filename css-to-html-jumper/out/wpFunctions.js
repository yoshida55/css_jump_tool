"use strict";
/**
 * WordPress関数メタデータ
 * AIチェック前にコードへ注釈を付与するために使用
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WP_FUNCTION_MAP = void 0;
exports.annotatePhpCode = annotatePhpCode;
exports.WP_FUNCTION_MAP = {
    // ── 直接出力・安全（そのまま呼ぶだけでOK） ──────────────────────────
    'the_title': { category: 'direct_output', safe: true, returnVersion: 'get_the_title', note: '直接出力・安全。そのまま呼ぶだけでOK。esc_html()の引数に渡すのは誤り' },
    'the_content': { category: 'direct_output', safe: true, returnVersion: 'get_the_content', note: '直接出力・内部でkses済み。そのまま呼ぶだけでOK。esc_html()の引数に渡すのは誤り' },
    'the_excerpt': { category: 'direct_output', safe: true, returnVersion: 'get_the_excerpt', note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'the_permalink': { category: 'direct_output', safe: true, returnVersion: 'get_permalink', note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'the_date': { category: 'direct_output', safe: true, returnVersion: 'get_the_date', note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'the_time': { category: 'direct_output', safe: true, returnVersion: 'get_the_time', note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'the_author': { category: 'direct_output', safe: true, returnVersion: 'get_the_author', note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'the_author_posts_link': { category: 'direct_output', safe: true, note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'the_tags': { category: 'direct_output', safe: true, note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'the_category': { category: 'direct_output', safe: true, note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'the_post_thumbnail': { category: 'direct_output', safe: true, returnVersion: 'get_the_post_thumbnail', note: '直接出力・安全。引数でサイズ・classを渡せる。そのまま呼ぶだけでOK' },
    'the_ID': { category: 'direct_output', safe: true, returnVersion: 'get_the_ID', note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'the_modified_date': { category: 'direct_output', safe: true, note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'the_modified_time': { category: 'direct_output', safe: true, note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'the_shortlink': { category: 'direct_output', safe: true, note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'the_post_thumbnail_caption': { category: 'direct_output', safe: true, note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'the_title_attribute': { category: 'direct_output', safe: true, note: '直接出力・属性値向けエスケープ済み。そのまま呼ぶだけでOK' },
    'wp_title': { category: 'direct_output', safe: true, note: '直接出力。そのまま呼ぶだけでOK（WordPress 4.1以降は非推奨、wp_get_document_title()を推奨）' },
    'wp_nav_menu': { category: 'direct_output', safe: true, note: '直接出力・安全。そのまま呼ぶだけでOK（echo=falseオプションで文字列取得可）' },
    'dynamic_sidebar': { category: 'direct_output', safe: true, note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'wp_footer': { category: 'action', safe: true, note: 'アクション実行。そのまま呼ぶだけでOK' },
    'wp_head': { category: 'action', safe: true, note: 'アクション実行。そのまま呼ぶだけでOK' },
    'body_class': { category: 'direct_output', safe: true, note: '直接出力。bodyタグ内で使用。そのまま呼ぶだけでOK' },
    'post_class': { category: 'direct_output', safe: true, note: '直接出力。記事ループ内で使用。そのまま呼ぶだけでOK' },
    'language_attributes': { category: 'direct_output', safe: true, note: '直接出力。htmlタグ内で使用。そのまま呼ぶだけでOK' },
    'bloginfo': { category: 'direct_output', safe: true, returnVersion: 'get_bloginfo', note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'comments_template': { category: 'direct_output', safe: true, note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'wp_list_comments': { category: 'direct_output', safe: true, note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'comment_form': { category: 'direct_output', safe: true, note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'next_posts_link': { category: 'direct_output', safe: true, note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'previous_posts_link': { category: 'direct_output', safe: true, note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'posts_nav_link': { category: 'direct_output', safe: true, note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'the_posts_pagination': { category: 'direct_output', safe: true, note: '直接出力・安全。そのまま呼ぶだけでOK' },
    'get_template_part': { category: 'action', safe: true, note: 'テンプレートファイルを読み込む。そのまま呼ぶだけでOK' },
    'get_header': { category: 'action', safe: true, note: 'ヘッダーテンプレートを読み込む。そのまま呼ぶだけでOK' },
    'get_footer': { category: 'action', safe: true, note: 'フッターテンプレートを読み込む。そのまま呼ぶだけでOK' },
    'get_sidebar': { category: 'action', safe: true, note: 'サイドバーテンプレートを読み込む。そのまま呼ぶだけでOK' },
    // ── 値を返す・esc_html()が必要 ──────────────────────────────────────
    'get_the_title': { category: 'returns_value', safe: false, escape: 'esc_html', note: '文字列を返す。echo esc_html(get_the_title()) が正しい' },
    'get_the_excerpt': { category: 'returns_value', safe: false, escape: 'esc_html', note: '文字列を返す。echo esc_html(get_the_excerpt()) が正しい' },
    'get_the_author': { category: 'returns_value', safe: false, escape: 'esc_html', note: '文字列を返す。echo esc_html(get_the_author()) が正しい' },
    'get_the_date': { category: 'returns_value', safe: false, escape: 'esc_html', note: '文字列を返す。echo esc_html(get_the_date()) が正しい' },
    'get_the_time': { category: 'returns_value', safe: false, escape: 'esc_html', note: '文字列を返す。echo esc_html(get_the_time()) が正しい' },
    'get_the_ID': { category: 'returns_value', safe: true, escape: 'intval', note: '数値を返す。echo intval(get_the_ID()) またはそのまま変数として使用' },
    'get_bloginfo': { category: 'returns_value', safe: false, escape: 'esc_html', note: '文字列を返す。echo esc_html(get_bloginfo()) が正しい' },
    'get_the_category_list': { category: 'returns_value', safe: true, note: 'HTML文字列を返す（内部でエスケープ済み）。そのままechoでOK' },
    'get_the_tag_list': { category: 'returns_value', safe: true, note: 'HTML文字列を返す（内部でエスケープ済み）。そのままechoでOK' },
    'get_the_content': { category: 'returns_value', safe: true, note: 'HTML文字列を返す（内部でkses済み）。そのままechoでOK' },
    'get_the_post_thumbnail': { category: 'returns_value', safe: true, note: 'HTML文字列（imgタグ）を返す。そのままechoでOK' },
    'get_the_post_thumbnail_url': { category: 'returns_value', safe: false, escape: 'esc_url', note: 'URL文字列を返す。echo esc_url(get_the_post_thumbnail_url()) が正しい' },
    'get_post_meta': { category: 'returns_value', safe: false, escape: 'esc_html', note: '任意の値を返す。出力時はesc_html()等でエスケープ必要' },
    'get_option': { category: 'returns_value', safe: false, escape: 'esc_html', note: 'オプション値を返す。出力時はesc_html()等でエスケープ必要' },
    'get_theme_mod': { category: 'returns_value', safe: false, escape: 'esc_html', note: 'テーマカスタマイズ値を返す。出力時はesc_html()等でエスケープ必要' },
    'get_field': { category: 'returns_value', safe: false, escape: 'esc_html', note: 'ACFフィールド値を返す。出力時はesc_html()等でエスケープ必要' },
    'get_term_meta': { category: 'returns_value', safe: false, escape: 'esc_html', note: 'ターム メタ値を返す。出力時はエスケープ必要' },
    'get_user_meta': { category: 'returns_value', safe: false, escape: 'esc_html', note: 'ユーザーメタ値を返す。出力時はエスケープ必要' },
    // ── 値を返す・esc_url()が必要 ────────────────────────────────────────
    'get_permalink': { category: 'returns_value', safe: false, escape: 'esc_url', note: 'URLを返す。echo esc_url(get_permalink()) が正しい' },
    'get_the_permalink': { category: 'returns_value', safe: false, escape: 'esc_url', note: 'URLを返す。echo esc_url(get_the_permalink()) が正しい' },
    'home_url': { category: 'returns_value', safe: false, escape: 'esc_url', note: 'URLを返す。echo esc_url(home_url()) が正しい' },
    'site_url': { category: 'returns_value', safe: false, escape: 'esc_url', note: 'URLを返す。echo esc_url(site_url()) が正しい' },
    'admin_url': { category: 'returns_value', safe: false, escape: 'esc_url', note: 'URLを返す。echo esc_url(admin_url()) が正しい' },
    'get_template_directory_uri': { category: 'returns_value', safe: false, escape: 'esc_url', note: 'URLを返す。echo esc_url(get_template_directory_uri()) が正しい' },
    'get_stylesheet_directory_uri': { category: 'returns_value', safe: false, escape: 'esc_url', note: 'URLを返す。echo esc_url(get_stylesheet_directory_uri()) が正しい' },
    'get_term_link': { category: 'returns_value', safe: false, escape: 'esc_url', note: 'URLを返す。echo esc_url(get_term_link()) が正しい' },
    'wp_login_url': { category: 'returns_value', safe: false, escape: 'esc_url', note: 'URLを返す。echo esc_url(wp_login_url()) が正しい' },
    'wp_logout_url': { category: 'returns_value', safe: false, escape: 'esc_url', note: 'URLを返す。echo esc_url(wp_logout_url()) が正しい' },
    'get_author_posts_url': { category: 'returns_value', safe: false, escape: 'esc_url', note: 'URLを返す。echo esc_url(get_author_posts_url()) が正しい' },
    'get_category_link': { category: 'returns_value', safe: false, escape: 'esc_url', note: 'URLを返す。echo esc_url(get_category_link()) が正しい' },
    'get_tag_link': { category: 'returns_value', safe: false, escape: 'esc_url', note: 'URLを返す。echo esc_url(get_tag_link()) が正しい' },
    'get_search_link': { category: 'returns_value', safe: false, escape: 'esc_url', note: 'URLを返す。echo esc_url(get_search_link()) が正しい' },
    'get_post_type_archive_link': { category: 'returns_value', safe: false, escape: 'esc_url', note: 'URLを返す。echo esc_url(get_post_type_archive_link()) が正しい' },
    'wp_get_attachment_url': { category: 'returns_value', safe: false, escape: 'esc_url', note: 'URLを返す。echo esc_url(wp_get_attachment_url()) が正しい' },
    // ── boolean（条件チェック・出力しない） ───────────────────────────────
    'is_home': { category: 'boolean', safe: true, note: 'bool返す。条件チェック用・出力しない' },
    'is_front_page': { category: 'boolean', safe: true, note: 'bool返す。条件チェック用・出力しない' },
    'is_single': { category: 'boolean', safe: true, note: 'bool返す。条件チェック用・出力しない' },
    'is_page': { category: 'boolean', safe: true, note: 'bool返す。条件チェック用・出力しない' },
    'is_archive': { category: 'boolean', safe: true, note: 'bool返す。条件チェック用・出力しない' },
    'is_category': { category: 'boolean', safe: true, note: 'bool返す。条件チェック用・出力しない' },
    'is_tag': { category: 'boolean', safe: true, note: 'bool返す。条件チェック用・出力しない' },
    'is_search': { category: 'boolean', safe: true, note: 'bool返す。条件チェック用・出力しない' },
    'is_404': { category: 'boolean', safe: true, note: 'bool返す。条件チェック用・出力しない' },
    'is_singular': { category: 'boolean', safe: true, note: 'bool返す。条件チェック用・出力しない' },
    'is_tax': { category: 'boolean', safe: true, note: 'bool返す。条件チェック用・出力しない' },
    'is_post_type_archive': { category: 'boolean', safe: true, note: 'bool返す。条件チェック用・出力しない' },
    'have_posts': { category: 'boolean', safe: true, note: 'bool返す。ループ条件チェック用' },
    'has_post_thumbnail': { category: 'boolean', safe: true, note: 'bool返す。サムネイル存在チェック用' },
    'in_category': { category: 'boolean', safe: true, note: 'bool返す。カテゴリ所属チェック用' },
    'is_user_logged_in': { category: 'boolean', safe: true, note: 'bool返す。ログイン状態チェック用' },
    'current_user_can': { category: 'boolean', safe: true, note: 'bool返す。権限チェック用' },
    'is_active_sidebar': { category: 'boolean', safe: true, note: 'bool返す。サイドバー有効チェック用' },
    'is_plugin_active': { category: 'boolean', safe: true, note: 'bool返す。プラグイン有効チェック用' },
};
/**
 * PHPコードをAIに送る前にWordPress関数の注釈を付与する
 * 実際のファイルは変更しない（AIへのコンテキスト用のみ）
 */
function annotatePhpCode(code) {
    const lines = code.split('\n');
    const annotated = lines.map(line => {
        const matches = [];
        for (const [funcName, meta] of Object.entries(exports.WP_FUNCTION_MAP)) {
            // 文字列・コメント内の関数名は無視したい。単純に関数呼び出しパターンで検索
            const pattern = new RegExp(`\\b${funcName}\\s*\\(`, 'g');
            if (pattern.test(line)) {
                matches.push(`[WP:${funcName} → ${meta.note}]`);
            }
        }
        if (matches.length === 0) {
            return line;
        }
        return `${line}  // ${matches.join(' / ')}`;
    });
    return annotated.join('\n');
}
//# sourceMappingURL=wpFunctions.js.map