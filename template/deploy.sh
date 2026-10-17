#!/usr/bin/env bash
# Baut die Seite und kopiert dist/ auf die Synology (nginx-Container "camper-tagebuch").
# Synology bietet kein SFTP-Subsystem an, deshalb tar-Pipe statt scp (wie bei der Planungs-App).
set -euo pipefail

NAS_USER="${NAS_USER:-pete}"
NAS_HOST="${NAS_HOST:-192.168.178.172}"
NAS_KEY="${NAS_KEY:-$HOME/.ssh/camper_nas}"
NAS_DIR="${NAS_DIR:-/volume1/docker/camper-tagebuch/html}"
PORT="${PORT:-8087}"

echo "→ Upload nach $NAS_USER@$NAS_HOST:$NAS_DIR"
tar -C dist -cf - . | ssh -o BatchMode=yes -i "$NAS_KEY" "$NAS_USER@$NAS_HOST" "mkdir -p '$NAS_DIR' && tar -C '$NAS_DIR' -xf -"
ssh -o BatchMode=yes -i "$NAS_KEY" "$NAS_USER@$NAS_HOST" "du -sh '$NAS_DIR'"
echo "✓ http://$NAS_HOST:$PORT/"
