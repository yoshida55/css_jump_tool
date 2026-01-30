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
    if (idResult) {
      var vscodeUrl = buildVscodeUrl(idResult.filePath, idResult.lineNumber);
      openInVscode(vscodeUrl);
      notifyUser("✓ #" + id + " → " + idResult.fileName + ":" + idResult.lineNumber, "success");
      return;
    }
  }

  // 2. クラス名で検索
  if (className) {
    var classResult = searchSelectorInCss(className, "class", targetCssFiles, projectPath, preferMediaQuery);

    if (classResult) {
      var vscodeUrl = buildVscodeUrl(classResult.filePath, classResult.lineNumber);
      openInVscode(vscodeUrl);
      notifyUser("✓ ." + className + " → " + classResult.fileName + ":" + classResult.lineNumber, "success");
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
        var url = buildVscodeUrl(altResult.filePath, altResult.lineNumber);
        openInVscode(url);
        notifyUser("✓ ." + cls + " → " + altResult.fileName + ":" + altResult.lineNumber, "success");
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
    
    // 波括弧の深さと@media開始位置を追跡
    var braceDepth = 0;
    var mediaQueryStartDepth = -1;  // @mediaの開始時の深さ（-1 = @media外）
    
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      
      // 波括弧をカウント
      var openBraces = (line.match(/{/g) || []).length;
      var closeBraces = (line.match(/}/g) || []).length;
      
      // @media の開始を検出
      if (/@media\s/.test(line)) {
        mediaQueryStartDepth = braceDepth;
      }
      
      // 波括弧による深さ更新（この行の開き括弧を加算）
      braceDepth += openBraces;
      
      // 現在@media内かどうかを判定
      var isInMediaQuery = mediaQueryStartDepth >= 0 && braceDepth > mediaQueryStartDepth;
      
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
      
      // @mediaブロックが終了したかチェック
      if (mediaQueryStartDepth >= 0 && braceDepth <= mediaQueryStartDepth) {
        mediaQueryStartDepth = -1;  // @media外に戻る
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

// VS Code URLを構築
function buildVscodeUrl(filePath, lineNumber) {
  // バックスラッシュをスラッシュに統一
  var cleanPath = filePath.replace(/\\/g, "/");
  // 標準の vscode://file/ 形式
  var url = "vscode://file/" + cleanPath + ":" + lineNumber;
  return url;
}

// 正規表現の特殊文字をエスケープ
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// VS Codeを開く（Native Messaging経由）
function openInVscode(url) {
  console.log("CSS Jumper: VS Codeを開く (Native Messaging)", url);

  chrome.runtime.sendNativeMessage(
    "com.cssjumper.open_vscode",
    { url: url },
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

// ユーザーに通知（アクティブタブへ）
function notifyUser(message, type) {
  console.log("CSS Jumper: 通知", message, type);
  
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (tabs[0]) {
      notifyUserToTab(tabs[0].id, message, type);
    }
  });
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
