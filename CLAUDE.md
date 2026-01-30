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
