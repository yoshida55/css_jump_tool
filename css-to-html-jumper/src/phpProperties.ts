// PHP / WordPress 関数の日本語解説辞書
export interface PhpFunctionInfo {
  name: string;
  description: string;
  params?: string[];
  returns?: string;
  tips?: string[];
  category?: string;
  frequent?: boolean; // trueにすると補完で上位表示
}

export const phpFunctions: { [key: string]: PhpFunctionInfo } = {

  // ==================== PHP配列 ====================
  "array_map": {
    name: "array_map",
    category: "PHP配列",
    description: "配列の全要素に関数を適用して新しい配列を返す。",
    params: ["callable $callback — 各要素に適用する関数", "array $array — 対象の配列"],
    returns: "新しい配列",
    tips: ["元の配列は変更されない", "array_filterと組み合わせてよく使う"]
  },
  "array_filter": {
    name: "array_filter",
    category: "PHP配列",
    description: "条件を満たす要素だけを残した配列を返す。",
    params: ["array $array — 対象の配列", "callable $callback — trueを返すと残す"],
    returns: "フィルタ後の配列",
    tips: ["callbackなしだとfalse/null/0/空文字を除去", "array_valuesで添字を振り直すとよい"]
  },
  "array_push": {
    name: "array_push",
    category: "PHP配列",
    description: "配列の末尾に要素を追加する。",
    params: ["array &$array — 対象の配列（参照渡し）", "mixed ...$values — 追加する値"],
    returns: "追加後の要素数",
    tips: ["$arr[] = $val; の方が高速でよく使われる"]
  },
  "array_merge": {
    name: "array_merge",
    category: "PHP配列",
    description: "複数の配列を結合して1つの配列にする。",
    params: ["array ...$arrays — 結合する配列"],
    returns: "結合後の配列",
    tips: ["キーが重複すると後の値で上書き", "連想配列の結合に注意（+演算子と挙動が違う）"]
  },
  "array_keys": {
    name: "array_keys",
    category: "PHP配列",
    description: "配列のキー一覧を返す。",
    params: ["array $array — 対象の配列"],
    returns: "キーの配列",
    tips: ["第2引数で特定の値を持つキーだけ取得できる"]
  },
  "array_values": {
    name: "array_values",
    category: "PHP配列",
    description: "配列の値だけを連続した添字で返す。",
    params: ["array $array — 対象の配列"],
    returns: "0始まりの配列",
    tips: ["array_filterの後に使って添字を振り直すことが多い"]
  },
  "in_array": {
    name: "in_array",
    category: "PHP配列",
    description: "配列に指定した値が含まれているか調べる。",
    params: ["mixed $needle — 探す値", "array $haystack — 対象の配列", "bool $strict — 型も一致させるか（デフォルトfalse）"],
    returns: "bool（含まれていればtrue）",
    tips: ["第3引数をtrueにすると型チェックも行う（推奨）"]
  },
  "implode": {
    name: "implode",
    category: "PHP文字列",
    description: "配列の要素を区切り文字でつなげて文字列にする。",
    params: ["string $separator — 区切り文字", "array $array — 対象の配列"],
    returns: "結合した文字列",
    tips: ["join()はimplodeの別名", "explodeで逆の操作ができる"]
  },
  "explode": {
    name: "explode",
    category: "PHP文字列",
    description: "文字列を区切り文字で分割して配列にする。",
    params: ["string $separator — 区切り文字", "string $string — 対象の文字列", "int $limit — 最大分割数（省略可）"],
    returns: "文字列の配列",
    tips: ["implodeで逆の操作ができる", "CSVや区切りデータの処理に便利"]
  },

  // ==================== PHP文字列 ====================
  "str_replace": {
    name: "str_replace",
    category: "PHP文字列",
    description: "文字列の一部を別の文字列に置き換える。",
    params: ["mixed $search — 検索する文字列", "mixed $replace — 置き換え後の文字列", "mixed $subject — 対象の文字列"],
    returns: "置き換え後の文字列",
    tips: ["配列を渡すと一括置換できる", "大文字小文字を区別しない場合はstr_ireplace"]
  },
  "strpos": {
    name: "strpos",
    category: "PHP文字列",
    description: "文字列の中に指定の文字列が何文字目にあるか返す。",
    params: ["string $haystack — 対象の文字列", "string $needle — 探す文字列", "int $offset — 検索開始位置（省略可）"],
    returns: "見つかった位置（見つからなければfalse）",
    tips: ["falseとの比較は === を使う（0と区別するため）"]
  },
  "substr": {
    name: "substr",
    category: "PHP文字列",
    description: "文字列の一部を切り出す。",
    params: ["string $string — 対象の文字列", "int $offset — 開始位置", "int $length — 切り出す長さ（省略可）"],
    returns: "切り出した文字列",
    tips: ["offsetが負だと末尾からの位置", "マルチバイトはmb_substrを使う"]
  },
  "strlen": {
    name: "strlen",
    category: "PHP文字列",
    description: "文字列のバイト数を返す。",
    params: ["string $string — 対象の文字列"],
    returns: "バイト数",
    tips: ["日本語はmb_strlen()を使う（1文字3バイトになるため）"]
  },
  "trim": {
    name: "trim",
    category: "PHP文字列",
    description: "文字列の前後の空白や改行を取り除く。",
    params: ["string $string — 対象の文字列", "string $characters — 取り除く文字（省略可）"],
    returns: "整形後の文字列",
    tips: ["ltrim（先頭のみ）、rtrim（末尾のみ）もある"]
  },
  "sprintf": {
    name: "sprintf",
    category: "PHP文字列",
    description: "フォーマットした文字列を返す。",
    params: ["string $format — フォーマット文字列", "mixed ...$values — 埋め込む値"],
    returns: "フォーマット後の文字列",
    tips: ["%s=文字列, %d=整数, %f=浮動小数点", "printf()はそのまま出力する版"]
  },
  "nl2br": {
    name: "nl2br",
    category: "PHP文字列",
    description: "改行文字の前に<br>タグを挿入する。",
    params: ["string $string — 対象の文字列"],
    returns: "変換後の文字列",
    tips: ["テキストエリアの内容をHTMLで表示するときに使う"]
  },
  "htmlspecialchars": {
    name: "htmlspecialchars",
    category: "PHP文字列",
    description: "HTMLの特殊文字をエンティティに変換してXSS対策をする。",
    params: ["string $string — 対象の文字列", "int $flags — ENT_QUOTES等のフラグ（省略可）"],
    returns: "変換後の文字列",
    tips: ["ユーザー入力をHTMLに出力するときは必ず使う（セキュリティ必須）", "ENT_QUOTESでシングル/ダブルクォートも変換"]
  },

  // ==================== PHP制御・その他 ====================
  "isset": {
    name: "isset",
    category: "PHP基本",
    description: "変数が存在していてnullでないかチェックする。",
    params: ["mixed $var — チェックする変数"],
    returns: "bool（存在かつnull以外ならtrue）",
    tips: ["配列のキー存在確認にもよく使う", "nullは存在していてもfalseを返す"]
  },
  "empty": {
    name: "empty",
    category: "PHP基本",
    description: "変数が空かどうかチェックする（0, '', [], null, false も空と判断）。",
    params: ["mixed $var — チェックする変数"],
    returns: "bool（空ならtrue）",
    tips: ["'0'（文字列のゼロ）もtrueになることに注意", "isset()と組み合わせて使うことが多い"]
  },
  "var_dump": {
    name: "var_dump",
    category: "PHP基本",
    description: "変数の型と値を詳細に出力する（デバッグ用）。",
    params: ["mixed ...$vars — 出力する変数"],
    returns: "void",
    tips: ["本番環境での使用は禁止", "print_r()より詳細情報を表示する"]
  },
  "print_r": {
    name: "print_r",
    category: "PHP基本",
    description: "変数の内容を人間が読みやすい形式で出力する（デバッグ用）。",
    params: ["mixed $value — 出力する変数", "bool $return — trueなら出力せず文字列で返す"],
    returns: "void または文字列",
    tips: ["配列の中身確認によく使う", "第2引数をtrueにすると変数に代入できる"]
  },
  "date": {
    name: "date",
    category: "PHP日付",
    description: "日付・時刻をフォーマットした文字列で返す。",
    params: ["string $format — フォーマット（例: 'Y-m-d H:i:s'）", "int $timestamp — Unixタイムスタンプ（省略時は現在時刻）"],
    returns: "フォーマット後の日付文字列",
    tips: ["Y=年, m=月, d=日, H=時, i=分, s=秒", "time()で現在のタイムスタンプを取得"]
  },

  // ==================== WordPress基本 ====================
  "get_posts": {
    name: "get_posts",
    category: "WordPress投稿",
    description: "条件を指定して投稿の配列を取得する。",
    params: ["array $args — 取得条件（post_type, numberposts, category等）"],
    returns: "WP_Post[] 投稿オブジェクトの配列",
    tips: ["numberposts=-1で全件取得", "wp_reset_postdata()は不要（queryを使わないため）"]
  },
  "get_post": {
    name: "get_post",
    category: "WordPress投稿",
    description: "指定IDの投稿オブジェクトを取得する。",
    params: ["int|WP_Post $post — 投稿IDまたはWP_Postオブジェクト", "string $output — OBJECT/ARRAY_A/ARRAY_N"],
    returns: "WP_Post|null",
    tips: ["$postグローバル変数からも取得できる"]
  },
  "get_post_meta": {
    name: "get_post_meta",
    frequent: true,
    category: "WordPress投稿",
    description: "投稿のカスタムフィールド（メタデータ）を取得する。",
    params: ["int $post_id — 投稿ID", "string $key — フィールド名", "bool $single — trueで単一値, falseで配列"],
    returns: "mixed（$single=trueなら値、falseなら配列）",
    tips: ["$single=trueをつけ忘れると配列で返る", "存在しない場合は空文字or空配列"]
  },
  "update_post_meta": {
    name: "update_post_meta",
    category: "WordPress投稿",
    description: "投稿のカスタムフィールドを更新（なければ追加）する。",
    params: ["int $post_id — 投稿ID", "string $meta_key — フィールド名", "mixed $meta_value — 保存する値"],
    returns: "int|bool（成功時はmeta_id、既存更新時はtrue）",
    tips: ["add_post_metaと違い、重複登録しない"]
  },
  "get_the_title": {
    name: "get_the_title",
    frequent: true,
    category: "WordPress投稿",
    description: "投稿タイトルを文字列で返す。",
    params: ["int|WP_Post $post — 投稿ID（省略時はグローバル$post）"],
    returns: "string タイトル文字列",
    tips: ["the_title()はそのまま出力する版"]
  },
  "the_title": {
    name: "the_title",
    frequent: true,
    category: "WordPress投稿",
    description: "投稿タイトルを直接出力する（ループ内で使用）。",
    params: ["string $before — タイトル前に追加（省略可）", "string $after — タイトル後に追加（省略可）"],
    returns: "void",
    tips: ["ループの外ではget_the_title()を使う"]
  },
  "the_content": {
    name: "the_content",
    frequent: true,
    category: "WordPress投稿",
    description: "投稿本文を出力する（ループ内で使用）。",
    params: [],
    returns: "void",
    tips: ["フィルタが自動適用される（段落変換・ショートコード等）", "get_the_content()はフィルタなしで取得"]
  },
  "get_the_permalink": {
    name: "get_the_permalink",
    frequent: true,
    category: "WordPress投稿",
    description: "投稿のパーマリンク（URL）を文字列で返す。",
    params: ["int|WP_Post $post — 投稿ID（省略時はグローバル$post）"],
    returns: "string URL文字列",
    tips: ["the_permalink()はそのまま出力する版"]
  },
  "get_the_ID": {
    name: "get_the_ID",
    frequent: true,
    category: "WordPress投稿",
    description: "現在の投稿IDを返す（ループ内で使用）。",
    params: [],
    returns: "int|false 投稿ID",
    tips: ["ループ外では$post->IDを使う"]
  },
  "setup_postdata": {
    name: "setup_postdata",
    category: "WordPress投稿",
    description: "WP_Postオブジェクトをグローバル変数に設定し、テンプレートタグを使えるようにする。",
    params: ["WP_Post $post — 設定するWP_Postオブジェクト"],
    returns: "bool",
    tips: ["wp_reset_postdata()で必ずリセットする", "サブループ（get_posts後のforeachループ）で必要"]
  },
  "wp_reset_postdata": {
    name: "wp_reset_postdata",
    category: "WordPress投稿",
    description: "setup_postdata()で変更されたグローバル$postをメインクエリに戻す。",
    params: [],
    returns: "void",
    tips: ["setup_postdata()を使ったら必ず呼ぶ（忘れるとバグの原因）"]
  },
  "have_posts": {
    name: "have_posts",
    frequent: true,
    category: "WordPress投稿",
    description: "ループに次の投稿があるかチェックする。while(have_posts()) で使用。",
    params: [],
    returns: "bool — 次の投稿があれば true",
    tips: ["while(have_posts()) : the_post(); ... endwhile; の形で使う", "サブループではWP_Queryのhave_posts()を使う"]
  },
  "the_post": {
    name: "the_post",
    frequent: true,
    category: "WordPress投稿",
    description: "次の投稿データをグローバル変数$postにセットし、テンプレートタグを使えるようにする。",
    params: [],
    returns: "void",
    tips: ["have_posts()とセットで使う", "呼び出すだけでthe_title()等が使えるようになる"]
  },
  "the_permalink": {
    name: "the_permalink",
    frequent: true,
    category: "WordPress投稿",
    description: "現在の投稿のパーマリンク（URL）を直接出力する。",
    params: [],
    returns: "void",
    tips: ["href属性に使うならget_the_permalink()で文字列を取得する方が安全"]
  },
  "the_ID": {
    name: "the_ID",
    category: "WordPress投稿",
    description: "現在の投稿IDを直接出力する。",
    params: [],
    returns: "void",
    tips: ["取得したい場合はget_the_ID()を使う"]
  },
  "the_author": {
    name: "the_author",
    frequent: true,
    category: "WordPress投稿",
    description: "現在の投稿の著者名を出力する。",
    params: [],
    returns: "void",
    tips: ["著者ページのリンクはthe_author_posts_link()を使う"]
  },
  "the_date": {
    name: "the_date",
    frequent: true,
    category: "WordPress投稿",
    description: "投稿の公開日を出力する（同日複数投稿時は最初の1件のみ）。",
    params: ["string $format — 日付フォーマット（デフォルトはWordPress設定に従う）"],
    returns: "void",
    tips: ["毎回表示するにはthe_time()を使う", "フォーマット例: 'Y年m月d日'"]
  },
  "the_time": {
    name: "the_time",
    category: "WordPress投稿",
    description: "投稿の公開日時を出力する（同日複数投稿でも毎回表示）。",
    params: ["string $format — 日付フォーマット（例: 'Y/m/d'）"],
    returns: "void",
    tips: ["the_date()と違い同日複数投稿でも毎回出力される"]
  },

  // ==================== WordPress WP_Query ====================
  "WP_Query": {
    name: "WP_Query",
    category: "WordPress WP_Query",
    description: "カスタムクエリで投稿を取得するクラス。",
    params: ["array $args — クエリパラメータ"],
    returns: "WP_Queryオブジェクト",
    tips: [
      "post_type: 'post'|'page'|カスタム投稿タイプ",
      "posts_per_page: -1で全件",
      "meta_query: カスタムフィールドで絞り込み",
      "tax_query: タクソノミーで絞り込み",
      "必ずwp_reset_postdata()でリセットする"
    ]
  },

  // ==================== WordPress条件分岐 ====================
  "is_page": {
    name: "is_page",
    frequent: true,
    category: "WordPress条件分岐",
    description: "現在のページが固定ページかどうかを返す。",
    params: ["int|string|array $page — ページID/スラッグ/タイトル（省略可）"],
    returns: "bool",
    tips: ["引数なしで任意の固定ページか判定", "is_single()は投稿記事用"]
  },
  "is_single": {
    name: "is_single",
    frequent: true,
    category: "WordPress条件分岐",
    description: "現在のページが投稿の個別ページかどうかを返す。",
    params: ["int|string|array $post — 投稿ID/スラッグ（省略可）"],
    returns: "bool",
    tips: ["カスタム投稿タイプにはis_singular()を使う"]
  },
  "is_singular": {
    name: "is_singular",
    category: "WordPress条件分岐",
    description: "現在のページが個別投稿ページ（投稿・固定・カスタム）かどうかを返す。",
    params: ["string|array $post_types — 投稿タイプ名（省略可）"],
    returns: "bool",
    tips: ["is_page() + is_single()をまとめた版"]
  },
  "is_front_page": {
    name: "is_front_page",
    category: "WordPress条件分岐",
    description: "現在のページがトップページかどうかを返す。",
    params: [],
    returns: "bool",
    tips: ["設定＞表示設定のフロントページ設定に依存"]
  },
  "is_archive": {
    name: "is_archive",
    frequent: true,
    category: "WordPress条件分岐",
    description: "現在のページがアーカイブページ（カテゴリ/タグ/日付等）かどうかを返す。",
    params: [],
    returns: "bool"
  },
  "is_category": {
    name: "is_category",
    category: "WordPress条件分岐",
    description: "現在のページがカテゴリアーカイブかどうかを返す。",
    params: ["int|string|array $category — カテゴリID/スラッグ（省略可）"],
    returns: "bool"
  },
  "is_tax": {
    name: "is_tax",
    category: "WordPress条件分岐",
    description: "現在のページがカスタムタクソノミーのアーカイブかどうかを返す。",
    params: ["string $taxonomy — タクソノミー名（省略可）", "int|string $term — タームID/スラッグ（省略可）"],
    returns: "bool"
  },
  "is_user_logged_in": {
    name: "is_user_logged_in",
    category: "WordPress条件分岐",
    description: "ユーザーがログイン中かどうかを返す。",
    params: [],
    returns: "bool",
    tips: ["会員限定コンテンツの表示切り替えに使う"]
  },

  // ==================== WordPressフック ====================
  "add_action": {
    name: "add_action",
    frequent: true,
    category: "WordPressフック",
    description: "アクションフックに関数を登録する。指定のタイミングで登録した関数が実行される。",
    params: ["string $hook_name — フック名", "callable $callback — 実行する関数", "int $priority — 優先度（デフォルト10）", "int $accepted_args — 引数の数（デフォルト1）"],
    returns: "bool（常にtrue）",
    tips: ["priorityが小さいほど早く実行", "Alt+クリックでdo_action定義へジャンプ"]
  },
  "add_filter": {
    name: "add_filter",
    frequent: true,
    category: "WordPressフック",
    description: "フィルターフックに関数を登録する。値を加工して返す処理に使う。",
    params: ["string $hook_name — フック名", "callable $callback — 実行する関数（値を受け取りreturnする）", "int $priority — 優先度（デフォルト10）", "int $accepted_args — 引数の数（デフォルト1）"],
    returns: "bool（常にtrue）",
    tips: ["必ず加工後の値をreturnする（returnがないと空になる）", "Alt+クリックでapply_filters定義へジャンプ"]
  },
  "do_action": {
    name: "do_action",
    category: "WordPressフック",
    description: "アクションフックを発火させる。add_actionで登録された関数が全て実行される。",
    params: ["string $hook_name — フック名", "mixed ...$args — コールバックに渡す引数"],
    returns: "void",
    tips: ["テーマ/プラグインの拡張ポイントを作るために使う", "Alt+クリックでadd_action登録箇所へジャンプ"]
  },
  "apply_filters": {
    name: "apply_filters",
    category: "WordPressフック",
    description: "フィルターフックを発火させ、加工された値を返す。",
    params: ["string $hook_name — フック名", "mixed $value — フィルターに渡す初期値", "mixed ...$args — 追加の引数"],
    returns: "mixed フィルター処理後の値",
    tips: ["値を返すのを忘れると空になる", "Alt+クリックでadd_filter登録箇所へジャンプ"]
  },
  "remove_action": {
    name: "remove_action",
    category: "WordPressフック",
    description: "登録済みのアクションフックから関数を削除する。",
    params: ["string $hook_name — フック名", "callable $callback — 削除する関数", "int $priority — 登録時と同じ優先度（デフォルト10）"],
    returns: "bool"
  },
  "remove_filter": {
    name: "remove_filter",
    category: "WordPressフック",
    description: "登録済みのフィルターフックから関数を削除する。",
    params: ["string $hook_name — フック名", "callable $callback — 削除する関数", "int $priority — 登録時と同じ優先度（デフォルト10）"],
    returns: "bool"
  },
  "has_action": {
    name: "has_action",
    category: "WordPressフック",
    description: "指定フックに関数が登録されているか確認する。",
    params: ["string $hook_name — フック名", "callable $callback — 確認する関数（省略可）"],
    returns: "bool|int 登録があればtrue（優先度のint）、なければfalse"
  },

  // ==================== WordPress URL・パス ====================
  "get_template_directory_uri": {
    name: "get_template_directory_uri",
    frequent: true,
    category: "WordPress URL",
    description: "アクティブなテーマのディレクトリURLを返す。",
    params: [],
    returns: "string URL文字列",
    tips: ["CSS/JS/画像のURLを作るのによく使う", "子テーマからは親テーマのURLが返る（子テーマはget_stylesheet_directory_uri()）"]
  },
  "get_stylesheet_directory_uri": {
    name: "get_stylesheet_directory_uri",
    category: "WordPress URL",
    description: "アクティブなテーマ（子テーマ含む）のディレクトリURLを返す。",
    params: [],
    returns: "string URL文字列",
    tips: ["子テーマ使用時はget_template_directory_uri()との違いに注意"]
  },
  "get_template_directory": {
    name: "get_template_directory",
    category: "WordPressパス",
    description: "アクティブなテーマのディレクトリの絶対パスを返す。",
    params: [],
    returns: "string 絶対パス文字列",
    tips: ["ファイル読み込み（require/include）に使う"]
  },
  "site_url": {
    name: "site_url",
    category: "WordPress URL",
    description: "サイトのURLを返す（WordPress設置URL）。",
    params: ["string $path — 追加するパス（省略可）"],
    returns: "string URL文字列"
  },
  "home_url": {
    name: "home_url",
    category: "WordPress URL",
    description: "サイトのホームURLを返す（フロントエンドURL）。",
    params: ["string $path — 追加するパス（省略可）"],
    returns: "string URL文字列",
    tips: ["site_url()とは設定によって異なる場合がある"]
  },
  "admin_url": {
    name: "admin_url",
    category: "WordPress URL",
    description: "管理画面のURLを返す。",
    params: ["string $path — 追加するパス（省略可、例: 'edit.php'）"],
    returns: "string URL文字列"
  },

  // ==================== WordPressエンキュー ====================
  "wp_enqueue_script": {
    name: "wp_enqueue_script",
    frequent: true,
    category: "WordPress読み込み",
    description: "JavaScriptファイルをHTMLに読み込む（重複防止・依存関係管理付き）。",
    params: ["string $handle — ハンドル名（固有のID）", "string $src — ファイルのURL", "array $deps — 依存スクリプトのハンドル名配列", "string|bool $ver — バージョン番号", "bool $in_footer — trueでfooterに読み込む"],
    returns: "void",
    tips: ["wp_enqueue_scriptsアクションの中で使う", "jQueryは'jquery'として依存に追加"]
  },
  "wp_enqueue_style": {
    name: "wp_enqueue_style",
    frequent: true,
    category: "WordPress読み込み",
    description: "CSSファイルをHTMLに読み込む（重複防止・依存関係管理付き）。",
    params: ["string $handle — ハンドル名", "string $src — ファイルのURL", "array $deps — 依存スタイルのハンドル名配列", "string|bool $ver — バージョン番号", "string $media — メディアタイプ（省略可）"],
    returns: "void",
    tips: ["wp_enqueue_scriptsアクションの中で使う"]
  },
  "wp_localize_script": {
    name: "wp_localize_script",
    category: "WordPress読み込み",
    description: "PHPの変数をJavaScriptに渡す（Ajax URL等の受け渡しに使う）。",
    params: ["string $handle — スクリプトのハンドル名", "string $object_name — JS側のオブジェクト名", "array $l10n — 渡すデータの連想配列"],
    returns: "bool",
    tips: ["wp_enqueue_scriptの後に呼ぶ", "Ajax URLはadmin_url('admin-ajax.php')"]
  },

  // ==================== WordPress管理画面 ====================
  "add_meta_box": {
    name: "add_meta_box",
    category: "WordPress管理画面",
    description: "投稿編集画面にカスタムメタボックスを追加する。",
    params: ["string $id — ボックスのID", "string $title — ボックスのタイトル", "callable $callback — 内容を出力する関数", "string $screen — 表示する画面（post/page等）", "string $context — 位置（normal/side/advanced）"],
    returns: "void",
    tips: ["add_meta_boxesアクション内で呼ぶ"]
  },
  "register_post_type": {
    name: "register_post_type",
    category: "WordPress管理画面",
    description: "カスタム投稿タイプを登録する。",
    params: ["string $post_type — 投稿タイプ名（20文字以内）", "array $args — 設定オプション（labels, public, supports等）"],
    returns: "WP_Post_Type|WP_Error",
    tips: ["init アクション内で呼ぶ", "supports: ['title','editor','thumbnail']等"]
  },
  "register_taxonomy": {
    name: "register_taxonomy",
    category: "WordPress管理画面",
    description: "カスタムタクソノミー（分類）を登録する。",
    params: ["string $taxonomy — タクソノミー名", "array|string $object_type — 関連付ける投稿タイプ", "array $args — 設定オプション"],
    returns: "WP_Taxonomy|WP_Error",
    tips: ["initアクション内で呼ぶ", "hierarchical=trueでカテゴリ、falseでタグに似た動作"]
  },

  // ==================== ACF（Advanced Custom Fields）====================
  "get_field": {
    name: "get_field",
    category: "ACF",
    description: "ACFで登録したカスタムフィールドの値を取得する。",
    params: ["string $field_name — フィールド名", "int|false $post_id — 投稿ID（省略時はグローバル$post）"],
    returns: "mixed フィールドの値",
    tips: ["オプションページの値取得は$post_idに'options'を指定", "the_field()はそのまま出力する版"]
  },
  "the_field": {
    name: "the_field",
    category: "ACF",
    description: "ACFのカスタムフィールド値を直接出力する。",
    params: ["string $field_name — フィールド名", "int|false $post_id — 投稿ID（省略可）"],
    returns: "void",
    tips: ["get_field()の出力版"]
  },
  "update_field": {
    name: "update_field",
    category: "ACF",
    description: "ACFのカスタムフィールド値を更新する。",
    params: ["string $field_name — フィールド名", "mixed $value — 保存する値", "int|false $post_id — 投稿ID（省略可）"],
    returns: "bool"
  },
  "have_rows": {
    name: "have_rows",
    category: "ACF",
    description: "ACFのリピーターフィールドやFlexibleコンテンツのループ制御。",
    params: ["string $field_name — フィールド名", "int|false $post_id — 投稿ID（省略可）"],
    returns: "bool 次の行があればtrue",
    tips: ["while(have_rows('xxx')): the_row(); のパターンで使う"]
  },
  "the_row": {
    name: "the_row",
    category: "ACF",
    description: "ACFリピーターの次の行に移動する（have_rowsと組み合わせて使う）。",
    params: [],
    returns: "void"
  },
  "get_sub_field": {
    name: "get_sub_field",
    category: "ACF",
    description: "ACFリピーター内のサブフィールド値を取得する。",
    params: ["string $field_name — サブフィールド名"],
    returns: "mixed フィールドの値",
    tips: ["have_rows/the_rowのループ内で使う"]
  },

  // ==================== WordPressセキュリティ ====================
  "esc_html": {
    name: "esc_html",
    frequent: true,
    category: "WordPressセキュリティ",
    description: "HTMLタグをエスケープして安全に出力する。",
    params: ["string $text — エスケープする文字列"],
    returns: "string エスケープ後の文字列",
    tips: ["HTMLを表示するときは必ず使う（XSS対策）"]
  },
  "esc_url": {
    name: "esc_url",
    frequent: true,
    category: "WordPressセキュリティ",
    description: "URLを安全にエスケープする。",
    params: ["string $url — エスケープするURL"],
    returns: "string 安全なURL文字列",
    tips: ["href属性やsrc属性に出力するURLには必ず使う"]
  },
  "esc_attr": {
    name: "esc_attr",
    frequent: true,
    category: "WordPressセキュリティ",
    description: "HTML属性値を安全にエスケープする。",
    params: ["string $text — エスケープする文字列"],
    returns: "string エスケープ後の文字列",
    tips: ["input value等の属性値に出力するときに使う"]
  },
  "wp_nonce_field": {
    name: "wp_nonce_field",
    category: "WordPressセキュリティ",
    description: "CSRFトークン（nonce）の隠しフィールドをHTMLに出力する。",
    params: ["string $action — アクション名", "string $name — フィールド名（デフォルト: '_wpnonce'）"],
    returns: "string HTML文字列",
    tips: ["フォームにCSRF対策として追加する（WordPress必須）"]
  },
  "check_admin_referer": {
    name: "check_admin_referer",
    category: "WordPressセキュリティ",
    description: "送信されたnonceが正しいか検証する（不正なら処理を止める）。",
    params: ["string $action — アクション名", "string $query_arg — nonceフィールド名"],
    returns: "bool|false 有効ならtrue、無効なら処理停止"
  },

  // ==================== WordPress翻訳 ====================
  "__": {
    name: "__",
    category: "WordPress翻訳",
    description: "翻訳された文字列を返す（多言語対応）。",
    params: ["string $text — 翻訳する文字列", "string $domain — テキストドメイン"],
    returns: "string 翻訳後の文字列",
    tips: ["_e()はそのまま出力する版"]
  },
  "_e": {
    name: "_e",
    category: "WordPress翻訳",
    description: "翻訳された文字列を直接出力する。",
    params: ["string $text — 翻訳する文字列", "string $domain — テキストドメイン"],
    returns: "void"
  },
  "_n": {
    name: "_n",
    category: "WordPress翻訳",
    description: "単数/複数で異なる翻訳文字列を返す。",
    params: ["string $single — 単数形", "string $plural — 複数形", "int $number — 数", "string $domain — テキストドメイン"],
    returns: "string"
  },

  // ==================== PHP数値・数学 ====================
  "abs": {
    name: "abs",
    category: "PHP数値",
    description: "絶対値を返す（マイナスをプラスに変換）。",
    params: ["int|float $num — 対象の数値"],
    returns: "int|float 絶対値"
  },
  "ceil": {
    name: "ceil",
    category: "PHP数値",
    description: "小数点以下を切り上げる。",
    params: ["float $num — 対象の数値"],
    returns: "float 切り上げた値",
    tips: ["floor()は切り捨て、round()は四捨五入"]
  },
  "floor": {
    name: "floor",
    category: "PHP数値",
    description: "小数点以下を切り捨てる。",
    params: ["float $num — 対象の数値"],
    returns: "float 切り捨てた値"
  },
  "round": {
    name: "round",
    category: "PHP数値",
    description: "四捨五入する。",
    params: ["float $num — 対象の数値", "int $precision — 小数点以下の桁数（デフォルト0）"],
    returns: "float 四捨五入した値"
  },
  "max": {
    name: "max",
    category: "PHP数値",
    description: "最大値を返す。",
    params: ["mixed ...$values — 比較する値（配列も可）"],
    returns: "mixed 最大値"
  },
  "min": {
    name: "min",
    category: "PHP数値",
    description: "最小値を返す。",
    params: ["mixed ...$values — 比較する値（配列も可）"],
    returns: "mixed 最小値"
  },
  "rand": {
    name: "rand",
    category: "PHP数値",
    description: "ランダムな整数を返す。",
    params: ["int $min — 最小値", "int $max — 最大値"],
    returns: "int ランダムな整数",
    tips: ["引数なしで呼ぶと 0〜RAND_MAX の値を返す"]
  },
  "number_format": {
    name: "number_format",
    category: "PHP数値",
    description: "数値を3桁区切りなどにフォーマットする。",
    params: ["float $num — 対象の数値", "int $decimals — 小数点以下の桁数", "string $decimal_separator — 小数点文字（デフォルト'.'）", "string $thousands_separator — 区切り文字（デフォルト','）"],
    returns: "string フォーマット済み文字列",
    tips: ["日本円表示: number_format($price, 0, '.', ',') . '円'"]
  },
  "intval": {
    name: "intval",
    category: "PHP数値",
    description: "値を整数に変換する。",
    params: ["mixed $value — 変換する値", "int $base — 基数（省略可、デフォルト10）"],
    returns: "int 整数値",
    tips: ["(int)キャストより安全。失敗時は0を返す"]
  },
  "floatval": {
    name: "floatval",
    category: "PHP数値",
    description: "値を浮動小数点数に変換する。",
    params: ["mixed $value — 変換する値"],
    returns: "float 浮動小数点値"
  },
  "is_numeric": {
    name: "is_numeric",
    category: "PHP数値",
    description: "値が数値または数値文字列かどうかチェックする。",
    params: ["mixed $value — チェックする値"],
    returns: "bool"
  },

  // ==================== PHP文字列（追加） ====================
  "str_pad": {
    name: "str_pad",
    category: "PHP文字列",
    description: "文字列を指定した長さになるまで別の文字列で埋める。",
    params: ["string $string — 対象の文字列", "int $length — 目標の長さ", "string $pad_string — 埋める文字列（デフォルト' '）", "int $pad_type — STR_PAD_RIGHT/LEFT/BOTH"],
    returns: "string パディング済み文字列",
    tips: ["ゼロ埋め: str_pad('5', 3, '0', STR_PAD_LEFT) → '005'"]
  },
  "str_repeat": {
    name: "str_repeat",
    category: "PHP文字列",
    description: "文字列を指定回数繰り返す。",
    params: ["string $string — 繰り返す文字列", "int $times — 繰り返し回数"],
    returns: "string 繰り返した文字列"
  },
  "str_contains": {
    name: "str_contains",
    category: "PHP文字列",
    description: "文字列が別の文字列を含むかチェックする（PHP8+）。",
    params: ["string $haystack — 対象文字列", "string $needle — 探す文字列"],
    returns: "bool",
    tips: ["PHP8未満ではstrpos()で代替"]
  },
  "str_starts_with": {
    name: "str_starts_with",
    category: "PHP文字列",
    description: "文字列が指定の文字列で始まるかチェックする（PHP8+）。",
    params: ["string $haystack — 対象文字列", "string $needle — 先頭の文字列"],
    returns: "bool"
  },
  "str_ends_with": {
    name: "str_ends_with",
    category: "PHP文字列",
    description: "文字列が指定の文字列で終わるかチェックする（PHP8+）。",
    params: ["string $haystack — 対象文字列", "string $needle — 末尾の文字列"],
    returns: "bool"
  },
  "strtolower": {
    name: "strtolower",
    category: "PHP文字列",
    description: "文字列を小文字に変換する。",
    params: ["string $string — 対象の文字列"],
    returns: "string 小文字の文字列",
    tips: ["日本語はmb_strtolower()を使う"]
  },
  "strtoupper": {
    name: "strtoupper",
    category: "PHP文字列",
    description: "文字列を大文字に変換する。",
    params: ["string $string — 対象の文字列"],
    returns: "string 大文字の文字列"
  },
  "ucfirst": {
    name: "ucfirst",
    category: "PHP文字列",
    description: "文字列の先頭を大文字にする。",
    params: ["string $string — 対象の文字列"],
    returns: "string 先頭が大文字の文字列"
  },
  "ucwords": {
    name: "ucwords",
    category: "PHP文字列",
    description: "各単語の先頭を大文字にする。",
    params: ["string $string — 対象の文字列"],
    returns: "string 各単語が大文字始まりの文字列"
  },
  "preg_match": {
    name: "preg_match",
    category: "PHP文字列",
    description: "正規表現でマッチするか検索する。",
    params: ["string $pattern — 正規表現パターン", "string $subject — 対象の文字列", "array &$matches — マッチ結果を格納する変数（省略可）"],
    returns: "int マッチ数（0または1）。エラー時はfalse",
    tips: ["全てのマッチを取得するにはpreg_match_all()を使う"]
  },
  "preg_replace": {
    name: "preg_replace",
    category: "PHP文字列",
    description: "正規表現にマッチした部分を別の文字列に置き換える。",
    params: ["string|array $pattern — 正規表現パターン", "string|array $replacement — 置き換え文字列", "string|array $subject — 対象の文字列"],
    returns: "string|array 置き換え後の文字列"
  },
  "preg_split": {
    name: "preg_split",
    category: "PHP文字列",
    description: "正規表現で文字列を分割して配列にする。",
    params: ["string $pattern — 正規表現パターン", "string $subject — 対象の文字列"],
    returns: "array 分割後の配列"
  },
  "mb_strlen": {
    name: "mb_strlen",
    category: "PHP文字列",
    description: "マルチバイト対応の文字列長を返す（日本語対応）。",
    params: ["string $string — 対象の文字列", "string $encoding — エンコーディング（省略可、デフォルト'UTF-8'）"],
    returns: "int 文字数",
    tips: ["strlen()はバイト数を返すが、mb_strlen()は文字数を返す"]
  },
  "mb_substr": {
    name: "mb_substr",
    category: "PHP文字列",
    description: "マルチバイト対応の文字列切り出し（日本語対応）。",
    params: ["string $string — 対象の文字列", "int $start — 開始位置", "int $length — 切り出す長さ（省略可）"],
    returns: "string 切り出した文字列"
  },
  "mb_strpos": {
    name: "mb_strpos",
    category: "PHP文字列",
    description: "マルチバイト対応の文字列検索（日本語対応）。",
    params: ["string $haystack — 対象の文字列", "string $needle — 探す文字列", "int $offset — 開始位置（省略可）"],
    returns: "int|false 見つかった位置またはfalse"
  },
  "mb_convert_encoding": {
    name: "mb_convert_encoding",
    category: "PHP文字列",
    description: "文字コードを変換する。",
    params: ["string $string — 変換する文字列", "string $to_encoding — 変換後のエンコーディング", "string $from_encoding — 変換前のエンコーディング（省略可）"],
    returns: "string 変換後の文字列",
    tips: ["Shift_JIS → UTF-8: mb_convert_encoding($str, 'UTF-8', 'SJIS')"]
  },
  "json_encode": {
    name: "json_encode",
    category: "PHP文字列",
    description: "PHPの値をJSON文字列に変換する。",
    params: ["mixed $value — エンコードする値", "int $flags — JSON_UNESCAPED_UNICODE等のフラグ（省略可）"],
    returns: "string|false JSON文字列",
    tips: ["日本語を含む場合はJSON_UNESCAPED_UNICODEフラグを使う"]
  },
  "json_decode": {
    name: "json_decode",
    category: "PHP文字列",
    description: "JSON文字列をPHPの値に変換する。",
    params: ["string $json — デコードするJSON文字列", "bool $associative — trueで連想配列（デフォルトfalse=オブジェクト）"],
    returns: "mixed デコードした値",
    tips: ["第2引数をtrueにすると配列として取得できて扱いやすい"]
  },

  // ==================== PHP配列（追加） ====================
  "array_slice": {
    name: "array_slice",
    category: "PHP配列",
    description: "配列の一部を切り出して返す。",
    params: ["array $array — 対象の配列", "int $offset — 開始位置", "int $length — 切り出す要素数（省略可）", "bool $preserve_keys — キーを保持するか（デフォルトfalse）"],
    returns: "array 切り出した配列",
    tips: ["先頭N件取得: array_slice($arr, 0, 5)"]
  },
  "array_splice": {
    name: "array_splice",
    category: "PHP配列",
    description: "配列の一部を削除・置換する（元の配列を変更する）。",
    params: ["array &$array — 対象の配列（参照渡し）", "int $offset — 開始位置", "int $length — 削除する要素数", "mixed $replacement — 挿入する要素（省略可）"],
    returns: "array 削除した要素の配列"
  },
  "array_unique": {
    name: "array_unique",
    category: "PHP配列",
    description: "配列から重複した値を除去する。",
    params: ["array $array — 対象の配列"],
    returns: "array 重複なしの配列",
    tips: ["array_valuesで添字を振り直すと扱いやすい"]
  },
  "array_flip": {
    name: "array_flip",
    category: "PHP配列",
    description: "配列のキーと値を入れ替える。",
    params: ["array $array — 対象の配列"],
    returns: "array キーと値を入れ替えた配列"
  },
  "array_reverse": {
    name: "array_reverse",
    category: "PHP配列",
    description: "配列の順序を逆にする。",
    params: ["array $array — 対象の配列", "bool $preserve_keys — キーを保持するか（デフォルトfalse）"],
    returns: "array 逆順の配列"
  },
  "array_search": {
    name: "array_search",
    category: "PHP配列",
    description: "配列から値を検索してキーを返す。",
    params: ["mixed $needle — 探す値", "array $haystack — 対象の配列", "bool $strict — 型も一致させるか（デフォルトfalse）"],
    returns: "mixed 見つかったキー、なければfalse"
  },
  "array_combine": {
    name: "array_combine",
    category: "PHP配列",
    description: "2つの配列を組み合わせて連想配列を作る。",
    params: ["array $keys — キーの配列", "array $values — 値の配列"],
    returns: "array 連想配列",
    tips: ["$keysと$valuesの要素数が一致している必要がある"]
  },
  "array_chunk": {
    name: "array_chunk",
    category: "PHP配列",
    description: "配列を指定サイズに分割する。",
    params: ["array $array — 対象の配列", "int $length — 各チャンクのサイズ", "bool $preserve_keys — キーを保持するか（デフォルトfalse）"],
    returns: "array 分割後の多次元配列",
    tips: ["ページネーションやグリッド表示の分割に使う"]
  },
  "array_column": {
    name: "array_column",
    category: "PHP配列",
    description: "多次元配列から特定のカラムの値だけを取り出す。",
    params: ["array $array — 対象の多次元配列", "int|string|null $column_key — 取り出すカラムのキー", "int|string|null $index_key — 結果のキーに使うカラム（省略可）"],
    returns: "array 取り出した値の配列",
    tips: ["DBのレコード配列からIDだけ抽出するのに便利"]
  },
  "sort": {
    name: "sort",
    category: "PHP配列",
    description: "配列を昇順に並べ替える（元の配列を変更）。",
    params: ["array &$array — 対象の配列（参照渡し）"],
    returns: "bool",
    tips: ["rsort()は降順。usort()はカスタム関数で並べ替え"]
  },
  "usort": {
    name: "usort",
    category: "PHP配列",
    description: "ユーザー定義の比較関数で配列を並べ替える。",
    params: ["array &$array — 対象の配列（参照渡し）", "callable $callback — 比較関数（-1/0/1を返す）"],
    returns: "bool",
    tips: ["宇宙船演算子: usort($arr, fn($a,$b) => $a['date'] <=> $b['date'])"]
  },
  "count": {
    name: "count",
    category: "PHP配列",
    description: "配列の要素数を返す。",
    params: ["Countable|array $array — 対象の配列"],
    returns: "int 要素数"
  },
  "range": {
    name: "range",
    category: "PHP配列",
    description: "指定した範囲の値で配列を作る。",
    params: ["int|float|string $start — 開始値", "int|float|string $end — 終了値", "int|float $step — ステップ（省略可）"],
    returns: "array 範囲の配列",
    tips: ["range(1, 5) → [1, 2, 3, 4, 5]"]
  },
  "compact": {
    name: "compact",
    category: "PHP配列",
    description: "変数名を指定して連想配列を作る。",
    params: ["string ...$var_names — 変数名の文字列"],
    returns: "array 変数名をキーにした連想配列",
    tips: ["compact('name', 'age') → ['name' => $name, 'age' => $age]"]
  },
  "extract": {
    name: "extract",
    category: "PHP配列",
    description: "連想配列のキーを変数名として展開する。",
    params: ["array $array — 展開する連想配列"],
    returns: "int 展開した変数の数",
    tips: ["ユーザー入力には使わない（変数上書き攻撃の危険あり）"]
  },

  // ==================== PHPファイル操作 ====================
  "file_get_contents": {
    name: "file_get_contents",
    category: "PHPファイル",
    description: "ファイルまたはURLの内容を文字列として読み込む。",
    params: ["string $filename — ファイルパスまたはURL", "bool $use_include_path — include_pathを使うか（デフォルトfalse）"],
    returns: "string|false ファイルの内容",
    tips: ["URLを読む場合はallow_url_fopen=Onが必要", "大きいファイルはメモリ消費に注意"]
  },
  "file_put_contents": {
    name: "file_put_contents",
    category: "PHPファイル",
    description: "文字列をファイルに書き込む。",
    params: ["string $filename — ファイルパス", "mixed $data — 書き込む内容", "int $flags — FILE_APPEND等のフラグ（省略可）"],
    returns: "int|false 書き込んだバイト数",
    tips: ["FILE_APPENDフラグで追記モード、LOCK_EXで排他ロック"]
  },
  "file_exists": {
    name: "file_exists",
    category: "PHPファイル",
    description: "ファイルまたはディレクトリが存在するか確認する。",
    params: ["string $filename — ファイルパス"],
    returns: "bool 存在すればtrue",
    tips: ["キャッシュがあるためclearstatcache()が必要なことがある"]
  },
  "is_file": {
    name: "is_file",
    category: "PHPファイル",
    description: "パスが通常のファイルかどうかチェックする。",
    params: ["string $filename — ファイルパス"],
    returns: "bool"
  },
  "is_dir": {
    name: "is_dir",
    category: "PHPファイル",
    description: "パスがディレクトリかどうかチェックする。",
    params: ["string $filename — パス"],
    returns: "bool"
  },
  "mkdir": {
    name: "mkdir",
    category: "PHPファイル",
    description: "ディレクトリを作成する。",
    params: ["string $directory — 作成するパス", "int $permissions — パーミッション（デフォルト0777）", "bool $recursive — 再帰的に作成するか（デフォルトfalse）"],
    returns: "bool",
    tips: ["第3引数をtrueにすると親ディレクトリも一括作成"]
  },
  "basename": {
    name: "basename",
    category: "PHPファイル",
    description: "パスからファイル名部分を返す。",
    params: ["string $path — ファイルパス", "string $suffix — 除去するサフィックス（省略可）"],
    returns: "string ファイル名",
    tips: ["dirname()はディレクトリ部分を返す"]
  },
  "dirname": {
    name: "dirname",
    category: "PHPファイル",
    description: "パスからディレクトリ部分を返す。",
    params: ["string $path — ファイルパス", "int $levels — 遡る階層数（デフォルト1）"],
    returns: "string ディレクトリパス",
    tips: ["__FILE__と組み合わせて相対パスを作るのに使う"]
  },
  "pathinfo": {
    name: "pathinfo",
    category: "PHPファイル",
    description: "パスの情報（ディレクトリ・ファイル名・拡張子）を配列で返す。",
    params: ["string $path — ファイルパス", "int $options — PATHINFO_DIRNAME等で絞り込み（省略可）"],
    returns: "array|string パス情報",
    tips: ["拡張子だけ: pathinfo($path, PATHINFO_EXTENSION)"]
  },
  "glob": {
    name: "glob",
    category: "PHPファイル",
    description: "パターンに一致するファイル/ディレクトリのパス一覧を返す。",
    params: ["string $pattern — globパターン（例: '*.jpg'）", "int $flags — GLOB_ONLYDIR等のフラグ（省略可）"],
    returns: "array|false ファイルパスの配列",
    tips: ["'uploads/*.jpg'で画像一覧取得などに使う"]
  },

  // ==================== PHP型チェック ====================
  "is_array": {
    name: "is_array",
    category: "PHP型チェック",
    description: "値が配列かどうかチェックする。",
    params: ["mixed $value — チェックする値"],
    returns: "bool"
  },
  "is_string": {
    name: "is_string",
    category: "PHP型チェック",
    description: "値が文字列かどうかチェックする。",
    params: ["mixed $value — チェックする値"],
    returns: "bool"
  },
  "is_int": {
    name: "is_int",
    category: "PHP型チェック",
    description: "値が整数かどうかチェックする。",
    params: ["mixed $value — チェックする値"],
    returns: "bool",
    tips: ["is_integer()はエイリアス"]
  },
  "is_float": {
    name: "is_float",
    category: "PHP型チェック",
    description: "値が浮動小数点数かどうかチェックする。",
    params: ["mixed $value — チェックする値"],
    returns: "bool"
  },
  "is_bool": {
    name: "is_bool",
    category: "PHP型チェック",
    description: "値がbool型かどうかチェックする。",
    params: ["mixed $value — チェックする値"],
    returns: "bool"
  },
  "is_null": {
    name: "is_null",
    category: "PHP型チェック",
    description: "値がnullかどうかチェックする。",
    params: ["mixed $value — チェックする値"],
    returns: "bool"
  },
  "is_object": {
    name: "is_object",
    category: "PHP型チェック",
    description: "値がオブジェクトかどうかチェックする。",
    params: ["mixed $value — チェックする値"],
    returns: "bool"
  },
  "gettype": {
    name: "gettype",
    category: "PHP型チェック",
    description: "値の型を文字列で返す。",
    params: ["mixed $value — チェックする値"],
    returns: "string 型名（'integer', 'string', 'array', 'object'等）"
  },

  // ==================== PHP日付（追加） ====================
  "time": {
    name: "time",
    category: "PHP日付",
    description: "現在のUnixタイムスタンプ（秒）を返す。",
    params: [],
    returns: "int 現在時刻のタイムスタンプ",
    tips: ["date()の第2引数に渡して日付フォーマット"]
  },
  "strtotime": {
    name: "strtotime",
    category: "PHP日付",
    description: "日付文字列をUnixタイムスタンプに変換する。",
    params: ["string $datetime — 日付文字列", "int $baseTimestamp — 基準時刻（省略可）"],
    returns: "int|false タイムスタンプ",
    tips: ["strtotime('+1 week'), strtotime('2024-01-01')等の自然言語も使える"]
  },
  "mktime": {
    name: "mktime",
    category: "PHP日付",
    description: "指定した日時のUnixタイムスタンプを返す。",
    params: ["int $hour", "int $minute", "int $second", "int $month", "int $day", "int $year"],
    returns: "int タイムスタンプ"
  },
  "checkdate": {
    name: "checkdate",
    category: "PHP日付",
    description: "日付が正しいかどうかチェックする。",
    params: ["int $month — 月", "int $day — 日", "int $year — 年"],
    returns: "bool 有効な日付ならtrue"
  },

  // ==================== PHPセッション ====================
  "session_start": {
    name: "session_start",
    category: "PHPセッション",
    description: "セッションを開始する（または既存セッションを再開する）。",
    params: [],
    returns: "bool",
    tips: ["出力（HTMLやecho）の前に呼ぶ必要がある"]
  },
  "session_destroy": {
    name: "session_destroy",
    category: "PHPセッション",
    description: "セッションを破棄する。",
    params: [],
    returns: "bool",
    tips: ["$_SESSIONのデータも手動でクリアするのが確実: $_SESSION = []"]
  },
  "session_id": {
    name: "session_id",
    category: "PHPセッション",
    description: "現在のセッションIDを取得または設定する。",
    params: ["string $id — 設定するID（省略時は取得のみ）"],
    returns: "string セッションID"
  },

  // ==================== WordPressユーザー ====================
  "get_current_user_id": {
    name: "get_current_user_id",
    category: "WordPressユーザー",
    description: "現在ログイン中のユーザーIDを返す。",
    params: [],
    returns: "int ユーザーID（未ログインは0）",
    tips: ["ログインチェックはis_user_logged_in()と組み合わせる"]
  },
  "get_userdata": {
    name: "get_userdata",
    category: "WordPressユーザー",
    description: "ユーザーIDからユーザー情報を取得する。",
    params: ["int $user_id — ユーザーID"],
    returns: "WP_User|false ユーザーオブジェクト",
    tips: ["$user->user_email, $user->display_name等でアクセス"]
  },
  "get_user_by": {
    name: "get_user_by",
    category: "WordPressユーザー",
    description: "指定したフィールドでユーザーを取得する。",
    params: ["string $field — 'id'/'email'/'login'/'slug'", "mixed $value — 検索する値"],
    returns: "WP_User|false"
  },
  "get_user_meta": {
    name: "get_user_meta",
    category: "WordPressユーザー",
    description: "ユーザーのメタデータを取得する。",
    params: ["int $user_id — ユーザーID", "string $key — メタキー", "bool $single — trueで単一値（デフォルトfalse）"],
    returns: "mixed メタ値"
  },
  "update_user_meta": {
    name: "update_user_meta",
    category: "WordPressユーザー",
    description: "ユーザーのメタデータを更新する。",
    params: ["int $user_id — ユーザーID", "string $meta_key — メタキー", "mixed $meta_value — 値"],
    returns: "int|bool"
  },
  "current_user_can": {
    name: "current_user_can",
    category: "WordPressユーザー",
    description: "現在のユーザーが指定の権限を持っているか確認する。",
    params: ["string $capability — 権限名（'manage_options','edit_posts'等）"],
    returns: "bool",
    tips: ["管理者チェック: current_user_can('manage_options')"]
  },
  "wp_create_user": {
    name: "wp_create_user",
    category: "WordPressユーザー",
    description: "新しいユーザーを作成する。",
    params: ["string $username — ユーザー名", "string $password — パスワード", "string $email — メールアドレス（省略可）"],
    returns: "int|WP_Error 作成したユーザーID"
  },
  "wp_set_password": {
    name: "wp_set_password",
    category: "WordPressユーザー",
    description: "ユーザーのパスワードを設定する。",
    params: ["string $password — 新しいパスワード", "int $user_id — ユーザーID"],
    returns: "void"
  },
  "wp_get_current_user": {
    name: "wp_get_current_user",
    category: "WordPressユーザー",
    description: "現在ログイン中のユーザーオブジェクトを返す。",
    params: [],
    returns: "WP_User",
    tips: ["$user->ID, $user->user_login等でアクセス"]
  },
  "get_avatar": {
    name: "get_avatar",
    category: "WordPressユーザー",
    description: "ユーザーのアバター画像タグを返す。",
    params: ["mixed $id_or_email — ユーザーID/メール/WP_User", "int $size — サイズ（px、デフォルト96）"],
    returns: "string|false imgタグのHTML"
  },

  // ==================== WordPressオプション ====================
  "get_option": {
    name: "get_option",
    category: "WordPressオプション",
    description: "WordPressのオプション値を取得する。",
    params: ["string $option — オプション名", "mixed $default_value — デフォルト値（省略可）"],
    returns: "mixed オプション値",
    tips: ["設定値の保存・取得に使う。autoloadされるためキャッシュされる"]
  },
  "update_option": {
    name: "update_option",
    category: "WordPressオプション",
    description: "WordPressのオプション値を更新する（なければ追加）。",
    params: ["string $option — オプション名", "mixed $value — 保存する値", "bool $autoload — 自動ロードするか（省略可）"],
    returns: "bool 変更があればtrue"
  },
  "add_option": {
    name: "add_option",
    category: "WordPressオプション",
    description: "WordPressのオプションを新規追加する（既存の場合は追加しない）。",
    params: ["string $option — オプション名", "mixed $value — 保存する値"],
    returns: "bool 追加成功ならtrue",
    tips: ["update_option()はなければ追加・あれば更新。add_option()は初回のみ"]
  },
  "delete_option": {
    name: "delete_option",
    category: "WordPressオプション",
    description: "WordPressのオプションを削除する。",
    params: ["string $option — オプション名"],
    returns: "bool 削除成功ならtrue"
  },
  "get_theme_mod": {
    name: "get_theme_mod",
    category: "WordPressオプション",
    description: "テーマカスタマイザーの設定値を取得する。",
    params: ["string $name — 設定名", "mixed $default_value — デフォルト値（省略可）"],
    returns: "mixed 設定値",
    tips: ["set_theme_mod()で保存した値を取得する"]
  },
  "set_theme_mod": {
    name: "set_theme_mod",
    category: "WordPressオプション",
    description: "テーマカスタマイザーの設定値を保存する。",
    params: ["string $name — 設定名", "mixed $value — 保存する値"],
    returns: "void"
  },

  // ==================== WordPressトランジェント ====================
  "get_transient": {
    name: "get_transient",
    category: "WordPressトランジェント",
    description: "一時的にキャッシュした値（トランジェント）を取得する。",
    params: ["string $transient — トランジェント名"],
    returns: "mixed キャッシュ値（期限切れ/未設定はfalse）",
    tips: ["APIレスポンスのキャッシュによく使う"]
  },
  "set_transient": {
    name: "set_transient",
    category: "WordPressトランジェント",
    description: "値を一時的にキャッシュ（トランジェント）として保存する。",
    params: ["string $transient — トランジェント名", "mixed $value — 保存する値", "int $expiration — 有効期間（秒）。0で期限なし"],
    returns: "bool",
    tips: ["HOUR_IN_SECONDS, DAY_IN_SECONDS等の定数が使える"]
  },
  "delete_transient": {
    name: "delete_transient",
    category: "WordPressトランジェント",
    description: "トランジェントキャッシュを削除する。",
    params: ["string $transient — トランジェント名"],
    returns: "bool"
  },

  // ==================== WordPressメディア ====================
  "wp_get_attachment_url": {
    name: "wp_get_attachment_url",
    category: "WordPressメディア",
    description: "添付ファイルのURLを返す。",
    params: ["int $attachment_id — 添付ファイルID"],
    returns: "string|false URL文字列"
  },
  "wp_get_attachment_image": {
    name: "wp_get_attachment_image",
    category: "WordPressメディア",
    description: "添付ファイルのimgタグを返す。",
    params: ["int $attachment_id — 添付ファイルID", "string|array $size — サイズ（'thumbnail'/'medium'/'large'/'full'）", "bool $icon — アイコンとして使うか（デフォルトfalse）", "array $attr — imgタグの属性"],
    returns: "string imgタグのHTML"
  },
  "wp_get_attachment_image_src": {
    name: "wp_get_attachment_image_src",
    category: "WordPressメディア",
    description: "添付ファイルの画像情報（URL・幅・高さ）を配列で返す。",
    params: ["int $attachment_id — 添付ファイルID", "string|array $size — サイズ"],
    returns: "array|false [url, width, height, is_intermediate]",
    tips: ["list($url, $width, $height) = wp_get_attachment_image_src(...)"]
  },
  "get_the_post_thumbnail": {
    name: "get_the_post_thumbnail",
    frequent: true,
    category: "WordPressメディア",
    description: "投稿のアイキャッチ画像タグを返す。",
    params: ["int|WP_Post $post — 投稿ID（省略時はグローバル$post）", "string|array $size — サイズ（デフォルト'post-thumbnail'）", "array $attr — imgタグの属性"],
    returns: "string imgタグのHTML"
  },
  "get_the_post_thumbnail_url": {
    name: "get_the_post_thumbnail_url",
    category: "WordPressメディア",
    description: "投稿のアイキャッチ画像URLを返す。",
    params: ["int|WP_Post $post — 投稿ID（省略可）", "string|array $size — サイズ"],
    returns: "string|false URL文字列"
  },
  "has_post_thumbnail": {
    name: "has_post_thumbnail",
    category: "WordPressメディア",
    description: "投稿にアイキャッチ画像が設定されているか確認する。",
    params: ["int|WP_Post $post — 投稿ID（省略時はグローバル$post）"],
    returns: "bool"
  },
  "wp_upload_dir": {
    name: "wp_upload_dir",
    category: "WordPressメディア",
    description: "WordPressのアップロードディレクトリ情報を返す。",
    params: [],
    returns: "array ['path', 'url', 'subdir', 'basedir', 'baseurl']",
    tips: ["uploads/ディレクトリのパス・URLを取得するのに使う"]
  },
  "media_handle_upload": {
    name: "media_handle_upload",
    category: "WordPressメディア",
    description: "フォームでアップロードされたファイルをメディアライブラリに追加する。",
    params: ["string $file_id — $_FILESのキー名", "int $post_id — 関連付ける投稿ID"],
    returns: "int|WP_Error 添付ファイルID"
  },

  // ==================== WordPressタクソノミー ====================
  "get_terms": {
    name: "get_terms",
    category: "WordPressタクソノミー",
    description: "タクソノミーのタームを取得する。",
    params: ["array $args — 取得条件（taxonomy, hide_empty, orderby等）"],
    returns: "WP_Term[]|WP_Error タームの配列",
    tips: ["taxonomy指定が必須。hide_empty=falseで投稿数0のタームも取得"]
  },
  "get_term": {
    name: "get_term",
    category: "WordPressタクソノミー",
    description: "指定IDのタームを取得する。",
    params: ["int|WP_Term $term — タームIDまたはWP_Termオブジェクト", "string $taxonomy — タクソノミー名"],
    returns: "WP_Term|WP_Error|null"
  },
  "get_term_by": {
    name: "get_term_by",
    category: "WordPressタクソノミー",
    description: "フィールドを指定してタームを取得する。",
    params: ["string $field — 'id'/'name'/'slug'/'term_taxonomy_id'", "mixed $value — 検索する値", "string $taxonomy — タクソノミー名"],
    returns: "WP_Term|false"
  },
  "get_the_terms": {
    name: "get_the_terms",
    category: "WordPressタクソノミー",
    description: "投稿に紐づくタームを取得する。",
    params: ["int|WP_Post $post — 投稿ID", "string $taxonomy — タクソノミー名"],
    returns: "WP_Term[]|false|WP_Error"
  },
  "wp_set_post_terms": {
    name: "wp_set_post_terms",
    category: "WordPressタクソノミー",
    description: "投稿にタームを設定する。",
    params: ["int $post_id — 投稿ID", "array|int $terms — タームID or スラッグの配列", "string $taxonomy — タクソノミー名", "bool $append — 追記するか上書きするか（デフォルトfalse=上書き）"],
    returns: "array|WP_Error 設定したタームのID配列"
  },
  "get_term_meta": {
    name: "get_term_meta",
    category: "WordPressタクソノミー",
    description: "タームのメタデータを取得する。",
    params: ["int $term_id — タームID", "string $key — メタキー", "bool $single — 単一値で返すか（デフォルトfalse）"],
    returns: "mixed メタ値"
  },
  "update_term_meta": {
    name: "update_term_meta",
    category: "WordPressタクソノミー",
    description: "タームのメタデータを更新する。",
    params: ["int $term_id — タームID", "string $meta_key — メタキー", "mixed $meta_value — 値"],
    returns: "int|bool"
  },
  "wp_insert_term": {
    name: "wp_insert_term",
    category: "WordPressタクソノミー",
    description: "新しいタームをタクソノミーに追加する。",
    params: ["string $term — タームの名前", "string $taxonomy — タクソノミー名", "array $args — slug/parent/description等（省略可）"],
    returns: "array|WP_Error ['term_id', 'term_taxonomy_id']"
  },

  // ==================== WordPress投稿操作 ====================
  "wp_insert_post": {
    name: "wp_insert_post",
    category: "WordPress投稿操作",
    description: "新しい投稿を作成またはデータベースに挿入する。",
    params: ["array $postarr — 投稿データ（post_title, post_content, post_status等）", "bool $wp_error — エラー時にWP_Errorを返すか（デフォルトfalse）"],
    returns: "int|WP_Error 投稿ID",
    tips: ["post_status: 'publish'/'draft'/'pending'", "post_type: 'post'/'page'/カスタム"]
  },
  "wp_update_post": {
    name: "wp_update_post",
    category: "WordPress投稿操作",
    description: "既存の投稿を更新する。",
    params: ["array $postarr — 更新データ（IDは必須）", "bool $wp_error — エラー時にWP_Errorを返すか"],
    returns: "int|WP_Error 投稿ID"
  },
  "wp_delete_post": {
    name: "wp_delete_post",
    category: "WordPress投稿操作",
    description: "投稿を削除する（デフォルトはゴミ箱に移動）。",
    params: ["int $post_id — 投稿ID", "bool $force_delete — trueで完全削除（デフォルトfalse）"],
    returns: "WP_Post|false|null 削除した投稿オブジェクト"
  },
  "wp_trash_post": {
    name: "wp_trash_post",
    category: "WordPress投稿操作",
    description: "投稿をゴミ箱に移動する。",
    params: ["int $post_id — 投稿ID"],
    returns: "WP_Post|false"
  },
  "get_post_status": {
    name: "get_post_status",
    category: "WordPress投稿操作",
    description: "投稿のステータスを返す。",
    params: ["int|WP_Post $post — 投稿ID（省略時はグローバル$post）"],
    returns: "string|false 'publish'/'draft'/'pending'等"
  },
  "get_post_type": {
    name: "get_post_type",
    category: "WordPress投稿操作",
    description: "投稿タイプを返す。",
    params: ["int|WP_Post $post — 投稿ID（省略時はグローバル$post）"],
    returns: "string|false 投稿タイプ名"
  },
  "get_children": {
    name: "get_children",
    category: "WordPress投稿操作",
    description: "指定投稿の子投稿を取得する。",
    params: ["array|int $args — 取得条件またはpost_parent ID"],
    returns: "WP_Post[] 子投稿の配列"
  },
  "get_adjacent_post": {
    name: "get_adjacent_post",
    category: "WordPress投稿操作",
    description: "前後の投稿を取得する。",
    params: ["bool $in_same_term — 同じタームの投稿か（デフォルトfalse）", "array|string $excluded_terms — 除外するターム", "bool $previous — trueで前の投稿（デフォルトtrue）"],
    returns: "WP_Post|null"
  },
  "get_previous_post": {
    name: "get_previous_post",
    category: "WordPress投稿操作",
    description: "前の投稿を取得する。",
    params: ["bool $in_same_term — 同じカテゴリか（デフォルトfalse）"],
    returns: "WP_Post|null"
  },
  "get_next_post": {
    name: "get_next_post",
    category: "WordPress投稿操作",
    description: "次の投稿を取得する。",
    params: ["bool $in_same_term — 同じカテゴリか（デフォルトfalse）"],
    returns: "WP_Post|null"
  },
  "the_excerpt": {
    name: "the_excerpt",
    frequent: true,
    category: "WordPress投稿操作",
    description: "投稿の抜粋を出力する。",
    params: [],
    returns: "void",
    tips: ["get_the_excerpt()は文字列で返す版"]
  },
  "get_the_excerpt": {
    name: "get_the_excerpt",
    frequent: true,
    category: "WordPress投稿操作",
    description: "投稿の抜粋を文字列で返す。",
    params: ["int|WP_Post $post — 投稿ID（省略可）"],
    returns: "string 抜粋テキスト"
  },
  "the_tags": {
    name: "the_tags",
    category: "WordPress投稿操作",
    description: "投稿のタグ一覧を出力する。",
    params: ["string $before — 前に表示するテキスト", "string $sep — 区切り文字", "string $after — 後に表示するテキスト"],
    returns: "void"
  },
  "the_category": {
    name: "the_category",
    category: "WordPress投稿操作",
    description: "投稿のカテゴリ一覧を出力する。",
    params: ["string $separator — 区切り文字（省略可）"],
    returns: "void"
  },

  // ==================== WordPressコメント ====================
  "get_comments": {
    name: "get_comments",
    category: "WordPressコメント",
    description: "コメントを取得する。",
    params: ["array $args — 取得条件（post_id, status, number等）"],
    returns: "WP_Comment[] コメントの配列"
  },
  "get_comment": {
    name: "get_comment",
    category: "WordPressコメント",
    description: "指定IDのコメントを取得する。",
    params: ["int|WP_Comment $comment — コメントID"],
    returns: "WP_Comment|null"
  },
  "wp_insert_comment": {
    name: "wp_insert_comment",
    category: "WordPressコメント",
    description: "新しいコメントを追加する。",
    params: ["array $commentdata — コメントデータ（comment_post_ID, comment_content等）"],
    returns: "int|false コメントID"
  },
  "get_comments_number": {
    name: "get_comments_number",
    category: "WordPressコメント",
    description: "投稿のコメント数を返す。",
    params: ["int|WP_Post $post — 投稿ID（省略時はグローバル$post）"],
    returns: "int コメント数"
  },
  "comments_open": {
    name: "comments_open",
    category: "WordPressコメント",
    description: "投稿のコメントが開いているか確認する。",
    params: ["int|WP_Post $post — 投稿ID（省略時はグローバル$post）"],
    returns: "bool"
  },

  // ==================== WordPressリダイレクト・URL ====================
  "wp_redirect": {
    name: "wp_redirect",
    category: "WordPressリダイレクト",
    description: "指定URLにリダイレクトする。",
    params: ["string $location — リダイレクト先URL", "int $status — HTTPステータスコード（デフォルト302）"],
    returns: "bool",
    tips: ["呼び出し後は必ずexit;を書く（処理を止めるため）"]
  },
  "wp_safe_redirect": {
    name: "wp_safe_redirect",
    category: "WordPressリダイレクト",
    description: "安全なURLのみにリダイレクトする（外部サイトへのオープンリダイレクト防止）。",
    params: ["string $location — リダイレクト先URL", "int $status — HTTPステータスコード（デフォルト302）"],
    returns: "bool",
    tips: ["wp_redirect()より安全。呼び出し後は必ずexit;"]
  },
  "get_permalink": {
    name: "get_permalink",
    category: "WordPressリダイレクト",
    description: "投稿のパーマリンクを返す。",
    params: ["int|WP_Post $post — 投稿ID（省略時はグローバル$post）"],
    returns: "string|false URL文字列"
  },
  "get_post_permalink": {
    name: "get_post_permalink",
    category: "WordPressリダイレクト",
    description: "カスタム投稿タイプのパーマリンクを返す。",
    params: ["int|WP_Post $post — 投稿ID"],
    returns: "string|false URL文字列"
  },
  "get_term_link": {
    name: "get_term_link",
    category: "WordPressリダイレクト",
    description: "タームのアーカイブURLを返す。",
    params: ["int|WP_Term|string $term — タームID/スラッグ/WP_Term", "string $taxonomy — タクソノミー名（省略可）"],
    returns: "string|WP_Error URL文字列"
  },
  "get_author_posts_url": {
    name: "get_author_posts_url",
    category: "WordPressリダイレクト",
    description: "著者の投稿一覧ページURLを返す。",
    params: ["int $author_id — 著者のユーザーID"],
    returns: "string URL文字列"
  },

  // ==================== WordPressテーマ・テンプレート ====================
  "get_theme_file_uri": {
    name: "get_theme_file_uri",
    frequent: true,
    category: "WordPressテーマ",
    description: "テーマファイルのURLを返す（子テーマを優先して検索）。",
    params: ["string $file — テーマディレクトリからの相対パス（省略可）"],
    returns: "string URL文字列",
    tips: ["子テーマに同名ファイルがあれば子テーマのURLを返す（親テーマより優先）", "get_template_directory_uri()との違いはこの子テーマ優先の挙動"]
  },
  "get_theme_file_path": {
    name: "get_theme_file_path",
    category: "WordPressテーマ",
    description: "テーマファイルの絶対パスを返す（子テーマを優先して検索）。",
    params: ["string $file — テーマディレクトリからの相対パス（省略可）"],
    returns: "string 絶対パス文字列"
  },
  "get_parent_theme_file_uri": {
    name: "get_parent_theme_file_uri",
    category: "WordPressテーマ",
    description: "親テーマのファイルURLを返す（子テーマ優先なし）。",
    params: ["string $file — 相対パス（省略可）"],
    returns: "string URL文字列"
  },
  "get_header": {
    name: "get_header",
    frequent: true,
    category: "WordPressテーマ",
    description: "テーマのheader.phpを読み込む。",
    params: ["string $name — テンプレート名（省略可）"],
    returns: "void",
    tips: ["header-{name}.phpを読み込む"]
  },
  "get_footer": {
    name: "get_footer",
    frequent: true,
    category: "WordPressテーマ",
    description: "テーマのfooter.phpを読み込む。",
    params: ["string $name — テンプレート名（省略可）"],
    returns: "void"
  },
  "get_sidebar": {
    name: "get_sidebar",
    category: "WordPressテーマ",
    description: "テーマのsidebar.phpを読み込む。",
    params: ["string $name — テンプレート名（省略可）"],
    returns: "void"
  },
  "get_template_part": {
    name: "get_template_part",
    frequent: true,
    category: "WordPressテーマ",
    description: "テンプレートパーツを読み込む。",
    params: ["string $slug — テンプレートのスラッグ", "string $name — テンプレート名（省略可）", "array $args — テンプレートに渡す変数（省略可）"],
    returns: "void",
    tips: ["get_template_part('template-parts/card', 'post') → template-parts/card-post.phpを読み込む"]
  },
  "locate_template": {
    name: "locate_template",
    category: "WordPressテーマ",
    description: "テンプレートファイルを探してパスを返す（子テーマ優先）。",
    params: ["string|array $template_names — テンプレートファイル名の配列", "bool $load — trueなら読み込む（デフォルトfalse）"],
    returns: "string テンプレートのパス"
  },
  "add_theme_support": {
    name: "add_theme_support",
    category: "WordPressテーマ",
    description: "テーマの機能（アイキャッチ・カスタムロゴ等）を有効にする。",
    params: ["string $feature — 機能名（'post-thumbnails'/'custom-logo'等）", "mixed ...$args — 追加設定（省略可）"],
    returns: "void",
    tips: ["after_setup_themeアクション内で呼ぶ", "'post-thumbnails'でアイキャッチ有効化"]
  },
  "register_nav_menus": {
    name: "register_nav_menus",
    category: "WordPressテーマ",
    description: "ナビゲーションメニューの場所を登録する。",
    params: ["array $locations — ['スラッグ' => '表示名']の連想配列"],
    returns: "void",
    tips: ["after_setup_themeアクション内で呼ぶ"]
  },
  "wp_nav_menu": {
    name: "wp_nav_menu",
    frequent: true,
    category: "WordPressテーマ",
    description: "ナビゲーションメニューを出力する。",
    params: ["array $args — theme_location/menu/container/menu_class等の設定"],
    returns: "void|string",
    tips: ["theme_location: register_nav_menusで登録したスラッグを指定"]
  },
  "register_sidebar": {
    name: "register_sidebar",
    frequent: true,
    category: "WordPressテーマ",
    description: "ウィジェットエリア（サイドバー）を登録する。",
    params: ["array $args — id/name/description/before_widget等の設定"],
    returns: "string 登録したサイドバーID",
    tips: ["widgets_initアクション内で呼ぶ"]
  },
  "dynamic_sidebar": {
    name: "dynamic_sidebar",
    frequent: true,
    category: "WordPressテーマ",
    description: "登録したウィジェットエリアを出力する。",
    params: ["int|string $index — サイドバーIDまたはインデックス"],
    returns: "bool ウィジェットがあればtrue"
  },
  "is_active_sidebar": {
    name: "is_active_sidebar",
    category: "WordPressテーマ",
    description: "ウィジェットエリアにウィジェットが設定されているか確認する。",
    params: ["string|int $index — サイドバーIDまたはインデックス"],
    returns: "bool"
  },
  "wp_head": {
    name: "wp_head",
    frequent: true,
    category: "WordPressテーマ",
    description: "</head>の直前に必ず呼ぶWordPressのフック発火関数。",
    params: [],
    returns: "void",
    tips: ["wp_enqueue_style/scriptで登録したCSS/JSがここで出力される"]
  },
  "wp_footer": {
    name: "wp_footer",
    frequent: true,
    category: "WordPressテーマ",
    description: "</body>の直前に必ず呼ぶWordPressのフック発火関数。",
    params: [],
    returns: "void",
    tips: ["footer読み込みJSがここで出力される"]
  },
  "body_class": {
    name: "body_class",
    category: "WordPressテーマ",
    description: "<body>タグにページに応じたクラスを付与する。",
    params: ["string|array $class — 追加するクラス（省略可）"],
    returns: "void",
    tips: ["<body <?php body_class(); ?>> と使う"]
  },
  "post_class": {
    name: "post_class",
    category: "WordPressテーマ",
    description: "投稿要素にWordPressのクラスを付与する。",
    params: ["string|array $class — 追加するクラス（省略可）", "int|WP_Post $post — 投稿ID（省略可）"],
    returns: "void"
  },
  "language_attributes": {
    name: "language_attributes",
    category: "WordPressテーマ",
    description: "<html>タグに言語属性を付与する。",
    params: ["string $doctype — ドキュメントタイプ（デフォルト'html'）"],
    returns: "void",
    tips: ["<html <?php language_attributes(); ?>> と使う"]
  },
  "bloginfo": {
    name: "bloginfo",
    frequent: true,
    category: "WordPressテーマ",
    description: "サイト情報を出力する。",
    params: ["string $show — 'name'/'description'/'charset'/'url'/'template_url'等"],
    returns: "void",
    tips: ["get_bloginfo()は文字列を返す版"]
  },
  "get_bloginfo": {
    name: "get_bloginfo",
    category: "WordPressテーマ",
    description: "サイト情報を文字列で返す。",
    params: ["string $show — 'name'/'description'/'charset'/'url'等"],
    returns: "string サイト情報"
  },

  // ==================== WordPressショートコード ====================
  "add_shortcode": {
    name: "add_shortcode",
    category: "WordPressショートコード",
    description: "カスタムショートコードを登録する。",
    params: ["string $tag — ショートコード名", "callable $callback — コールバック関数（$atts, $content, $tag）"],
    returns: "void",
    tips: ["コールバックはreturnで文字列を返す（echoは使わない）"]
  },
  "do_shortcode": {
    name: "do_shortcode",
    category: "WordPressショートコード",
    description: "文字列内のショートコードを処理して展開する。",
    params: ["string $content — 処理する文字列", "bool $ignore_html — HTMLタグを無視するか（デフォルトfalse）"],
    returns: "string ショートコードを展開した文字列",
    tips: ["ウィジェットやカスタムフィールドの内容にショートコードを使いたい場合に使う"]
  },
  "shortcode_atts": {
    name: "shortcode_atts",
    category: "WordPressショートコード",
    description: "ショートコードの属性とデフォルト値をマージする。",
    params: ["array $pairs — デフォルト値の連想配列", "array $atts — ショートコードから渡された属性"],
    returns: "array マージ後の属性配列",
    tips: ["ショートコードのコールバック内でデフォルト値を設定するのに使う"]
  },

  // ==================== WordPress Ajax ====================
  "wp_ajax": {
    name: "wp_ajax",
    category: "WordPress Ajax",
    description: "【フック名】ログイン済みユーザー向けのAjax処理フック。add_action('wp_ajax_{action}', callback)で使う。",
    params: [],
    returns: "void",
    tips: ["add_action('wp_ajax_my_action', 'my_function')のように使う"]
  },
  "wp_send_json_success": {
    name: "wp_send_json_success",
    category: "WordPress Ajax",
    description: "成功レスポンスをJSONで返してスクリプトを終了する。",
    params: ["mixed $data — レスポンスデータ（省略可）", "int $status_code — HTTPステータスコード（デフォルト200）"],
    returns: "void",
    tips: ["Ajaxハンドラの最後に呼ぶ（wp_die()の代わり）"]
  },
  "wp_send_json_error": {
    name: "wp_send_json_error",
    category: "WordPress Ajax",
    description: "エラーレスポンスをJSONで返してスクリプトを終了する。",
    params: ["mixed $data — エラーデータ（省略可）", "int $status_code — HTTPステータスコード（デフォルト200）"],
    returns: "void"
  },
  "wp_verify_nonce": {
    name: "wp_verify_nonce",
    category: "WordPress Ajax",
    description: "nonceを検証する（Ajax通信のセキュリティチェック）。",
    params: ["string $nonce — 検証するnonce文字列", "string $action — アクション名"],
    returns: "int|false 有効なら1か2、無効ならfalse"
  },
  "wp_create_nonce": {
    name: "wp_create_nonce",
    category: "WordPress Ajax",
    description: "nonceを生成して返す。",
    params: ["string $action — アクション名"],
    returns: "string nonce文字列",
    tips: ["wp_localize_scriptでJSに渡してAjax通信のセキュリティトークンとして使う"]
  },
  "wp_die": {
    name: "wp_die",
    category: "WordPress Ajax",
    description: "WordPressの終了関数（Ajaxの最後やエラー時に使う）。",
    params: ["mixed $message — メッセージ（省略可）", "mixed $title — タイトル（省略可）"],
    returns: "void",
    tips: ["Ajaxハンドラの最後はwp_send_json_success/error()の使用を推奨"]
  },

  // ==================== WordPress REST API ====================
  "register_rest_route": {
    name: "register_rest_route",
    category: "WordPress REST API",
    description: "カスタムREST APIエンドポイントを登録する。",
    params: ["string $namespace — 名前空間（例: 'myplugin/v1'）", "string $route — ルート（例: '/posts'）", "array $args — methods/callback/permission_callback等"],
    returns: "bool",
    tips: ["rest_api_initアクション内で呼ぶ", "permission_callbackは必須（セキュリティ上）"]
  },
  "rest_url": {
    name: "rest_url",
    category: "WordPress REST API",
    description: "REST APIのURLを返す。",
    params: ["string $path — エンドポイントのパス（省略可）"],
    returns: "string URL文字列",
    tips: ["デフォルトは /wp-json/"]
  },

  // ==================== WooCommerce ====================
  "wc_get_product": {
    name: "wc_get_product",
    category: "WooCommerce",
    description: "商品IDからWC_Productオブジェクトを取得する。",
    params: ["int|WC_Product $product — 商品IDまたはWC_Productオブジェクト"],
    returns: "WC_Product|false 商品オブジェクト"
  },
  "wc_get_order": {
    name: "wc_get_order",
    category: "WooCommerce",
    description: "注文IDからWC_Orderオブジェクトを取得する。",
    params: ["int $order_id — 注文ID"],
    returns: "WC_Order|false 注文オブジェクト"
  },
  "wc_get_cart_url": {
    name: "wc_get_cart_url",
    category: "WooCommerce",
    description: "カートページのURLを返す。",
    params: [],
    returns: "string URL文字列"
  },
  "wc_get_checkout_url": {
    name: "wc_get_checkout_url",
    category: "WooCommerce",
    description: "チェックアウトページのURLを返す。",
    params: [],
    returns: "string URL文字列"
  },
  "wc_price": {
    name: "wc_price",
    category: "WooCommerce",
    description: "価格をWooCommerceのフォーマットで返す（通貨記号・小数点等）。",
    params: ["float $price — 価格", "array $args — 通貨設定（省略可）"],
    returns: "string フォーマット済み価格HTML"
  },
  "wc_get_price_including_tax": {
    name: "wc_get_price_including_tax",
    category: "WooCommerce",
    description: "税込み価格を返す。",
    params: ["WC_Product $product — 商品オブジェクト", "array $args — qty/price等（省略可）"],
    returns: "float 税込み価格"
  },
  "wc_get_price_excluding_tax": {
    name: "wc_get_price_excluding_tax",
    category: "WooCommerce",
    description: "税抜き価格を返す。",
    params: ["WC_Product $product — 商品オブジェクト", "array $args — qty/price等（省略可）"],
    returns: "float 税抜き価格"
  },
  "wc_add_to_cart_message": {
    name: "wc_add_to_cart_message",
    category: "WooCommerce",
    description: "カートに追加した際のメッセージを返す。",
    params: ["array|int $products — 商品IDまたはID配列", "bool $show_qty — 数量を表示するか"],
    returns: "string メッセージHTML"
  },
  "WC": {
    name: "WC",
    category: "WooCommerce",
    description: "WooCommerceのメインインスタンスを返す。",
    params: [],
    returns: "WooCommerce インスタンス",
    tips: ["WC()->cart, WC()->session, WC()->customer等でアクセス"]
  },
  "wc_get_page_id": {
    name: "wc_get_page_id",
    category: "WooCommerce",
    description: "WooCommerceページ（ショップ/カート/マイアカウント等）の投稿IDを返す。",
    params: ["string $page — 'shop'/'cart'/'checkout'/'myaccount'"],
    returns: "int 投稿ID"
  },
  "is_shop": {
    name: "is_shop",
    category: "WooCommerce",
    description: "現在のページがWooCommerceショップページか確認する。",
    params: [],
    returns: "bool"
  },
  "is_product": {
    name: "is_product",
    category: "WooCommerce",
    description: "現在のページが商品ページか確認する。",
    params: [],
    returns: "bool"
  },
  "is_cart": {
    name: "is_cart",
    category: "WooCommerce",
    description: "現在のページがカートページか確認する。",
    params: [],
    returns: "bool"
  },
  "is_checkout": {
    name: "is_checkout",
    category: "WooCommerce",
    description: "現在のページがチェックアウトページか確認する。",
    params: [],
    returns: "bool"
  },
  "is_account_page": {
    name: "is_account_page",
    category: "WooCommerce",
    description: "現在のページがマイアカウントページか確認する。",
    params: [],
    returns: "bool"
  },
  "is_woocommerce": {
    name: "is_woocommerce",
    category: "WooCommerce",
    description: "現在のページがWooCommerceページか確認する。",
    params: [],
    returns: "bool",
    tips: ["is_shop()||is_product()||is_product_category()等をまとめて判定する"]
  },
  "woocommerce_template_loop_product_thumbnail": {
    name: "woocommerce_template_loop_product_thumbnail",
    category: "WooCommerce",
    description: "ループ内で商品サムネイルを出力する。",
    params: [],
    returns: "void"
  },
  "wc_get_template_part": {
    name: "wc_get_template_part",
    category: "WooCommerce",
    description: "WooCommerceのテンプレートパーツを読み込む。",
    params: ["string $slug — テンプレートスラッグ", "string $name — テンプレート名（省略可）"],
    returns: "void"
  },
  "wc_get_template": {
    name: "wc_get_template",
    category: "WooCommerce",
    description: "WooCommerceのテンプレートを読み込む（テーマ内で上書き可）。",
    params: ["string $template_name — テンプレートファイル名", "array $args — テンプレートに渡す変数（省略可）"],
    returns: "void"
  },

  // ==================== WordPressデバッグ ====================
  "error_log": {
    name: "error_log",
    category: "PHPデバッグ",
    description: "エラーログにメッセージを記録する。",
    params: ["mixed $message — ログに記録する内容", "int $message_type — 送信先（0=PHPエラーログ、デフォルト）"],
    returns: "bool",
    tips: ["WPのデバッグ: wp-config.phpでWP_DEBUGとWP_DEBUG_LOGをtrueに設定"]
  },
  "wp_debug_backtrace_summary": {
    name: "wp_debug_backtrace_summary",
    category: "PHPデバッグ",
    description: "バックトレースのサマリーを返す（WPデバッグ用）。",
    params: [],
    returns: "string バックトレース文字列"
  },
  "trigger_error": {
    name: "trigger_error",
    category: "PHPデバッグ",
    description: "ユーザー定義のエラーを発生させる。",
    params: ["string $message — エラーメッセージ", "int $error_level — E_USER_ERROR/E_USER_WARNING/E_USER_NOTICE"],
    returns: "bool"
  },

  "add_image_size": { name: "add_image_size", category: "追加辞書", description: "" },
  "get_taxonomies": { name: "get_taxonomies", category: "追加辞書", description: "" },
  "wp_login_url": { name: "wp_login_url", category: "追加辞書", description: "" },
  "wp_logout_url": { name: "wp_logout_url", category: "追加辞書", description: "" },
  "wp_registration_url": { name: "wp_registration_url", category: "追加辞書", description: "" },
  "is_home": { name: "is_home", frequent: true, category: "WordPress条件分岐", description: "現在のページがブログのトップページかどうかを返す。" },
  "is_admin": { name: "is_admin", category: "追加辞書", description: "" },
  "is_404": { name: "is_404", category: "追加辞書", description: "" },
  "is_search": { name: "is_search", category: "追加辞書", description: "" },
  "get_search_query": { name: "get_search_query", category: "追加辞書", description: "" },
  "the_search_query": { name: "the_search_query", category: "追加辞書", description: "" },
  "paginate_links": { name: "paginate_links", category: "追加辞書", description: "" },
  "next_posts_link": { name: "next_posts_link", category: "追加辞書", description: "" },
  "previous_posts_link": { name: "previous_posts_link", category: "追加辞書", description: "" },
  "comments_template": { name: "comments_template", category: "追加辞書", description: "" },
  "wp_list_comments": { name: "wp_list_comments", category: "追加辞書", description: "" },
  "comment_form": { name: "comment_form", category: "追加辞書", description: "" },
  "admin_enqueue_scripts": { name: "admin_enqueue_scripts", category: "追加辞書", description: "" },
  "plugin_dir_path": { name: "plugin_dir_path", category: "追加辞書", description: "" },
  "plugin_dir_url": { name: "plugin_dir_url", category: "追加辞書", description: "" },
  "get_stylesheet_uri": { name: "get_stylesheet_uri", category: "追加辞書", description: "" },
  "echo": { name: "echo", category: "追加辞書", description: "" },
  "print": { name: "print", category: "追加辞書", description: "" },
  "printf": { name: "printf", category: "追加辞書", description: "" },
  "die": { name: "die", category: "追加辞書", description: "" },
  "exit": { name: "exit", category: "追加辞書", description: "" },
  "require": { name: "require", category: "追加辞書", description: "" },
  "require_once": { name: "require_once", category: "追加辞書", description: "" },
  "include": { name: "include", category: "追加辞書", description: "" },
  "include_once": { name: "include_once", category: "追加辞書", description: "" },
  "foreach": { name: "foreach", category: "追加辞書", description: "" },
  "while": { name: "while", category: "追加辞書", description: "" },
  "switch": { name: "switch", category: "追加辞書", description: "" },
  "match": { name: "match", category: "追加辞書", description: "" },
  "array_pop": { name: "array_pop", category: "追加辞書", description: "" },
  "array_shift": { name: "array_shift", category: "追加辞書", description: "" },
  "array_unshift": { name: "array_unshift", category: "追加辞書", description: "" },
  "array_diff": { name: "array_diff", category: "追加辞書", description: "" },
  "array_intersect": { name: "array_intersect", category: "追加辞書", description: "" }
};
