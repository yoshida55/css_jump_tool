# CSS Jumper 取説（Chrome拡張機能）

## 概要
Live ServerでHTMLを開き、要素のCSS定義にVS Codeで直接ジャンプするChrome拡張機能。

---

## 全機能一覧

| 機能 | 操作 | 説明 |
|------|------|------|
| CSSジャンプ | Alt+クリック | 要素のCSS定義をVS Codeで開く |
| ブラウザハイライト | VS Codeでセレクタ選択 | VS Codeでセレクタ行にカーソル→ブラウザで該当要素をハイライト |
| Flex情報表示 | 自動 / 右クリックメニュー | Flexbox階層をラベルで可視化 |
| サイズ表示 | ポップアップ → 📐サイズ | 要素のwidth/heightを表示 |
| 距離表示 | ポップアップ → ↕距離 | 要素間のmargin/paddingを表示 |
| クイックリサイズ | ホイール / Ctrl+右クリック / Ctrl+↓ | 画面幅を指定値にトグル |

---

## 1. CSSジャンプ（Alt+クリック）

### 操作
1. Live ServerでHTMLを開く
2. 要素を **Alt+クリック**
3. VS Codeで該当CSSの行が開く

### 検索優先度
1. ID（`#header`）→ 最優先
2. 最初のクラス名（`.nav_bar`）
3. その他クラスで再検索（フォールバック）
4. メディアクエリ内を優先（画面幅768px未満時）

### 仕組み
```
Alt+クリック → content.js → background.js（CSS検索）
→ Native Messaging → open_vscode.exe → vscode://file/path:行番号
```

⚠ JavaScriptからの`vscode://`直接呼び出しはChromeがブロックするため、Native Messaging経由で起動。

---

## 2. Flex情報表示

### ONにする方法
- 拡張機能アイコン → 「🎨 Flex情報を自動表示（リロード時）」にチェック

### 表示内容

| 要素 | 説明 |
|------|------|
| `└` の数 | 階層の深さ（`└└` = 深さ2） |
| `flex 横` / `flex 縦` | flex-directionの方向 |
| `.class_name` / `#id` | 要素のセレクタ |

### 表示例
```
flex 横  .wrapper           ← 紫（深さ0 = ルート）
└ flex 縦  .sidebar         ← 青（深さ1）
└└ flex 横  .nav_list       ← 緑（深さ2）
└ flex 横  .main_content    ← 青（深さ1）
```

### 色分け

| 深さ | 色 |
|------|------|
| 0 | 紫 |
| 1 | 青 |
| 2 | 緑 |
| 3 | オレンジ |
| 4 | 赤 |
| 5+ | シアン |

### クリックでジャンプ
ラベルをクリック → その要素のCSS定義にVS Codeでジャンプ（CSSジャンプと同じ仕組み）

### 重なり回避
ラベルが被る場合は自動的に下にズラして配置。

---

## 3. ブラウザハイライト（VS Code連携）

### 概要
VS Code拡張機能（css-to-html-jumper）と連携し、VS Codeでセレクタにカーソルを置くとブラウザ上の該当要素が自動的にハイライトされる。

### 操作

#### CSSファイルの場合
1. VS CodeでCSSファイルを開く
2. セレクタ行（`.class_name`や`#id`）にカーソルを配置
3. ブラウザで該当要素がオレンジ色でハイライト
4. 3秒後に自動消去

#### HTMLファイルの場合
1. VS CodeでHTMLファイルを開く
2. `class="xxx"`や`id="yyy"`の中にカーソルを配置
3. ブラウザで該当クラス/IDがハイライト
4. 複数クラス（`class="a b c"`）の場合、カーソル位置のクラスのみハイライト

### 動作仕様

| 動作 | 説明 |
|------|------|
| ハイライト色 | オレンジ枠（rgba(255, 150, 0, 0.9)） + 半透明背景 |
| 自動消去 | 3秒後に消去 |
| スクロール追従 | スクロールしても要素に追従 |
| カーソル移動で解除 | プロパティ行や空行に移動すると即座に解除 |
| 再表示抑止 | 同じセレクタでは3秒経過後も再出現しない |

### 仕組み
```
VS Code拡張（port 3848 HTTPサーバー起動）
↓
currentBrowserSelector = { type: 'class', name: 'xxx' }
↓
Chrome拡張（500msポーリング）
↓
fetch("http://127.0.0.1:3848/selector")
↓
ブラウザでハイライト表示
```

