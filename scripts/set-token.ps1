<#
  更新「今日消费」用的 DeepSeek 控制台 token。

  为什么需要它：官方 API key 只能读总余额，读不到消费明细；控制台的用量接口
  `/api/v0/usage/by_api_key/cost` 由控制台登录态（Bearer token）鉴权，而这个
  token 会过期、平台也没有提供密码登录或刷新接口，所以失效后需要重新贴一次。

  获取 token：
    1. 浏览器打开 https://platform.deepseek.com 并保持登录；
    2. F12 → Network → 随便点一个 /api/v0/... 请求 → Request Headers；
    3. 复制 `authorization: Bearer xxxxx` 里 Bearer 后面那一整串（64 字符）。

  用法：
    pwsh -File set-token.ps1              # 交互式粘贴
    pwsh -File set-token.ps1 -Token xxx   # 或直接带上
#>
param([string]$Token)

$credsPath = Join-Path $env:USERPROFILE '.dsh\.credentials.yaml'
if (-not (Test-Path $credsPath)) { Write-Host "✗ 找不到凭据库：$credsPath"; exit 1 }

if (-not $Token) { $Token = (Read-Host '粘贴控制台 token（Bearer 后面那串）').Trim() }
$Token = $Token -replace '^Bearer\s+', ''
$Token = $Token.Trim('"', "'", ' ')
if ($Token.Length -lt 20) { Write-Host '✗ token 太短，已中止'; exit 1 }

# 用今天的窗口做一次校验，避免把无效 token 写进去
$dayStart = [int][Math]::Floor(([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 28800) / 86400) * 86400 - 28800
$url = "https://platform.deepseek.com/api/v0/usage/by_api_key/cost?start=$dayStart&end=$($dayStart + 86400)&tz=28800"
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0'
$body = (& curl.exe -s -m 20 -H "authorization: Bearer $Token" -H "user-agent: $ua" -H 'accept: */*' $url) -join ''
if ($body -notmatch '"code":\s*0[,\}]') {
  Write-Host ('✗ 校验失败：' + $body.Substring(0, [Math]::Min(140, $body.Length)))
  exit 1
}

# 写入凭据库（refs 里的一行）；插件每次请求都会重新解析，无需重启
$creds = Get-Content $credsPath -Raw
if ($creds -match 'DEEPSEEK_PLATFORM_TOKEN') {
  $creds = $creds -replace '(?m)^(\s*)DEEPSEEK_PLATFORM_TOKEN:.*$', "`$1DEEPSEEK_PLATFORM_TOKEN: $Token"
} else {
  $creds = $creds -replace '(?m)^(  SILICONFLOW_API_KEY:.*)$', "`$1`n  DEEPSEEK_PLATFORM_TOKEN: $Token"
}
Set-Content -Path $credsPath -Value $creds -NoNewline -Encoding UTF8

$today = ([regex]::Match($body, '"currency":"(\w+)"')).Groups[1].Value
Write-Host '✓ token 有效，已写入凭据库；浮标的「今日」会在下一次轮询（≤60 秒）出现'
