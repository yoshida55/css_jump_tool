# CSS Jumper プロジェクト

## 概要
HTMLからAlt+クリックでCSSの該当行をVS Codeで開くChrome拡張機能

## 構成

```
css-jumper/
├── manifest.json          ... 拡張機能設定（MV3）
├── background.js          ... Service Worker（CSS検索、Native Messaging）
├── content.js             ... ページ操作（Alt+クリック検知、表示機能）
├── popup.html / popup.js  ... 設定UI
├── setup.bat              ... セットアップ用バッチ
└── native-host/
    ├── open_vscode.exe              ... VS Code起動用（Python不要）
    ├── open_vscode.py               ... exeのソース
    └── com.cssjumper.open_vscode.json  ... Native Messaging設定

css-to-html-jumper/
├── package.json           ... 拡張機能設定
├── src/                   ... TypeScriptソースコード
├── out/                   ... ビルド済みJS（Git管理済み）
├── node_modules/          ... 依存パッケージ（Git管理済み・災害復旧用）
└── *.vsix                 ... ビルド済み拡張ファイル（Git管理済み）
```

**重要**: `.gitignore` で node_modules/ と out/ を Git管理対象にしています。
→ 会社PCで `git clone` 後、**npm install 不要**で即開発可能
→ PC故障時もGitから完全復元可能（npmレジストリへの依存なし）

## 主要機能

| 機能 | 操作 | 説明 |
|------|------|------|
| CSSジャンプ | Alt+クリック | CSSファイルのみ開く |
| **3点連携ジャンプ** | **ダブルクリック** | **CSS + HTML🟡 + ブラウザ🔴** |
| **モバイルCSS検索** | **Ctrl+ダブルクリック / 767px以下** | **@media内を優先検索** |
| **HTMLハイライト** | **上記ジャンプ時** | **HTMLファイル該当行を黄色3秒表示** |
| Flex情報表示 | Alt+F / 自動 / 右クリック | Flexbox階層をラベルで可視化 |
| サイズ表示 | 右クリックメニュー | width/height表示 |
| 距離表示 | 右クリックメニュー | margin/padding表示 |
| クイックリサイズ | Ctrl+↓ / ホイール | 画面幅トグル |

### Flex情報表示の詳細

ページ上のFlexboxコンテナにラベルを表示し、階層構造を可視化する機能。

#### 表示内容
- **ツリー記号**: `└` の数で階層の深さを表現
- **方向**: `横`（row）/ `縦`（column）
- **セレクタ**: クラス名（`.class`）/ ID（`#id`）/ タグ名
- **色分け**: 深さごとに色が変化
  - 深さ0: 紫 / 深さ1: 青 / 深さ2: 緑 / 深さ3: オレンジ / 深さ4: 赤 / 深さ5+: シアン

#### 表示例
```
flex 横  .wrapper           ← 紫（深さ0）
└ flex 縦  .sidebar         ← 青（深さ1）
└└ flex 横  .nav_list       ← 緑（深さ2）
└ flex 横  .main_content    ← 青（深さ1）
```

#### キーボードショートカット
- **Alt+F** でFlex情報表示をトグル（2026-02-12追加）
- manifest.json の commands セクションで定義
- background.js でトグルロジック実装

#### クリックでCSSジャンプ
ラベルをクリックすると、その要素のCSS定義にVS Codeでジャンプ（Native Messaging経由）
- モバイルCSS自動検知対応（767px以下で@media優先）

#### 重なり回避
ラベルが重なる場合は自動的に下にズラして配置

#### 関連コード（content.js）
- `getFlexDepth()` — 親を遡ってflex階層の深さを計算
- `getElemSelector()` — 要素のクラス名/ID/タグ名を取得
- `showFlexInfo()` — ラベル生成・配置・クリックイベント設定
- `removeFlexInfo()` — ラベル削除

### 3点連携ジャンプ（2026-02-12追加）

#### 概要
ダブルクリック時にCSS、HTML、ブラウザの3箇所を同時にハイライト表示する機能。

#### 動作フロー
```
1. ブラウザで要素をダブルクリック
2. content.js → background.js でCSS検索
3. Native Messaging → VS CodeでCSSファイルを開く（フォーカス）
4. background.js → http://127.0.0.1:3848/highlight-line → VS CodeでHTMLファイルを開く（🟡黄色ハイライト3秒）
5. content.js → ブラウザで該当要素に赤枠追加（🔴3秒）
```

#### HTMLハイライト実装
- **VS Code側**: extension.ts に `/highlight-line` POSTエンドポイント追加（port 3848）
- **Chrome側**: background.js の `highlightLineInVSCode()` 関数
- **デコレーション**: `backgroundColor: 'rgba(255, 255, 0, 0.3)'`、3秒後に自動消去

