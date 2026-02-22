import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';


// ステータスバーアイテム（overview の新鮮さを表示）
let overviewStatusBar: vscode.StatusBarItem | null = null;
// 現在監視中のソースファイルパス
let watchedSourcePath: string | null = null;

/**
 * ソースコードを SHA-256 ハッシュに変換（短縮8文字）
 */
function computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
}

/**
 * 生成済み overview.html から埋め込みハッシュを読み出す
 */
function readStoredHash(htmlPath: string): string | null {
    try {
        const content = fs.readFileSync(htmlPath, 'utf-8');
        const m = content.match(/<meta name="overview-source-hash" content="([a-f0-9]+)">/);
        return m ? m[1] : null;
    } catch {
        return null;
    }
}

/**
 * ステータスバーを更新する
 * @param sourcePath  JS/TSファイルのフルパス
 * @param sourceCode  現在のソースコード文字列
 */
function updateOverviewStatusBar(sourcePath: string, sourceCode: string) {
    if (!overviewStatusBar) {
        overviewStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    }

    const dirPath   = path.dirname(sourcePath);
    const baseName  = path.basename(sourcePath, path.extname(sourcePath));
    const htmlPath  = path.join(dirPath, `${baseName}_overview.html`);

    if (!fs.existsSync(htmlPath)) {
        overviewStatusBar.hide();
        return;
    }

    const currentHash = computeHash(sourceCode);
    const storedHash  = readStoredHash(htmlPath);

    const isFresh = (storedHash === currentHash);
    watchedSourcePath = sourcePath;

    overviewStatusBar.command = 'cssToHtmlJumper.generateOverview';

    if (isFresh) {
        overviewStatusBar.text            = `🎇 overview ✅`;
        overviewStatusBar.tooltip         = `${baseName}_overview.html は最新です\nクリックで再生成`;
        overviewStatusBar.color           = new vscode.ThemeColor('statusBar.foreground');
        overviewStatusBar.backgroundColor = undefined;
    } else {
        overviewStatusBar.text            = `🎇 overview ⚠ 要更新`;
        overviewStatusBar.tooltip         = `${baseName} のコードが変更されています\nクリックして overview を再生成`;
        overviewStatusBar.color           = new vscode.ThemeColor('statusBarItem.warningForeground');
        overviewStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
    overviewStatusBar.show();
}

export function registerOverviewGenerator(context: vscode.ExtensionContext) {
    const generatorCommand = vscode.commands.registerCommand('cssToHtmlJumper.generateOverview', async (uri: vscode.Uri) => {
        // コンテキストメニューから呼ばれた場合はuriが渡される。コマンドパレットからならアクティブエディタを使用。
        let targetUri = uri;
        if (!targetUri) {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('JSファイルを開いてから実行してください。');
                return;
            }
            targetUri = editor.document.uri;
        }

        if (!targetUri.fsPath.endsWith('.js') && !targetUri.fsPath.endsWith('.ts')) {
            vscode.window.showErrorMessage('JavaScript または TypeScript ファイルを選択してください。');
            return;
        }

        try {
            const doc = await vscode.workspace.openTextDocument(targetUri);
            await generateOverview(doc);
            // 生成後にステータスバーを更新
            updateOverviewStatusBar(targetUri.fsPath, doc.getText());
        } catch (err: any) {
            vscode.window.showErrorMessage(`ファイルの読み込みに失敗しました: ${err.message}`);
        }
    });

    // JS/TS が保存されたときにハッシュを再チェック
    const saveWatcher = vscode.workspace.onDidSaveTextDocument((doc) => {
        if (!doc.uri.fsPath.endsWith('.js') && !doc.uri.fsPath.endsWith('.ts')) { return; }
        updateOverviewStatusBar(doc.uri.fsPath, doc.getText());
    });

    // エディタが切り替わったときもステータスバーを更新
    const editorWatcher = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor) { overviewStatusBar?.hide(); return; }
        const fp = editor.document.uri.fsPath;
        if (!fp.endsWith('.js') && !fp.endsWith('.ts')) { overviewStatusBar?.hide(); return; }
        updateOverviewStatusBar(fp, editor.document.getText());
    });

    context.subscriptions.push(generatorCommand, saveWatcher, editorWatcher);
}

