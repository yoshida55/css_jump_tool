// 最小ウィンドウ幅（これ以下に縮めない）
var MIN_WINDOW_WIDTH = 400;

document.addEventListener("DOMContentLoaded", function() {
  var projectPathInput = document.getElementById("projectPath");
  var selectFilesBtn = document.getElementById("selectFilesBtn");
  var autoDetectBtn = document.getElementById("autoDetectBtn");
  var cssFileInput = document.getElementById("cssFileInput");
  var reloadBtn = document.getElementById("reloadBtn");
  var clearBtn = document.getElementById("clearBtn");
  var showSizeBtn = document.getElementById("showSizeBtn");
  var showSpacingBtn = document.getElementById("showSpacingBtn");
  var showBothBtn = document.getElementById("showBothBtn");
  var customWidth = document.getElementById("customWidth");
  var cssFilesList = document.getElementById("cssFilesList");
  var status = document.getElementById("status");
  var quickResizeWidthInput = document.getElementById("quickResizeWidth");
  var saveQuickResizeBtn = document.getElementById("saveQuickResizeBtn");

  // 保存された情報を読み込み
  loadSavedData();
  
  // クイックリサイズ幅の保存
  saveQuickResizeBtn.addEventListener("click", function() {
    var width = parseInt(quickResizeWidthInput.value);
    if (!width || width < 320 || width > 3840) {
      showStatus("⚠️ 幅は320〜3840pxの範囲で入力してください", "error");
      return;
    }
    var trigger = document.querySelector('input[name="resizeTrigger"]:checked').value;
    chrome.storage.local.set({ quickResizeWidth: width, quickResizeTrigger: trigger }, function() {
      var triggerLabel = {"both": "両方", "wheel": "ホイール", "ctrlRight": "Ctrl+右クリック", "ctrlDown": "Ctrl+↓"}[trigger] || trigger;
      showStatus("✓ " + width + "px / " + triggerLabel, "success");
    });
  });
  
  // トリガー設定変更時も自動保存
  var triggerRadios = document.querySelectorAll('input[name="resizeTrigger"]');
  for (var i = 0; i < triggerRadios.length; i++) {
    triggerRadios[i].addEventListener("change", function() {
      var trigger = document.querySelector('input[name="resizeTrigger"]:checked').value;
      chrome.storage.local.set({ quickResizeTrigger: trigger }, function() {
        var triggerLabel = {"both": "両方", "wheel": "ホイール", "ctrlRight": "Ctrl+右クリック", "ctrlDown": "Ctrl+↓"}[trigger] || trigger;
        showStatus("✓ トリガー: " + triggerLabel, "success");
      });
    });
  }

  // プロジェクトパス入力時に自動保存
  projectPathInput.addEventListener("change", function() {
    var path = projectPathInput.value.trim();
    if (path) {
      // パスの正規化（\を/に変換、末尾の/を削除）
      path = normalizePath(path);
      projectPathInput.value = path;
      
      chrome.storage.local.set({ projectPath: path }, function() {
        showStatus("✓ パスを保存しました", "success");
      });
    }
  });

  // 画面幅の選択時に自動保存
  var screenWidthRadios = document.querySelectorAll('input[name="screenWidth"]');
  for (var i = 0; i < screenWidthRadios.length; i++) {
    screenWidthRadios[i].addEventListener("change", saveScreenWidth);
  }
  
  customWidth.addEventListener("change", function() {
    var customRadio = document.querySelector('input[name="screenWidth"][value="custom"]');
    if (customRadio.checked) {
      saveScreenWidth();
    }
  });

  // ファイル選択ボタン
  selectFilesBtn.addEventListener("click", function() {
    var projectPath = projectPathInput.value.trim();
    
    if (!projectPath) {
      showStatus("⚠️ 先にプロジェクトパスを入力してください", "error");
      projectPathInput.focus();
      projectPathInput.classList.add("input-error");
      setTimeout(function() {
        projectPathInput.classList.remove("input-error");
      }, 2000);
      return;
    }
    
    cssFileInput.click();
  });

  // ファイルが選択された時
  cssFileInput.addEventListener("change", function(event) {
    var files = event.target.files;
    
    if (!files || files.length === 0) {
      return;
    }
    
    var projectPath = normalizePath(projectPathInput.value.trim());
    showStatus("📂 CSSファイルを読み込み中...", "info");
    
    var cssFiles = [];
    var loadedCount = 0;
    var errorCount = 0;
    
    for (var i = 0; i < files.length; i++) {
      (function(file) {
        var reader = new FileReader();
        
        reader.onload = function(e) {
          var content = e.target.result;
          
          var relativePath = file.webkitRelativePath || file.name;
          var fullPath = projectPath + "/" + relativePath;
          fullPath = normalizePath(fullPath);
          
          cssFiles.push({
            name: file.name,
            relativePath: relativePath,
            path: fullPath,
            content: content,
            lines: content.split("\n").length,
            size: file.size
          });
          
          loadedCount++;
          
          if (loadedCount + errorCount === files.length) {
            saveCssFiles(cssFiles, errorCount);
          }
        };
        
        reader.onerror = function() {
          console.error("ファイル読み込みエラー:", file.name);
          errorCount++;
          
          if (loadedCount + errorCount === files.length) {
            saveCssFiles(cssFiles, errorCount);
          }
        };
        
        reader.readAsText(file);
      })(files[i]);
    }
  });

  // CSSファイルを保存
  function saveCssFiles(cssFiles, errorCount) {
    if (cssFiles.length === 0) {
      showStatus("⚠️ CSSファイルが読み込めませんでした", "error");
      return;
    }
    
    chrome.storage.local.set({
      projectPath: normalizePath(projectPathInput.value.trim()),
      cssFiles: cssFiles
    }, function() {
      updateUI(cssFiles);
      var message = "✓ " + cssFiles.length + "個のCSSファイルを読み込みました";
      if (errorCount > 0) {
        message += "（" + errorCount + "個失敗）";
      }
      showStatus(message, errorCount > 0 ? "warning" : "success");
    });
  }

  // CSS自動検出ボタン
  autoDetectBtn.addEventListener("click", function() {
    var projectPath = projectPathInput.value.trim();
    
    if (!projectPath) {
      showStatus("⚠️ 先にプロジェクトパスを入力してください", "error");
      projectPathInput.focus();
      return;
    }
    
    showStatus("🔍 CSSファイルを検出中...", "info");
    
    // アクティブタブからCSSリンクを取得
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (!tabs || !tabs[0]) {
        showStatus("⚠️ アクティブなタブが見つかりません", "error");
        return;
      }
      
      chrome.tabs.sendMessage(tabs[0].id, { action: "getCssLinks" }, function(response) {
        if (chrome.runtime.lastError || !response || !response.cssLinks) {
          showStatus("⚠️ ページをリロードしてください（F5）", "error");
          return;
        }
        
        var cssLinks = response.cssLinks;
        
        if (cssLinks.length === 0) {
          showStatus("⚠️ CSSファイルが見つかりません（Live Server必須）", "error");
          return;
        }
        
        // 各CSSファイルをfetchで読み込み
        var cssFiles = [];
        var loadedCount = 0;
        var errorCount = 0;
        
        for (var i = 0; i < cssLinks.length; i++) {
          (function(url) {
            fetch(url)
              .then(function(res) { return res.text(); })
              .then(function(content) {
                // URLから相対パスを抽出
                var urlObj = new URL(url);
                var pathname = urlObj.pathname;
                // 先頭の/を削除
                var relativePath = pathname.replace(/^\//, '');
                var fileName = relativePath.split('/').pop();
                
                // 除外ファイルをスキップ
                var excludeFiles = ["reset.css", "normalize.css", "sanitize.css"];
                var isExcluded = false;
                for (var e = 0; e < excludeFiles.length; e++) {
                  if (fileName.toLowerCase() === excludeFiles[e].toLowerCase()) {
                    isExcluded = true;
                    break;
                  }
                }
                
                cssFiles.push({
                  name: fileName,
                  relativePath: relativePath,
                  content: content,
                  lines: content.split('\n').length,
                  excluded: isExcluded
                });
                loadedCount++;
                
                if (loadedCount + errorCount === cssLinks.length) {
                  saveCssFiles(cssFiles, errorCount);
                }
              })
              .catch(function(err) {
                console.error("CSS Jumper: fetch失敗", url, err);
                errorCount++;
                if (loadedCount + errorCount === cssLinks.length) {
                  saveCssFiles(cssFiles, errorCount);
                }
              });
          })(cssLinks[i]);
        }
      });
    });
  });

  // 再読込ボタン
  reloadBtn.addEventListener("click", function() {
    var projectPath = projectPathInput.value.trim();
    
    if (!projectPath) {
      showStatus("⚠️ 先にプロジェクトパスを入力してください", "error");
      projectPathInput.focus();
      return;
    }
    
    showStatus("📂 CSSファイルを再選択してください", "info");
    cssFileInput.click();
  });

  // サイズ表示ボタン
  showSizeBtn.addEventListener("click", function() {
    var selectedWidth = document.querySelector('input[name="screenWidth"]:checked').value;
    var targetViewportWidth;
    if (selectedWidth === "custom") {
      var customValue = parseInt(customWidth.value);
      if (!customValue || customValue < 320 || customValue > 3840) {
        showStatus("⚠️ カスタム幅は320〜3840pxの範囲で入力してください", "error");
        customWidth.focus();
        return;
      }
      targetViewportWidth = customValue;
    } else {
      targetViewportWidth = parseInt(selectedWidth);
    }
    
    chrome.storage.local.set({ targetViewportWidth: targetViewportWidth });
    showStatus("📐 ビューポート幅を " + targetViewportWidth + "px に調整中...", "info");
    
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (!tabs || !tabs[0]) {
        showStatus("⚠️ アクティブなタブが見つかりません", "error");
        return;
      }
      
      var tabWindowId = tabs[0].windowId;
      var tabId = tabs[0].id;
      
      // クローム幅ベースのリサイズ + 微調整
      function resizeToTarget(attempt) {
        chrome.windows.get(tabWindowId, function(win) {
          chrome.tabs.sendMessage(tabId, { action: "getViewportInfo" }, function(response) {
            if (chrome.runtime.lastError || !response) {
              var fallbackWindowWidth = Math.max(targetViewportWidth + 87, MIN_WINDOW_WIDTH);
              chrome.windows.update(tabWindowId, { width: fallbackWindowWidth }, function() {
                setTimeout(function() {
                  chrome.tabs.sendMessage(tabId, { action: "toggleSizeDisplay" });
                  showStatus("✓ ビューポート幅 " + targetViewportWidth + "px でサイズ表示", "success");
                }, 200);
              });
              return;
            }
            
            var currentViewport = response.viewportWidth;
            
            if (currentViewport === targetViewportWidth) {
              chrome.tabs.sendMessage(tabId, { action: "toggleSizeDisplay" });
              showStatus("✓ ビューポート幅 " + targetViewportWidth + "px でサイズ表示", "success");
              return;
            }
            
            var targetWindowWidth;
            if (attempt === 1) {
              // 初回：クローム幅を計算
              var chromeWidth = win.width - currentViewport;
              targetWindowWidth = Math.max(targetViewportWidth + chromeWidth, MIN_WINDOW_WIDTH);
            } else {
              // リトライ：直接ピクセル差分で微調整
              var diff = currentViewport - targetViewportWidth;
              targetWindowWidth = Math.max(win.width - diff, MIN_WINDOW_WIDTH);
            }
            
            chrome.windows.update(tabWindowId, { width: targetWindowWidth }, function() {
              setTimeout(function() {
                chrome.tabs.sendMessage(tabId, { action: "getViewportInfo" }, function(resp2) {
                  var newViewport = resp2 ? resp2.viewportWidth : targetViewportWidth;
                  var newDiff = Math.abs(newViewport - targetViewportWidth);
                  
                  if (newDiff > 0 && attempt < 5) {
                    resizeToTarget(attempt + 1);
                  } else {
                    chrome.tabs.sendMessage(tabId, { action: "toggleSizeDisplay" });
                    showStatus("✓ ビューポート幅 " + targetViewportWidth + "px でサイズ表示", "success");
                  }
                });
              }, 150);
            });
          });
        });
      }
      
      resizeToTarget(1);
    });
  });

  // 距離表示ボタン
  showSpacingBtn.addEventListener("click", function() {
    var selectedWidth = document.querySelector('input[name="screenWidth"]:checked').value;
    var targetViewportWidth;
    
    if (selectedWidth === "custom") {
      var customValue = parseInt(customWidth.value);
      if (!customValue || customValue < 320 || customValue > 3840) {
        showStatus("⚠️ カスタム幅は320〜3840pxの範囲で入力してください", "error");
        customWidth.focus();
        return;
      }
      targetViewportWidth = customValue;
    } else {
      targetViewportWidth = parseInt(selectedWidth);
    }
    
    chrome.storage.local.set({ targetViewportWidth: targetViewportWidth });
    showStatus("↕️ ビューポート幅を " + targetViewportWidth + "px に調整中...", "info");
    
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (!tabs || !tabs[0]) {
        showStatus("⚠️ アクティブなタブが見つかりません", "error");
        return;
      }
      
      var tabWindowId = tabs[0].windowId;
      var tabId = tabs[0].id;
      
      function resizeToTarget(attempt) {
        chrome.windows.get(tabWindowId, function(win) {
          chrome.tabs.sendMessage(tabId, { action: "getViewportInfo" }, function(response) {
            if (chrome.runtime.lastError || !response) {
              var fallbackWindowWidth = Math.max(targetViewportWidth + 87, MIN_WINDOW_WIDTH);
              chrome.windows.update(tabWindowId, { width: fallbackWindowWidth }, function() {
                setTimeout(function() {
                  chrome.tabs.sendMessage(tabId, { action: "toggleSpacingDisplay" });
                  showStatus("✓ ビューポート幅 " + targetViewportWidth + "px で距離表示", "success");
                }, 200);
              });
              return;
            }
            
            var currentViewport = response.viewportWidth;
            
            if (currentViewport === targetViewportWidth) {
              chrome.tabs.sendMessage(tabId, { action: "toggleSpacingDisplay" });
              showStatus("✓ ビューポート幅 " + targetViewportWidth + "px で距離表示", "success");
              return;
            }
            
            var targetWindowWidth;
            if (attempt === 1) {
              var chromeWidth = win.width - currentViewport;
              targetWindowWidth = Math.max(targetViewportWidth + chromeWidth, MIN_WINDOW_WIDTH);
            } else {
              var diff = currentViewport - targetViewportWidth;
              targetWindowWidth = Math.max(win.width - diff, MIN_WINDOW_WIDTH);
            }
            
            chrome.windows.update(tabWindowId, { width: targetWindowWidth }, function() {
              setTimeout(function() {
                chrome.tabs.sendMessage(tabId, { action: "getViewportInfo" }, function(resp2) {
                  var newViewport = resp2 ? resp2.viewportWidth : targetViewportWidth;
                  var newDiff = Math.abs(newViewport - targetViewportWidth);
                  if (newDiff > 0 && attempt < 5) {
                    resizeToTarget(attempt + 1);
                  } else {
                    chrome.tabs.sendMessage(tabId, { action: "toggleSpacingDisplay" });
                    showStatus("✓ ビューポート幅 " + targetViewportWidth + "px で距離表示", "success");
                  }
                });
              }, 150);
            });
          });
        });
      }
      
      resizeToTarget(1);
    });
  });
  
  // 両方表示ボタン
  showBothBtn.addEventListener("click", function() {
    var selectedWidth = document.querySelector('input[name="screenWidth"]:checked').value;
    var targetViewportWidth;
    
    if (selectedWidth === "custom") {
      var customValue = parseInt(customWidth.value);
      if (!customValue || customValue < 320 || customValue > 3840) {
        showStatus("⚠️ カスタム幅は320〜3840pxの範囲で入力してください", "error");
        customWidth.focus();
        return;
      }
      targetViewportWidth = customValue;
    } else {
      targetViewportWidth = parseInt(selectedWidth);
    }
    
    chrome.storage.local.set({ targetViewportWidth: targetViewportWidth });
    showStatus("📐+↕️ ビューポート幅を " + targetViewportWidth + "px に調整中...", "info");
    
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (!tabs || !tabs[0]) {
        showStatus("⚠️ アクティブなタブが見つかりません", "error");
        return;
      }
      
      var tabWindowId = tabs[0].windowId;
      var tabId = tabs[0].id;
      
      function resizeToTarget(attempt) {
        chrome.windows.get(tabWindowId, function(win) {
          chrome.tabs.sendMessage(tabId, { action: "getViewportInfo" }, function(response) {
            if (chrome.runtime.lastError || !response) {
              var fallbackWindowWidth = Math.max(targetViewportWidth + 87, MIN_WINDOW_WIDTH);
              chrome.windows.update(tabWindowId, { width: fallbackWindowWidth }, function() {
                setTimeout(function() {
                  chrome.tabs.sendMessage(tabId, { action: "toggleBothDisplay" });
                  showStatus("✓ ビューポート幅 " + targetViewportWidth + "px でサイズ＋距離表示", "success");
                }, 200);
              });
              return;
            }
            
            var currentViewport = response.viewportWidth;
            
            if (currentViewport === targetViewportWidth) {
              chrome.tabs.sendMessage(tabId, { action: "toggleBothDisplay" });
              showStatus("✓ ビューポート幅 " + targetViewportWidth + "px でサイズ＋距離表示", "success");
              return;
            }
            
            var targetWindowWidth;
            if (attempt === 1) {
              var chromeWidth = win.width - currentViewport;
              targetWindowWidth = Math.max(targetViewportWidth + chromeWidth, MIN_WINDOW_WIDTH);
            } else {
              var diff = currentViewport - targetViewportWidth;
              targetWindowWidth = Math.max(win.width - diff, MIN_WINDOW_WIDTH);
            }
            
            chrome.windows.update(tabWindowId, { width: targetWindowWidth }, function() {
              setTimeout(function() {
                chrome.tabs.sendMessage(tabId, { action: "getViewportInfo" }, function(resp2) {
                  var newViewport = resp2 ? resp2.viewportWidth : targetViewportWidth;
                  var newDiff = Math.abs(newViewport - targetViewportWidth);
                  if (newDiff > 0 && attempt < 5) {
                    resizeToTarget(attempt + 1);
                  } else {
                    chrome.tabs.sendMessage(tabId, { action: "toggleBothDisplay" });
                    showStatus("✓ ビューポート幅 " + targetViewportWidth + "px でサイズ＋距離表示", "success");
                  }
                });
              }, 150);
            });
          });
        });
      }
      
      resizeToTarget(1);
    });
  });

  clearBtn.addEventListener("click", function() {
    if (!confirm("設定をクリアしますか？")) {
      return;
    }
    
    chrome.storage.local.remove(["projectPath", "cssFiles"], function() {
      projectPathInput.value = "";
      cssFilesList.innerHTML = "";
      cssFileInput.value = "";
      showStatus("✓ 設定をクリアしました", "success");
    });
  });

  // UI更新
  function updateUI(cssFiles) {
    cssFilesList.innerHTML = "";
    
    var header = document.createElement("h3");
    header.textContent = "📄 読み込んだCSSファイル (" + cssFiles.length + "個)";
    cssFilesList.appendChild(header);
    
    var ul = document.createElement("ul");
    
    // ファイルサイズでソート（大きい順）
    var sortedFiles = cssFiles.slice().sort(function(a, b) {
      return (b.lines || 0) - (a.lines || 0);
    });
    
    for (var i = 0; i < sortedFiles.length; i++) {
      var file = sortedFiles[i];
      var li = document.createElement("li");
      
      // 除外ファイルは灰色で表示
      var isExcluded = ["reset.css", "normalize.css", "sanitize.css"].indexOf(file.name.toLowerCase()) !== -1;
      
      li.innerHTML = 
        '<span class="file-name' + (isExcluded ? ' excluded' : '') + '">' + 
          escapeHtml(file.name) + 
          (isExcluded ? ' <small>(除外)</small>' : '') +
        '</span>' +
        '<span class="file-info">' + file.lines + '行</span>';
      li.title = file.path || file.relativePath;
      ul.appendChild(li);
    }
    
    cssFilesList.appendChild(ul);
  }

  // 保存されたデータを読み込み
  function loadSavedData() {
    chrome.storage.local.get(["projectPath", "cssFiles", "screenWidth", "customScreenWidth", "quickResizeWidth", "quickResizeTrigger"], function(result) {
      if (result.projectPath) {
        projectPathInput.value = result.projectPath;
      }
      
      if (result.cssFiles && result.cssFiles.length > 0) {
        updateUI(result.cssFiles);
        showStatus("✓ " + result.cssFiles.length + "個のCSSファイルが設定済み", "info");
      } else {
        showStatus("CSSファイルを選択してください", "info");
      }
      
      // 画面幅の設定を復元
      if (result.screenWidth) {
        var radio = document.querySelector('input[name="screenWidth"][value="' + result.screenWidth + '"]');
        if (radio) {
          radio.checked = true;
        }
      }
      
      if (result.customScreenWidth) {
        customWidth.value = result.customScreenWidth;
      }
      
      // クイックリサイズ幅を復元
      if (result.quickResizeWidth) {
        quickResizeWidthInput.value = result.quickResizeWidth;
      }
      
      // クイックリサイズトリガーを復元
      if (result.quickResizeTrigger) {
        var triggerRadio = document.querySelector('input[name="resizeTrigger"][value="' + result.quickResizeTrigger + '"]');
        if (triggerRadio) {
          triggerRadio.checked = true;
        }
      }
    });
  }

  // 画面幅の設定を保存
  function saveScreenWidth() {
    var selectedWidth = document.querySelector('input[name="screenWidth"]:checked').value;
    var saveData = { screenWidth: selectedWidth };
    
    if (selectedWidth === "custom") {
      var customValue = parseInt(customWidth.value);
      if (customValue) {
        saveData.customScreenWidth = customValue;
      }
    }
    
    chrome.storage.local.set(saveData, function() {
      showStatus("✓ 画面幅を保存しました", "success");
    });
  }

  // パスの正規化
  function normalizePath(path) {
    if (!path) return path;
    // バックスラッシュをスラッシュに変換
    path = path.replace(/\\/g, "/");
    // 重複スラッシュを削除
    path = path.replace(/\/+/g, "/");
    // 末尾のスラッシュを削除
    path = path.replace(/\/+$/, "");
    return path;
  }

  // HTMLエスケープ
  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // ステータス表示
  function showStatus(message, type) {
    status.textContent = message;
    status.className = "status " + type;
    
    if (type !== "info") {
      setTimeout(function() {
        status.className = "status";
      }, 4000);
    }
  }
});
