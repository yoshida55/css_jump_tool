# CSS to HTML Jumper 簡単な取説

## 📦 インストール

### 初回セットアップ

1. **vsixファイルをインストール**
   ```
   Ctrl+Shift+P → "Install from VSIX" → vsixファイル選択
   ```

2. **VS Code再起動**
   ```
   Ctrl+Shift+P → "Developer: Reload Window"
   ```

3. **settings.jsonに設定追加**
   ```json
   {
     "cssToHtmlJumper.claudeApiKey": "YOUR_CLAUDE_API_KEY",
     "cssToHtmlJumper.geminiApiKey": "YOUR_GEMINI_API_KEY",
     "cssToHtmlJumper.memoFilePath": "D:\\50_knowledge\\01_memo.md",
     "cssToHtmlJumper.quizCategories": ["CSS", "JavaScript", "Python", "HTML"]
   }
   ```

---

## 🎯 主要機能

### 1. CSSからHTML検索
- **操作**: `Ctrl+Shift+H`
- **説明**: CSSセレクタのHTML使用箇所にジャンプ

### 2. セクションジャンプ
- **操作**: `Ctrl+Shift+L`
- **説明**: CSSの罫線コメントセクション一覧を表示

### 3. Claude AI質問
- **操作**: `Ctrl+I`
- **プリセット**:
  - 🔧 **改善して**: 右側に改善案表示
  - 🐛 **バグチェック**: 問題点を指摘
  - 📖 **説明して**: コメントとして挿入
  - 🎨 **SVGで図解**: SVGをクリップボードにコピー
  - 📝 **CSSスケルトン生成**: HTMLからCSS空ルール生成
  - 🏗 **HTML構造改善**: セマンティックHTML提案

### 4. 踏み込んだ質問
- **操作**: `Ctrl+I` → InputBox入力 → プリセット選択
- **例**: `<div class="slide"></div>について` → 📖 説明して
- **結果**: 指定部分について詳しく解説

### 5. メモ検索
- **操作**: `Ctrl+Shift+M`
- **機能**:
  - Fuzzy検索でメモから情報検索
  - 最近の検索履歴10件表示
  - 結果0件時はGemini AIで要約

### 6. クイズ機能
- **出題**: `Ctrl+Shift+7`
- **評価**: `Ctrl+Shift+8`（最後のクイズを自動採点）
- **機能**:
  - メモから問題を自動生成（Gemini 2.5 Flash-Lite）
  - スペースド・リピティション（1日後に復習）
  - 10日間スキップ（別の問題選択時）
  - カテゴリフィルタ対応
  - 履歴をGitで同期可能（`その他/.quiz-history.json`）

#### クイズカテゴリ設定
```
Ctrl+Shift+P → "クイズのカテゴリ変更"
  → CSS / JavaScript / Python 選択
```

#### メモの書き方
```markdown
## widthプロパティとは？ CSS
幅を指定するプロパティ

## mapメソッドとは？ JavaScript
配列を変換するメソッド
```

**ルール**:
- 見出し末尾に半角/全角空白 + カテゴリ名
- カテゴリ名は `quizCategories` に登録された単語のみ認識
- 大小文字無視（`css`, `CSS`, `Css` 全て同じ）

### 7. 赤枠追加/削除
- **追加**: CSSセレクタにホバー → 🔴クリック
- **削除**: コマンドパレット → "赤枠をすべて削除"

### 8. Copilot解説
- **操作**: `Ctrl+Shift+/`
- **説明**: 選択コードをCopilot Chatに送信して解説

### 9. 日本語ホバー
- **CSSプロパティ**: ホバーで日本語解説表示
- **JSメソッド**: ホバーで日本語解説表示

### 10. Alt+Click
- **CSSからHTML**: Alt+クリックで使用箇所にジャンプ

### 11. SVGリンク挿入
- **操作**: `Ctrl+Alt+S`
- **説明**: AHKが保存したSVGファイルへの相対パスリンクをmdに挿入
- **流れ**:
  1. AIでSVG生成 → コピー
  2. AHK（常駐）が自動検知 → `その他\SVG一覧\` に保存 → クリップボードクリア
  3. mdファイル上で `Ctrl+Alt+S` → `![SVG](./その他/SVG一覧/xxx.svg)` が挿入
  4. `Ctrl+クリック` でSVG表示
- **注意**: `Ctrl+Alt+V` はPaste Image拡張が使用中のため使わないこと

### 12. ブラウザハイライト（CSS/HTML連携）
- **対象**: CSS/HTMLファイル
- **操作**: セレクタ行・class/id属性にカーソル配置
- **動作**:
  - **CSSファイル**: `.class_name`や`#id`のセレクタ行にカーソル → ブラウザで該当要素をオレンジハイライト
  - **HTMLファイル**: `class="xxx"`や`id="yyy"`内にカーソル → ブラウザでそのクラス/IDをハイライト
  - 3秒後に自動消去（同じセレクタでは再出現しない）
  - スクロールしてもハイライトが追従
  - プロパティ行や空行に移動すると即座に解除
- **前提条件**:
  - Live ServerでHTML表示中
  - Chrome拡張（css-jumper）インストール済み
  - ポート3848でHTTPサーバー起動（拡張が自動起動）
- **Tips**: 複数クラス（`class="a b c"`）の場合、カーソル位置のクラスのみハイライト

---

## ⚙ settings.json 設定一覧

### 必須設定（最低限これだけ設定）
```json
{
  "cssToHtmlJumper.claudeApiKey": "sk-ant-api03-...",
  "cssToHtmlJumper.geminiApiKey": "AIza...",
  "cssToHtmlJumper.memoFilePath": "D:\\50_knowledge\\01_memo.md"
}
```

