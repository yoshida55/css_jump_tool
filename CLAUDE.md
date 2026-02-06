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
```

## 主要機能

| 機能 | 操作 |
|------|------|
| CSSジャンプ | Alt+クリック |
| サイズ表示 | 右クリックメニュー |
| 距離表示 | 右クリックメニュー |
| クイックリサイズ | Ctrl+↓ / ホイール |

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
4. メディアクエリ内を優先（768px未満時）

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
code --install-extension css-to-html-jumper-1.4.0.vsix --force
# → VS Code: Ctrl+Shift+P → Developer: Reload Window
```

### 全機能一覧

| 機能 | 操作 | 説明 |
|------|------|------|
| CSSからHTML検索 | `Ctrl+Shift+H` | CSSセレクタのHTML使用箇所にジャンプ |
| セクションジャンプ | `Ctrl+Shift+L` | 罫線ボックスコメントのセクション一覧 |
| Claude AI質問 | `Ctrl+I` | プリセット選択 or 直接入力 |
| Copilot解説 | `Ctrl+Shift+/` | 選択コードをCopilot Chatに送信 |
| 赤枠追加 | ホバー→🔴クリック | CSSセレクタに `border: 0.5rem solid red` 追加 |
| 赤枠一括削除 | コマンドパレット | 全赤枠を一括削除 |
| CSS日本語ホバー | CSSプロパティにホバー | 日本語でプロパティ解説 |
| JS日本語ホバー | JSメソッドにホバー | 日本語でメソッド解説 |
| セレクタホバー | CSSセレクタにホバー | HTMLの使用箇所をサイドに表示 |
| ステータスバー | 自動 | 現在のセクション名を画面下に表示 |
| Alt+Click | CSSセレクタ→HTML | Definition Provider |

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

### セクション検出の仕様
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
- **Python不要、Node.js不要**（VS Code内蔵ランタイムで動作）
- vsixファイルをUSB等で持ち込み → Install from VSIX
- 詳細は `会社PC_ClaudeCode導入メモ.md` 参照
