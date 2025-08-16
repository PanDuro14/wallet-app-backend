# 1) Copia y descomprime para inspeccionar
Copy-Item .\ABC124.pkpass .\ABC124.zip
Expand-Archive .\ABC124.zip -DestinationPath .\ABC124

# 2) Revisa el pass.json bonito
Get-Content .\ABC124\pass.json -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 32

# 3) Verifica que existan los assets
Get-ChildItem .\ABC124\*.png













