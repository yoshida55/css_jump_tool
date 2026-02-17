// 右クリックメニューを作成（トップレベルに直接表示）
chrome.runtime.onInstalled.addListener(function() {
  // 既存のメニューをクリア
  chrome.contextMenus.removeAll(function() {
    chrome.contextMenus.create({
      id: "toggleSizeDisplay",
      title: "📐 CSS Jumper: サイズ表示",
      contexts: ["all"]
    });
    
    chrome.contextMenus.create({
      id: "toggleSpacingDisplay",
      title: "↕️ CSS Jumper: 距離表示",
      contexts: ["all"]
    });
    
    // セクション枠表示の親メニュー
    chrome.contextMenus.create({
      id: "showSectionOutline",
      title: "🔲 CSS Jumper: セクション枠を表示",
      contexts: ["all"]
    });
    
    console.log("CSS Jumper: メニュー作成完了");
  });
});

// 右クリックメニューがクリックされた時の処理
chrome.contextMenus.onClicked.addListener(function(info, tab) {
  console.log("CSS Jumper: メニュークリック", info.menuItemId);
  
  if (info.menuItemId === "toggleSizeDisplay") {
    // 保存されたビューポート幅を取得してウィンドウをリサイズ
    chrome.storage.local.get(["targetViewportWidth"], function(result) {
      var targetWidth = result.targetViewportWidth || 1280;
      
      // 精密なリサイズ（リトライあり）
      resizeToTargetViewport(tab.id, tab.windowId, targetWidth, 1, function() {
        chrome.tabs.sendMessage(tab.id, { action: "toggleSizeDisplay" }, function(response) {
          if (chrome.runtime.lastError) {
            console.error("CSS Jumper: toggleSizeDisplay送信エラー", chrome.runtime.lastError);
            notifyUserToTab(tab.id, "ページをリロードしてください（F5）", "error");
          }
        });
      });
    });
  }
  
  if (info.menuItemId === "toggleSpacingDisplay") {
    // 保存されたビューポート幅を取得してウィンドウをリサイズ
    chrome.storage.local.get(["targetViewportWidth"], function(result) {
      var targetWidth = result.targetViewportWidth || 1280;
      
      // 精密なリサイズ（リトライあり）
      resizeToTargetViewport(tab.id, tab.windowId, targetWidth, 1, function() {
        chrome.tabs.sendMessage(tab.id, { action: "toggleSpacingDisplay" }, function(response) {
          if (chrome.runtime.lastError) {
            console.error("CSS Jumper: toggleSpacingDisplay送信エラー", chrome.runtime.lastError);
            notifyUserToTab(tab.id, "ページをリロードしてください（F5）", "error");
          }
        });
      });
    });
  }
  
  // セクション枠を表示
  if (info.menuItemId === "showSectionOutline") {
    // content.jsにセクション一覧を要求
    chrome.tabs.sendMessage(tab.id, { action: "getSectionList" }, function(response) {
      if (chrome.runtime.lastError) {
        console.error("CSS Jumper: getSectionList送信エラー", chrome.runtime.lastError);
        notifyUserToTab(tab.id, "ページをリロードしてください（F5）", "error");
        return;
      }
      
      if (response && response.sections && response.sections.length > 0) {
        // 既存のサブメニューを削除（存在しなくてもエラーにしない）
        response.sections.forEach(function(section, index) {
          chrome.contextMenus.remove("section_" + index, function() {
            if (chrome.runtime.lastError) { /* 無視 */ }
          });
        });
        chrome.contextMenus.remove("section_all", function() {
          if (chrome.runtime.lastError) { /* 無視 */ }
        });
        
        // サブメニューを作成
        response.sections.forEach(function(section, index) {
          chrome.contextMenus.create({
            id: "section_" + index,
            parentId: "showSectionOutline",
            title: section.tag + (section.className ? "." + section.className : ""),
            contexts: ["all"]
          }, function() {
            if (chrome.runtime.lastError) { /* 重複は無視 */ }
          });
        });
        
        // 全セクション表示オプション
        chrome.contextMenus.create({
          id: "section_all",
          parentId: "showSectionOutline",
          title: "📋 全セクション",
          contexts: ["all"]
        }, function() {
          if (chrome.runtime.lastError) { /* 重複は無視 */ }
        });
        
        // メニューを再表示するために右クリックを促す通知
        notifyUserToTab(tab.id, "セクション一覧を取得しました。もう一度右クリックしてサブメニューから選択してください", "info");
      } else {
        notifyUserToTab(tab.id, "セクションが見つかりませんでした", "error");
      }
    });
  }
  
  // セクションサブメニューがクリックされた場合
  if (info.menuItemId && info.menuItemId.startsWith("section_")) {
    chrome.tabs.sendMessage(tab.id, { 
      action: "showSectionOutline", 
      sectionId: info.menuItemId 
    }, function(response) {
      if (chrome.runtime.lastError) {
        console.error("CSS Jumper: showSectionOutline送信エラー", chrome.runtime.lastError);
      }
    });
  }
});


// 最小ウィンドウ幅（これ以下に縮めない）
var MIN_WINDOW_WIDTH = 400;