### 前提条件
- VS Code拡張（css-to-html-jumper v1.10.0以上）インストール済み
- Live ServerでHTML表示中
- ポート3848が利用可能

### トラブルシューティング

| 症状 | 対処 |
|------|------|
| ハイライトが出ない | VS Code再起動 → Developer: Reload Window |
| ポート3848エラー | 他のVS Codeを閉じる |
| 点滅する | Chrome拡張リロード + ページリロード |

---

## 4. サイズ・距離表示

### 操作
1. 拡張機能アイコンをクリック
2. 画面幅を選択（1280px / 375px / カスタム）
3. 「📐 サイズ」「↕ 距離」「📐+↕」のいずれかをクリック

### 表示内容
- **サイズ**: width × height（px / rem）
- **距離**: margin / padding の値

---

## 5. クイックリサイズ

### 操作
ホイールクリック / Ctrl+右クリック / Ctrl+↓ のいずれかで画面幅をトグル。

### 設定
- 拡張機能アイコン → 「🖱 クイックリサイズ」でトリガーと幅を設定
- デフォルト: 1400px

---

## Chrome拡張の基本操作

| 操作 | 手順 |
|------|------|
| 拡張機能管理画面 | アドレスバーに `chrome://extensions/` |
| 拡張機能リロード | `chrome://extensions/` → 🔄ボタン |
| ページリロード | `F5` or `Ctrl+R` |
| 開発者ツール | `F12` |
| コンソール表示 | `F12` → Consoleタブ |

### 拡張機能のデバッグ方法
1. `chrome://extensions/` → 拡張機能の「詳細」
2. 「ビュー」→「バックグラウンドページ」クリック
3. コンソールでエラー確認

---

## 初回セットアップ

### STEP 1: フォルダ配置
`css-jumper/` を任意の場所にコピー（日本語パス非推奨）

### STEP 2: Chrome拡張読み込み
1. `chrome://extensions/` を開く
2. 「デベロッパーモード」ON
3. 「パッケージ化されていない拡張機能を読み込む」→ `css-jumper/` を選択
4. 拡張機能IDをメモ

### STEP 3: setup.bat 実行
1. `setup.bat` をダブルクリック
2. 拡張機能IDを入力 → Enter
3. 「セットアップ完了」と表示されればOK

※ 自動で以下を実行:
- Native Messaging用JSONのパス更新
- レジストリにNative Messaging登録
- `vscode://` プロトコルハンドラ登録

### STEP 4: Chrome再起動

### STEP 5: 初回設定
1. 拡張機能アイコンをクリック
2. ①プロジェクトパスを入力
3. 「🔍 ページから自動検出」でCSSファイルを選択

---

## 会社PCへの持ち込み

### 必要なもの
| ファイル | 必須？ | 理由 |
|---------|--------|------|
| `css-jumper/` フォルダ一式 | ✅ | 拡張本体 |
| `setup.bat` | ✅ | Native Messaging登録 |
| `native-host/` | ✅ | VS Codeジャンプ用 |

### 手順
1. USBで `css-jumper/` を持ち込み
2. Chrome拡張読み込み → IDメモ
3. `setup.bat` 実行 → ID入力
4. Chrome再起動

⚠ **setup.batを実行しないとAlt+クリック・Flexラベルクリックのジャンプが動かない**
（Flex表示・サイズ表示のみならsetup.bat不要）

---

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| Native Messaging失敗 | setup.bat再実行 → Chrome再起動 |
| VS Codeが開かない | `start vscode://file/C:/test.txt:1` で切り分け |
| 拡張機能が動かない | `chrome://extensions/` で再読み込み → ページリロード |
| Flex表示が出ない | ポップアップで「Flex情報を自動表示」ON → ページリロード |
| ラベルが多すぎる | 小さすぎる要素（30x20px未満）は自動除外済み |

---

## ファイル構成

```
css-jumper/
├── manifest.json          ... 拡張機能設定（MV3）
├── background.js          ... CSS検索、Native Messaging
├── content.js             ... Alt+クリック検知、Flex表示、サイズ表示
├── popup.html / popup.js  ... 設定UI
├── popup.css              ... ポップアップのスタイル
├── setup.bat              ... セットアップ用バッチ
├── icons/                 ... 拡張機能アイコン
└── native-host/
    ├── open_vscode.exe              ... VS Code起動用（Python不要）
    ├── open_vscode.py               ... exeのソース
    └── com.cssjumper.open_vscode.json  ... Native Messaging設定
```

---

**最終更新**: 2026-02-12
