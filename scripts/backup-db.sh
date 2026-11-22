#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/root/nobai245-backups"
RETENTION_DAYS=14
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_FILE="${BACKUP_DIR}/nobai245_pg_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Iniciando backup do PostgreSQL (nobai245-db)..."
docker exec nobai245-db pg_dump -U postgres nobai245 | gzip > "${BACKUP_FILE}"

# Remove backups mais antigos que RETENTION_DAYS
find "${BACKUP_DIR}" -type f -name "nobai245_pg_*.sql.gz" -mtime +${RETENTION_DAYS} -delete

echo "[$(date)] Backup concluido com sucesso: ${BACKUP_FILE}"
