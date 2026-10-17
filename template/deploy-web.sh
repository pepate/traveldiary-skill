#!/usr/bin/env bash
# Baut die Seite und lädt dist/ auf den Linevast-Webspace (cPanel) per SSH hoch, inkl. .htaccess + .htpasswd (Basic Auth).
# Zugangsdaten in .env.web (nicht im Git):  WEB_HOST=…  WEB_USER=…  WEB_PORT=22  WEB_DIR=public_html/camper  WEB_AUTH="user:passwort,user2:passwort2"
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env.web ] && set -a && . ./.env.web && set +a
: "${WEB_HOST:?WEB_HOST fehlt (.env.web)}" "${WEB_USER:?WEB_USER fehlt}" "${WEB_DIR:?WEB_DIR fehlt}"
WEB_PORT="${WEB_PORT:-22}"
WEB_KEY="${WEB_KEY:-$HOME/.ssh/camper_web}"
SSH="ssh -o BatchMode=yes -p $WEB_PORT -i $WEB_KEY $WEB_USER@$WEB_HOST"

[ "${1:-}" = "--no-build" ] || npm run build

# Passwortschutz: .htpasswd aus WEB_AUTH erzeugen (apr1, wie htpasswd -m)
STAGE="$(mktemp -d)"
cp -r dist/. "$STAGE/"
cp web/.htaccess "$STAGE/.htaccess"
if [ -n "${WEB_AUTH:-}" ]; then
  : > "$STAGE/.htpasswd"
  IFS=',' read -ra PAIRS <<< "$WEB_AUTH"
  for pair in "${PAIRS[@]}"; do
    u="${pair%%:*}"; p="${pair#*:}"
    echo "$u:$(openssl passwd -apr1 "$p")" >> "$STAGE/.htpasswd"
  done
  # AuthUserFile braucht einen absoluten Pfad auf dem Server
  HOME_DIR="$($SSH 'echo $HOME')"
  sed -i "s#__HTPASSWD__#$HOME_DIR/$WEB_DIR/.htpasswd#" "$STAGE/.htaccess"
else
  echo "⚠ WEB_AUTH leer – Seite wird OHNE Passwort veröffentlicht"
  sed -i '/# AUTH-START/,/# AUTH-END/d' "$STAGE/.htaccess"
fi

# Inkrementell: nur Dateien hochladen, deren Hash sich seit dem letzten erfolgreichen Deploy geändert hat
# (.deploy-manifest lokal, nicht im Git). --full erzwingt alles.
MANIFEST=.deploy-manifest
( cd "$STAGE" && find . -type f -print0 | sort -z | xargs -0 md5sum ) > "$STAGE.new"
if [ "${1:-}" = "--full" ] || [ "${2:-}" = "--full" ] || [ ! -f "$MANIFEST" ]; then
  LIST="$(cut -c35- "$STAGE.new")"
else
  LIST="$(comm -13 <(sort "$MANIFEST") <(sort "$STAGE.new") | cut -c35-)"
fi
COUNT=$(printf '%s
' "$LIST" | grep -c . || true)
echo "→ Upload nach $WEB_USER@$WEB_HOST:$WEB_DIR ($COUNT Dateien)"
if [ "$COUNT" -gt 0 ]; then
  printf '%s
' "$LIST" | tar -C "$STAGE" -cf - -T - | $SSH "mkdir -p '$WEB_DIR' && tar -C '$WEB_DIR' -xf -"
fi
$SSH "du -sh '$WEB_DIR'"
mv "$STAGE.new" "$MANIFEST"
rm -rf "$STAGE"
echo "✓ fertig"
