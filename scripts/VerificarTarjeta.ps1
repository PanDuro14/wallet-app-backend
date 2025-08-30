# 1) Copia y descomprime para inspeccionar
Copy-Item .\fc462ddd-75a1-435e-891c-aa7f424a781f.pkpass .\fc462ddd-75a1-435e-891c-aa7f424a781f.zip
Expand-Archive .\fc462ddd-75a1-435e-891c-aa7f424a781f.zip -DestinationPath .\ABC124

# 2) Revisa el pass.json bonito
Get-Content .\fc462ddd-75a1-435e-891c-aa7f424a781f\pass.json -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 32

# 3) Verifica que existan los assets
Get-ChildItem .\fc462ddd-75a1-435e-891c-aa7f424a781f\*.png