// 精密なビューポートリサイズ関数（クローム幅計算 + 微調整）
function resizeToTargetViewport(tabId, windowId, targetViewportWidth, attempt, callback) {
  chrome.windows.get(windowId, function(win) {
    chrome.tabs.sendMessage(tabId, { action: "getViewportInfo" }, function(response) {
      if (chrome.runtime.lastError || !response) {
        // フォールバック：推定値でリサイズ
        var fallbackWindowWidth = Math.max(targetViewportWidth + 87, MIN_WINDOW_WIDTH);
        chrome.windows.update(windowId, { width: fallbackWindowWidth }, function() {
          setTimeout(callback, 300);
        });
        return;
      }
      
      var currentViewport = response.viewportWidth;
      
      // ピッタリ一致したらコールバック
      if (currentViewport === targetViewportWidth) {
        callback();
        return;
      }
      
      var targetWindowWidth;
      
      if (attempt === 1) {
        // 初回：クローム幅を計算して絶対値でリサイズ
        var chromeWidth = win.width - currentViewport;
        targetWindowWidth = Math.max(targetViewportWidth + chromeWidth, MIN_WINDOW_WIDTH);
        
        console.log("CSS Jumper: 初回リサイズ", {
          currentWindow: win.width,
          currentViewport: currentViewport,
          chromeWidth: chromeWidth,
          targetViewport: targetViewportWidth,
          targetWindow: targetWindowWidth
        });
      } else {
        // リトライ：直接ピクセル差分で微調整
        var diff = currentViewport - targetViewportWidth;
        targetWindowWidth = Math.max(win.width - diff, MIN_WINDOW_WIDTH);
        
        console.log("CSS Jumper: 微調整リトライ", {
          attempt: attempt,
          currentViewport: currentViewport,
          diff: diff,
          targetWindow: targetWindowWidth
        });
      }
      
      chrome.windows.update(windowId, { width: targetWindowWidth }, function() {
        setTimeout(function() {
          chrome.tabs.sendMessage(tabId, { action: "getViewportInfo" }, function(resp2) {
            var newViewport = resp2 ? resp2.viewportWidth : targetViewportWidth;
            var newDiff = Math.abs(newViewport - targetViewportWidth);
            
            // まだずれていて、リトライ回数が残っていれば再試行
            if (newDiff > 0 && attempt < 5) {
              resizeToTargetViewport(tabId, windowId, targetViewportWidth, attempt + 1, callback);
            } else {
              callback();
            }
          });
        }, 150);
      });
    });
  });
}
// content.jsからのメッセージを受信
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  console.log("CSS Jumper: メッセージ受信", message);
  
  if (message.action === "classNameResult") {
    handleSelectorInfo(message.id, message.className, message.allClasses, message.viewportWidth);
  }
  
  // AIアドバイスリクエスト
  if (message.action === "aiAdviceRequest") {
    handleAiAdviceRequest(message, sender, sendResponse);
    return true; // 非同期レスポンスのため
  }

  // クイックリサイズ
  if (message.action === "quickResize") {
    handleQuickResize(message, sender, sendResponse);
    return true; // 非同期レスポンスのため
  }
  
  // セクションメニューを事前にロード
  if (message.action === "preloadSectionMenu") {
    var sections = message.sections;
    if (sections && sections.length > 0) {
      // 既存のサブメニューを削除（存在しなくてもエラーにしない）
      for (var i = 0; i < 20; i++) {
        chrome.contextMenus.remove("section_" + i, function() {
          if (chrome.runtime.lastError) { /* 無視 */ }
        });
      }
      chrome.contextMenus.remove("section_all", function() {
        if (chrome.runtime.lastError) { /* 無視 */ }
      });
      
      // 少し待ってからサブメニューを作成
      setTimeout(function() {
        sections.forEach(function(section, index) {
          chrome.contextMenus.create({
            id: "section_" + index,
            parentId: "showSectionOutline",
            title: section.tag + (section.className ? "." + section.className : ""),
            contexts: ["all"]
          }, function() {
            if (chrome.runtime.lastError) {
              // 重複エラーは無視
            }
          });
        });
        
        // 全セクション表示オプション
        chrome.contextMenus.create({
          id: "section_all",
          parentId: "showSectionOutline",
          title: "📋 全セクション",
          contexts: ["all"]
        }, function() {
          if (chrome.runtime.lastError) {
            // 重複エラーは無視
          }
        });
        
        console.log("CSS Jumper: セクションメニュー事前ロード完了", sections.length + "件");
      }, 100);
    }
  }
});

// クイックリサイズ処理（クローム幅ベース）
function handleQuickResize(message, sender, sendResponse) {
  chrome.storage.local.get(["quickResizeWidth"], function(result) {
    var targetWidth = result.quickResizeWidth || 1400;
    var tabId = sender.tab.id;
    var windowId = sender.tab.windowId;
    
    // 現在のウィンドウ情報とビューポート情報を取得
    chrome.windows.get(windowId, function(win) {
      chrome.tabs.sendMessage(tabId, { action: "getViewportInfo" }, function(response) {
        if (chrome.runtime.lastError || !response) {
          sendResponse({ success: false, error: "ビューポート情報取得失敗" });
          return;
        }
        
        var currentViewport = response.viewportWidth;
        var chromeWidth = win.width - currentViewport;
        
        if (message.isActive) {
          // 元に戻す（保存された元のビューポート幅を使用）
          var originalViewportWidth = message.originalWidth;
          if (originalViewportWidth) {
            var targetWindowWidth = Math.max(originalViewportWidth + chromeWidth, MIN_WINDOW_WIDTH);
            
            chrome.windows.update(windowId, { width: targetWindowWidth }, function() {
              sendResponse({ success: true });
            });
          } else {
            sendResponse({ success: false });
          }
        } else {
          // ターゲット幅にリサイズ
          var originalViewportWidth = currentViewport;
          var targetWindowWidth = Math.max(targetWidth + chromeWidth, MIN_WINDOW_WIDTH);
          
          console.log("CSS Jumper: クイックリサイズ", {
            currentWindow: win.width,
            currentViewport: currentViewport,
            chromeWidth: chromeWidth,
            targetViewport: targetWidth,
            targetWindow: targetWindowWidth
          });
          
          chrome.windows.update(windowId, { width: targetWindowWidth }, function() {
            sendResponse({ success: true, originalWidth: originalViewportWidth, targetWidth: targetWidth });
          });
        }
      });
    });
  });
}

