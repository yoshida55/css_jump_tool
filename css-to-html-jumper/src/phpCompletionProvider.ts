import * as vscode from 'vscode';
import * as fs from 'fs';
import { phpFunctions } from './phpProperties';

export interface PhpFunction {
    name: string;
    description: string;
    insertText?: string; // エイリアス用（例: "enqueue_style" → 挿入は "wp_enqueue_style"）
}

// メモから抽出したPHP/WP関数キャッシュ
let cachedFunctions: PhpFunction[] | null = null;

/**
 * メモファイルからPHP/WP関数名を抽出する
 */
export function extractPhpFunctionsFromMemo(memoContent: string): PhpFunction[] {
    const functions: PhpFunction[] = [];
    const seen = new Set<string>();
    const lines = memoContent.split('\n');

    // WP/PHP関数のパターン
    const funcPattern = /\b((?:wp_|WP_|get_|the_|is_|have_|add_|remove_|do_|apply_|register_|unregister_|setup_|query_|wc_|esc_|sanitize_)\w+)\b/g;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineRegex = new RegExp(funcPattern.source, 'g');
        let match;

        while ((match = lineRegex.exec(line)) !== null) {
            const name = match[1];
            if (seen.has(name) || name.length < 4) { continue; }
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

export function getCachedPhpFunctions(): PhpFunction[] | null {
    return cachedFunctions;
}

/**
 * PHPファイル用の途中一致補完プロバイダーを登録する
 */
export function registerPhpCompletionProvider(context: vscode.ExtensionContext) {
    // デバッグ用コマンド：抽出された関数数を確認
    const debugCmd = vscode.commands.registerCommand('cssToHtmlJumper.debugPhpCompletion', () => {
        const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
        const memoFilePath = config.get<string>('memoFilePath', '');
        if (!memoFilePath || !fs.existsSync(memoFilePath)) {
            vscode.window.showErrorMessage(`メモファイルが見つかりません: ${memoFilePath}`);
            return;
        }
        const memoContent = fs.readFileSync(memoFilePath, 'utf-8');
        const functions = extractPhpFunctionsFromMemo(memoContent);
        vscode.window.showInformationMessage(`PHP補完: ${functions.length}件の関数を抽出しました（例: ${functions.slice(0, 3).map(f => f.name).join(', ')}）`);
    });
    context.subscriptions.push(debugCmd);

    const provider = vscode.languages.registerCompletionItemProvider(
        'php',
        {
            provideCompletionItems(document, position) {
                // メモファイルを読み込む（キャッシュあれば再利用。なくても辞書補完は動く）
                if (!cachedFunctions) {
                    const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
                    const memoFilePath = config.get<string>('memoFilePath', '');
                    if (memoFilePath && fs.existsSync(memoFilePath)) {
                        const memoContent = fs.readFileSync(memoFilePath, 'utf-8');
                        cachedFunctions = extractPhpFunctionsFromMemo(memoContent);
                    } else {
                        cachedFunctions = []; // メモなしでも辞書補完は続行
                    }
                }

                // カーソル位置の単語を取得
                const wordRange = document.getWordRangeAtPosition(position, /[\w_]+/);
                if (!wordRange) { return []; }
                const word = document.getText(wordRange).toLowerCase();
                if (word.length < 2) { return []; }

                // メモ由来の補完（途中一致）
                const memoItems = cachedFunctions
                    .filter(f => f.name.toLowerCase().includes(word))
                    .map(f => {
                        const actualInsert = f.insertText || f.name;
                        const label = f.insertText ? `${f.name} → ${f.insertText}` : f.name;
                        const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Function);
                        item.detail = '📖 メモより';
                        item.documentation = new vscode.MarkdownString(f.description);
                        item.insertText = new vscode.SnippetString(`${actualInsert}($1)$0`);
                        const isPrefix = f.name.toLowerCase().startsWith(word);
                        item.sortText = (isPrefix ? '!0_' : '!1_') + f.name;
                        return item;
                    });

                // phpProperties.ts 辞書由来の補完（途中一致）
                const memoNames = new Set(memoItems.map(i => (i.label as string).split(' → ')[0]));
                const dictItems = Object.entries(phpFunctions)
                    .filter(([key]) => key.toLowerCase().includes(word) && !memoNames.has(key))
                    .map(([key, info]) => {
                        // frequent な関数はプレフィックスを除いたラベルにして前方一致させる
                        // 例: get_theme_file_uri → ラベル "theme_file_uri"、挿入は "get_theme_file_uri()"
                        const stripped = key.replace(/^(get_|the_|wp_|is_|have_|add_|do_|apply_|register_|setup_|remove_|wc_|esc_|sanitize_)/, '');
                        const useShortLabel = info.frequent && stripped !== key && stripped.toLowerCase().includes(word);
                        const label = useShortLabel ? stripped : key;
                        const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Function);
                        item.detail = useShortLabel
                            ? `📚 → ${key}`
                            : (info.category ? `📚 ${info.category}` : '📚 PHP/WP辞書');
                        let doc = `**${key}**\n\n` + info.description;
                        if (info.params?.length) { doc += '\n\n**引数**: ' + info.params.join(' \\ '); }
                        if (info.returns) { doc += '\n\n**戻り値**: ' + info.returns; }
                        if (info.tips?.length) { doc += '\n\n💡 ' + info.tips.join('\n\n💡 '); }
                        item.documentation = new vscode.MarkdownString(doc);
                        item.insertText = new vscode.SnippetString(`${key}($1)$0`);
                        item.filterText = label;
                        const isPrefix = label.toLowerCase().startsWith(word);
                        // \x00 = 最低文字コード → どのプロバイダーより前に並ぶ
                        const rank = info.frequent ? '\x00\x00' : (isPrefix ? '\x00\x01' : '\x00\x02');
                        item.sortText = rank + label;
                        if (info.frequent && isPrefix) { item.preselect = true; }
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
            cachedFunctions = null;
        }
    });

    context.subscriptions.push(provider, watcher);
}

/**
 * PHPファイル用のゴーストテキスト（インライン補完）プロバイダーを登録する
 * Intelephense と競合しないドロップダウン外の補完
 */
export function registerPhpInlineCompletionProvider(context: vscode.ExtensionContext) {
    const provider = vscode.languages.registerInlineCompletionItemProvider(
        { language: 'php' },
        {
            provideInlineCompletionItems(document, position) {
                const wordRange = document.getWordRangeAtPosition(position, /[\w_]+/);
                if (!wordRange) { return []; }
                const word = document.getText(wordRange);
                if (word.length < 3) { return []; }
                const wordLower = word.toLowerCase();

                // frequent 関数から前方一致で候補を探す（短い順）
                const candidates = Object.entries(phpFunctions)
                    .filter(([key, info]) => info.frequent && key.toLowerCase().startsWith(wordLower))
                    .sort(([a], [b]) => a.length - b.length);

                if (candidates.length === 0) { return []; }

                // 上位3件をゴーストテキストとして返す（Alt+] で切り替え可能）
                return candidates.slice(0, 3).map(([key]) =>
                    new vscode.InlineCompletionItem(`${key}()`, wordRange)
                );
            }
        }
    );
    context.subscriptions.push(provider);
}
