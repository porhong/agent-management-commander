param([string]$Path = '.')
Get-ChildItem $Path -Recurse -File | Select-String -Pattern 'AKIA[0-9A-Z]{16}' -List