#### ブラウザハイライト
- content.js の `highlightElement()` 関数
- 赤枠: `outline: 3px solid red`、3秒後に自動消去

### モバイルCSS自動検知（2026-02-12追加）

#### 概要
ビューポート幅767px以下の場合、`@media (max-width: 767px)` 内のCSSを優先検索する機能。

#### 検知ロジック
```javascript
var actualWidth = document.documentElement.clientWidth || window.innerWidth;
var autoDetectMobile = actualWidth <= 767;
var isMobile = preferMobile || autoDetectMobile;
```

#### 重要ポイント
- `document.documentElement.clientWidth` を使用（DevToolsレスポンシブモード対応）
- `window.innerWidth` はブラウザウィンドウ幅なので使えない
- 境界値は `<= 767` （CSSの `@media (max-width: 767px)` と一致）

#### 強制モバイルCSS検索
- **Ctrl+ダブルクリック** でPC表示時も強制的にモバイルCSS優先
- Flexラベルクリック時も自動検知適用

#### DevToolsレスポンシブモードの制限
- ダブルクリックは動作しない（Chrome仕様でズーム機能が優先）
- 代替手段: **Flexラベルクリック** または **Alt+クリック**

## Native Messaging について

### 背景（2026-01時点で発生した問題）

**問題**: 家のPCでAlt+クリックしてもVS Codeが開かない
- 会社PCでは動作していた
- アドレスバーに直接 `vscode://...` を入力 → 動く
- コマンドプロンプトで `start vscode://...` → 動く
- JavaScriptから `window.open()` 等 → ブロックされる

**原因**: ChromeがJavaScriptからの外部プロトコル（vscode://）呼び出しをセキュリティ上ブロック

**解決策**: Native Messagingを使用
```
Chrome拡張 → sendNativeMessage → open_vscode.exe → start vscode://...
```

### Native Messaging 構成

1. **open_vscode.exe**（Python版をPyInstallerでコンパイル）
   - Chromeからのメッセージを受信
   - URLを抽出して `start` コマンドで実行
   - Python不要で動作

2. **com.cssjumper.open_vscode.json**
   - Native Messaging ホストのマニフェスト
   - exeのパスと許可する拡張機能IDを設定

3. **レジストリ登録**
   - `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.cssjumper.open_vscode`
   - 値: JSONファイルのフルパス

### setup.bat の処理内容

1. 拡張機能IDを入力させる
2. JSONファイルを現在のパスで生成
3. レジストリにNative Messaging登録
4. vscode://プロトコルハンドラ登録

## セットアップ手順

1. フォルダを配置（日本語パス非推奨）
2. Chrome拡張を読み込み → IDをメモ
3. setup.bat を実行 → IDを入力
4. Chrome再起動

詳細は `README_セットアップ手順.txt` 参照

## 開発メモ

### vscode:// URL形式
```
vscode://file/D:/path/to/file.css:行番号
```

### CSS検索ロジック（background.js）
1. IDで検索（最優先）
2. クラス名で検索
3. 全クラスで再検索（フォールバック）
4. **モバイル時（767px以下）**: `@media (max-width: 767px)` 内を優先検索

### 依存関係
- Chrome拡張機能（MV3）
- Native Messaging（open_vscode.exe）
- VS Codeプロトコルハンドラ（vscode://）

---

## VS Code拡張機能（css-to-html-jumper）

### 構成
```
css-to-html-jumper/
├── package.json           ... 拡張機能設定
├── src/
│   ├── extension.ts       ... メインロジック
│   ├── cssProperties.ts   ... CSSプロパティ日本語辞書
│   └── jsProperties.ts    ... JSメソッド日本語辞書
└── out/                   ... コンパイル済みJS
```

### ビルド手順（変更時は必ず全ステップ実行）
```bash
cd css-to-html-jumper
npm run compile
npx vsce package --no-dependencies
code --install-extension css-to-html-jumper-1.10.0.vsix --force
# → VS Code: Ctrl+Shift+P → Developer: Reload Window
```

### 全機能一覧