### 全設定項目（すべてのオプション）
```json
{
  "cssToHtmlJumper.claudeApiKey": "sk-ant-api03-...",
  "cssToHtmlJumper.claudeModel": "claude-sonnet-4-5-20250929",
  "cssToHtmlJumper.geminiApiKey": "AIza...",
  "cssToHtmlJumper.memoFilePath": "D:\\50_knowledge\\01_memo.md",
  "cssToHtmlJumper.targetFiles": "**/*.html",
  "cssToHtmlJumper.copilotPrompt": "このコードの目的を簡潔に説明して",
  "cssToHtmlJumper.quizCategory": "全て",
  "cssToHtmlJumper.quizCategories": ["CSS", "JavaScript", "Python", "HTML"],
  "cssToHtmlJumper.svgTempFilePath": "%TEMP%\\svg_clipboard.svg"
}
```

### 設定項目の詳細

| 設定項目 | 説明 | デフォルト |
|---------|------|-----------|
| `claudeApiKey` | Claude API キー（必須） | - |
| `claudeModel` | Claudeモデル | `claude-sonnet-4-5-20250929` |
| `geminiApiKey` | Gemini API キー（メモ検索0件時の要約用） | - |
| `memoFilePath` | メモファイルパス（絶対パス、`\\`でエスケープ） | - |
| `targetFiles` | 検索対象HTMLファイル（glob形式） | `**/*.html` |
| `copilotPrompt` | Copilot解説のプロンプト | `このコードの目的を簡潔に説明して` |
| `quizCategory` | 出題カテゴリ | `全て` |
| `quizCategories` | カテゴリ判定リスト（配列） | `["CSS", "JavaScript", "Python", "HTML"]` |
| `svgTempFilePath` | SVG一時ファイルパス（環境変数OK） | `%TEMP%\svg_clipboard.svg` |

### 設定のコツ

| 項目 | ポイント |
|------|---------|
| パス指定 | Windowsは `\\` でエスケープ（例: `D:\\50_knowledge\\01_memo.md`） |
| API Key | `sk-ant-api03-` で始まる（Claude）、`AIza` で始まる（Gemini） |
| モデル変更 | Haiku使用で料金1/4（`claude-haiku-4-5`） |
| カテゴリ追加 | `quizCategories`に追加 → メモの見出しでカテゴリ判定 |

---

## 📁 ファイル構成

```
D:\50_knowledge\（会社: T:\50_knowledge\）
├─ 01_memo.md              # メモファイル
├─ images\                 # 画像（Paste Image用）
├─ クイズ回答.md           # クイズ回答履歴（自動作成）
└─ その他\
   ├─ SVG一覧\             # AHKが自動保存するSVGファイル
   └─ .quiz-history.json   # クイズ履歴（Git管理可能）
```

---

## 🎓 Tips

### クイズ機能の活用

1. **メモを書く**
   ```markdown
   ## z-indexとは？ CSS
   重なり順を指定する
   ```

2. **カテゴリ変更**
   ```
   Ctrl+Shift+P → "クイズのカテゴリ変更" → CSS
   ```

3. **クイズ実行**
   ```
   Ctrl+Shift+7 → 問題表示 → 💡 答えを見る
   ```

4. **復習サイクル**
   - 答えを見る → 1日後に再出題
   - 別の問題 → 10日後に再出題
   - 回答削除 → すぐに再出題対象

### Claude AI質問の活用

```
1. コード選択
2. Ctrl+I
3. InputBox: "slideについて" （空欄でもOK）
4. プリセット選択: 📖 説明して
→ slideについて詳しく解説がコメント挿入される
```

### SVG図解の活用

```
1. コード選択
2. Ctrl+I → 🎨 SVGで図解
3. SVGがクリップボードにコピーされる
4. AHKが自動保存 → Ctrl+Alt+S でmdにリンク挿入
5. Ctrl+クリックでSVG表示
```

---

## 🔄 更新手順

```bash
# 新しいvsixファイルを取得
code --install-extension css-to-html-jumper-1.10.0.vsix --force

# VS Code再起動
Ctrl+Shift+P → "Developer: Reload Window"
```

---

## 🏢 会社PCへの持ち込み

### 方法1: Gitからクローン（推奨）
```bash
git clone <リポジトリURL>
cd css-to-html-jumper
code --install-extension css-to-html-jumper-1.10.0.vsix --force
```
※ node_modules/ と out/ がGit管理済み → npm install 不要

### 方法2: USBで持ち込み
1. **vsixファイルをUSBで持ち込み**
2. **Install from VSIX**

### 共通: settings.json設定
```json
{
  "cssToHtmlJumper.claudeApiKey": "YOUR_CLAUDE_API_KEY",
  "cssToHtmlJumper.geminiApiKey": "YOUR_GEMINI_API_KEY",
  "cssToHtmlJumper.memoFilePath": "T:\\50_knowledge\\01_memo.md"
}
```

### オプション: AHKファイル配置（SVG機能用）
- `SVG表示保存CS+S.ahk` をスタートアップに配置
- 環境変数 `KNOWLEDGE_ROOT=T:\50_knowledge` を設定

✅ **Python不要・Node.js不要**で動作

---

## 🆘 トラブルシューティング

| 症状 | 対処 |
|------|------|
| クイズが出ない | メモに `## 質問 CSS` 形式で書く |
| カテゴリが認識されない | `quizCategories`に登録 |
| Claude APIエラー | `claudeApiKey`を確認 |
| ホバーが出ない | VS Code再起動 |

---

**バージョン**: 1.10.0
**最終更新**: 2026-02-12
