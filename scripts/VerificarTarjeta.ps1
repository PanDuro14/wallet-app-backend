# 1) Copia y descomprime para inspeccionar
Copy-Item .\48f441ab-71de-49d2-a853-94f249680b74.pkpass .\48f441ab-71de-49d2-a853-94f249680b74.zip
Expand-Archive .\48f441ab-71de-49d2-a853-94f249680b74.zip -DestinationPath .\ABC124

# 2) Revisa el pass.json bonito
Get-Content .\48f441ab-71de-49d2-a853-94f249680b74\pass.json -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 32

# 3) Verifica que existan los assets
Get-ChildItem .\48f441ab-71de-49d2-a853-94f249680b74\*.png













