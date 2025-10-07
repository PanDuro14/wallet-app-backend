# 1) Copia y descomprime para inspeccionar
Copy-Item .\73ef6876-8d19-4dc3-a2b3-a8bde9c647e5.pkpass .\73ef6876-8d19-4dc3-a2b3-a8bde9c647e5.zip
Expand-Archive .\73ef6876-8d19-4dc3-a2b3-a8bde9c647e5.zip -DestinationPath .\ABC124

# 2) Revisa el pass.json bonito
Get-Content .\73ef6876-8d19-4dc3-a2b3-a8bde9c647e5\pass.json -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 32

# 3) Verifica que existan los assets
Get-ChildItem .\73ef6876-8d19-4dc3-a2b3-a8bde9c647e5\*.png