async function generateOverview(doc: vscode.TextDocument) {
    const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
    const apiKey = config.get<string>('geminiApiKey', '');
    
    if (!apiKey) {
        vscode.window.showErrorMessage('Generate Overview を使うには Gemini API Key の設定が必要です。設定画面から "cssToHtmlJumper.geminiApiKey" を設定してください。');
        return;
    }

    const fsPath = doc.uri.fsPath;
    const fileName = path.basename(fsPath);
    const codeContext = doc.getText();
    const lineCount = doc.lineCount;

    vscode.window.showInformationMessage(`⏳ ${fileName} の Overview を生成中... (Gemini 2.5 Flash)`);
    const loadingMsg = vscode.window.setStatusBarMessage(`$(sync~spin) Overview 生成中: ${fileName}...`);

    try {
        const prompt = `以下の JavaScript/TypeScript ファイルを解析し、概要ビュア (overview.html) に表示するための構造化データを提供してください。

【出力要件】
以下の構造を持つ純粋な JSON のみを出力してください。Markdownブロック (\`\`\`json など) は含めないでください。

{
  "functions": [
    {
      "name": "関数名()",
      "start": 10,
      "end": 20,
      "desc": "簡潔な1行説明",
      "role": "トリガー：xxx / 役割：xxx / ユーティリティ",
      "tip": "ホバー時に表示する詳細な説明文。HTMLタグ(<br>, <strong>など)が使えます。",
      "category": "primary" // "primary"(重要), "util", "event", "loop", "cfg" のいずれか
    }
  ],
  "config": [
    { "key": "変数名", "value": "値や説明" }
  ],
  "flowGroups": [
    {
      "title": "⚡ 起動時", // 見出しになる部分 (primaryセクションなら⚡、ほかは適宜絵文字)
      "isPrimary": true, // 目立たせるかどうか
      "items": ["関数名()", "_arrow_", "次の関数()"] // _arrow_ は下矢印(↓)に置換されます
    }
  ]
}

【説明の書き方ルール — 必ず守ること】
1. desc・tip・role に他の関数名を書くときは、画面上での役割も添える。
   悪い例: 「btnNextClickHandler で使用される」
   良い例: 「次へボタン（btnNextClickHandler）がクリックされたときに使用される」
2. index・counter・position などの抽象的な変数は、画面上で何を意味するか一言添える。
   悪い例: 「カルーセルがスライドできる最大のインデックス位置を定義する」
   良い例: 「カルーセルがスライドできる最大のインデックス位置（＝画面に表示されるスライド枚数の上限）を定義する」
3. 専門用語は使ってよいが、必ず画面・ユーザー操作に結びつけた言葉を1つ以上含める。
4. desc は1行20〜40文字程度のシンプルな日本語にする。
5. tip はより詳しく、具体的な動作の例や「なぜそうなるか」まで説明する。

【対象コード】
${codeContext.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n')}
`;


        const postData = JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.2, // 構造化データなので低め
                responseMimeType: "application/json"
            }
        });

        const options = {
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const resultJson = await new Promise<string>((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => resolve(data));
            });
            req.on('error', reject);
            req.write(postData);
            req.end();
        });

        const parsed = JSON.parse(resultJson);
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
            throw new Error('Gemini API からの応答が空でした。');
        }

        const cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        const overviewData = JSON.parse(cleanText);

        // HTML テンプレートにデータを差し込む (ソースコードも直接埋め込む)
        const sourceHash = computeHash(codeContext);
        const generatedAt = new Date().toLocaleString('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
        const htmlContent = buildHtmlOverview(fileName, lineCount, overviewData, codeContext, sourceHash, generatedAt);

        // 同フォルダに overview.html を保存
        const dirPath = path.dirname(fsPath);
        const nameWithoutExt = path.basename(fileName, path.extname(fileName));
        const outPath = path.join(dirPath, `${nameWithoutExt}_overview.html`);
        fs.writeFileSync(outPath, htmlContent, 'utf-8');

        // ブラウザで開く (Windows環境でのエラー対策としてchild_processを使用)
        const cp = require('child_process');
        if (process.platform === 'win32') {
            cp.exec(`start "" "${outPath}"`);
        } else if (process.platform === 'darwin') {
            cp.exec(`open "${outPath}"`);
        } else {
            cp.exec(`xdg-open "${outPath}"`);
        }
        
        vscode.window.showInformationMessage(`✅ ${nameWithoutExt}_overview.html を作成しました！`);

    } catch (err: any) {
        console.error("[Generate Overview] Error:", err);
        vscode.window.showErrorMessage(`Overview 生成エラー: ${err.message}`);
    } finally {
        loadingMsg.dispose();
    }
}

