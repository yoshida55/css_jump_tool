import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

// --- 型定義 ---
interface AiHoverInfo {
    intent: string;
    predictedInput: string;
    predictedOutput: string;
    flow: string;
}

interface DiskCacheEntry {
    mtime: number; // ファイルの最終更新時刻（ミリ秒）
    symbols: { [name: string]: AiHoverInfo };
}

// --- インメモリキャッシュ（セッション中の高速アクセス用）---
const hoverCache = new Map<string, Map<string, AiHoverInfo>>();
const isCaching = new Set<string>(); // 処理中のファイル（多重呼び出し防止）
const contentHashMap = new Map<string, number>(); // コンテンツハッシュ（保存時の不要なAPI呼び出し防止）

// 簡易ハッシュ関数（コンテンツ変更検知用）
function simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}

// --- ディスクキャッシュ（VS Code再起動を跨いで持続）---
let diskCachePath = '';
let diskCacheData: { [fsPath: string]: DiskCacheEntry } = {};

function loadDiskCache(context: vscode.ExtensionContext) {
    try {
        const cacheDir = context.globalStorageUri.fsPath;
        diskCachePath = path.join(cacheDir, 'ai-hover-cache.json');
        if (fs.existsSync(diskCachePath)) {
            const raw = fs.readFileSync(diskCachePath, 'utf-8');
            diskCacheData = JSON.parse(raw);
        }
    } catch (_) {
        diskCacheData = {};
    }
}

function saveDiskCache() {
    try {
        const cacheDir = path.dirname(diskCachePath);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        fs.writeFileSync(diskCachePath, JSON.stringify(diskCacheData));
    } catch (err) {
        console.error('[AI Hover] Failed to write disk cache:', err);
    }
}

export function registerAiHoverProvider(context: vscode.ExtensionContext) {
    // 起動時にディスクキャッシュを読み込む
    loadDiskCache(context);

    // 1. Hover Providerの登録
    const hoverProvider = vscode.languages.registerHoverProvider(
        ['javascript', 'typescript', 'html'],
        {
            provideHover(document, position) {
                const wordRange = document.getWordRangeAtPosition(position);
                if (!wordRange) return null;
                const word = document.getText(wordRange);

                const fileCache = hoverCache.get(document.uri.fsPath);
                if (fileCache && fileCache.has(word)) {
                    const info = fileCache.get(word)!;
                    
                    const markdown = new vscode.MarkdownString();
                    markdown.isTrusted = true;
                    markdown.supportHtml = true;
                    
                    markdown.appendMarkdown(`### ✨ AI 仮想実行 (Ghost Execution)\n\n`);
                    markdown.appendMarkdown(`**🎯 意図:**\n\n${info.intent}\n\n`);
                    if (info.predictedInput || info.predictedOutput) {
                        markdown.appendMarkdown(`**💡 推測データ:**\n\n`);
                        markdown.appendCodeblock(
                            `Input : ${info.predictedInput || 'なし'}\nOutput: ${info.predictedOutput || 'なし'}`,
                            'typescript'
                        );
                    }
                    if (info.flow) {
                        markdown.appendMarkdown(`\n**🔄 処理フロー:**\n\n${info.flow}\n`);
                    }

                    return new vscode.Hover(markdown, wordRange);
                }
                return null;
            }
        }
    );
    context.subscriptions.push(hoverProvider);

    // 2. 保存時の自動キャッシュ更新（コンテンツが実際に変わった場合のみ再解析）
    const saveListener = vscode.workspace.onDidSaveTextDocument(async (doc) => {
        const lang = doc.languageId;
        if (lang === 'javascript' || lang === 'typescript' || lang === 'html') {
            const content = doc.getText();
            const hash = simpleHash(content);
            const prevHash = contentHashMap.get(doc.uri.fsPath);
            if (prevHash === hash) {
                // コンテンツ変更なし → API呼び出しスキップ
                return;
            }
            contentHashMap.set(doc.uri.fsPath, hash);
            hoverCache.delete(doc.uri.fsPath);
            await cacheFileWithAI(doc);
        }
    });
    context.subscriptions.push(saveListener);

    // 3. アクティブエディタが変わった時もキャッシュを試みる
    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
            const lang = editor.document.languageId;
            if (lang === 'javascript' || lang === 'typescript' || lang === 'html') {
                const fsPath = editor.document.uri.fsPath;
                if (!hoverCache.has(fsPath)) {
                    cacheFileWithAI(editor.document);
                }
            }
        }
    }, null, context.subscriptions);

    // 最初のアクティブファイルもキャッシュ
    if (vscode.window.activeTextEditor) {
        const doc = vscode.window.activeTextEditor.document;
        const lang = doc.languageId;
        if (lang === 'javascript' || lang === 'typescript' || lang === 'html') {
            cacheFileWithAI(doc);
        }
    }
}