// セレクタ情報（ID, クラス）を処理（最新のCSS内容を取得してから検索）
async function handleSelectorInfo(id, className, allClasses, viewportWidth) {
  // モバイル幅（768px未満）の場合はメディアクエリ内を優先
  var preferMediaQuery = viewportWidth && viewportWidth < 768;
  console.log("CSS Jumper: セレクタ情報処理開始", { id: id, className: className, viewportWidth: viewportWidth, preferMediaQuery: preferMediaQuery });
  
  if (!id && !className) {
    notifyUser("IDまたはクラスが見つかりません（適用されている要素を右クリックしてください）", "error");
    return;
  }

  // 保存されたCSS情報を取得
  var result;
  try {
    result = await chrome.storage.local.get(["projectPath", "cssFiles"]);
  } catch (e) {
    console.error("CSS Jumper: ストレージアクセスエラー", e);
    notifyUser("設定の読み込みに失敗しました", "error");
    return;
  }
  
  var projectPath = result.projectPath;
  var cssFiles = result.cssFiles || [];
  
  if (!projectPath) {
    notifyUser("⚠️ プロジェクトパスが未設定です\n拡張機能アイコンをクリックして設定してください", "error");
    return;
  }
  
  if (cssFiles.length === 0) {
    notifyUser("⚠️ CSSファイルが未読み込みです\n拡張機能アイコンをクリックしてCSSを選択してください", "error");
    return;
  }

  // 各CSSファイルの最新内容をLive Serverから取得
  var refreshedCssFiles = await refreshCssContents(cssFiles, projectPath);
  
  // 除外ファイルをフィルタリング
  var excludeFiles = ["reset.css", "normalize.css", "sanitize.css"];
  var targetCssFiles = refreshedCssFiles.filter(function(file) {
    for (var e = 0; e < excludeFiles.length; e++) {
      if (file.name.toLowerCase() === excludeFiles[e].toLowerCase()) {
        return false;
      }
    }
    return true;
  });
  
  console.log("CSS Jumper: 最新CSS取得完了", { 
    projectPath: projectPath, 
    allFilesCount: refreshedCssFiles.length,
    targetFilesCount: targetCssFiles.length,
    targetFileNames: targetCssFiles.map(function(f) { return f.name; })
  });

  // 1. IDで検索（最優先）
  if (id) {
    var idResult = searchSelectorInCss(id, "id", targetCssFiles, projectPath, preferMediaQuery);
    if (idResult) {
      // CSS + HTMLの3点連携
      var htmlResult = await searchInHtml(id, "id", projectPath);

      // HTML を先に開く（見つかった場合）
      if (htmlResult) {
        openInVscode(htmlResult.filePath, htmlResult.lineNumber);
        // HTMLファイルの該当行をハイライト（少し遅延）
        setTimeout(function() {
          highlightLineInVSCode(htmlResult.filePath, htmlResult.lineNumber);
        }, 200);
        // 少し遅延してからCSS を開く（CSSがアクティブになる）
        setTimeout(function() {
          openInVscode(idResult.filePath, idResult.lineNumber);
          // CSS行を中央にスクロール＋ハイライト
          setTimeout(function() {
            highlightLineInVSCode(idResult.filePath, idResult.lineNumber);
          }, 300);
        }, 100);
        notifyUser("✓ #" + id + " → CSS:" + idResult.fileName + ":" + idResult.lineNumber + " / HTML:" + htmlResult.fileName + ":" + htmlResult.lineNumber, "success");
      } else {
        // HTMLが見つからない場合はCSSのみ
        openInVscode(idResult.filePath, idResult.lineNumber);
        // CSS行を中央にスクロール＋ハイライト
        setTimeout(function() {
          highlightLineInVSCode(idResult.filePath, idResult.lineNumber);
        }, 300);
        notifyUser("✓ #" + id + " → " + idResult.fileName + ":" + idResult.lineNumber, "success");
      }

      // ブラウザハイライト（3秒間）
      triggerBrowserHighlight(id, "id");

      return;
    }
  }

  // 2. クラス名で検索
  if (className) {
    var classResult = searchSelectorInCss(className, "class", targetCssFiles, projectPath, preferMediaQuery);

    if (classResult) {
      // CSS + HTMLの3点連携
      var htmlResult = await searchInHtml(className, "class", projectPath);

      // HTML を先に開く（見つかった場合）
      if (htmlResult) {
        openInVscode(htmlResult.filePath, htmlResult.lineNumber);
        // HTMLファイルの該当行をハイライト（少し遅延）
        setTimeout(function() {
          highlightLineInVSCode(htmlResult.filePath, htmlResult.lineNumber);
        }, 200);
        // 少し遅延してからCSS を開く（CSSがアクティブになる）
        setTimeout(function() {
          openInVscode(classResult.filePath, classResult.lineNumber);
          // CSS行を中央にスクロール＋ハイライト
          setTimeout(function() {
            highlightLineInVSCode(classResult.filePath, classResult.lineNumber);
          }, 300);
        }, 100);
        notifyUser("✓ ." + className + " → CSS:" + classResult.fileName + ":" + classResult.lineNumber + " / HTML:" + htmlResult.fileName + ":" + htmlResult.lineNumber, "success");
      } else {
        // HTMLが見つからない場合はCSSのみ
        openInVscode(classResult.filePath, classResult.lineNumber);
        // CSS行を中央にスクロール＋ハイライト
        setTimeout(function() {
          highlightLineInVSCode(classResult.filePath, classResult.lineNumber);
        }, 300);
        notifyUser("✓ ." + className + " → " + classResult.fileName + ":" + classResult.lineNumber, "success");
      }

      // ブラウザハイライト（3秒間）
      triggerBrowserHighlight(className, "class");

      return;
    }
  }

  // 3. 見つからない場合、全クラスで再検索
  if (allClasses && allClasses.length > 0) {
    for (var i = 0; i < allClasses.length; i++) {
      var cls = allClasses[i];
      if (cls === className) continue;

      var altResult = searchSelectorInCss(cls, "class", targetCssFiles, projectPath, preferMediaQuery);
      if (altResult) {
        // CSS + HTMLの3点連携
        var htmlResult = await searchInHtml(cls, "class", projectPath);

        // HTML を先に開く（見つかった場合）
        if (htmlResult) {
          openInVscode(htmlResult.filePath, htmlResult.lineNumber);
          // HTMLファイルの該当行をハイライト（少し遅延）
          setTimeout(function() {
            highlightLineInVSCode(htmlResult.filePath, htmlResult.lineNumber);
          }, 200);
          // 少し遅延してからCSS を開く（CSSがアクティブになる）
          setTimeout(function() {
            openInVscode(altResult.filePath, altResult.lineNumber);
            // CSS行を中央にスクロール＋ハイライト
            setTimeout(function() {
              highlightLineInVSCode(altResult.filePath, altResult.lineNumber);
            }, 300);
          }, 100);
          notifyUser("✓ ." + cls + " → CSS:" + altResult.fileName + ":" + altResult.lineNumber + " / HTML:" + htmlResult.fileName + ":" + htmlResult.lineNumber, "success");
        } else {
          // HTMLが見つからない場合はCSSのみ
          openInVscode(altResult.filePath, altResult.lineNumber);
          // CSS行を中央にスクロール＋ハイライト
          setTimeout(function() {
            highlightLineInVSCode(altResult.filePath, altResult.lineNumber);
          }, 300);
          notifyUser("✓ ." + cls + " → " + altResult.fileName + ":" + altResult.lineNumber, "success");
        }

        // ブラウザハイライト（3秒間）
        triggerBrowserHighlight(cls, "class");

        return;
      }
    }
  }
    
  // 検索失敗時に詳細情報を表示
  var fileNames = targetCssFiles.map(function(f) { return f.name; }).join(", ");
  var targetName = id ? "#" + id : "." + className;
  notifyUser("「" + targetName + "」が見つかりません\n検索対象: " + fileNames, "error");
}