// ========================================
// HTML テンプレート生成
// ========================================
function buildHtmlOverview(fileName: string, lineCount: number, data: any, sourceCode: string, sourceHash: string = '', generatedAt: string = ''): string {
    const functionsHtml = generateLeftPanelHtml(data);
    const fnMapJson = JSON.stringify(data.functions.map((f: any) => ({
        name: f.name,
        start: f.start,
        end: f.end
    })));

    // ソースコードをJS文字列として安全にエスケープ
    const escapedSource = sourceCode
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$\{/g, '\\${');

    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="overview-source-hash" content="${sourceHash}">
<meta name="overview-generated-at" content="${generatedAt}">
<title>${fileName} — 概要ビュア</title>
<link href="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-tomorrow.min.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/plugins/line-numbers/prism-line-numbers.min.css" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: 'Segoe UI', sans-serif;
    background: #0d1117; color: #c9d1d9;
    height: 100vh; overflow: hidden;
    display: flex; flex-direction: column;
}

/* ─── ヘッダー ─── */
#header {
    background: #161b22; border-bottom: 1px solid #30363d;
    padding: 10px 20px; display: flex; align-items: center; gap: 10px; flex-shrink: 0;
}
#header h1 { font-size: 1.0rem; color: #e6edf3; font-weight: 600; }
.badge { background: #21262d; border: 1px solid #30363d; border-radius: 20px; padding: 2px 10px; font-size: 0.73rem; color: #8b949e; }
#esc-hint { margin-left: auto; font-size: 0.7rem; color: #484f58; opacity: 0; transition: opacity 0.3s; }
#esc-hint.show { opacity: 1; }

/* ─── レイアウト ─── */
#layout { display: flex; flex: 1; overflow: hidden; }

/* ════════════ 左パネル ════════════ */
#left-panel {
    width: 315px; min-width: 315px;
    background: #0d1117; border-right: 1px solid #21262d;
    overflow-y: auto; padding: 14px 12px;
    display: flex; flex-direction: column; gap: 5px;
}

/* ── セクションラベル ── */
.section-label {
    font-size: 0.68rem; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: #484f58; padding: 10px 0 3px;
}
.section-label.primary {
    color: #cba6f7;
    font-size: 0.76rem;
    padding: 12px 0 5px;
    text-shadow: 0 0 12px rgba(203,166,247,0.3);
}