| 機能 | 操作 | 説明 |
|------|------|------|
| CSSからHTML検索 | `Ctrl+Shift+H` | CSSセレクタのHTML使用箇所にジャンプ |
| セクション一覧 | `Ctrl+Shift+A` | 罫線ボックスコメントのセクション一覧（遠距離ジャンプ） |
| 次のセクション | `Ctrl+↓` | 次の罫線ボックスセクションへ移動（近距離） |
| 前のセクション | `Ctrl+↑` | 前の罫線ボックスセクションへ移動（近距離） |
| Claude AI質問 | `Ctrl+I` | プリセット選択 or 直接入力 |
| Copilot解説 | `Ctrl+Shift+/` | 選択コードをCopilot Chatに送信 |
| メモ検索 | `Ctrl+Enter` | Fuzzy検索でメモから情報検索、履歴10件表示、0件時Gemini要約 |
| クイズ出題 | `Ctrl+Shift+7` | メモから問題生成、スペースド・リピティション対応 |
| クイズ評価 | `Ctrl+Shift+8` | 最後のクイズを自動採点（Gemini 2.5 Flash-Lite） |
| 赤枠追加 | ホバー→🔴クリック | CSSセレクタに `border: 0.5rem solid red` 追加 |
| 赤枠一括削除 | コマンドパレット | 全赤枠を一括削除 |
| CSS日本語ホバー | CSSプロパティにホバー | 日本語でプロパティ解説 |
| JS日本語ホバー | JSメソッドにホバー | 日本語でメソッド解説 |
| セレクタホバー | CSSセレクタにホバー | HTMLの使用箇所をサイドに表示 |
| ステータスバー | 自動 | 現在のセクション名を画面下に表示 |
| Alt+Click | CSSセレクタ→HTML | Definition Provider |
| ブラウザハイライト | CSS/HTMLでセレクタ選択 | ブラウザで該当要素をハイライト（3秒後自動消去） |
| **HTMLハイライト** | **Chrome拡張からのジャンプ時** | **VS CodeでHTML該当行を黄色ハイライト（3秒）** |
| SVGリンク挿入 | `Ctrl+Alt+S` | AHK保存済みSVGへの相対パスリンクをmdに挿入 |

### SVGリンク挿入機能（Ctrl+Alt+S）の仕組み

⚠ **この機能は複数のシステムが連携しており複雑。変更時は全体の流れを理解すること。**

#### 全体フロー
```
① AIでSVG生成 → ユーザーがコピー
② AutoHotkey（常駐）がクリップボード監視で自動検知
   → 「その他\SVG一覧\svg_YYYYMMDD_HHMMSS.svg」に自動保存
   → 一時ファイル「%TEMP%\svg_clipboard.svg」にも保存
   → クリップボードをクリア（誤爆防止）
③ ユーザーがmdファイル上で Ctrl+Alt+S を押す
④ VS Code拡張が一時ファイルの存在を確認
   → 「その他\SVG一覧」フォルダの最新SVGファイルを特定
   → カーソル位置に ![SVG](./その他/SVG一覧/xxx.svg) を挿入
   → 一時ファイルを削除
⑤ ユーザーが挿入されたリンクを Ctrl+クリック → SVG表示
```

#### なぜクリップボードから直接読まないのか
- AHKがSVG検知後に**クリップボードをクリアする**（Typelessの復元による誤爆防止）
- そのため VS Code拡張がクリップボードを読んでも空
- 解決策: AHKが `%TEMP%\svg_clipboard.svg` に一時ファイルとして残す

#### 関連ファイル
| ファイル | 役割 |
|---------|------|
| `SVG表示保存CS_S.ahk` | AutoHotkeyスクリプト（Startup配下で常駐） |
| `extension.ts` の `insertSvgFromTemp` | VS Code拡張のSVG挿入コマンド |
| `package.json` の `svgTempFilePath` 設定 | 一時ファイルパスのカスタマイズ用 |

#### 自宅・会社でのパス対応
- SVG保存先の基底パスは**環境変数 `KNOWLEDGE_ROOT`** で切り替え（AHK側）
  - 自宅: `D:\50_knowledge`、会社: `T:\50_knowledge`