// CSSファイルの内容をLive Serverから取得して更新
async function refreshCssContents(cssFiles, projectPath) {
  var refreshedFiles = [];
  
  for (var i = 0; i < cssFiles.length; i++) {
    var file = cssFiles[i];
    var refreshedFile = Object.assign({}, file);
    
    try {
      // Live ServerのURLを構築（相対パスから）
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs[0] && tabs[0].url) {
        var pageUrl = new URL(tabs[0].url);
        var baseUrl = pageUrl.origin;
        var cssUrl = baseUrl + "/" + file.relativePath;
        
        console.log("CSS Jumper: CSS取得中", cssUrl);
        
        var response = await fetch(cssUrl, { cache: "no-store" });
        if (response.ok) {
          var content = await response.text();
          refreshedFile.content = content;
          refreshedFile.lines = content.split("\n").length;
          console.log("CSS Jumper: CSS更新成功", file.name, refreshedFile.lines + "行");
        }
      }
    } catch (e) {
      console.warn("CSS Jumper: CSS取得失敗、キャッシュを使用", file.name, e);
      // 取得失敗時は元のキャッシュを使用
    }
    
    refreshedFiles.push(refreshedFile);
  }
  
  return refreshedFiles;
}

// CSSファイル内でクラス名を検索
// CSSファイル内でセレクタ（ID/クラス）を検索
// preferMediaQuery: trueの場合、@media内のマッチを優先
function searchSelectorInCss(selector, type, cssFiles, projectPath, preferMediaQuery) {
  var firstMatch = null;  // 最初に見つかったマッチ（フォールバック用）
  var mediaMatch = null;  // メディアクエリ内で見つかったマッチ
  
  for (var f = 0; f < cssFiles.length; f++) {
    var file = cssFiles[f];
    
    // ファイル内容がない場合はスキップ
    if (!file.content) {
      console.warn("CSS Jumper: ファイル内容がありません", file.name);
      continue;
    }
    
    var lines = file.content.split("\n");
    
    // 正規表現の構築
    // IDの場合: #id-name
    // クラスの場合: .class-name
    var prefix = type === "id" ? "#" : "\\.";
    var regex = new RegExp(prefix + "(" + escapeRegex(selector) + ")(?:\\s*[{,:\\[]|\\s*$)", "i");
    
    // スタック方式で波括弧の深さと@media位置を追跡（ネスト対応）
    var braceDepth = 0;
    var mediaStack = [];  // @mediaのネストをスタックで管理

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // 波括弧をカウント
      var openBraces = (line.match(/{/g) || []).length;
      var closeBraces = (line.match(/}/g) || []).length;

      // @media の開始を検出 → スタックにpush
      if (/@media\s/.test(line)) {
        mediaStack.push(braceDepth);
      }

      // 波括弧による深さ更新（この行の開き括弧を加算）
      braceDepth += openBraces;

      // 現在@media内かどうかを判定（スタックに要素があれば@media内）
      var isInMediaQuery = mediaStack.length > 0 && braceDepth > mediaStack[mediaStack.length - 1];
      
      if (regex.test(line)) {
        // パスを構築
        var filePath;
        if (file.relativePath && file.relativePath !== file.name) {
          filePath = projectPath + "/" + file.relativePath;
        } else {
          filePath = projectPath + "/css/" + file.name;
        }
        filePath = filePath.replace(/\\/g, "/").replace(/\/+/g, "/");
        
        var matchResult = {
          filePath: filePath,
          fileName: file.name,
          lineNumber: i + 1,
          lineContent: line.trim(),
          isInMediaQuery: isInMediaQuery
        };
        
        // 最初のマッチを記録
        if (!firstMatch) {
          firstMatch = matchResult;
        }
        
        // メディアクエリ内のマッチを記録（優先モード時）
        if (preferMediaQuery && isInMediaQuery && !mediaMatch) {
          mediaMatch = matchResult;
          console.log("CSS Jumper: メディアクエリ内マッチ発見", { selector: selector, line: i + 1, braceDepth: braceDepth });
        }
        
        // 優先モードでない場合、または最初のマッチがメディアクエリ外なら即座に返す
        if (!preferMediaQuery) {
          console.log("CSS Jumper: マッチ発見", { selector: selector, type: type, file: file.name, line: i + 1, filePath: filePath });
          return matchResult;
        }
      }
      
      // 波括弧による深さ更新（この行の閉じ括弧を減算）
      braceDepth -= closeBraces;
      
      // 閉じた@mediaをスタックから除去
      while (mediaStack.length > 0 && braceDepth <= mediaStack[mediaStack.length - 1]) {
        mediaStack.pop();
      }
    }
  }
  
  // 優先モードの場合：メディアクエリ内マッチがあればそれを、なければ最初のマッチを返す
  if (preferMediaQuery && mediaMatch) {
    console.log("CSS Jumper: メディアクエリ優先マッチを返す", { selector: selector, line: mediaMatch.lineNumber });
    return mediaMatch;
  }
  
  if (firstMatch) {
    console.log("CSS Jumper: フォールバックマッチを返す", { selector: selector, line: firstMatch.lineNumber });
  }
  
  return firstMatch;
}

