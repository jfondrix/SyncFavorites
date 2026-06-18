# SyncFav — Self-Hosted Bookmark Sync Extension

Sync your bookmarks across **Brave, Chrome, and Edge** using your own VPS. No third-party services, no accounts, full privacy.

---

This is the **browser extension** repo. The companion server repo is [SyncFavoritesServer](https://github.com/jfondrix/SyncFavoritesServer).

---

## How it works

- The **browser extension** lets you upload and download your bookmarks to/from your server
- The **server** stores your bookmarks as a JSON file on your VPS
- All requests are protected by a secret token you choose

---

## Setup

### 1. Deploy the server

Clone the server repo on your VPS:

```bash
git clone https://github.com/jfondrix/SyncFavoritesServer.git /opt/syncfav
cd /opt/syncfav
npm install
```

Start it:

```bash
SYNC_TOKEN=your-secret-token PORT=3001 node syncfavserver.js
```

To run it as a background service that survives reboots, create a systemd unit:

```bash
cat > /etc/systemd/system/syncfav.service << 'EOF'
[Unit]
Description=SyncFav Bookmark Server
After=network.target

[Service]
WorkingDirectory=/opt/syncfav
ExecStart=/usr/bin/node syncfavserver.js
Restart=always
Environment=PORT=3001
Environment=SYNC_TOKEN=your-secret-token

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable syncfav
systemctl start syncfav
```

### 2. Set up Nginx + SSL (recommended)

```nginx
server {
    listen 80;
    server_name syncbookmarks.yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Then get a free SSL certificate:

```bash
certbot --nginx -d syncbookmarks.yourdomain.com
```

### 3. Install the extension

1. Download or clone this repo
2. Open `brave://extensions` (or `chrome://extensions` / `edge://extensions`)
3. Enable **Developer mode**
4. Click **Load unpacked** and select this folder
5. Click the extension icon, enter your server URL and token, click **Save Configuration**

---

## API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | None | Health check |
| GET | `/bookmarks` | Bearer token | Retrieve bookmarks |
| PUT | `/bookmarks` | Bearer token | Upload bookmarks |

---

## Requirements

- A VPS or any server running Node.js 16+
- A domain with DNS pointed to your server (optional but recommended for SSL)

---

## Privacy

Your bookmarks never leave your own server. The extension stores your server URL and token in your browser's local storage only.

See [Privacy Policy](https://www.sprintia.eu/privacy).

---

## License

MIT
