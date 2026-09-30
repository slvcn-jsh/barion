---
name: powershell-principles
description: Baseline standard for secure, production-grade PowerShell scripting, strict mode enforcement, parameter validation, and anti-malware execution defense.
origin: sauron
---

# PowerShell Engineering Principles

Enforce structured, robust, and secure PowerShell scripting across administration tools, CI/CD automation, and deployment engines. Prohibit dangerous dynamic execution sinks, enforce strict parameter validation, and guarantee fail-closed error handling.

## When to Activate

- Writing, modifying, or reviewing PowerShell scripts (`.ps1`) and binary modules (`.psm1`, `.psd1`).
- Scaffolding Windows automation pipelines, deployment tasks, or provisioning hooks.
- Auditing PowerShell scripts for injection risks, credential leakage, or execution policy violations.

## Core Concepts

### 1. Robust Scripting Architecture and Fail-Closed Execution

- Always declare `[CmdletBinding()]` and explicit `param()` blocks at the beginning of scripts and functions to enable advanced cmdlet behaviors (such as `-Verbose` and `-WhatIf`).
- Mandate fail-closed error handling by setting `$ErrorActionPreference = 'Stop'` at script initialization. Non-terminating errors must be promoted to terminating exceptions.
- Enable `Set-StrictMode -Version Latest` to catch uninitialized variables, invalid property lookups, and deprecated indexing patterns at runtime.
- Follow the approved PowerShell verb naming taxonomy (`Get`, `Set`, `New`, `Remove`, `Invoke`, `Test`, `Export`, `Import`). Never author custom or non-approved verbs.

### 2. Parameter Validation and Typing

- Strongly type every parameter (such as `[string]`, `[int]`, `[switch]`, `[FileInfo]`).
- Apply defensive parameter validation attributes (`[ValidateNotNullOrEmpty()]`, `[ValidateSet()]`, `[ValidateRange()]`, `[ValidatePattern()]`).
- Implement `[System.IO.Path]::GetFullPath()` or `Resolve-Path` for filesystem operations rather than relying on current working directory assumptions.

### 3. Pipeline and Object Stream Hygiene

- Emit structured objects (`[PSCustomObject]`) across the pipeline instead of formatted text or raw strings. Leave string formatting to the consumer via `Format-Table` or `Out-String`.
- Use the pipeline efficiently by implementing `process {}` blocks in reusable functions.
- Release external handles and unmanaged resources using `try { ... } finally { ... }` blocks.

## Security and Anti-Malware Directives

1. **Absolute Ban on `Invoke-Expression` (`iex`):** Never pipe strings, network downloads, or user parameters into `Invoke-Expression`. `Invoke-Expression` is a critical command injection vulnerability and the primary vector for malicious fileless script payloads.
2. **Prohibit Unverified Web Execution:** Never execute scripts downloaded directly from the internet (`irm <url> | iex` or `Invoke-WebRequest <url> | powershell`). Always download to a quarantine directory, verify cryptographic hashes against a trusted manifest, and inspect content before execution.
3. **Execution Policy Integrity:** Never distribute scripts that permanently weaken machine execution policy (`Set-ExecutionPolicy Unrestricted -Scope LocalMachine`). When execution is required in automated environments, constrain scope strictly to the process boundary (`-Scope Process`).
4. **Secure Credential Management:** Never accept or store credentials in plain text strings. Use `[System.Security.SecureString]` or standard secret stores (`Microsoft.PowerShell.SecretManagement`).
5. **Sanitize External Process Arguments:** When calling native Windows executables (`cmd.exe`, `git.exe`, `docker.exe`), pass arguments as an explicit array rather than a single concatenated string to avoid argument injection.

## Code Examples

### Production-Grade Hardened PowerShell Script Example

```powershell
<#
.SYNOPSIS
    Secure deployment artifact builder following Sauron PowerShell principles.
.DESCRIPTION
    Validates inputs, enforces strict error control, and builds release artifacts safely.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param (
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateNotNullOrEmpty()]
    [ValidatePattern('^[a-zA-Z0-9_\-\.]+$')]
    [string]$ReleaseTag,

    [Parameter(Mandatory = $false)]
    [ValidateNotNullOrEmpty()]
    [string]$TargetDirectory = "$PSScriptRoot\dist",

    [Parameter(Mandatory = $false)]
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
    # Resolve and validate full destination path
    $ResolvedTarget = [System.IO.Path]::GetFullPath($TargetDirectory)

    if (-not (Test-Path -LiteralPath $ResolvedTarget)) {
        if ($PSCmdlet.ShouldProcess($ResolvedTarget, "Create Directory")) {
            $null = New-Item -ItemType Directory -LiteralPath $ResolvedTarget -Force
            Write-Verbose "Created destination folder: $ResolvedTarget"
        }
    }

    $ManifestPath = Join-Path -Path $ResolvedTarget -ChildPath "manifest-$ReleaseTag.json"

    if ((Test-Path -LiteralPath $ManifestPath) -and (-not $Force)) {
        throw "Target manifest already exists at $ManifestPath. Use -Force to overwrite."
    }

    $ManifestData = [PSCustomObject]@{
        ReleaseTag   = $ReleaseTag
        GeneratedAt  = (Get-Date).ToUniversalTime().ToString("o")
        BuiltBy      = $env:USERNAME
        ChecksumAlgorithm = "SHA256"
    }

    if ($PSCmdlet.ShouldProcess($ManifestPath, "Write Release Manifest")) {
        $JsonContent = $ManifestData | ConvertTo-Json -Depth 4
        Set-Content -LiteralPath $ManifestPath -Value $JsonContent -Encoding utf8NoBOM
        Write-Verbose "Successfully wrote manifest to $ManifestPath"
    }

    # Emit structured output to pipeline
    [PSCustomObject]@{
        Status   = "Success"
        Artifact = $ManifestPath
    }
}
catch {
    Write-Error "Deployment artifact build failed: $_"
    exit 1
}
```

## Anti-Patterns

- **AP-14 (Leaking secrets):** Writing plaintext passwords, tokens, or private keys inside `.ps1` files.
- **AP-28 (No stop condition):** Unbounded loops querying external services without timeout counters.
- **AP-52 (Fake fix):** Suppressing terminating script errors with `$ErrorActionPreference = 'SilentlyContinue'` to mask failures.

## Best Practices

- Validate all PowerShell scripts using PSScriptAnalyzer (`Invoke-ScriptAnalyzer -Path .`).
- Prefer `-LiteralPath` over `-Path` when handling user-provided file paths to prevent wildcard expansion attacks.
- Format all files with UTF-8 without BOM encoding (`utf8NoBOM`).

## Related Skills

- [shell-scripting-principles](file:///C:/Users/IGING/Documents/GitHub/sauron/skills/devops/shell-scripting-principles/SKILL.md)
- [windows-cmd-principles](file:///C:/Users/IGING/Documents/GitHub/sauron/skills/devops/windows-cmd-principles/SKILL.md)
- [security-audit](file:///C:/Users/IGING/Documents/GitHub/sauron/core/skills/security/security-audit.md)
