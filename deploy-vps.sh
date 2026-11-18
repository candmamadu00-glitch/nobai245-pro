#!/usr/bin/env bash
set -euo pipefail

echo "============================================================"
echo "  DEPLOY PRODUCAO - NO BAI 245 (BACKEND + WEB-ADMIN + SSL)"
echo "============================================================"

if [ ! -f ".env" ]; then
  echo "[ERRO] Arquivo .env nao encontrado na raiz. Copie .env.example para .env antes de iniciar."
  exit 1
fi

if [ ! -f "backend/.env" ]; then
  echo "[ERRO] Arquivo backend/.env nao encontrado."
  exit 1
fi

if [ ! -f "web-admin/.env" ]; then
  echo "[ERRO] Arquivo web-admin/.env nao encontrado."
  exit 1
fi

echo "[1/4] Construindo imagens de producao (API + Web-Admin)..."
docker compose build --pull

echo "[2/4] Subindo banco PostgreSQL, Redis, API, Web-Admin e Proxy SSL..."
docker compose up -d

echo "[3/4] Sincronizando schema do banco de dados (Prisma)..."
if [ -d "backend/prisma/migrations" ] && [ "$(ls -A backend/prisma/migrations 2>/dev/null)" ]; then
  docker compose exec -T nobai245-api npx prisma migrate deploy
else
  docker compose exec -T nobai245-api npx prisma db push
fi

echo "[4/4] Verificando saude dos servicos..."
sleep 5
docker compose ps
docker compose exec -T nobai245-api node -e "fetch('http://127.0.0.1:3333/health').then(async r => { console.log('Health HTTP:', r.status, await r.text()); process.exit(r.ok ? 0 : 1); })"

echo "============================================================"
echo "  [OK] NO BAI 245 ONLINE EM PRODUCAO!"
echo "============================================================"
