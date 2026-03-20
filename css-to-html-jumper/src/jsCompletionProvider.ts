import * as vscode from 'vscode';
import * as fs from 'fs';
import { jsMethods } from './jsProperties';

export interface JsFunction {
    name: string;
    description: string;
    insertText?: string; // エイリアス用
}

// メモから抽出したJS関数キャッシュ
let cachedJsFunctions: JsFunction[] | null = null;

/**
 * メモファイルからJS関数名を抽出する
 */
export function extractJsFunctionsFromMemo(memoContent: string): JsFunction[] {
    const functions: JsFunction[] = [];
    const seen = new Set<string>();
    const lines = memoContent.split('\n');

    // camelCase 関数パターン（document.xxx / window.xxx / addEventListener 等）
    // バッククォート・コードブロック内の camelCase 関数を優先
    const funcPattern = /\b([a-z][a-zA-Z0-9]{3,}(?:[A-Z][a-zA-Z0-9]*)+)\s*(?:\(|$)/g;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineRegex = new RegExp(funcPattern.source, 'g');
        let match;

        while ((match = lineRegex.exec(line)) !== null) {
            const name = match[1];
            if (seen.has(name) || name.length < 4) { continue; }
            // 既知の辞書エントリは辞書側で補完するのでスキップ
            if (jsMethods[name]) { continue; }
            seen.add(name);

            // 前後2行を description として取得
            const start = Math.max(0, i - 1);
            const end = Math.min(lines.length, i + 3);
            const description = lines.slice(start, end)
                .map(l => l.replace(/^[#\-\*\s`]+/, '').trim())
                .filter(l => l.length > 0)
                .join('\n');

            functions.push({ name, description });
        }
    }

    return functions;
}

export function getCachedJsFunctions(): JsFunction[] | null {
    return cachedJsFunctions;
}

/**
 * JS/TSファイル用の途中一致補完プロバイダーを登録する
 */
export function registerJsCompletionProvider(context: vscode.ExtensionContext) {
    const provider = vscode.languages.registerCompletionItemProvider(
        ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'],
        {
            provideCompletionItems(document, position) {
                // メモファイルを読み込む（キャッシュあれば再利用）
                if (!cachedJsFunctions) {
                    const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
                    const memoFilePath = config.get<string>('memoFilePath', '');
                    if (memoFilePath && fs.existsSync(memoFilePath)) {
                        const memoContent = fs.readFileSync(memoFilePath, 'utf-8');
                        cachedJsFunctions = extractJsFunctionsFromMemo(memoContent);
                    } else {
                        cachedJsFunctions = [];
                    }
                }

                // カーソル位置の単語を取得
                const wordRange = document.getWordRangeAtPosition(position, /[\w]+/);
                if (!wordRange) { return []; }
                const word = document.getText(wordRange).toLowerCase();
                if (word.length < 2) { return []; }

                // メモ由来の補完（途中一致）
                const memoItems = cachedJsFunctions
                    .filter(f => f.name.toLowerCase().includes(word))
                    .map(f => {
                        const item = new vscode.CompletionItem(f.name, vscode.CompletionItemKind.Function);
                        item.detail = '📖 メモより';
                        item.documentation = new vscode.MarkdownString(f.description);
                        item.insertText = new vscode.SnippetString(`${f.name}($1)$0`);
                        const isPrefix = f.name.toLowerCase().startsWith(word);
                        item.sortText = (isPrefix ? '!0_' : '!1_') + f.name;
                        return item;
                    });

                // jsMethods 辞書由来の補完（途中一致）
                const memoNames = new Set(memoItems.map(i => i.label as string));
                const dictItems = Object.entries(jsMethods)
                    .filter(([key]) => key.toLowerCase().includes(word) && !memoNames.has(key))
                    .map(([key, info]) => {
                        const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Function);
                        item.detail = '📚 JS辞書';
                        let doc = `**${key}**\n\n` + info.description;
                        if (info.syntax) { doc += `\n\n\`\`\`js\n${info.syntax}\n\`\`\``; }
                        if (info.params?.length) { doc += '\n\n**引数**: ' + info.params.join(' \\ '); }
                        if (info.returns) { doc += '\n\n**戻り値**: ' + info.returns; }
                        if (info.tips?.length) { doc += '\n\n💡 ' + info.tips.join('\n\n💡 '); }
                        item.documentation = new vscode.MarkdownString(doc);
                        item.insertText = new vscode.SnippetString(`${key}($1)$0`);
                        item.filterText = key;
                        const isPrefix = key.toLowerCase().startsWith(word);
                        item.sortText = (isPrefix ? '\x00\x01' : '\x00\x02') + key;
                        return item;
                    });

                return [...memoItems, ...dictItems];
            }
        }
    );

    // メモ保存時にキャッシュをリセット
    const watcher = vscode.workspace.onDidSaveTextDocument(doc => {
        const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
        const memoFilePath = config.get<string>('memoFilePath', '');
        if (doc.uri.fsPath === memoFilePath) {
            cachedJsFunctions = null;
        }
    });

    context.subscriptions.push(provider, watcher);
}

/**
 * JS/TSファイル用のゴーストテキスト（インライン補完）プロバイダーを登録する
 */
export function registerJsInlineCompletionProvider(context: vscode.ExtensionContext) {
    const provider = vscode.languages.registerInlineCompletionItemProvider(
        [
            { language: 'javascript' },
            { language: 'typescript' },
            { language: 'javascriptreact' },
            { language: 'typescriptreact' }
        ],
        {
            provideInlineCompletionItems(document, position) {
                const wordRange = document.getWordRangeAtPosition(position, /[\w]+/);
                if (!wordRange) { return []; }
                const word = document.getText(wordRange);
                if (word.length < 3) { return []; }
                const wordLower = word.toLowerCase();

                // 辞書から前方一致で候補を探す（短い順）
                const candidates = Object.entries(jsMethods)
                    .filter(([key]) => key.toLowerCase().startsWith(wordLower))
                    .sort(([a], [b]) => a.length - b.length);

                if (candidates.length === 0) { return []; }

                // 上位3件をゴーストテキストとして返す
                return candidates.slice(0, 3).map(([key]) =>
                    new vscode.InlineCompletionItem(`${key}()`, wordRange)
                );
            }
        }
    );
    context.subscriptions.push(provider);
}
