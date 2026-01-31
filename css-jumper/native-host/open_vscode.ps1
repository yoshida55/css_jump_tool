# Native Messaging host for CSS Jumper
# stdin から Chrome のメッセージを読み、vscode:// プロトコルで VS Code を開く

# stdin からメッセージ長（4バイト）を読む
$stdin = [Console]::OpenStandardInput()
$lenBuf = New-Object byte[] 4
$stdin.Read($lenBuf, 0, 4) | Out-Null
$msgLen = [BitConverter]::ToUInt32($lenBuf, 0)

# メッセージ本文を読む
$msgBuf = New-Object byte[] $msgLen
$stdin.Read($msgBuf, 0, $msgLen) | Out-Null
$msg = [Text.Encoding]::UTF8.GetString($msgBuf)

# JSON パース
$data = $msg | ConvertFrom-Json
$url = $data.url

# vscode:// プロトコルで VS Code を起動
Start-Process $url

# 成功レスポンスを返す
$resp = '{"success":true}'
$respBytes = [Text.Encoding]::UTF8.GetBytes($resp)
$respLen = [BitConverter]::GetBytes([uint32]$respBytes.Length)

$stdout = [Console]::OpenStandardOutput()
$stdout.Write($respLen, 0, 4)
$stdout.Write($respBytes, 0, $respBytes.Length)
$stdout.Flush()
