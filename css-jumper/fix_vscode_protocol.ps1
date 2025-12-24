# vscodeプロトコル 確認・修復スクリプト
# 使い方: 右クリック → PowerShellで実行

$vscodePath = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe"
$regPath = "HKCU:\Software\Classes\vscode\shell\open\command"

Write-Host "=== vscodeプロトコル確認 ===" -ForegroundColor Cyan

# VS Codeの存在確認
if (Test-Path $vscodePath) {
    Write-Host "✓ VS Code発見: $vscodePath" -ForegroundColor Green
} else {
    Write-Host "✗ VS Codeが見つかりません" -ForegroundColor Red
    Write-Host "  パスを確認してください: $vscodePath"
    Read-Host "Enterで終了"
    exit
}

# レジストリ確認
if (Test-Path $regPath) {
    $currentValue = (Get-ItemProperty -Path $regPath).'(Default)'
    Write-Host "✓ レジストリ登録済み" -ForegroundColor Green
    Write-Host "  現在の値: $currentValue" -ForegroundColor Gray
    
    # 正しい値かチェック
    $expectedValue = "`"$vscodePath`" --open-url `"%1`""
    if ($currentValue -eq $expectedValue) {
        Write-Host "✓ 設定は正常です！" -ForegroundColor Green
    } else {
        Write-Host "⚠ 設定が古い可能性があります。修復しますか？" -ForegroundColor Yellow
        $choice = Read-Host "(y/n)"
        if ($choice -eq "y") {
            Set-ItemProperty -Path $regPath -Name "(Default)" -Value $expectedValue
            Write-Host "✓ 修復完了！Chromeを再起動してください" -ForegroundColor Green
        }
    }
} else {
    Write-Host "✗ レジストリ未登録" -ForegroundColor Red
    Write-Host "  新規登録しますか？" -ForegroundColor Yellow
    $choice = Read-Host "(y/n)"
    if ($choice -eq "y") {
        New-Item -Path "HKCU:\Software\Classes\vscode" -Force | Out-Null
        Set-ItemProperty -Path "HKCU:\Software\Classes\vscode" -Name "(Default)" -Value "URL:vscode"
        Set-ItemProperty -Path "HKCU:\Software\Classes\vscode" -Name "URL Protocol" -Value ""
        New-Item -Path "HKCU:\Software\Classes\vscode\shell\open\command" -Force | Out-Null
        Set-ItemProperty -Path "HKCU:\Software\Classes\vscode\shell\open\command" -Name "(Default)" -Value "`"$vscodePath`" --open-url `"%1`""
        Write-Host "✓ 登録完了！Chromeを再起動してください" -ForegroundColor Green
    }
}

Write-Host ""
Read-Host "Enterで終了"
