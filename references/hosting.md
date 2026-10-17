# Hosting options

`trip.json → output` records the user's choice (`single`, `web`, `nas`). All three start from `npm run build` (→ `dist/`).

## single – one HTML file

```bash
npm run build:single      # → ../<Title>.html next to the project (name from trip title)
```

`scripts/build-single.mjs` builds with vite-plugin-singlefile and embeds all JSON, photos (resized to 1200 px),
POI images and videos up to 8 MB as data URIs in `window.__EMBED__`. Map tiles, terrain and fonts still need
internet. Typical size: 20–50 MB. Send as a *document* (WhatsApp: "Datei", not "Medium").

Limits to tell the user: some mobile browsers block the map's web worker for pages opened from the file
system; the template falls back to a data-URL worker, but if lines and place names stay missing on a phone,
hosting (web/nas) is the reliable path.

## web – shared web space over SSH (cPanel-style)

Needs: SSH access with a key, a (sub)domain with a document root, Apache (`.htaccess` honoured).

1. Key: `ssh-keygen -t ed25519 -N "" -C "traveldiary-deploy" -f ~/.ssh/traveldiary` → the user imports and
   **authorises** the public key in the hosting panel (cPanel: "SSH Access" → "Manage Keys").
2. `cp .env.web.example .env.web` and fill in:
   ```
   WEB_HOST=…   WEB_USER=…   WEB_PORT=22   WEB_DIR=camper.example.com   WEB_KEY=~/.ssh/traveldiary
   WEB_AUTH=friend:secret,family:secret2      # Basic-Auth logins; empty = public site
   ```
   `WEB_DIR` is relative to the SSH user's home (the document root the panel shows for the subdomain).
3. Test: `ssh -i ~/.ssh/traveldiary -p 22 user@host 'echo ok'`.
4. `npm run deploy:web` (= build + `deploy-web.sh`): writes `.htaccess` from `web/.htaccess` (HTTPS redirect,
   Basic Auth with absolute `AuthUserFile`, cache headers), generates `.htpasswd` with `openssl passwd -apr1`,
   uploads only files whose hash changed since the last deploy (`.deploy-manifest`, local). `--full` forces all,
   `--no-build` skips the build. The first upload moves everything (photos!) and can take minutes; later ones
   are seconds.
5. Verify from outside: `curl -sI https://host/` → 401; with `-u user:pass` → 200; a photo URL → 200;
   `/.htpasswd` → 403.

The panel's own `.htaccess` in that folder is replaced; for a static site that is fine.

## nas – Synology / own nginx

`deploy.sh` copies `dist/` by tar pipe over SSH into a folder served by an nginx container (`nas/default.conf`:
Basic Auth for requests from outside the LAN, no-cache for page/data, long cache for media). Set `NAS_USER`,
`NAS_HOST`, `NAS_KEY`, `NAS_DIR` in the script or the environment. HTTPS via the NAS reverse proxy.

## Not recommended

Object storage (GCS/S3 static website) – no password, HTTPS on a custom domain needs a load balancer.
GitHub Pages – public only.
