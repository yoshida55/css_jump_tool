"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractPhpFunctionsFromMemo = extractPhpFunctionsFromMemo;
exports.getCachedPhpFunctions = getCachedPhpFunctions;
exports.registerPhpCompletionProvider = registerPhpCompletionProvider;
const vscode = require("vscode");
const fs = require("fs");
// メモから抽出したPHP/WP関数キャッシュ
let cachedFunctions = null;
/**
 * メモファイルからPHP/WP関数名を抽出する
 */
function extractPhpFunctionsFromMemo(memoContent) {
    const functions = [];
    const seen = new Set();
    const lines = memoContent.split('\n');
    // WP/PHP関数のパターン
    const funcPattern = /\b((?:wp_|WP_|get_|the_|is_|have_|add_|remove_|do_|apply_|register_|unregister_|setup_|query_|wc_|esc_|sanitize_)\w+)\b/g;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineRegex = new RegExp(funcPattern.source, 'g');
        let match;
        while ((match = lineRegex.exec(line)) !== null) {
            const name = match[1];
            if (seen.has(name) || name.length < 4) {
                continue;
            }
            seen.add(name);
            // 前後2行をdescriptionとして取得
            const start = Math.max(0, i - 1);
            const end = Math.min(lines.length, i + 3);
            const description = lines.slice(start, end)
                .map(l => l.replace(/^[#\-\*\s]+/, '').trim())
                .filter(l => l.length > 0)
                .join('\n');
            functions.push({ name, description });
            // wp_* 関数はプレフィックスなしのエイリアスも追加
            // 例: "enqueue_style" と打っても "wp_enqueue_style" が出る
            const aliasMatch = name.match(/^(wp_|WP_)(.+)/);
            if (aliasMatch) {
                const alias = aliasMatch[2];
                if (!seen.has(alias) && alias.length >= 4) {
                    seen.add(alias);
                    functions.push({ name: alias, description, insertText: name });
                }
            }
        }
    }
    return functions;
}
function getCachedPhpFunctions() {
    return cachedFunctions;
}
/**
 * PHPファイル用の途中一致補完プロバイダーを登録する
 */
function registerPhpCompletionProvider(context) {
    // デバッグ用コマンド：抽出された関数数を確認
    const debugCmd = vscode.commands.registerCommand('cssToHtmlJumper.debugPhpCompletion', () => {
        const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
        const memoFilePath = config.get('memoFilePath', '');
        if (!memoFilePath || !fs.existsSync(memoFilePath)) {
            vscode.window.showErrorMessage(`メモファイルが見つかりません: ${memoFilePath}`);
            return;
        }
        const memoContent = fs.readFileSync(memoFilePath, 'utf-8');
        const functions = extractPhpFunctionsFromMemo(memoContent);
        vscode.window.showInformationMessage(`PHP補完: ${functions.length}件の関数を抽出しました（例: ${functions.slice(0, 3).map(f => f.name).join(', ')}）`);
    });
    context.subscriptions.push(debugCmd);
    const provider = vscode.languages.registerCompletionItemProvider('php', {
        provideCompletionItems(document, position) {
            // メモファイルを読み込む（キャッシュあれば再利用）
            if (!cachedFunctions) {
                const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
                const memoFilePath = config.get('memoFilePath', '');
                if (!memoFilePath || !fs.existsSync(memoFilePath)) {
                    return [];
                }
                const memoContent = fs.readFileSync(memoFilePath, 'utf-8');
                cachedFunctions = extractPhpFunctionsFromMemo(memoContent);
            }
            // カーソル位置の単語を取得
            const wordRange = document.getWordRangeAtPosition(position, /[\w_]+/);
            if (!wordRange) {
                return [];
            }
            const word = document.getText(wordRange).toLowerCase();
            if (word.length < 2) {
                return [];
            }
            // 途中一致でフィルタ（先頭一致を上位に）
            return cachedFunctions
                .filter(f => f.name.toLowerCase().includes(word))
                .map(f => {
                const actualInsert = f.insertText || f.name;
                const label = f.insertText ? `${f.name} → ${f.insertText}` : f.name;
                const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Function);
                item.detail = '📖 メモより';
                item.documentation = new vscode.MarkdownString(f.description);
                item.insertText = new vscode.SnippetString(`${actualInsert}($1)$0`);
                // "!" は英字より前に並ぶのでメモ補完を上位表示
                const isPrefix = f.name.toLowerCase().startsWith(word);
                item.sortText = (isPrefix ? '!0_' : '!1_') + f.name;
                return item;
            });
        }
    });
    // メモ保存時にキャッシュをリセット
    const watcher = vscode.workspace.onDidSaveTextDocument(doc => {
        const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
        const memoFilePath = config.get('memoFilePath', '');
        if (doc.uri.fsPath === memoFilePath) {
            cachedFunctions = null;
        }
    });
    context.subscriptions.push(provider, watcher);
}
//# sourceMappingURL=phpCompletionProvider.js.map