// 正規表現の特殊文字をエスケープ
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// AIアドバイス用: セレクタのCSSルール全体を抽出（最大3件）
function extractCssRulesForSelector(selector, type, cssFiles) {
  var results = [];
  var prefix = type === "id" ? "#" : "\\.";
  var regex = new RegExp(prefix + "(" + escapeRegex(selector) + ")(?:\\s*[{,:\\[]|\\s*$)", "i");

  for (var f = 0; f < cssFiles.length && results.length < 3; f++) {
    var file = cssFiles[f];
    if (!file.content) continue;

    var lines = file.content.split("\n");
    var braceDepth = 0;
    var inRule = false;
    var ruleSelectorLine = "";
    var ruleBody = [];
    var ruleStartDepth = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();

      // ルール内でない場合、セレクタを検索
      if (!inRule && regex.test(line)) {
        ruleSelectorLine = trimmed;
        inRule = true;
        ruleBody = [];
        ruleStartDepth = braceDepth;
      }

      // 波括弧をカウント
      var openBraces = (line.match(/{/g) || []).length;
      var closeBraces = (line.match(/}/g) || []).length;
      braceDepth += openBraces - closeBraces;

      // ルール内の場合、本体を収集
      if (inRule) {
        // セレクタ行の`{`以降を抽出
        if (ruleSelectorLine === trimmed && openBraces > 0) {
          var afterBrace = line.substring(line.indexOf("{") + 1).trim();
          if (afterBrace && afterBrace !== "}") {
            ruleBody.push(afterBrace);
          }
        } else if (trimmed && trimmed !== "{" && trimmed !== "}") {
          ruleBody.push(trimmed);
        }

        // ルール終了判定
        if (braceDepth <= ruleStartDepth) {
          results.push({
            selector: ruleSelectorLine,
            rules: ruleBody.join("\n")
          });
          inRule = false;
          if (results.length >= 3) break;
        }
      }
    }
  }

  return results;
}

