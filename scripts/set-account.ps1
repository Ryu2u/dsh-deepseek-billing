<#
  配置「今日消费」的自动续期账号（只需要跑一次）。

  它把手机号 + Windows DPAPI（CurrentUser）加密后的密码写到：
      %USERPROFILE%\.dsh\deepseek-billing\account.json
  密码在磁盘上只有 DPAPI 密文，只有当前 Windows 账号能解开；插件在控制台 token
  失效时才会用它调 /auth-api/v0/users/login 换新 token。

  用法：
      pwsh -File set-account.ps1                 # 交互输入密码
      pwsh -File set-account.ps1 -Mobile 138...  # 换手机号
  改密码后重跑一次即可。
#>
param(
  [string]$Mobile = '',
  [string]$AreaCode = '+86',
  [string]$DeviceId = ''
)

$accountDir = Join-Path $env:USERPROFILE '.dsh\deepseek-billing'
$accountPath = Join-Path $accountDir 'account.json'
$credsPath = Join-Path $env:USERPROFILE '.dsh\.credentials.yaml'

if (-not $Mobile) { $Mobile = (Read-Host '手机号').Trim() }
if (-not $DeviceId) { $DeviceId = [Convert]::ToBase64String((1..66 | ForEach-Object { Get-Random -Maximum 256 })) }
if ($Mobile -notmatch '^\d{6,15}$') { Write-Host '✗ 手机号格式不对'; exit 1 }

$secure = Read-Host '账号密码（输入不回显）' -AsSecureString
$plain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if ($plain.Length -lt 6) { Write-Host '✗ 密码太短'; exit 1 }

Add-Type -AssemblyName System.Security
$blob = [System.Security.Cryptography.ProtectedData]::Protect(
  [Text.Encoding]::UTF8.GetBytes($plain), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
$plain = $null
New-Item -ItemType Directory -Force -Path $accountDir | Out-Null
$account = [ordered]@{
  mobile = $Mobile
  areaCode = $AreaCode
  deviceId = $DeviceId
  passwordProtected = [Convert]::ToBase64String($blob)
  updatedAt = (Get-Date).ToString('s')
}
Set-Content -Path $accountPath -Value ($account | ConvertTo-Json) -Encoding UTF8
Write-Host "✓ 已写入 $accountPath（密码为 DPAPI 密文）"

# 顺手验证一次登录，并把拿到的 token 直接写进凭据库
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0'
$decrypted = [Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect($blob, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser))
$loginBody = @{ email = ''; mobile = $Mobile; password = $decrypted; area_code = $AreaCode; device_id = $DeviceId; os = 'web' } | ConvertTo-Json -Compress
$decrypted = $null
$tmp = Join-Path $env:TEMP ('dsb-login-' + [guid]::NewGuid().ToString('N') + '.json')
Set-Content -Path $tmp -Value $loginBody -NoNewline -Encoding UTF8
$resp = (& curl.exe -s -m 25 -H 'content-type: application/json' -H "user-agent: $ua" -H 'accept: */*' --data-binary "@$tmp" 'https://platform.deepseek.com/auth-api/v0/users/login') -join ''
Remove-Item $tmp -Force
$token = ([regex]::Match($resp, '"token":"([^"]+)"')).Groups[1].Value
if ($token.Length -lt 20) {
  Write-Host ('✗ 登录未成功：' + $resp.Substring(0, [Math]::Min(160, $resp.Length)))
  Write-Host '  （账号文件已保存，改好密码后重跑本脚本即可）'
  exit 1
}
$creds = Get-Content $credsPath -Raw
if ($creds -match 'DEEPSEEK_PLATFORM_TOKEN') {
  $creds = $creds -replace '(?m)^(\s*)DEEPSEEK_PLATFORM_TOKEN:.*$', "$1DEEPSEEK_PLATFORM_TOKEN: $token"
} else {
  $creds = $creds -replace '(?m)^(  SILICONFLOW_API_KEY:.*)$', "$1
  DEEPSEEK_PLATFORM_TOKEN: $token"
}
Set-Content -Path $credsPath -Value $creds -NoNewline -Encoding UTF8
Write-Host '✓ 登录成功，token 已写入凭据库；插件以后会自己续期'

