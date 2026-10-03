# Okna nocne: N pętli w tle, każde zadanie w świeżej sesji Claude'a i we własnym klonie roboczym.
# Dlaczego osobny worktree na okno: dwie sesje piszące w jednym katalogu nadpisują sobie pliki.
# Użycie: pwsh scripts/noc.ps1 -Okna 12 [-Tor dane] [-Model opus]
param(
    [int]$Okna = 6,
    [string]$Tor = '',
    [string]$Model = 'opus'
)
$repo = (git rev-parse --show-toplevel).Trim()
$claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claude) {
    $claude = Get-ChildItem "$env:USERPROFILE\.vscode\extensions\anthropic.claude-code-*\resources\native-binary\claude.exe" |
        Sort-Object FullName | Select-Object -Last 1 -ExpandProperty FullName
}
if (-not $claude) { throw 'Brak CLI claude' }
$logi = Join-Path $repo '.noc'; New-Item -ItemType Directory -Force $logi | Out-Null

1..$Okna | ForEach-Object {
    $i = $_
    $wt = "C:\wt\adresscore\okno-$i"
    Start-Job -Name "okno-$i" -ArgumentList $repo, $wt, $claude, $Tor, $Model, $logi, $i -ScriptBlock {
        param($repo, $wt, $claude, $Tor, $Model, $logi, $i)
        if (-not (Test-Path $wt)) {
            git -C $repo worktree add --detach $wt origin/main | Out-Null
            Copy-Item "$repo\.env.local" $wt -ErrorAction SilentlyContinue
            Push-Location $wt; pnpm install --frozen-lockfile | Out-Null; Pop-Location
        }
        $env:OKNO = "okno-$i@$env:COMPUTERNAME"
        Set-Location $wt
        while ($true) {
            git fetch -q origin main; git switch -q --detach origin/main
            $wynik = node scripts/zadanie.mjs wez $Tor | ConvertFrom-Json
            if (-not $wynik.nr) { Start-Sleep 300; continue }   # pusta kolejka – zajrzyj za 5 min
            $prompt = (Get-Content "$wt\scripts\okno-prompt.md" -Raw).
                Replace('{{NR}}', $wynik.nr).Replace('{{TYTUL}}', $wynik.tytul).Replace('{{GALAZ}}', $wynik.galaz)
            $log = "$logi\okno-$i.log"
            "=== $(Get-Date -f 'HH:mm') #$($wynik.nr) $($wynik.tytul)" | Add-Content $log
            & $claude -p $prompt --model $Model --permission-mode auto -n "okno-$i #$($wynik.nr)" *>> $log
            if ($LASTEXITCODE -ne 0 -and (Get-Content $log -Tail 20 | Select-String 'limit|rate')) {
                node scripts/zadanie.mjs zwolnij $wynik.nr
                Start-Sleep 900                                  # limit planu – poczekaj na reset
            }
        }
    } | Out-Null
    Write-Host "okno-$i ruszyło (log: .noc\okno-$i.log)"
}
Write-Host 'Podgląd: Get-Job | Format-Table; pnpm zadanie lista; Get-Content .noc\okno-1.log -Wait'
