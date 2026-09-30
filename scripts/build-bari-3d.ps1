<#
.SYNOPSIS
    Builds Barion's rigged and animated Bari GLB with Blender.
#>
[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [ValidateNotNullOrEmpty()]
    [string]$BlenderPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $PSScriptRoot -ChildPath '..'))
$buildScript = [System.IO.Path]::GetFullPath((Join-Path -Path $PSScriptRoot -ChildPath '3d\build_bari_rig.py'))
$inputAsset = [System.IO.Path]::GetFullPath((Join-Path -Path $repoRoot -ChildPath 'assets\3d\bari\bari_prototype_static.glb'))
$outputAsset = [System.IO.Path]::GetFullPath((Join-Path -Path $repoRoot -ChildPath 'assets\3d\bari\bari_animated.glb'))
$blendOutput = [System.IO.Path]::GetFullPath((Join-Path -Path $repoRoot -ChildPath 'assets\3d\bari\source\bari_rigged.blend'))
$reportOutput = [System.IO.Path]::GetFullPath((Join-Path -Path $repoRoot -ChildPath 'assets\3d\bari\bari_animated.report.json'))
$temporaryDirectory = [System.IO.Path]::GetFullPath((Join-Path -Path $repoRoot -ChildPath '.tmp\bari-build'))
$successMarker = Join-Path -Path $temporaryDirectory -ChildPath ("{0}.ok" -f [System.Guid]::NewGuid().ToString('N'))

if (-not (Test-Path -LiteralPath $buildScript -PathType Leaf)) {
    throw "Bari Blender build script not found: $buildScript"
}
if (-not (Test-Path -LiteralPath $inputAsset -PathType Leaf)) {
    throw "Static Bari source asset not found: $inputAsset"
}

if ([string]::IsNullOrWhiteSpace($BlenderPath)) {
    $blenderCommand = Get-Command -Name 'blender' -ErrorAction SilentlyContinue
    if ($null -ne $blenderCommand) {
        $BlenderPath = $blenderCommand.Source
    }
    else {
        $candidatePaths = Get-ChildItem -LiteralPath 'C:\Program Files\Blender Foundation' -Filter 'blender.exe' -Recurse -ErrorAction SilentlyContinue |
            Sort-Object -Property FullName -Descending |
            Select-Object -ExpandProperty FullName
        $BlenderPath = $candidatePaths | Select-Object -First 1
    }
}

if ([string]::IsNullOrWhiteSpace($BlenderPath)) {
    throw 'Blender was not found. Install Blender 5.x or pass -BlenderPath.'
}

$resolvedBlender = (Resolve-Path -LiteralPath $BlenderPath).Path
$blenderArguments = @(
    '--background',
    '--python', $buildScript,
    '--',
    '--input', $inputAsset,
    '--output', $outputAsset,
    '--blend-output', $blendOutput,
    '--report', $reportOutput,
    '--success-marker', $successMarker
)

try {
    $null = New-Item -ItemType Directory -Path $temporaryDirectory -Force
    & $resolvedBlender @blenderArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Blender Bari build failed with exit code $LASTEXITCODE."
    }

    if (-not (Test-Path -LiteralPath $successMarker -PathType Leaf)) {
        throw 'Blender stopped before Bari validation completed.'
    }
    if (-not (Test-Path -LiteralPath $outputAsset -PathType Leaf)) {
        throw "Blender completed without producing expected asset: $outputAsset"
    }

    [PSCustomObject]@{
        Status = 'Success'
        Asset = $outputAsset
        BlendSource = $blendOutput
        Report = $reportOutput
    }
}
finally {
    if (Test-Path -LiteralPath $successMarker -PathType Leaf) {
        Remove-Item -LiteralPath $successMarker -Force
    }
}
