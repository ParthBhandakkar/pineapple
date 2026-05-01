param(
  [string]$Base = "https://pineapplee.com",
  [Parameter(Mandatory = $true)] [string]$Email,
  [string]$Password = "TestPass123!",
  [Parameter(Mandatory = $true)] [string]$Name,
  [string]$ModelCode = "deepseek-v3-2",
  [string]$Prompt = "Reply with the single word: ok"
)

$ErrorActionPreference = "Stop"

function Show-Step([string]$Label) { Write-Host ""; Write-Host "==== $Label ====" -ForegroundColor Cyan }

$session = $null
$loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json
$loginResp = Invoke-WebRequest -Uri "$Base/api/auth/login" -Method Post -ContentType 'application/json' -Body $loginBody -UseBasicParsing -SessionVariable session
Show-Step "Login as $Email"
"  STATUS: $($loginResp.StatusCode)"

Show-Step "Bootstrap"
$boot = (Invoke-WebRequest -Uri "$Base/api/bootstrap" -Method Get -UseBasicParsing -WebSession $session).Content | ConvertFrom-Json
"  user.id      : $($boot.user.id)"
"  user.email   : $($boot.user.email)"
"  plan.code    : $($boot.entitlement.plan.code)"
"  wallet.sub   : $($boot.wallet.subscriptionTokensRemaining)"
"  wallet.pur   : $($boot.wallet.purchasedTokensRemaining)"
"  conversations: $($boot.conversations.Count)"
$deployed = @($boot.userAgents | Where-Object { $_.status -eq 'DEPLOYED' })
"  deployedAgts : $($deployed.Count)"

if ($deployed.Count -eq 0) {
  Show-Step "Deploy default agent"
  $defaultAgent = $boot.agents | Where-Object { $_.isDefault -eq $true } | Select-Object -First 1
  if (-not $defaultAgent) { $defaultAgent = $boot.agents | Select-Object -First 1 }
  if (-not $defaultAgent) { throw "No agents available to deploy" }
  $deployBody = @{ agentIds = @($defaultAgent.id) } | ConvertTo-Json
  $dr = Invoke-WebRequest -Uri "$Base/api/agents/deploy" -Method Post -ContentType 'application/json' -Body $deployBody -UseBasicParsing -WebSession $session
  "  status: $($dr.StatusCode); deployed agent: $($defaultAgent.name)"
  $boot = (Invoke-WebRequest -Uri "$Base/api/bootstrap" -Method Get -UseBasicParsing -WebSession $session).Content | ConvertFrom-Json
  $deployed = @($boot.userAgents | Where-Object { $_.status -eq 'DEPLOYED' })
  "  deployedAgts now: $($deployed.Count)"
}

Show-Step "Create conversation"
$convBody = @{ title = "QA chat for $Name"; agentId = $deployed[0].agentId } | ConvertTo-Json
$conv = ((Invoke-WebRequest -Uri "$Base/api/conversations" -Method Post -ContentType 'application/json' -Body $convBody -UseBasicParsing -WebSession $session).Content | ConvertFrom-Json).conversation
"  conversationId: $($conv.id)"

Show-Step "Send chat prompt (model=$ModelCode)"
$chatBody = @{ prompt = $Prompt; modelCode = $ModelCode; conversationId = $conv.id; agentId = $deployed[0].agentId } | ConvertTo-Json
$started = Get-Date
try {
  $chatResp = Invoke-WebRequest -Uri "$Base/api/chat" -Method Post -ContentType 'application/json' -Body $chatBody -UseBasicParsing -WebSession $session -TimeoutSec 120
  $elapsed = (Get-Date) - $started
  "  STATUS: $($chatResp.StatusCode)  elapsed: $([Math]::Round($elapsed.TotalSeconds,1))s"
  $cj = $chatResp.Content | ConvertFrom-Json
  "  task.id    : $($cj.task.id)"
  "  task.status: $($cj.status)"
  $script:taskId = $cj.task.id
} catch {
  $st = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { 'n/a' }
  $body = ''
  if ($_.Exception.Response) {
    try { $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); $body = $reader.ReadToEnd() } catch {}
  }
  Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "  STATUS: $st"
  Write-Host "  BODY  : $body"
  exit 1
}

Show-Step "Poll for task settlement"
$pollDeadline = (Get-Date).AddSeconds(180)
$boot2 = $null
while ((Get-Date) -lt $pollDeadline) {
  Start-Sleep -Seconds 4
  $boot2 = (Invoke-WebRequest -Uri "$Base/api/bootstrap" -Method Get -UseBasicParsing -WebSession $session).Content | ConvertFrom-Json
  $task = $boot2.tasks | Where-Object { $_.id -eq $script:taskId }
  if ($task) {
    "  poll @ $([DateTime]::Now.ToString('HH:mm:ss')) -> $($task.status)"
    if ($task.status -in @('COMPLETED', 'FAILED', 'PENDING_APPROVAL', 'REJECTED')) {
      "  final status : $($task.status)"
      "  final cost   : $($task.tokenCost)"
      if ($task.status -eq 'FAILED') {
        Write-Host "  FAILURE BODY: $($task.result)" -ForegroundColor Red
      }
      break
    }
  }
}

if (-not $boot2) {
  $boot2 = (Invoke-WebRequest -Uri "$Base/api/bootstrap" -Method Get -UseBasicParsing -WebSession $session).Content | ConvertFrom-Json
}

Show-Step "Inspect conversation"
$myConv = $boot2.conversations | Where-Object { $_.id -eq $conv.id }
"  messages: $($myConv.messages.Count)"
$assistantMsgs = @($myConv.messages | Where-Object { $_.role -eq 'ASSISTANT' })
"  assistant messages: $($assistantMsgs.Count)"
if ($assistantMsgs.Count -gt 0) {
  $last = $assistantMsgs[-1]
  $preview = $last.content.Substring(0, [Math]::Min(400, $last.content.Length))
  "  last assistant content preview:"
  "  $preview"
}

Show-Step "Conversation IDs the user can see"
foreach ($c in $boot2.conversations | Select-Object -First 5) { "  $($c.id) | $($c.title)" }

return $conv.id
