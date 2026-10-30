param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Alias("Event")][Parameter(Mandatory = $true)][string]$EventName,
  [string]$Marker = "janusx-agent-hook-v2",
  [string]$Matcher = ""
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom

function Write-Diagnostic($Status, $Detail) {
  try {
    $diagnosticPath = Join-Path $PSScriptRoot "janusx-agent-hook-last.json"
    $diagnostic = [ordered]@{
      source = $Source
      event = $EventName
      status = $Status
      detail = $Detail
      hasPort = -not [string]::IsNullOrWhiteSpace($env:JANUSX_HOOK_PORT)
      hasToken = -not [string]::IsNullOrWhiteSpace($env:JANUSX_HOOK_TOKEN)
      terminalId = $env:JANUSX_HOOK_TERMINAL_ID
      workspaceId = $env:JANUSX_HOOK_WORKSPACE_ID
      timestamp = (Get-Date).ToUniversalTime().ToString("o")
    }
    $diagnostic | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $diagnosticPath -Encoding UTF8
  } catch {
  }
}

function Get-FirstString($Value, [string[]]$Names) {
  if ($null -eq $Value -or $Value -is [string]) { return $null }
  $propertyNames = $Value.PSObject.Properties.Name
  foreach ($name in $Names) {
    if ($propertyNames -contains $name) {
      $candidate = $Value.$name
      if ($candidate -is [string] -and -not [string]::IsNullOrWhiteSpace($candidate)) {
        return $candidate
      }
    }
  }
  return $null
}

try {
  $port = $env:JANUSX_HOOK_PORT
  $token = $env:JANUSX_HOOK_TOKEN
  if ([string]::IsNullOrWhiteSpace($port) -or [string]::IsNullOrWhiteSpace($token)) {
    Write-Diagnostic "missing-env" "JANUSX_HOOK_PORT or JANUSX_HOOK_TOKEN is empty"
    exit 0
  }

  # Codex pipes hook stdin as UTF-16LE with a BOM on Windows; Claude pipes
  # UTF-8. Read the raw stream and decode by BOM so both session identities
  # survive — reading UTF-16 bytes as UTF-8 yields NUL-separated mojibake,
  # ConvertFrom-Json then fails, and session_id/thread_id/transcript_path
  # are silently dropped (the terminal never binds its native session).
  $stdinBytes = $null
  if ([Console]::IsInputRedirected) {
    $stdinStream = [Console]::OpenStandardInput()
    $bufferStream = New-Object System.IO.MemoryStream
    try {
      $stdinStream.CopyTo($bufferStream)
      $stdinBytes = $bufferStream.ToArray()
    } finally {
      $bufferStream.Dispose()
      $stdinStream.Dispose()
    }
  }
  $stdinRaw = ""
  if ($null -ne $stdinBytes -and $stdinBytes.Length -ge 2) {
    if ($stdinBytes[0] -eq 0xFF -and $stdinBytes[1] -eq 0xFE) {
      $stdinRaw = [System.Text.Encoding]::Unicode.GetString($stdinBytes).TrimStart([char]0xFEFF)
    } elseif ($stdinBytes[0] -eq 0xFE -and $stdinBytes[1] -eq 0xFF) {
      $stdinRaw = [System.Text.Encoding]::BigEndianUnicode.GetString($stdinBytes).TrimStart([char]0xFEFF)
    } elseif ($stdinBytes.Length -ge 3 -and $stdinBytes[0] -eq 0xEF -and $stdinBytes[1] -eq 0xBB -and $stdinBytes[2] -eq 0xBF) {
      $stdinRaw = [System.Text.Encoding]::UTF8.GetString($stdinBytes, 3, $stdinBytes.Length - 3)
    } else {
      $stdinRaw = [System.Text.Encoding]::UTF8.GetString($stdinBytes)
    }
  }
  $rawValue = $null
  if (-not [string]::IsNullOrWhiteSpace($stdinRaw)) {
    try {
      $rawValue = $stdinRaw | ConvertFrom-Json
    } catch {
      $rawValue = $stdinRaw
    }
  }

  $message = Get-FirstString $rawValue @("message", "prompt", "notification", "reason", "last_assistant_message")
  if (-not $message -and $null -ne $rawValue -and $rawValue -isnot [string]) {
    $propertyNames = $rawValue.PSObject.Properties.Name
    if ($propertyNames -contains "tool_input") {
      $message = Get-FirstString $rawValue.tool_input @("prompt", "description", "task")
    }
  }

  $sessionId = Get-FirstString $rawValue @("session_id", "sessionId", "thread_id", "threadId")
  # Toast/excerpt text never needs more than a head: tool prompts can carry
  # tens of KB that would otherwise ride every POST body inside 'message'.
  if ($message -and $message.Length -gt 2000) { $message = $message.Substring(0, 2000) }

  # Coordinator only reads a handful of raw keys (status/state for opencode
  # rules, matcher/type fallbacks, transcript paths) — never forward the full
  # stdin object: tool_input/tool_response can carry megabytes of file or
  # command text that only slow down serialization and the POST body.
  $rawFiltered = [ordered]@{}
  if ($null -ne $rawValue -and $rawValue -isnot [string]) {
    foreach ($name in @("status", "state", "matcher", "notification_type", "type", "transcript_path", "transcriptPath", "session_id", "sessionId", "thread_id", "threadId")) {
      try {
        if ($rawValue.PSObject.Properties.Name -contains $name) {
          $candidate = $rawValue.$name
          if ($candidate -is [string] -and -not [string]::IsNullOrWhiteSpace($candidate)) {
            if ($candidate.Length -gt 4096) { $candidate = $candidate.Substring(0, 4096) }
            $rawFiltered[$name] = $candidate
          }
        }
      } catch {
      }
    }
    try {
      $rawProps = $rawValue.properties
      if ($null -ne $rawProps -and $rawProps -isnot [string] -and $rawProps.PSObject.Properties.Name -contains "status") {
        $propsStatus = $rawProps.status
        if ($propsStatus -is [string] -and -not [string]::IsNullOrWhiteSpace($propsStatus)) {
          $rawFiltered["properties"] = [ordered]@{ status = $propsStatus }
        }
      }
    } catch {
    }
  }

  $payload = [ordered]@{
    source = $Source
    event = $EventName
    terminalId = $env:JANUSX_HOOK_TERMINAL_ID
    workspaceId = $env:JANUSX_HOOK_WORKSPACE_ID
    sessionId = $sessionId
    cwd = (Get-Location).Path
    message = $message
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
    matcher = $Matcher
    raw = $rawFiltered
  }

  $json = $payload | ConvertTo-Json -Depth 10 -Compress
  $bodyBytes = $utf8NoBom.GetBytes($json)
  $headers = @{ Authorization = "Bearer $token" }
  # Never stall the agent: a stale JANUSX_HOOK_PORT (app restarted, terminal
  # kept) must fail fast instead of blocking the turn on the default 100s timeout.
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/api/agent-hook" -Headers $headers -ContentType "application/json; charset=utf-8" -Body $bodyBytes -TimeoutSec 2 | Out-Null
  Write-Diagnostic "posted" "ok"
} catch {
  Write-Diagnostic "error" $_.Exception.Message
}

exit 0