// HTMLファイルでクラス名/IDを検索
async function searchInHtml(selector, type, projectPath) {
  try {
    // VS Codeから現在のプロジェクトパスを自動取得
    var actualProjectPath = projectPath; // フォールバック
    try {
      var vsCodeResponse = await fetch("http://127.0.0.1:3848/project-path");
      if (vsCodeResponse.ok) {
        var vsCodeData = await vsCodeResponse.json();
        if (vsCodeData.projectPath) {
          actualProjectPath = vsCodeData.projectPath;
          console.log("CSS Jumper: VS Codeからプロジェクトパス自動取得", actualProjectPath);
        }
      }
    } catch (e) {
      console.log("CSS Jumper: VS Code連携失敗、設定値を使用", projectPath);
    }

    // アクティブタブのURLから HTMLファイルを特定
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs[0] || !tabs[0].url) {
      console.log("CSS Jumper: アクティブタブが見つかりません");
      return null;
    }

    var pageUrl = new URL(tabs[0].url);
    var htmlFileName = pageUrl.pathname.split('/').pop() || 'index.html';

    // プロジェクトパスからHTMLファイルの絶対パスを作成
    var htmlFilePath = actualProjectPath + "\\" + htmlFileName;

    // HTMLファイルの内容を取得
    var htmlUrl = pageUrl.origin + "/" + htmlFileName;
    console.log("CSS Jumper: HTML検索中", htmlUrl, selector, type);

    var response = await fetch(htmlUrl, { cache: "no-store" });
    if (!response.ok) {
      console.log("CSS Jumper: HTML取得失敗", response.status);
      return null;
    }

    var content = await response.text();
    var lines = content.split("\n");

    // 検索パターン
    var searchPattern;
    if (type === "id") {
      searchPattern = new RegExp('id\\s*=\\s*["\']' + selector + '["\']', 'i');
    } else {
      // class検索（class="btn" または class="nav btn"のようなパターン）
      searchPattern = new RegExp('class\\s*=\\s*["\'][^"\']*\\b' + selector + '\\b[^"\']*["\']', 'i');
    }

    // 最初にマッチした行を返す
    for (var i = 0; i < lines.length; i++) {
      if (searchPattern.test(lines[i])) {
        console.log("CSS Jumper: HTML検索成功", htmlFileName, i + 1);
        return {
          filePath: htmlFilePath,
          fileName: htmlFileName,
          lineNumber: i + 1
        };
      }
    }

    console.log("CSS Jumper: HTML検索失敗", selector);
    return null;
  } catch (e) {
    console.error("CSS Jumper: HTML検索エラー", e);
    return null;
  }
}

// ブラウザで要素をハイライト（3秒間）
function triggerBrowserHighlight(selector, type) {
  console.log("CSS Jumper: ブラウザハイライト", selector, type);

  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "highlightElement",
        selector: selector,
        type: type
      }, function(response) {
        if (chrome.runtime.lastError) {
          console.error("CSS Jumper: ハイライトメッセージ送信エラー", chrome.runtime.lastError);
        }
      });
    }
  });
}

// VS Codeを開く（Native Messaging経由、code --goto方式）
function openInVscode(filePath, lineNumber) {
  // URLエンコードされたパスをデコード（日本語フォルダ対応）
  var decodedPath = decodeURIComponent(filePath);
  console.log("CSS Jumper: VS Codeを開く", decodedPath, lineNumber);

  chrome.runtime.sendNativeMessage(
    "com.cssjumper.open_vscode",
    { file: decodedPath, line: lineNumber },
    function(response) {
      if (chrome.runtime.lastError) {
        console.error("CSS Jumper: Native Messaging失敗", chrome.runtime.lastError.message);
        notifyUser("VS Codeを開けませんでした: " + chrome.runtime.lastError.message, "error");
      } else {
        console.log("CSS Jumper: Native Messaging成功", response);
      }
    }
  );
}

// VS Code拡張にHTTPリクエストを送ってハイライト表示
function highlightLineInVSCode(filePath, lineNumber) {
  // URLエンコードされたパスをデコード（日本語フォルダ対応）
  var decodedPath = decodeURIComponent(filePath);
  console.log("CSS Jumper: VS Code行ハイライト", decodedPath, lineNumber);

  fetch("http://127.0.0.1:3848/highlight-line", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filePath: decodedPath, lineNumber: lineNumber })
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    console.log("CSS Jumper: ハイライトリクエスト成功", data);
  })
  .catch(function(err) {
    console.log("CSS Jumper: ハイライトリクエスト失敗", err);
  });
}

// ユーザーに通知（アクティブタブへ）
function notifyUser(message, type) {
  console.log("CSS Jumper: 通知", message, type);
  
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (tabs[0]) {
      notifyUserToTab(tabs[0].id, message, type);
    }
  });
}

// ========================================
// AI CSSアドバイス機能
// ========================================

