# Chrome拡張からvscode://プロトコルが開けない

**日付**: 2026-01-28
**Keywords**: Chrome, vscode, protocol, Native Messaging, 外部プロトコル, ブロック, JavaScript, window.open, chrome.tabs.create, セキュリティ, 拡張機能
**Error**: "VS Codeを開けませんでした: Error when communicating with the native messaging host."
**影響範囲**: CSS Jumper拡張機能（HTMLからCSSへジャンプ機能）
**重要度**: 🔴 Critical

---

## 症状

Alt+クリックでCSSの該当行をVS Codeで開く機能が動作しない。

**期待動作**: Alt+クリック → VS Codeで該当CSSファイルの行が開く
**実際の動作**: 通知は出るがVS Codeが起動しない

**重要な切り分け結果**:
| 方法 | 結果 |
|------|------|
| ブラウザのアドレスバーに直接入力 | ✅ 動く |
| コマンドプロンプトで `start vscode://...` | ✅ 動く |
| JavaScriptから `window.open()` | ❌ 動かない |
| JavaScriptから `location.href` | ❌ 動かない |
| Chrome拡張から `chrome.tabs.create()` | ❌ 動かない |

**環境差異**: 会社PCでは動作するが、家PCでは動作しない

---

## 原因

**ChromeがJavaScriptからの外部プロトコル（vscode://）呼び出しをセキュリティ上ブロック**

考えられる原因:
- Chromeのバージョン差（新バージョンはセキュリティ強化）
- 過去に「このサイトからの外部アプリ起動をブロック」を選択した
- 会社PCはグループポリシーで許可されている
- セキュリティソフトの違い

---

## 対処

**Native Messagingを使用して回避**

```
Chrome拡張 → sendNativeMessage → open_vscode.exe → start vscode://...
```

### 1. Native Messaging ホスト作成（Python）

```python
# open_vscode.py
import sys
import json
import struct
import subprocess

def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    message_length = struct.unpack('I', raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode('utf-8')
    return json.loads(message)

def send_message(message):
    encoded = json.dumps(message).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()

def main():
    message = read_message()
    if message and 'url' in message:
        url = message['url']
        subprocess.Popen(['cmd', '/c', 'start', '', url], shell=False)
        send_message({'success': True})
    else:
        send_message({'success': False, 'error': 'No URL provided'})

if __name__ == '__main__':
    main()
```

### 2. PyInstallerでexe化（Python不要にする）

```bash
pyinstaller --onefile --noconsole open_vscode.py
```

### 3. Native Messaging マニフェスト

```json
{
  "name": "com.cssjumper.open_vscode",
  "description": "Open VS Code from CSS Jumper",
  "path": "C:\\path\\to\\open_vscode.exe",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://拡張機能ID/"]
}
```

### 4. レジストリ登録

```powershell
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.cssjumper.open_vscode" /ve /t REG_SZ /d "C:\path\to\com.cssjumper.open_vscode.json" /f
```

### 5. background.js 修正

```javascript
// 変更前: chrome.tabs.create() や content.js経由
// 変更後: Native Messaging
function openInVscode(url) {
  chrome.runtime.sendNativeMessage(
    "com.cssjumper.open_vscode",
    { url: url },
    function(response) {
      if (chrome.runtime.lastError) {
        console.error("Native Messaging失敗", chrome.runtime.lastError.message);
      }
    }
  );
}
```

### 6. manifest.json に権限追加

```json
"permissions": [
  "nativeMessaging",
  ...
]
```

---

## 修正ファイル

- `css-jumper/background.js` - openInVscode関数をNative Messaging方式に変更
- `css-jumper/manifest.json` - nativeMessaging権限追加
- `css-jumper/native-host/open_vscode.py` - 新規作成
- `css-jumper/native-host/open_vscode.exe` - PyInstallerでコンパイル
- `css-jumper/native-host/com.cssjumper.open_vscode.json` - 新規作成
- `css-jumper/setup.bat` - セットアップ自動化

---

## 予防策

- 外部プロトコル呼び出しはNative Messagingを使う
- 環境差異がある場合はNative Messagingで統一
- setup.batで環境構築を自動化

---

## 関連問題

- なし（初出）

---

## 学んだこと

1. **Chromeのセキュリティは環境によって異なる**
   - 会社と家でブロック状況が違う場合がある

2. **JavaScriptからの外部プロトコル呼び出しは不安定**
   - `window.open()`, `location.href`, `chrome.tabs.create()` すべてブロックされる可能性

3. **Native Messagingは確実**
   - OSのコマンド経由で呼び出すので確実に動作
   - exeにコンパイルすればPython不要

4. **デバッグの切り分けが重要**
   - アドレスバー直接入力 → プロトコル登録OK
   - コマンドプロンプト → OS側OK
   - JavaScript → ブラウザがブロック