- `その他\SVG一覧\` 以下はGit管理で同一構成
- mdに挿入するリンクは**相対パス**（`./その他/SVG一覧/xxx.svg`）なのでどのPCでも動く
- VS Code拡張は現在のmdファイルから上位を辿って `その他\SVG一覧` を自動検出

#### ショートカットキーの競合注意
- `Ctrl+Alt+V` は **Paste Image拡張機能**（画像貼り付け）が使用中 → 使用禁止
- `Ctrl+Alt+S` をSVG挿入に割り当て済み
- AHK側の `Ctrl+Alt+S` はVS Code拡張に譲渡済み（コメントアウト）

### Claude AI プリセット（Ctrl+I）

| プリセット | 出力先 | 特徴 |
|-----------|--------|------|
| 🔧 改善して | 右側分割表示 | 制約付き（シンプル、_区切り、既存踏襲、変更行コメント） |
| 🐛 バグチェック | 右側分割表示 | |
| 📖 説明して | コメントとして挿入 | CSS→`/* */`、HTML→`<!-- -->` |
| 🎨 SVGで図解 | エディタ挿入+クリップボード | `<svg>〜</svg>`を自動抽出してコピー |
| 📝 CSSスケルトン生成 | リンク先CSSに追記 | HTML選択→class/ID抽出→空ルール生成 |
| 直接入力 | コメントとして挿入 | 自由質問 |

### 改善プリセットの制約（裏プロンプト）
- シンプルに保つ（タグ増やさない）
- タグ名をクラス名に使わない（.div, .span 禁止）
- 今の実装をできるだけ活かす
- クラス名は `_`（アンダースコア）区切り（`-`禁止）
- 既存の命名規則を踏襲
- 変更行の右側にコメント + 下にまとめ

### CSSスケルトン生成の動作
1. HTMLファイルでコードを選択 → Ctrl+I → 📝 CSSスケルトン生成
2. Claude AIがHTMLを解析、class/IDを抽出
3. HTMLコメント（`<!-- -->`）はCSSコメント（`/* */`）としてそのまま出力
4. `<link rel="stylesheet">`からCSSファイルを自動検出
5. 複数CSSある場合 → QuickPickで選択
6. CSSファイル末尾に自動追記
7. CSSファイルが見つからない場合 → 右側パネルに表示

### セクション検出の仕様（HTML構造改善用）
- **body直下の `<header>`, `<section>`, `<footer>` タグのみ検出**
- class/id属性があればQuickPickに表示
- 閉じタグマッチングで正確な範囲特定
- アイコン: 🔝(header) 📦(section) 🔚(footer)

### セクション検出の仕様（セクション移動用）
- 罫線ボックス形式: `┌─┐ │ セクション名 │ └─┘`
- **半角パイプ `|` と罫線 `│` の両方に対応**
- ボックス内の1行目のみ採用（2行目以降は無視）
- `@media(max-width)` 内なら📱アイコン表示

### ⚠ 注意事項
- Claude API通信: `api.anthropic.com:443` へのHTTPS必須
- APIキー設定: `cssToHtmlJumper.claudeApiKey`
- モデル設定: `cssToHtmlJumper.claudeModel`（デフォルト: claude-sonnet-4-5）
- max_tokens: 4096（SVGの途切れ防止のため増加済み）
- SVG出力: `</svg>`で途切れる場合あり → プロンプトに「必ず</svg>で終わること」と指示済み
- activationEvents: `onLanguage:css`, `onLanguage:html`, `onLanguage:javascript`
- コードブロック除去: Claude回答から ` ```css ` 等を自動削除

### 会社PCへの持ち込み

#### 方法1: Git clone（推奨）
```bash
git clone <リポジトリURL>
cd css-to-html-jumper
code --install-extension css-to-html-jumper-1.10.0.vsix --force
Ctrl+Shift+P → Developer: Reload Window
```

**重要**: node_modules/ と out/ がGit管理済み → **npm install 不要**

#### 方法2: USBで持ち込み
- vsixファイルをUSB等で持ち込み → Install from VSIX

#### 共通設定
```json
// settings.json（会社PC用パス）
{
  "cssToHtmlJumper.claudeApiKey": "sk-ant-api03-...",
  "cssToHtmlJumper.geminiApiKey": "AIza...",
  "cssToHtmlJumper.memoFilePath": "T:\\50_knowledge\\01_memo.md"
}
```

#### オプション: AHK配置（SVG機能用）
- `SVG表示保存CS+S.ahk` をスタートアップに配置
- 環境変数 `KNOWLEDGE_ROOT=T:\50_knowledge` を設定

#### 詳細
- **Python不要、Node.js不要**（VS Code内蔵ランタイムで動作）
- 詳細は `会社PC_ClaudeCode導入メモ.md` 参照

---

## ショートカットキー一覧

全ショートカットキーは `ショートカットキー一覧.md` を参照。

### 頻繁に使うキー（覚えるべき）

| キー | 機能 | 場所 |
|------|------|------|
| ダブルクリック | 3点連携（CSS + HTML + ブラウザ） | ブラウザ |
| `Ctrl+Shift+H` | CSSからHTML検索 | VS Code |
| `Alt+F` | Flex情報表示トグル | ブラウザ |
| `Ctrl+↓` / `Ctrl+↑` | セクション移動 | VS Code |
| `Ctrl+I` | Claude AI質問 | VS Code |
| `Ctrl+Enter` | メモ検索 | VS Code |

---

**最終更新**: 2026-02-15