// content.jsからのAIアドバイスリクエストを処理
function handleAiAdviceRequest(message, sender, sendResponse) {
  chrome.storage.local.get(["claudeApiKey", "claudeModel", "cssFiles"], function(result) {
    var apiKey = result.claudeApiKey;
    var model = result.claudeModel || "claude-sonnet-4-5-20250929";
    var cssFiles = result.cssFiles || [];

    if (!apiKey) {
      sendResponse({ error: "API Keyが未設定です。拡張機能アイコンから設定してください。" });
      return;
    }

    var elementInfo = message.elementInfo;

    // CSSルールを検索
    var cssRules = [];
    if (cssFiles.length > 0) {
      // IDで検索
      if (elementInfo.id) {
        var idRules = extractCssRulesForSelector(elementInfo.id, "id", cssFiles);
        cssRules = cssRules.concat(idRules);
      }
      // クラスで検索（最初のクラスのみ）
      if (elementInfo.classList) {
        var firstClass = elementInfo.classList.split(" ")[0];
        if (firstClass) {
          var classRules = extractCssRulesForSelector(firstClass, "class", cssFiles);
          cssRules = cssRules.concat(classRules);
        }
      }
    }

    // プロンプト構築
    var prompt = buildAdvicePrompt(elementInfo, message.userQuestion, cssRules);

    // Claude API呼び出し
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 1024,
        messages: [
          { role: "user", content: prompt }
        ]
      })
    })
    .then(function(response) {
      if (!response.ok) {
        return response.text().then(function(text) {
          throw new Error("API Error " + response.status + ": " + text);
        });
      }
      return response.json();
    })
    .then(function(data) {
      var answer = data.content[0].text;
      sendResponse({ answer: answer });
    })
    .catch(function(err) {
      console.error("CSS Jumper: Claude API エラー", err);
      sendResponse({ error: err.message });
    });
  });
}

// AIアドバイス用プロンプト構築
function buildAdvicePrompt(info, userQuestion, cssRules) {
  var lines = [];
  lines.push("あなたはCSS/HTMLのエキスパートです。ユーザーがブラウザ上でクリックした要素について質問しています。");
  lines.push("簡潔に、具体的なCSSプロパティと値で回答してください。");
  lines.push("");
  lines.push("【クリックした要素】");
  lines.push("タグ: " + info.tagName);
  if (info.id) lines.push("ID: #" + info.id);
  if (info.classList) lines.push("クラス: ." + info.classList);
  lines.push("");

  // CSSソースコード（見つかった場合）
  if (cssRules && cssRules.length > 0) {
    lines.push("【CSSファイル内の該当ルール】");
    for (var i = 0; i < cssRules.length; i++) {
      lines.push(cssRules[i].selector + " {");
      lines.push(cssRules[i].rules);
      lines.push("}");
      if (i < cssRules.length - 1) lines.push("");
    }
    lines.push("");
  }

  lines.push("【要素のcomputedStyle（ブラウザ最終計算値）】");
  lines.push("display: " + info.display);
  lines.push("position: " + info.position);
  lines.push("width: " + info.width + " / height: " + info.height);
  lines.push("padding: " + info.padding);
  lines.push("margin: " + info.margin);
  lines.push("flex: " + info.flex);
  if (info.flexDirection) lines.push("flex-direction: " + info.flexDirection);
  if (info.justifyContent) lines.push("justify-content: " + info.justifyContent);
  if (info.alignItems) lines.push("align-items: " + info.alignItems);
  if (info.gap) lines.push("gap: " + info.gap);
  lines.push("overflow: " + info.overflow);
  lines.push("box-sizing: " + info.boxSizing);
  lines.push("");
  lines.push("【親要素】");
  lines.push("タグ: " + info.parentTagName);
  if (info.parentClass) lines.push("クラス: ." + info.parentClass);
  lines.push("display: " + info.parentDisplay);
  if (info.parentFlexDirection) lines.push("flex-direction: " + info.parentFlexDirection);
  lines.push("");
  lines.push("【ビューポート幅】 " + info.viewportWidth + "px");
  lines.push("");
  lines.push("【ユーザーの質問】");
  lines.push(userQuestion);
  lines.push("");
  lines.push("【回答ルール】");
  lines.push("- 具体的なCSSプロパティと値を提示");
  lines.push("- どのセレクタに適用するか明示（.クラス名 { ... }）");
  lines.push("- 理由を1行で添える");
  lines.push("- 日本語で回答");
  lines.push("- 200文字以内");

  return lines.join("\n");
}

// 特定タブに通知
function notifyUserToTab(tabId, message, type) {
  chrome.tabs.sendMessage(tabId, {
    action: "showNotification",
    message: message,
    type: type
  }, function() {
    if (chrome.runtime.lastError) {
      console.log("CSS Jumper: 通知送信失敗（ページリロードが必要）");
    }
  });
}

// Ctrl+Alt+F でFlex情報表示をトグル
chrome.commands.onCommand.addListener(function(command) {
  if (command === "toggleFlexInfo") {
    chrome.storage.local.get(["autoShowFlex"], function(result) {
      var currentState = result.autoShowFlex || false;
      var newState = !currentState;

      chrome.storage.local.set({ autoShowFlex: newState }, function() {
        console.log("CSS Jumper: Flex情報自動表示", newState ? "ON" : "OFF");

        // アクティブタブにトグル指示を送信
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: newState ? "showFlexInfo" : "removeFlexInfo"
            }, function(response) {
              if (chrome.runtime.lastError) {
                console.log("CSS Jumper: メッセージ送信失敗（ページリロードが必要）");
              } else {
                // 通知表示
                notifyUserToTab(tabs[0].id,
                  "Flex情報表示: " + (newState ? "ON ✓" : "OFF"),
                  "success");
              }
            });
          }
        });
      });
    });
  }

  if (command === "toggleBoxModel") {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: "toggleBoxModel"
        }, function(response) {
          if (chrome.runtime.lastError) {
            console.log("CSS Jumper: メッセージ送信失敗（ページリロードが必要）");
          }
        });
      }
    });
  }
});

