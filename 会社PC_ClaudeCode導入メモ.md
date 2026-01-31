# 会社PCでClaude Codeを使う手順

## 結論: Node.jsインストール不要！

Claude Codeはネイティブバイナリ版があり、Node.js不要で動く。

---

## 方法1: ネイティブインストール（推奨・Node.js不要）

### 手順
1. PowerShellを開く
2. 以下を実行:
```powershell
irm https://claude.ai/install.ps1 | iex
```
3. インストール先: `~/.claude/bin/claude`
4. 初回起動時に認証（以下のどちらか）:
   - **Claude Maxサブスクリプション**（月額 $100 or $200）→ OAuth認証でログインするだけ
   - **Anthropic APIキー**（従量課金）→ APIキーを入力

### どっちがいい？
- **サブスクリプション（Claude Max）**: 定額で使い放題に近い。頻繁に使うならこっち
- **APIキー**: 使った分だけ課金。たまにしか使わないならこっち

### 注意
- 管理者権限は不要
- ただし PowerShell のスクリプト実行ポリシーがブロックされてる場合あり
- その場合: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

---

## 方法2: ポータブルNode.js + npm（ネイティブ版がダメな場合）

### Step 1: Node.js zip版をダウンロード
- サイト: https://nodejs.org/en/download/
- 「Windows Binary (.zip)」64-bit を選択
- インストーラー(.msi)ではなく .zip を選ぶこと！

### Step 2: 展開
- 例: `D:\tools\node-v22.x.x-win-x64\` に展開
- `node.exe` と `npm.cmd` がそのフォルダにある

### Step 3: PATHに追加（管理者不要）
- 「環境変数」で検索 → 「ユーザー環境変数の編集」
- `Path` に `D:\tools\node-v22.x.x-win-x64\` を追加
- cmd再起動 → `node -v` で確認

### Step 4: Claude Codeインストール
```cmd
npm install -g @anthropic-ai/claude-code
```
- グローバルインストール先: `%APPDATA%\npm\`（管理者不要）

### Step 5: 起動
```cmd
claude
```

---

## ネットワーク要件

| 通信先 | 用途 | 必須 |
|--------|------|:----:|
| claude.ai | ネイティブインストーラー | 初回のみ |
| api.anthropic.com:443 | Claude API通信 | 常時 |
| registry.npmjs.org | npm版インストール時 | 初回のみ |

**会社のファイアウォール/プロキシで上記がブロックされてると使えない**

### プロキシ設定が必要な場合
```cmd
set HTTPS_PROXY=http://proxy.company.com:8080
set HTTP_PROXY=http://proxy.company.com:8080
```

---

## 参考リンク
- Claude Code公式セットアップ: https://code.claude.com/docs/en/setup
- npm: https://www.npmjs.com/package/@anthropic-ai/claude-code
- Node.jsダウンロード: https://nodejs.org/en/download/
- Node.jsポータブル版: https://github.com/garethflowers/nodejs-portable
