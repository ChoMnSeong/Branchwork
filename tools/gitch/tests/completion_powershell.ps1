param([Parameter(Mandatory = $true)][string]$CompletionScript)

$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($CompletionScript, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
. $CompletionScript

function Get-GitchMatches([string]$Line) {
    $result = [System.Management.Automation.CommandCompletion]::CompleteInput($Line, $Line.Length, $null)
    return @($result.CompletionMatches | ForEach-Object { $_.CompletionText })
}

function Read-CompletedArgument([string]$Candidate) {
    $parsedTokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput('gitch g ' + $Candidate, [ref]$parsedTokens, [ref]$errors)
    if ($errors.Count -gt 0) { throw ('Invalid completion quote: ' + $Candidate) }
    $command = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true)
    if ($command.CommandElements.Count -ne 3) { throw ('Completion split an argument: ' + $Candidate) }
    $argument = $command.CommandElements[2]
    if ($argument -isnot [System.Management.Automation.Language.StringConstantExpressionAst]) {
        throw ('Completion produced an expression: ' + $Candidate)
    }
    return $argument.Value
}

$repos = @(Get-GitchMatches 'gitch g Project')
$branches = @(Get-GitchMatches 'gitch b feature/')
$quoted = @(Get-GitchMatches 'gitch g "Project with "')
$languageLine = 'gitch g --lang ts,py'
$languageResult = [System.Management.Automation.CommandCompletion]::CompleteInput($languageLine, $languageLine.Length, $null)
$completedLanguageLine = $languageLine.Substring(0, $languageResult.ReplacementIndex) + $languageResult.CompletionMatches[0].CompletionText + $languageLine.Substring($languageResult.ReplacementIndex + $languageResult.ReplacementLength)
[ordered]@{
    repos = $repos
    repoArguments = @($repos | ForEach-Object { Read-CompletedArgument $_ })
    branches = $branches
    branchArguments = @($branches | ForEach-Object { Read-CompletedArgument $_ })
    quotedArguments = @($quoted | ForEach-Object { Read-CompletedArgument $_ })
    precise = @(Get-GitchMatches 'gitch g --pre')
    watch = @(Get-GitchMatches 'gitch g watch --det')
    languages = @(Get-GitchMatches 'gitch g --lang ts,py')
    completedLanguageLine = $completedLanguageLine
    nativeLanguageArguments = @(& gitch _complete -- g --lang ts,py)
    accounts = @(Get-GitchMatches 'gitch use a')
    subcommands = @(Get-GitchMatches 'gitch g ')
} | ConvertTo-Json -Depth 8 -Compress
