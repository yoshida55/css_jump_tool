// 最小ウィンドウ幅（これ以下に縮めない）
var MIN_WINDOW_WIDTH = 400;

document.addEventListener("DOMContentLoaded", function () {
  var projectPathInput = document.getElementById("projectPath");
  var autoDetectBtn = document.getElementById("autoDetectBtn");
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
  var pathHistorySelect = document.getElementById("pathHistory");
  var browseFolderBtn = document.getElementById("browseFolderBtn");
  var autoShowFlexCheckbox = document.getElementById("autoShowFlex");
  var claudeApiKeyInput = document.getElementById("claudeApiKey");
  var saveApiKeyBtn = document.getElementById("saveApiKeyBtn");
  var claudeModelSelect = document.getElementById("claudeModel");
  var apiKeyStatus = document.getElementById("apiKeyStatus");
  var screenshotBtn = document.getElementById("screenshotBtn");
  var screenshotStatus = document.getElementById("screenshotStatus");

  // 保存された情報を読み込み
  loadSavedData();

  // ========== スクリーンショット ==========
  screenshotBtn.addEventListener("click", function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs[0]) {
        showScreenshotStatus("⚠️ アクティブなタブが見つかりません", "error");
        return;
      }
      takeFullPageScreenshot(tabs[0].id);
    });
  });

  function takeFullPageScreenshot(tabId) {
    showScreenshotStatus("準備中（スクロールして全体読み込み）...", "info");
    screenshotBtn.disabled = true;

    chrome.debugger.attach({ tabId: tabId }, "1.3", function () {
      if (chrome.runtime.lastError) {
        showScreenshotStatus("⚠️ " + chrome.runtime.lastError.message, "error");
        screenshotBtn.disabled = false;
        return;
      }

      // ① まず一番下までスクロール（遅延読み込みを全部発火させる）
      showScreenshotStatus("スクロール中（遅延読み込み待ち）...", "info");
      chrome.debugger.sendCommand({ tabId: tabId }, "Runtime.evaluate", {
        expression: "window.scrollTo(0, document.body.scrollHeight)"
      }, function () {
        // ② 遅延読み込みが完了するまで待機（2秒）
        setTimeout(function () {

          // ③ 一番上に戻す
          chrome.debugger.sendCommand({ tabId: tabId }, "Runtime.evaluate", {
            expression: "window.scrollTo(0, 0)"
          }, function () {
            setTimeout(function () {

              // ④ 実際のページ全体の高さをJSで取得（メトリクスより正確）
              chrome.debugger.sendCommand({ tabId: tabId }, "Runtime.evaluate", {
                expression: "JSON.stringify({ w: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth), h: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) })"
              }, function (sizeResult) {

                var size = { w: 1440, h: 3000 }; // フォールバック値
                try {
                  size = JSON.parse(sizeResult.result.value);
                } catch(e) {}

                var width  = Math.max(size.w, 800);
                var height = Math.max(size.h, 600);

                showScreenshotStatus("撮影中（" + width + "×" + height + "px）...", "info");

                // ⑤ ビューポートをページ全体サイズに拡張
                chrome.debugger.sendCommand({ tabId: tabId }, "Emulation.setDeviceMetricsOverride", {
                  width: width,
                  height: height,
                  deviceScaleFactor: 1,
                  mobile: false
                }, function () {

                  // ⑥ フルページキャプチャ
                  chrome.debugger.sendCommand({ tabId: tabId }, "Page.captureScreenshot", {
                    format: "png",
                    captureBeyondViewport: true,
                    clip: { x: 0, y: 0, width: width, height: height, scale: 1 }
                  }, function (result) {

                    // ⑦ ビューポートを元に戻してデタッチ
                    chrome.debugger.sendCommand({ tabId: tabId }, "Emulation.clearDeviceMetricsOverride", {}, function () {
                      chrome.debugger.detach({ tabId: tabId });
                    });

                    screenshotBtn.disabled = false;

                    if (chrome.runtime.lastError || !result || !result.data) {
                      showScreenshotStatus("⚠️ キャプチャ失敗", "error");
                      return;
                    }

                    // ⑧ PNGをダウンロード
                    var ts = makeTimestamp();
                    var dataUrl = "data:image/png;base64," + result.data;
                    chrome.downloads.download({
                      url: dataUrl,
                      filename: "screenshot_" + ts + ".png"
                    }, function () {
                      showScreenshotStatus("✓ 保存: screenshot_" + ts + ".png", "success");
                    });
                  });
                });
              });
            }, 500);
          });
        }, 2000); // 遅延読み込み待ち 2秒
      });
    });
  }

  function detachAndReset(tabId) {
    chrome.debugger.detach({ tabId: tabId });
    screenshotBtn.disabled = false;
  }

  function makeTimestamp() {
    var d = new Date();
    return d.getFullYear()
      + pad2(d.getMonth() + 1)
      + pad2(d.getDate())
      + "_"
      + pad2(d.getHours())
      + pad2(d.getMinutes())
      + pad2(d.getSeconds());
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  function showScreenshotStatus(msg, type) {
    screenshotStatus.textContent = msg;
    screenshotStatus.className = "status " + (type || "");
    if (type !== "info") {
      setTimeout(function () { screenshotStatus.className = "status"; }, 4000);
    }
  }

  // Claude API Key保存
  saveApiKeyBtn.addEventListener("click", function () {
    var apiKey = claudeApiKeyInput.value.trim();
    if (!apiKey) {
      apiKeyStatus.textContent = "⚠️ API Keyを入力してください";
      apiKeyStatus.className = "status error";
      return;
    }
    var model = claudeModelSelect.value;
    chrome.storage.local.set({ claudeApiKey: apiKey, claudeModel: model }, function () {
      apiKeyStatus.textContent = "✓ 保存しました";
      apiKeyStatus.className = "status success";
      setTimeout(function () { apiKeyStatus.className = "status"; }, 3000);
    });
  });

  // モデル変更時も自動保存
  claudeModelSelect.addEventListener("change", function () {
    var model = claudeModelSelect.value;
    chrome.storage.local.set({ claudeModel: model }, function () {
      apiKeyStatus.textContent = "✓ モデル: " + model.split("-").slice(1, 3).join("-");
      apiKeyStatus.className = "status success";
      setTimeout(function () { apiKeyStatus.className = "status"; }, 3000);
    });
  });

  // Flex情報自動表示の設定変更時
  autoShowFlexCheckbox.addEventListener("change", function () {
    var isEnabled = autoShowFlexCheckbox.checked;
    chrome.storage.local.set({ autoShowFlex: isEnabled }, function () {
      showStatus(
        isEnabled ? "✓ Flex情報自動表示ON" : "✓ Flex情報自動表示OFF",
        "success"
      );
    });
  });

  // クイックリサイズ幅の保存
  saveQuickResizeBtn.addEventListener("click", function () {
    var width = parseInt(quickResizeWidthInput.value);
    if (!width || width < 320 || width > 3840) {
      showStatus("⚠️ 幅は320〜3840pxの範囲で入力してください", "error");
      return;
    }
    var trigger = document.querySelector(
      'input[name="resizeTrigger"]:checked',
    ).value;
    chrome.storage.local.set(
      { quickResizeWidth: width, quickResizeTrigger: trigger },
      function () {
        var triggerLabel =
          {
            both: "両方",
            wheel: "ホイール",
            ctrlRight: "Ctrl+右クリック",
            ctrlDown: "Ctrl+↓",
          }[trigger] || trigger;
        showStatus("✓ " + width + "px / " + triggerLabel, "success");
      },
    );
  });

  // トリガー設定変更時も自動保存
  var triggerRadios = document.querySelectorAll('input[name="resizeTrigger"]');
  for (var i = 0; i < triggerRadios.length; i++) {
    triggerRadios[i].addEventListener("change", function () {
      var trigger = document.querySelector(
        'input[name="resizeTrigger"]:checked',
      ).value;
      chrome.storage.local.set({ quickResizeTrigger: trigger }, function () {
        var triggerLabel =
          {
            both: "両方",
            wheel: "ホイール",
            ctrlRight: "Ctrl+右クリック",
            ctrlDown: "Ctrl+↓",
          }[trigger] || trigger;
        showStatus("✓ トリガー: " + triggerLabel, "success");
      });
    });
  }

  // プロジェクトパス入力時に自動保存（履歴にも追加）
  projectPathInput.addEventListener("change", function () {
    var path = projectPathInput.value.trim();
    if (path) {
      // パスの正規化（\を/に変換、末尾の/を削除）
      path = normalizePath(path);
      projectPathInput.value = path;

      // パスを保存し、履歴にも追加
      savePathToHistory(path);
      chrome.storage.local.set({ projectPath: path }, function () {
        showStatus("✓ パスを保存しました", "success");
      });
    }
  });

  // フォルダ参照ボタン（履歴から親パスを使用）
  browseFolderBtn.addEventListener("click", async function () {
    // File System Access API が利用可能かチェック
    if (!window.showDirectoryPicker) {
      showStatus("⚠️ このブラウザはフォルダ選択に対応していません", "error");
      return;
    }

    // 履歴から親パスを取得
    chrome.storage.local.get(
      ["pathHistory", "projectPath"],
      async function (result) {
        var parentPath = "";

        // 現在のパスまたは履歴の最初のパスから親パスを取得
        var basePath =
          result.projectPath || (result.pathHistory && result.pathHistory[0]);

        if (!basePath || !/^[A-Za-z]:/.test(basePath)) {
          showStatus(
            "⚠️ 先にパスを1回入力してください\n（履歴がないため親パスが分かりません）",
            "error",
          );
          return;
        }

        // 親パスを取得（最後のフォルダを除去）
        parentPath = basePath.replace(/\/[^\/]+$/, "");

        try {
          var dirHandle = await window.showDirectoryPicker();
          var folderName = dirHandle.name;

          // 親パス + 選択したフォルダ名
          var fullPath = parentPath + "/" + folderName;
          fullPath = normalizePath(fullPath);

          projectPathInput.value = fullPath;
          savePathToHistory(fullPath);
          chrome.storage.local.set({ projectPath: fullPath }, function () {
            showStatus("✓ " + folderName + " に切り替えました", "success");
          });
        } catch (e) {
          // ユーザーがキャンセルした場合は何もしない
          if (e.name !== "AbortError") {
            console.error("CSS Jumper: フォルダ選択エラー", e);
          }
        }
      },
    );
  });

  // 履歴ドロップダウンから選択
  pathHistorySelect.addEventListener("change", function () {
    var selectedPath = pathHistorySelect.value;
    if (selectedPath) {
      projectPathInput.value = selectedPath;
      chrome.storage.local.set({ projectPath: selectedPath }, function () {
        showStatus("✓ 履歴からパスを選択しました", "success");
      });
      // 選択をリセット（同じパスを再選択できるように）
      pathHistorySelect.value = "";
    }
  });

  // 画面幅の選択時に自動保存
  var screenWidthRadios = document.querySelectorAll(
    'input[name="screenWidth"]',
  );
  for (var i = 0; i < screenWidthRadios.length; i++) {
    screenWidthRadios[i].addEventListener("change", saveScreenWidth);
  }

  customWidth.addEventListener("change", function () {
    var customRadio = document.querySelector(
      'input[name="screenWidth"][value="custom"]',
    );
    if (customRadio.checked) {
      saveScreenWidth();
    }
  });

  // CSSファイルを保存
  function saveCssFiles(cssFiles, errorCount) {
    if (cssFiles.length === 0) {
      showStatus("⚠️ CSSファイルが読み込めませんでした", "error");
      return;
    }

    chrome.storage.local.set(
      {
        projectPath: normalizePath(projectPathInput.value.trim()),
        cssFiles: cssFiles,
      },
      function () {
        updateUI(cssFiles);
        var message =
          "✓ " + cssFiles.length + "個のCSSファイルを読み込みました";
        if (errorCount > 0) {
          message += "（" + errorCount + "個失敗）";
        }
        showStatus(message, errorCount > 0 ? "warning" : "success");
      },
    );
  }

  // CSS自動検出ボタン
  autoDetectBtn.addEventListener("click", function () {
    var projectPath = projectPathInput.value.trim();

    if (!projectPath) {
      showStatus("⚠️ 先にプロジェクトパスを入力してください", "error");
      projectPathInput.focus();
      return;
    }

    showStatus("🔍 CSSファイルを検出中...", "info");

    // アクティブタブからCSSリンクを取得
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs[0]) {
        showStatus("⚠️ アクティブなタブが見つかりません", "error");
        return;
      }

      chrome.tabs.sendMessage(
        tabs[0].id,
        { action: "getCssLinks" },
        function (response) {
          if (chrome.runtime.lastError || !response || !response.cssLinks) {
            showStatus("⚠️ ページをリロードしてください（F5）", "error");
            return;
          }

          var cssLinks = response.cssLinks;

          if (cssLinks.length === 0) {
            showStatus(
              "⚠️ CSSファイルが見つかりません（Live Server必須）",
              "error",
            );
            return;
          }

          // 各CSSファイルをfetchで読み込み
          var cssFiles = [];
          var loadedCount = 0;
          var errorCount = 0;

          for (var i = 0; i < cssLinks.length; i++) {
            (function (url) {
              fetch(url)
                .then(function (res) {
                  return res.text();
                })
                .then(function (content) {
                  // URLから相対パスを抽出
                  var urlObj = new URL(url);
                  var pathname = urlObj.pathname;
                  // 先頭の/を削除
                  var relativePath = pathname.replace(/^\//, "");
                  var fileName = relativePath.split("/").pop();

                  // 除外ファイルをスキップ
                  var excludeFiles = [
                    "reset.css",
                    "normalize.css",
                    "sanitize.css",
                  ];
                  var isExcluded = false;
                  for (var e = 0; e < excludeFiles.length; e++) {
                    if (
                      fileName.toLowerCase() === excludeFiles[e].toLowerCase()
                    ) {
                      isExcluded = true;
                      break;
                    }
                  }

                  cssFiles.push({
                    name: fileName,
                    relativePath: relativePath,
                    content: content,
                    lines: content.split("\n").length,
                    excluded: isExcluded,
                  });
                  loadedCount++;

                  if (loadedCount + errorCount === cssLinks.length) {
                    saveCssFiles(cssFiles, errorCount);
                  }
                })
                .catch(function (err) {
                  console.error("CSS Jumper: fetch失敗", url, err);
                  errorCount++;
                  if (loadedCount + errorCount === cssLinks.length) {
                    saveCssFiles(cssFiles, errorCount);
                  }
                });
            })(cssLinks[i]);
          }
        },
      );
    });
  });

  // 再読込ボタン
  reloadBtn.addEventListener("click", function () {
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
  showSizeBtn.addEventListener("click", function () {
    var selectedWidth = document.querySelector(
      'input[name="screenWidth"]:checked',
    ).value;
    var targetViewportWidth;
    if (selectedWidth === "custom") {
      var customValue = parseInt(customWidth.value);
      if (!customValue || customValue < 320 || customValue > 3840) {
        showStatus(
          "⚠️ カスタム幅は320〜3840pxの範囲で入力してください",
          "error",
        );
        customWidth.focus();
        return;
      }
      targetViewportWidth = customValue;
    } else {
      targetViewportWidth = parseInt(selectedWidth);
    }

    chrome.storage.local.set({ targetViewportWidth: targetViewportWidth });
    showStatus(
      "📐 ビューポート幅を " + targetViewportWidth + "px に調整中...",
      "info",
    );

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs[0]) {
        showStatus("⚠️ アクティブなタブが見つかりません", "error");
        return;
      }

      var tabWindowId = tabs[0].windowId;
      var tabId = tabs[0].id;

      // クローム幅ベースのリサイズ + 微調整
      function resizeToTarget(attempt) {
        chrome.windows.get(tabWindowId, function (win) {
          chrome.tabs.sendMessage(
            tabId,
            { action: "getViewportInfo" },
            function (response) {
              if (chrome.runtime.lastError || !response) {
                var fallbackWindowWidth = Math.max(
                  targetViewportWidth + 87,
                  MIN_WINDOW_WIDTH,
                );
                chrome.windows.update(
                  tabWindowId,
                  { width: fallbackWindowWidth },
                  function () {
                    setTimeout(function () {
                      chrome.tabs.sendMessage(tabId, {
                        action: "toggleSizeDisplay",
                      });
                      showStatus(
                        "✓ ビューポート幅 " +
                          targetViewportWidth +
                          "px でサイズ表示",
                        "success",
                      );
                    }, 200);
                  },
                );
                return;
              }

              var currentViewport = response.viewportWidth;

              if (currentViewport === targetViewportWidth) {
                chrome.tabs.sendMessage(tabId, { action: "toggleSizeDisplay" });
                showStatus(
                  "✓ ビューポート幅 " + targetViewportWidth + "px でサイズ表示",
                  "success",
                );
                return;
              }

              var targetWindowWidth;
              if (attempt === 1) {
                // 初回：クローム幅を計算
                var chromeWidth = win.width - currentViewport;
                targetWindowWidth = Math.max(
                  targetViewportWidth + chromeWidth,
                  MIN_WINDOW_WIDTH,
                );
              } else {
                // リトライ：直接ピクセル差分で微調整
                var diff = currentViewport - targetViewportWidth;
                targetWindowWidth = Math.max(
                  win.width - diff,
                  MIN_WINDOW_WIDTH,
                );
              }

              chrome.windows.update(
                tabWindowId,
                { width: targetWindowWidth },
                function () {
                  setTimeout(function () {
                    chrome.tabs.sendMessage(
                      tabId,
                      { action: "getViewportInfo" },
                      function (resp2) {
                        var newViewport = resp2
                          ? resp2.viewportWidth
                          : targetViewportWidth;
                        var newDiff = Math.abs(
                          newViewport - targetViewportWidth,
                        );

                        if (newDiff > 0 && attempt < 5) {
                          resizeToTarget(attempt + 1);
                        } else {
                          chrome.tabs.sendMessage(tabId, {
                            action: "toggleSizeDisplay",
                          });
                          showStatus(
                            "✓ ビューポート幅 " +
                              targetViewportWidth +
                              "px でサイズ表示",
                            "success",
                          );
                        }
                      },
                    );
                  }, 150);
                },
              );
            },
          );
        });
      }

      resizeToTarget(1);
    });
  });

  // 距離表示ボタン
  showSpacingBtn.addEventListener("click", function () {
    var selectedWidth = document.querySelector(
      'input[name="screenWidth"]:checked',
    ).value;
    var targetViewportWidth;

    if (selectedWidth === "custom") {
      var customValue = parseInt(customWidth.value);
      if (!customValue || customValue < 320 || customValue > 3840) {
        showStatus(
          "⚠️ カスタム幅は320〜3840pxの範囲で入力してください",
          "error",
        );
        customWidth.focus();
        return;
      }
      targetViewportWidth = customValue;
    } else {
      targetViewportWidth = parseInt(selectedWidth);
    }

    chrome.storage.local.set({ targetViewportWidth: targetViewportWidth });
    showStatus(
      "↕️ ビューポート幅を " + targetViewportWidth + "px に調整中...",
      "info",
    );

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs[0]) {
        showStatus("⚠️ アクティブなタブが見つかりません", "error");
        return;
      }

      var tabWindowId = tabs[0].windowId;
      var tabId = tabs[0].id;

      function resizeToTarget(attempt) {
        chrome.windows.get(tabWindowId, function (win) {
          chrome.tabs.sendMessage(
            tabId,
            { action: "getViewportInfo" },
            function (response) {
              if (chrome.runtime.lastError || !response) {
                var fallbackWindowWidth = Math.max(
                  targetViewportWidth + 87,
                  MIN_WINDOW_WIDTH,
                );
                chrome.windows.update(
                  tabWindowId,
                  { width: fallbackWindowWidth },
                  function () {
                    setTimeout(function () {
                      chrome.tabs.sendMessage(tabId, {
                        action: "toggleSpacingDisplay",
                      });
                      showStatus(
                        "✓ ビューポート幅 " +
                          targetViewportWidth +
                          "px で距離表示",
                        "success",
                      );
                    }, 200);
                  },
                );
                return;
              }

              var currentViewport = response.viewportWidth;

              if (currentViewport === targetViewportWidth) {
                chrome.tabs.sendMessage(tabId, {
                  action: "toggleSpacingDisplay",
                });
                showStatus(
                  "✓ ビューポート幅 " + targetViewportWidth + "px で距離表示",
                  "success",
                );
                return;
              }

              var targetWindowWidth;
              if (attempt === 1) {
                var chromeWidth = win.width - currentViewport;
                targetWindowWidth = Math.max(
                  targetViewportWidth + chromeWidth,
                  MIN_WINDOW_WIDTH,
                );
              } else {
                var diff = currentViewport - targetViewportWidth;
                targetWindowWidth = Math.max(
                  win.width - diff,
                  MIN_WINDOW_WIDTH,
                );
              }

              chrome.windows.update(
                tabWindowId,
                { width: targetWindowWidth },
                function () {
                  setTimeout(function () {
                    chrome.tabs.sendMessage(
                      tabId,
                      { action: "getViewportInfo" },
                      function (resp2) {
                        var newViewport = resp2
                          ? resp2.viewportWidth
                          : targetViewportWidth;
                        var newDiff = Math.abs(
                          newViewport - targetViewportWidth,
                        );
                        if (newDiff > 0 && attempt < 5) {
                          resizeToTarget(attempt + 1);
                        } else {
                          chrome.tabs.sendMessage(tabId, {
                            action: "toggleSpacingDisplay",
                          });
                          showStatus(
                            "✓ ビューポート幅 " +
                              targetViewportWidth +
                              "px で距離表示",
                            "success",
                          );
                        }
                      },
                    );
                  }, 150);
                },
              );
            },
          );
        });
      }

      resizeToTarget(1);
    });
  });

  // 両方表示ボタン
  showBothBtn.addEventListener("click", function () {
    var selectedWidth = document.querySelector(
      'input[name="screenWidth"]:checked',
    ).value;
    var targetViewportWidth;

    if (selectedWidth === "custom") {
      var customValue = parseInt(customWidth.value);
      if (!customValue || customValue < 320 || customValue > 3840) {
        showStatus(
          "⚠️ カスタム幅は320〜3840pxの範囲で入力してください",
          "error",
        );
        customWidth.focus();
        return;
      }
      targetViewportWidth = customValue;
    } else {
      targetViewportWidth = parseInt(selectedWidth);
    }

    chrome.storage.local.set({ targetViewportWidth: targetViewportWidth });
    showStatus(
      "📐+↕️ ビューポート幅を " + targetViewportWidth + "px に調整中...",
      "info",
    );

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs[0]) {
        showStatus("⚠️ アクティブなタブが見つかりません", "error");
        return;
      }

      var tabWindowId = tabs[0].windowId;
      var tabId = tabs[0].id;

      function resizeToTarget(attempt) {
        chrome.windows.get(tabWindowId, function (win) {
          chrome.tabs.sendMessage(
            tabId,
            { action: "getViewportInfo" },
            function (response) {
              if (chrome.runtime.lastError || !response) {
                var fallbackWindowWidth = Math.max(
                  targetViewportWidth + 87,
                  MIN_WINDOW_WIDTH,
                );
                chrome.windows.update(
                  tabWindowId,
                  { width: fallbackWindowWidth },
                  function () {
                    setTimeout(function () {
                      chrome.tabs.sendMessage(tabId, {
                        action: "toggleBothDisplay",
                      });
                      showStatus(
                        "✓ ビューポート幅 " +
                          targetViewportWidth +
                          "px でサイズ＋距離表示",
                        "success",
                      );
                    }, 200);
                  },
                );
                return;
              }

              var currentViewport = response.viewportWidth;

              if (currentViewport === targetViewportWidth) {
                chrome.tabs.sendMessage(tabId, { action: "toggleBothDisplay" });
                showStatus(
                  "✓ ビューポート幅 " +
                    targetViewportWidth +
                    "px でサイズ＋距離表示",
                  "success",
                );
                return;
              }

              var targetWindowWidth;
              if (attempt === 1) {
                var chromeWidth = win.width - currentViewport;
                targetWindowWidth = Math.max(
                  targetViewportWidth + chromeWidth,
                  MIN_WINDOW_WIDTH,
                );
              } else {
                var diff = currentViewport - targetViewportWidth;
                targetWindowWidth = Math.max(
                  win.width - diff,
                  MIN_WINDOW_WIDTH,
                );
              }

              chrome.windows.update(
                tabWindowId,
                { width: targetWindowWidth },
                function () {
                  setTimeout(function () {
                    chrome.tabs.sendMessage(
                      tabId,
                      { action: "getViewportInfo" },
                      function (resp2) {
                        var newViewport = resp2
                          ? resp2.viewportWidth
                          : targetViewportWidth;
                        var newDiff = Math.abs(
                          newViewport - targetViewportWidth,
                        );
                        if (newDiff > 0 && attempt < 5) {
                          resizeToTarget(attempt + 1);
                        } else {
                          chrome.tabs.sendMessage(tabId, {
                            action: "toggleBothDisplay",
                          });
                          showStatus(
                            "✓ ビューポート幅 " +
                              targetViewportWidth +
                              "px でサイズ＋距離表示",
                            "success",
                          );
                        }
                      },
                    );
                  }, 150);
                },
              );
            },
          );
        });
      }

      resizeToTarget(1);
    });
  });

  clearBtn.addEventListener("click", function () {
    if (!confirm("設定をクリアしますか？（履歴も含む）")) {
      return;
    }

    chrome.storage.local.remove(
      ["projectPath", "cssFiles", "pathHistory"],
      function () {
        projectPathInput.value = "";
        cssFilesList.innerHTML = "";
        // 履歴ドロップダウンもクリア
        while (pathHistorySelect.options.length > 1) {
          pathHistorySelect.remove(1);
        }
        showStatus("✓ 設定と履歴をクリアしました", "success");
      },
    );
  });

  // UI更新
  function updateUI(cssFiles) {
    cssFilesList.innerHTML = "";

    var header = document.createElement("h3");
    header.textContent = "📄 読み込んだCSSファイル (" + cssFiles.length + "個)";
    cssFilesList.appendChild(header);

    var ul = document.createElement("ul");

    // ファイルサイズでソート（大きい順）
    var sortedFiles = cssFiles.slice().sort(function (a, b) {
      return (b.lines || 0) - (a.lines || 0);
    });

    for (var i = 0; i < sortedFiles.length; i++) {
      var file = sortedFiles[i];
      var li = document.createElement("li");

      // 除外ファイルは灰色で表示
      var isExcluded =
        ["reset.css", "normalize.css", "sanitize.css"].indexOf(
          file.name.toLowerCase(),
        ) !== -1;

      li.innerHTML =
        '<span class="file-name' +
        (isExcluded ? " excluded" : "") +
        '">' +
        escapeHtml(file.name) +
        (isExcluded ? " <small>(除外)</small>" : "") +
        "</span>" +
        '<span class="file-info">' +
        file.lines +
        "行</span>";
      li.title = file.path || file.relativePath;
      ul.appendChild(li);
    }

    cssFilesList.appendChild(ul);
  }

  // 保存されたデータを読み込み
  function loadSavedData() {
    chrome.storage.local.get(
      [
        "projectPath",
        "cssFiles",
        "screenWidth",
        "customScreenWidth",
        "quickResizeWidth",
        "quickResizeTrigger",
        "pathHistory",
        "autoShowFlex",
        "claudeApiKey",
        "claudeModel",
      ],
      function (result) {
        if (result.projectPath) {
          projectPathInput.value = result.projectPath;
        }

        if (result.cssFiles && result.cssFiles.length > 0) {
          updateUI(result.cssFiles);
          showStatus(
            "✓ " + result.cssFiles.length + "個のCSSファイルが設定済み",
            "info",
          );
        } else {
          showStatus("CSSファイルを選択してください", "info");
        }

        // 画面幅の設定を復元
        if (result.screenWidth) {
          var radio = document.querySelector(
            'input[name="screenWidth"][value="' + result.screenWidth + '"]',
          );
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
          var triggerRadio = document.querySelector(
            'input[name="resizeTrigger"][value="' +
              result.quickResizeTrigger +
              '"]',
          );
          if (triggerRadio) {
            triggerRadio.checked = true;
          }
        }

        // パス履歴を復元
        if (result.pathHistory && result.pathHistory.length > 0) {
          updatePathHistoryDropdown(result.pathHistory);
        }

        // Flex情報自動表示の設定を復元
        if (result.autoShowFlex) {
          autoShowFlexCheckbox.checked = true;
        }

        // Claude API設定を復元
        if (result.claudeApiKey) {
          claudeApiKeyInput.value = result.claudeApiKey;
        }
        if (result.claudeModel) {
          claudeModelSelect.value = result.claudeModel;
        }
      },
    );
  }

  // 画面幅の設定を保存
  function saveScreenWidth() {
    var selectedWidth = document.querySelector(
      'input[name="screenWidth"]:checked',
    ).value;
    var saveData = { screenWidth: selectedWidth };

    if (selectedWidth === "custom") {
      var customValue = parseInt(customWidth.value);
      if (customValue) {
        saveData.customScreenWidth = customValue;
      }
    }

    chrome.storage.local.set(saveData, function () {
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
      setTimeout(function () {
        status.className = "status";
      }, 4000);
    }
  }

  // パスを履歴に保存（最大10件）
  function savePathToHistory(path) {
    chrome.storage.local.get(["pathHistory"], function (result) {
      var history = result.pathHistory || [];

      // 既存の同じパスを削除
      history = history.filter(function (p) {
        return p !== path;
      });

      // 先頭に追加
      history.unshift(path);

      // 最大10件に制限
      if (history.length > 10) {
        history = history.slice(0, 10);
      }

      chrome.storage.local.set({ pathHistory: history }, function () {
        updatePathHistoryDropdown(history);
      });
    });
  }

  // 履歴ドロップダウンを更新
  function updatePathHistoryDropdown(history) {
    // 既存のオプションをクリア（最初のプレースホルダー以外）
    while (pathHistorySelect.options.length > 1) {
      pathHistorySelect.remove(1);
    }

    // 履歴を追加
    for (var i = 0; i < history.length; i++) {
      var option = document.createElement("option");
      option.value = history[i];
      // パスが長い場合は末尾のフォルダ名を強調
      var displayPath = history[i];
      var parts = displayPath.split("/");
      var folderName = parts[parts.length - 1] || parts[parts.length - 2];
      option.textContent = folderName + " - " + displayPath;
      pathHistorySelect.appendChild(option);
    }
  }
});