// ========================================
// コンテンツスクリプトからのメッセージ処理
// ========================================
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  console.log("CSS Jumper background: メッセージ受信", request.action);

  if (request.action === "explainAndJump") {
    handleExplainAndJump(request, sender.tab.id, sendResponse);
    return true; // 非同期レスポンスを有効化
  }

  if (request.action === "resizeViewport") {
    resizeToViewport(request.width, request.height, sender.tab.id, sendResponse);
    return true;
  }

  if (request.action === "restoreWindow") {
    restoreWindow(request, sender.tab.id, sendResponse);
    return true;
  }
});

// 元のウィンドウサイズ・位置に復元
async function restoreWindow(request, tabId, sendResponse) {
  try {
    var tab = await chrome.tabs.get(tabId);
    await chrome.windows.update(tab.windowId, {
      width: request.width,
      height: request.height,
      left: request.left,
      top: request.top
    });
    sendResponse({ success: true });
  } catch (e) {
    console.error("CSS Jumper: 復元エラー", e);
    sendResponse({ success: false, error: e.message });
  }
}

// ビューポートサイズに合わせてウィンドウをリサイズ
async function resizeToViewport(targetWidth, targetHeight, tabId, sendResponse) {
  try {
    var tab = await chrome.tabs.get(tabId);
    var win = await chrome.windows.get(tab.windowId);

    // 現在のウィンドウサイズとビューポートの差分を取得
    var results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function() {
        return {
          viewportWidth: document.documentElement.clientWidth,
          viewportHeight: window.innerHeight,
          screenWidth: screen.availWidth,
          screenHeight: screen.availHeight
        };
      }
    });

    var viewport = results[0].result;
    var diffW = win.width - viewport.viewportWidth;
    var diffH = win.height - viewport.viewportHeight;

    // 差分を加算してウィンドウサイズを設定
    var newWidth = targetWidth + diffW;
    var newHeight = targetHeight ? targetHeight + diffH : win.height;

    // 画面サイズの上限チェック
    var maxW = viewport.screenWidth;
    var maxH = viewport.screenHeight;
    if (newWidth > maxW) { newWidth = maxW; }
    if (newHeight > maxH) { newHeight = maxH; }

    // サイズのみ変更、位置は画面外にはみ出す場合のみ調整
    var updateObj = { width: newWidth, height: newHeight };
    if (win.left + newWidth > maxW) {
      updateObj.left = Math.max(0, maxW - newWidth);
    }
    if (win.top + newHeight > maxH) {
      updateObj.top = Math.max(0, maxH - newHeight);
    }

    await chrome.windows.update(tab.windowId, updateObj);

    sendResponse({ success: true, previousWidth: win.width, previousHeight: win.height, previousLeft: win.left, previousTop: win.top });
  } catch (e) {
    console.error("CSS Jumper: リサイズエラー", e);
    sendResponse({ success: false, error: e.message });
  }
}

// CSS説明 + ジャンプ処理
async function handleExplainAndJump(request, tabId, sendResponse) {
  console.log("CSS Jumper: CSS説明リクエスト処理開始", request);
  
  try {
    // 1. CSSファイルと内容を取得
    var cssFiles = await getCssFilesFromStorage();
    var cssContent = findCssContent(cssFiles, request.className, request.id);
    
    // 2. VS Code拡張に説明リクエスト送信
    var response = await fetch("http://127.0.0.1:3848/explain-and-jump", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        className: request.className,
        id: request.id,
        tagName: request.tagName,
        htmlContext: request.htmlContext,
        cssContent: cssContent,
        userRequest: request.userRequest  // ユーザーの改善要望を追加
      })
    });
    
    if (response.ok) {
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "VS Code拡張との通信エラー" });
    }
  } catch (error) {
    console.error("CSS Jumper: CSS説明リクエストエラー", error);
    sendResponse({ success: false, error: error.message });
  }
}

// CSS ファイルをストレージから取得
function getCssFilesFromStorage() {
  return new Promise(function(resolve) {
    chrome.storage.local.get(["cssFiles"], function(result) {
      resolve(result.cssFiles || []);
    });
  });
}

// CSS内容から関連する定義を抽出（コンテキスト強化）
function findCssContent(cssFiles, className, id) {
  var targetSelector = className ? "." + className.split(" ")[0] : "#" + id;
  var relatedContent = [];
  
  // 1. ターゲットそのものの定義を探す
  for (var i = 0; i < cssFiles.length; i++) {
    var file = cssFiles[i];
    if (!file.content) continue;
    
    // シンプルな抽出：ファイル全体を含めるか、関連しそうな行を抽出
    // 今回は精度向上のため、ファイルサイズが小さければファイル全体を送る
    // 大きければ、ターゲットを含む周辺のルールを送る
    
    if (file.content.length < 20000) {
      relatedContent.push("/* File: " + (file.url || "unknown") + " */\n" + file.content);
    } else {
      // 部分抽出ロジック（ターゲットを含む前後200行など）
      var lines = file.content.split("\n");
      var targetIndex = -1;
      
      for (var j = 0; j < lines.length; j++) {
        if (lines[j].includes(targetSelector) && lines[j].includes("{")) {
          targetIndex = j;
          break;
        }
      }
      
      if (targetIndex !== -1) {
        var start = Math.max(0, targetIndex - 50);
        var end = Math.min(lines.length, targetIndex + 150);
        relatedContent.push("/* File: " + (file.url || "unknown") + " (partial) */\n" + lines.slice(start, end).join("\n"));
      }
    }
  }
  
  return relatedContent.join("\n\n") || "/* CSS定義が見つかりませんでした */";
}