/* ── fn-box ── */
.fn-box {
    background: #161b22; border: 1px solid #30363d;
    border-radius: 8px; padding: 9px 11px; cursor: pointer;
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
    user-select: none; position: relative;
}
.fn-box:hover { background: #1c2128; border-color: #58a6ff; }
.fn-box.active { border-color: #f0b429 !important; background: #1c1a0f; box-shadow: 0 0 0 2px #f0b42930; }

.fn-box.primary {
    background: #13182a;
    border-color: #2d3550;
    box-shadow: 0 0 0 1px #3843700040;
}
.fn-box.primary:hover { border-color: #7aa2f7; background: #181f36; }

.fn-name { font-family: 'Cascadia Code','Consolas',monospace; font-size: 0.85rem; color: #58a6ff; font-weight: 600; }
.fn-box.primary .fn-name { color: #7aa2f7; }
.fn-box.active .fn-name { color: #f0b429; }
.fn-desc { font-size: 0.74rem; color: #8b949e; margin-top: 3px; line-height: 1.5; }

/* 色種別 */
.event { border-left: 3px solid #cba6f7; }
.util  { border-left: 3px solid #3fb950; }
.loop  { border-left: 3px solid #374768; }
.cfg   { border-left: 3px solid #f0883e; }
.struct { background: #12111a; border: 1px dashed #30363d; cursor: default; }
.struct:hover { background: #12111a; border-color: #30363d; box-shadow: none; }

.arrow { text-align: center; color: #484f58; font-size: 0.75rem; padding: 1px 0; }
.arrow.primary { color: #7aa2f7; }

.config-grid { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; font-size: 0.74rem; }
.config-grid span:nth-child(odd)  { font-family: monospace; color: #e3b341; }
.config-grid span:nth-child(even) { font-family: monospace; color: #3fb950; text-align: right; }

.loop-group {
    border: 1px solid #2a4a6a; border-radius: 10px;
    padding: 9px; background: #0e1f30;
    display: flex; flex-direction: column; gap: 4px;
    position: relative;
}
.loop-group::before {
    content: '🔄 毎フレーム'; position: absolute; top: -9px; left: 10px;
    background: #0e1f30; padding: 0 6px; font-size: 0.62rem; color: #4a90d0; font-weight: 700;
}
.loop-group .fn-box { background: #122030; border-color: #2a4060; }
.loop-group .fn-box:hover { background: #1a2e44; border-color: #4a80c0; }
.loop-group .fn-name { color: #7dc4f7; }
.sub-group { display: flex; gap: 5px; padding-left: 8px; }
.fn-box.small .fn-name { font-size: 0.76rem; }
.fn-box.small .fn-desc { font-size: 0.67rem; }

/* ════════════ 右パネル ════════════ */
#right-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
#right-header { background: #161b22; border-bottom: 1px solid #30363d; padding: 7px 16px; font-size: 0.75rem; color: #8b949e; flex-shrink: 0; }
#right-header span { color: #58a6ff; font-family: monospace; }

/* ── ナビバー ── */
#nav-bar {
    background: #0d1117; border-bottom: 1px solid #21262d;
    padding: 5px 10px; display: flex; align-items: center; gap: 6px;
    min-height: 36px; flex-shrink: 0;
}
#back-btn {
    background: #21262d; border: 1px solid #30363d; border-radius: 5px;
    color: #8b949e; font-size: 0.72rem; padding: 3px 10px; cursor: pointer;
    transition: background 0.15s, color 0.15s; white-space: nowrap;
}
#back-btn:hover:not(:disabled) { background: #30363d; color: #e6edf3; }
#back-btn:disabled { opacity: 0.3; cursor: default; }
#breadcrumb { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; overflow: hidden; }
.bc-hint { color: #484f58; font-size: 0.7rem; }
.bc-item { color: #58a6ff; cursor: pointer; font-family: monospace; font-size: 0.72rem; padding: 1px 7px; border-radius: 4px; transition: background 0.15s; }
.bc-item:hover { background: #21262d; }
.bc-current { color: #f0b429; font-family: monospace; font-size: 0.72rem; background: #1a1500; border: 1px solid #f0b42930; padding: 1px 7px; border-radius: 4px; font-weight: 600; }
.bc-sep { color: #30363d; font-size: 0.7rem; }

/* ── コードコンテナ ── */
#code-container { flex: 1; overflow-y: auto; position: relative; background: #1e1e2e; }

#line-highlight {
    position: absolute; left: 0; right: 0;
    background: rgba(240, 180, 41, 0.12);
    border-left: 3px solid rgba(240, 180, 41, 0.9);
    box-shadow: inset 0 0 0 1px rgba(240,180,41,0.08);
    pointer-events: none; opacity: 0;
    transition: top 0.25s ease, height 0.25s ease, opacity 0.2s ease;
    z-index: 5;
}
#back-float {
    position: absolute; right: 12px;
    background: rgba(22, 27, 34, 0.92);
    border: 1px solid #f0b42980; border-radius: 20px;
    color: #f0b429; font-size: 0.73rem; font-weight: 600;
    padding: 5px 14px; cursor: pointer;
    opacity: 0; pointer-events: none;
    transform: translateX(6px);
    transition: opacity 0.2s ease, transform 0.2s ease, top 0.25s ease;
    z-index: 10; white-space: nowrap; user-select: none;
}
#back-float.visible { opacity: 1; pointer-events: auto; transform: translateX(0); }
#back-float:hover { background: rgba(35, 30, 5, 0.98); border-color: #f0b429; }

pre[class*="language-"] { margin: 0; border-radius: 0; background: #1e1e2e !important; font-size: 14px; tab-size: 4; padding-bottom: 50vh !important; }
code[class*="language-"] { font-size: 14px; }
#loading-msg { padding: 40px; color: #484f58; font-size: 0.85rem; }

/* Ctrl+Clickできる関数名 */
#code-el .token.function.fn-link { cursor: default; border-bottom: 1px dotted rgba(88,166,255,0.4); transition: background 0.1s; }
#code-el .token.function.fn-link:hover { background: rgba(88,166,255,0.08); border-radius: 2px; }
body.ctrl-held #code-el .token.function.fn-link { cursor: pointer; background: rgba(88,166,255,0.18); border-bottom: 1px solid #58a6ff; }

/* ════════════ AIホバーツールチップ ════════════ */
#fn-tooltip {
    position: fixed; background: #161b22; border: 1px solid #30363d; border-radius: 10px;
    padding: 12px 14px; max-width: 260px; font-size: 0.73rem; color: #c9d1d9; line-height: 1.65;
    z-index: 999; pointer-events: none; opacity: 0; transition: opacity 0.15s;
    box-shadow: 0 6px 20px rgba(0,0,0,0.5);
}
#fn-tooltip.show { opacity: 1; }
#fn-tooltip .tip-role { font-size: 0.62rem; color: #3fb950; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 5px; }
#fn-tooltip .tip-name { font-family: monospace; color: #7aa2f7; font-weight: 700; font-size: 0.82rem; margin-bottom: 6px; }
#fn-tooltip .tip-body { color: #b0bcc8; }
#fn-tooltip .tip-hint { margin-top: 8px; font-size: 0.65rem; color: #484f58; border-top: 1px solid #21262d; padding-top: 6px; }
</style>
</head>
<body>

<div id="header">
    <h1>🎆 ${fileName} 概要ビュア</h1>
    <span class="badge">左ブロックをクリック → スポットライト</span>
    <span class="badge">コード内関数名は <kbd>Ctrl</kbd>+クリックでジャンプ</span>
    ${generatedAt ? `<span class="badge" style="color:#3fb950;border-color:#3fb950;opacity:0.7">🕐 生成: ${generatedAt}</span>` : ''}
    <span id="esc-hint">ESC でハイライト解除</span>
</div>

<div id="layout">
    <!-- ═════ 左パネル ═════ -->
    <div id="left-panel">
        ${functionsHtml}
    </div>

    <!-- ═════ 右パネル ═════ -->
    <div id="right-panel">
        <div id="right-header">📄 <span>${fileName}</span> — ${lineCount}行</div>
        <div id="nav-bar">
            <button id="back-btn" disabled title="1つ前の関数に戻る">← 戻る</button>
            <div id="breadcrumb">
                <span class="bc-hint">📍 左の関数をクリックするとスポットライト表示されます</span>
            </div>
        </div>
        <div id="code-container">
            <div id="line-highlight"></div>
            <div id="back-float">← 戻る</div>
            <div id="loading-msg">⏳ コードを読み込み中...</div>
            <pre id="code-pre" class="language-javascript line-numbers" style="display:none"><code id="code-el"></code></pre>
        </div>
    </div>
</div>

<div id="fn-tooltip">
    <div class="tip-role" id="tip-role"></div>
    <div class="tip-name" id="tip-name"></div>
    <div class="tip-body" id="tip-body"></div>
    <div class="tip-hint">クリックでスポットライト表示</div>
</div>

<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-javascript.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/plugins/line-numbers/prism-line-numbers.min.js"></script>
<script>
const codeEl        = document.getElementById('code-el');
const codePre       = document.getElementById('code-pre');
const codeContainer = document.getElementById('code-container');
const hlBox         = document.getElementById('line-highlight');
const breadcrumb    = document.getElementById('breadcrumb');
const backBtn       = document.getElementById('back-btn');
const backFloat     = document.getElementById('back-float');
const escHint       = document.getElementById('esc-hint');
const loadingMsg    = document.getElementById('loading-msg');
const tooltip       = document.getElementById('fn-tooltip');

let currentActive = null;
let spotlitActive = false;
const navStack = [];

// APIから提供された関数情報をマップ化
const fnList = ${fnMapJson};
const fnMap = {};
fnList.forEach(f => {
    const raw = f.name;
    const bare = raw.split('(')[0];  // 'resizeCanvas()' -> 'resizeCanvas'
    const box = document.getElementById('fn-' + bare);
    const entry = { start: f.start, end: f.end, box, name: raw };
    fnMap[bare] = entry;
    fnMap[raw] = entry;
});

// ソースコードを直接埋め込み（fetchの代わり）
const __embeddedSource = \`${escapedSource}\`;
(function() {
    loadingMsg.style.display = 'none';
    codePre.style.display = 'block';
    codeEl.textContent = __embeddedSource;
    Prism.highlightElement(codeEl);
    // PrismJSのDOM操作が完了するのを待つ
    setTimeout(function() { setupCodeLinks(); }, 200);
})();

document.addEventListener('keydown', e => {
    if (e.key === 'Control') document.body.classList.add('ctrl-held');
    if (e.key === 'Escape')  clearSpotlight();
});
document.addEventListener('keyup', e => {
    if (e.key === 'Control') document.body.classList.remove('ctrl-held');
});

function setupCodeLinks() {
    document.querySelectorAll('#code-el .token.function').forEach(function(span) {
        var name = span.textContent.trim();
        if (!fnMap[name]) return;
        span.classList.add('fn-link');
        span.setAttribute('data-fn', name);
    });
}

// イベント委譲でCtrl+Clickを処理（個別spanへのリスナーより確実）
codeEl.addEventListener('mousedown', function(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    var target = e.target;
    while (target && target !== codeEl) {
        if (target.classList && target.classList.contains('fn-link')) {
            var fname = target.getAttribute('data-fn');
            if (fname && fnMap[fname]) {
                e.preventDefault();
                e.stopPropagation();
                var entry = fnMap[fname];
                highlightLines(entry.start, entry.end, entry.box, entry.name);
            }
            return;
        }
        target = target.parentNode;
    }
});

function clearSpotlight() {
    hlBox.style.opacity = '0';
    spotlitActive = false;
    escHint.classList.remove('show');
    if (currentActive) { currentActive.classList.remove('active'); currentActive = null; }
}

function highlightLines(startLine, endLine, box, name, addHistory = true) {
    const lineRows = codePre.querySelector('.line-numbers-rows');
    if (!lineRows) return;
    const spans = Array.from(lineRows.querySelectorAll('span'));
    if (startLine > spans.length) return;

    const s = spans[startLine - 1];
    const e = spans[Math.min(endLine, spans.length) - 1];

    const top = codePre.offsetTop + lineRows.offsetTop + s.offsetTop;
    const height = (e.offsetTop + e.offsetHeight) - s.offsetTop;

    hlBox.style.top = top + "px";
    hlBox.style.height = height + "px";
    hlBox.style.opacity = "1";
    backFloat.style.top = (top + 4) + "px";

    spotlitActive = true;
    escHint.classList.add("show");

    const viewH = codeContainer.clientHeight;
    codeContainer.scrollTop = Math.max(0, top + height / 2 - viewH / 2);

    if (currentActive) currentActive.classList.remove('active');
    if (box) { box.classList.add('active'); currentActive = box; }

    if (addHistory && name) {
        const last = navStack[navStack.length - 1];
        if (!last || last.name !== name) {
            navStack.push({ name, start: startLine, end: endLine, box });
            if (navStack.length > 10) navStack.shift();
        }
    }
    renderNav();
}

function renderNav() {
    const canBack = navStack.length >= 2;
    backBtn.disabled = !canBack;
    backFloat.classList.toggle('visible', canBack);

    if (navStack.length === 0) {
        breadcrumb.innerHTML = '<span class="bc-hint">📍 左の関数をクリックすると強調表示されます</span>';
        return;
    }
    const parts = navStack.map((item, i) => {
        const isCurrent = (i === navStack.length - 1);
        return \`<span class="\${isCurrent ? 'bc-current' : 'bc-item'}" data-idx="\${i}">\${item.name}</span>\`;
    });
    breadcrumb.innerHTML = '<span class="bc-hint">📍 </span>' + parts.join('<span class="bc-sep"> → </span>');
    breadcrumb.querySelectorAll('.bc-item').forEach(el => {
        el.addEventListener('click', () => {
            const idx = parseInt(el.dataset.idx, 10);
            navStack.splice(idx + 1);
            const target = navStack[navStack.length - 1];
            if (target) highlightLines(target.start, target.end, target.box, null, false);
            renderNav();
        });
    });
}

function goBack() {
    if (navStack.length < 2) return;
    navStack.pop();
    const prev = navStack[navStack.length - 1];
    if (prev) highlightLines(prev.start, prev.end, prev.box, null, false);
    renderNav();
}
backBtn.addEventListener('click', goBack);
backFloat.addEventListener('click', e => { e.stopPropagation(); goBack(); });

document.querySelectorAll('.fn-box[data-start]').forEach(box => {
    box.addEventListener('click', () => {
        const s = parseInt(box.dataset.start, 10);
        const e = parseInt(box.dataset.end, 10);
        const name = box.dataset.name;
        highlightLines(s, e, box, name);
    });
});

codeContainer.addEventListener('click', e => {
    if (!e.ctrlKey && spotlitActive) clearSpotlight();
});

let tooltipTimer = null;
document.querySelectorAll('.fn-box[data-tip]').forEach(box => {
    box.addEventListener('mouseenter', e => {
        clearTimeout(tooltipTimer);
        document.getElementById('tip-role').textContent = box.dataset.tipRole || '';
        document.getElementById('tip-name').textContent = box.dataset.name || '';
        document.getElementById('tip-body').innerHTML = box.dataset.tip;
        positionTooltip(e);
        tooltip.classList.add('show');
    });
    box.addEventListener('mousemove', positionTooltip);
    box.addEventListener('mouseleave', () => {
        tooltipTimer = setTimeout(() => tooltip.classList.remove('show'), 80);
    });
});

function positionTooltip(e) {
    const margin = 14;
    const tipW = 270;
    let x = e.clientX + margin;
    let y = e.clientY + margin;
    if (x + tipW > window.innerWidth) x = e.clientX - tipW - margin;
    if (y + tooltip.offsetHeight > window.innerHeight) y = e.clientY - tooltip.offsetHeight - margin;
    tooltip.style.left = Math.max(4, x) + 'px';
    tooltip.style.top = Math.max(4, y) + 'px';
}
</script>
</body>
</html>`;
}

function generateLeftPanelHtml(data: any): string {
    let html = '';

    // Functions Map for quick lookup
    const fnDict: any = {};
    if (data.functions) {
        data.functions.forEach((f: any) => {
            const safeName = (f.name || '').replace(/\(.*?\)$/, '');
            fnDict[safeName] = f;
            fnDict[f.name] = f;
        });
    }

    // Process Flow Groups FIRST (primary groups first, then secondary)
    if (data.flowGroups) {
        // Primary groups (重要なフロー) — 大きく表示
        data.flowGroups.filter((g: any) => g.isPrimary).forEach((group: any) => {
            html += `<div class="section-label primary">${htmlEscape(group.title || '処理フロー')}</div>\n`;
            html += renderGroupItems(group.items, fnDict, true);
        });

        // Non-primary groups (補助フロー) — loop-group で囲む
        data.flowGroups.filter((g: any) => !g.isPrimary).forEach((group: any) => {
            html += `<div class="section-label">${htmlEscape(group.title || '処理フロー')}</div>\n`;
            html += `<div class="loop-group">\n`;
            html += renderGroupItems(group.items, fnDict, false);
            html += `</div>\n`;
        });
    }

    // Config block at the bottom
    if (data.config && data.config.length > 0) {
        html += `<div class="section-label">⚙️ CONFIG — 設定値</div>\n`;
        html += `<div class="fn-box cfg">\n<div class="config-grid">\n`;
        data.config.forEach((c: any) => {
            html += `<span>${htmlEscape(c.key)}</span><span>${htmlEscape(c.value)}</span>\n`;
        });
        html += `</div>\n</div>\n`;
    }

    return html;
}

function renderGroupItems(items: string[], fnDict: any, isPrimary: boolean): string {
    let html = '';
    const cls = isPrimary ? ' primary' : '';
    // Collect consecutive util items to render as sub-group
    let utilBuffer: any[] = [];

    function flushUtils() {
        if (utilBuffer.length === 0) return;
        if (utilBuffer.length >= 2) {
            html += `<div class="arrow">↙ 内部で使用</div>\n`;
            html += `<div class="sub-group">\n`;
            utilBuffer.forEach(fn => {
                const bareName = (fn.name || '').replace(/\(.*?\)$/, '');
                html += `<div class="fn-box util small" id="fn-${htmlEscape(bareName)}"
                    data-start="${fn.start || 1}" data-end="${fn.end || 1}" data-name="${htmlEscape(fn.name)}"
                    data-tip-role="${htmlEscape(fn.role || '')}"
                    data-tip="${htmlEscape(fn.tip || fn.desc || '')}">
                    <div class="fn-name">${htmlEscape(fn.name)}</div>
                    <div class="fn-desc">${htmlEscape(fn.desc || '')}</div>
                </div>\n`;
            });
            html += `</div>\n`;
        } else {
            utilBuffer.forEach(fn => {
                const bareName = (fn.name || '').replace(/\(.*?\)$/, '');
                html += `<div class="fn-box util small" id="fn-${htmlEscape(bareName)}"
                    data-start="${fn.start || 1}" data-end="${fn.end || 1}" data-name="${htmlEscape(fn.name)}"
                    data-tip-role="${htmlEscape(fn.role || '')}"
                    data-tip="${htmlEscape(fn.tip || fn.desc || '')}">
                    <div class="fn-name">${htmlEscape(fn.name)}</div>
                    <div class="fn-desc">${htmlEscape(fn.desc || '')}</div>
                </div>\n`;
            });
        }
        utilBuffer = [];
    }

    items.forEach((itemName: string) => {
        if (itemName === '_arrow_') {
            flushUtils();
            html += `<div class="arrow${cls}">↓</div>\n`;
            return;
        }

        const bareName = itemName.replace(/\(.*?\)$/, '');
        const fnDoc = fnDict[bareName] || fnDict[itemName];

        if (fnDoc && fnDoc.category === 'util') {
            utilBuffer.push(fnDoc);
            return;
        }

        flushUtils();

        if (fnDoc) {
            const extraClass = fnDoc.category ? ` ${fnDoc.category}` : '';
            const boxCls = isPrimary ? ' primary' : (fnDoc.category === 'loop' ? ' loop' : '');
            html += `<div class="fn-box${boxCls}${extraClass}" id="fn-${htmlEscape(bareName)}"
                data-start="${fnDoc.start || 1}" data-end="${fnDoc.end || 1}" data-name="${htmlEscape(fnDoc.name || itemName)}"
                data-tip-role="${htmlEscape(fnDoc.role || '')}"
                data-tip="${htmlEscape(fnDoc.tip || fnDoc.desc || '')}">
                <div class="fn-name">${htmlEscape(fnDoc.name || itemName)}</div>
                <div class="fn-desc">${htmlEscape(fnDoc.desc || '')}</div>
            </div>\n`;
        } else {
            html += `<div class="fn-box${cls}" data-name="${htmlEscape(itemName)}">
                <div class="fn-name">${htmlEscape(itemName)}</div>
            </div>\n`;
        }
    });

    flushUtils();
    return html;
}

function htmlEscape(str: string): string {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