async function cacheFileWithAI(document: vscode.TextDocument) {
    const fsPath = document.uri.fsPath;
    if (isCaching.has(fsPath)) return;
    isCaching.add(fsPath);

    const loadingMsg = vscode.window.setStatusBarMessage("$(sync~spin) AI Hover: AIがコードを解析中...");

    try {
        // ---- ディスクキャッシュのチェック（ファイルが変わっていなければAPIをスキップ）----
        try {
            const mtime = fs.statSync(fsPath).mtimeMs;
            const cachedEntry = diskCacheData[fsPath];
            if (cachedEntry && cachedEntry.mtime === mtime) {
                // ファイルが変更されていない → キャッシュから即座に復元
                const fileCache = new Map<string, AiHoverInfo>();
                for (const [name, info] of Object.entries(cachedEntry.symbols)) {
                    fileCache.set(name, info);
                }
                hoverCache.set(fsPath, fileCache);
                // コンテンツハッシュも記録（保存時の不要API呼び出し防止）
                contentHashMap.set(fsPath, simpleHash(document.getText()));
                // loadingMsgはfinallyで自動的に破棄される
                vscode.window.setStatusBarMessage(`💾 AI ${fileCache.size} functions (cached)`, 3000);
                return;
            }
        } catch (_) { /* statに失敗した場合はキャッシュチェックをスキップしてAPI呼び出しへ */ }
        // ---------------------------------------------------------------------------------

        const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
        const apiKey = config.get<string>('geminiApiKey', '');
        if (!apiKey) {
            vscode.window.showWarningMessage('AI Hover機能を使うには Gemini API Key の設定が必要です。');
            return;
        }

        const codeContext = document.getText();
        
        const prompt = `以下のコードについて、主要な関数、重要変数、クラスなどの「意図」「推測される入力・出力データのダミー」「簡単な処理フロー」を抽出してください。ユーザーが関数名や変数名にホバー表示した際に表示するためのデータです。

【出力要件】
- \`symbols\` という配列を持つ純粋なJSONのみを出力してください。Markdownブロック（\`\`\`json など）を含めないでください。
- 対象とするシンボル（関数名、変数名）の正確な名前を \`name\` に入れてください。（この名前で完全一致検索します）
- \`intent\` にはその機能・変数の意図を1〜2文で。
- \`predictedInput\`, \`predictedOutput\` には具体的な推測値やデータのダミー例を。
- \`flow\` にはMarkdownの箇条書き（'- '）で簡単なフローを。

【出力例】
{
  "symbols": [
    {
      "name": "calculateTotal",
      "intent": "カート商品の合計と税込み価格を計算する処理",
      "predictedInput": "[{ price: 100 }, { price: 200 }]",
      "predictedOutput": "330",
      "flow": "- 配列をループ\n- 価格を合算\n- 税率を掛ける"
    },
    {
      "name": "isCaching",
      "intent": "多重リクエストを防ぐためのフラグ管理セット",
      "predictedInput": "Set(1) { 'path/to/file.js' }",
      "predictedOutput": "",
      "flow": ""
    }
  ]
}

【対象コード】
${codeContext}
`;

        const postData = JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.1,
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
        
        if (text) {
            // Markdownのバッククォートが混ざるケースを考慮して除去
            const cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
            // GeminiがJSON文字列値内に生の改行/タブを入れることがある → エスケープして修正
            const sanitized = cleanText.replace(
                /"(?:[^"\\]|\\.)*"/g,
                (match: string) => match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
            );
            const responseData = JSON.parse(sanitized);
            const fileCache = new Map<string, AiHoverInfo>();
            
            if (responseData.symbols && Array.isArray(responseData.symbols)) {
                for (const sym of responseData.symbols) {
                    if (sym.name) {
                        fileCache.set(sym.name, {
                            intent: sym.intent || '',
                            predictedInput: sym.predictedInput || '',
                            predictedOutput: sym.predictedOutput || '',
                            flow: sym.flow || ''
                        });
                    }
                }
            }
            hoverCache.set(fsPath, fileCache);
            // コンテンツハッシュを記録（保存時の不要API呼び出し防止）
            contentHashMap.set(fsPath, simpleHash(document.getText()));

            // ---- ディスクキャッシュに保存（次回VS Code起動時はAPIをスキップできる）----
            try {
                diskCacheData[fsPath] = {
                    mtime: fs.statSync(fsPath).mtimeMs,
                    symbols: Object.fromEntries(fileCache)
                };
                saveDiskCache();
            } catch (_) { /* 保存失敗は無視（機能には影響しない） */ }
            // -----------------------------------------------------------------------

            vscode.window.setStatusBarMessage(`✅ AI ${fileCache.size} functions loaded`, 5000);
        }

    } catch (err: any) {
        console.error("[AI Hover] Error:", err);
        vscode.window.showErrorMessage(`AI Hover エラー: ${err.message}`);
    } finally {
        loadingMsg.dispose();
        isCaching.delete(fsPath);
    }
}
