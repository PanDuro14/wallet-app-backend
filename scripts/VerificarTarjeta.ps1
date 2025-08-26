# 1) Copia y descomprime para inspeccionar
Copy-Item .\7aab528b-808c-48ed-94bd-c1117be1e113.pkpass .\7aab528b-808c-48ed-94bd-c1117be1e113.zip
Expand-Archive .\7aab528b-808c-48ed-94bd-c1117be1e113.zip -DestinationPath .\ABC124

# 2) Revisa el pass.json bonito
Get-Content .\7aab528b-808c-48ed-94bd-c1117be1e113\pass.json -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 32

# 3) Verifica que existan los assets
Get-ChildItem .\7aab528b-808c-48ed-94bd-c1117be1e113\*.png













