# 🎯 MediaTech Streamer - Deployment Guide

MediaTech Streamer is a professional-grade WHIP (WebRTC-HTTP Ingestion Protocol) broadcaster designed for Twitch. Follow these instructions to deploy the application successfully.

---

## ⚠️ Critical Requirement: HTTPS
Modern browsers **block** access to the Camera, Microphone, and Screen Sharing unless the site is served over **HTTPS** (Secure Context). 
- **Development**: `localhost` is treated as a secure context.
- **Production**: You **MUST** use an SSL certificate (Let's Encrypt, Cloudflare, etc.).

---

## 📦 Option 1: Deploy with Docker (Recommended)

This is the fastest way to get a production-ready environment running locally or on a VPS.

### 1. Build and Start
Ensure you have Docker and Docker Compose installed, then run:
```bash
docker-compose up -d --build
```

### 2. Access the App
- Open your browser to `http://localhost:8080`.
- The container uses Nginx to serve the app with the correct MIME types for ESM.

### 3. (Production) Add SSL
If deploying to a server, use a reverse proxy like **Nginx Proxy Manager** or **Traefik** to provide SSL termination for the container.

---

## 🌐 Option 2: Static Cloud Hosting (Vercel, Netlify, Cloudflare)

Since this app is client-side driven, you can host it for free on most static platforms.

### 1. Upload to GitHub
Initialize a repository and push your code:
```bash
git init
git add .
git commit -m "initial commit"
git remote add origin <your-repo-url>
git push -u origin main
```

### 2. Connect to Hosting
- **Vercel**: Import the project. It will automatically detect the `index.html`.
- **Netlify**: Drag and drop the folder or connect your GitHub repo.
- **GitHub Pages**: Go to Settings > Pages and set the source to the `main` branch.

---

## 🛠 Option 3: Manual Local Development

If you just want to test changes quickly:

### 1. Using a Python Server (Fastest)
```bash
# This will start a server on port 8000
python3 -m http.server 8000
```

### 2. Using VS Code "Live Server"
- Install the **Live Server** extension.
- Click **"Go Live"** in the bottom right corner of VS Code.

---

## 🎮 Setting Up Twitch WHIP

To actually start streaming, you need your Twitch credentials.

1. **Get your Stream Key**:
   - Go to the [Twitch Creator Dashboard](https://dashboard.twitch.tv/settings/stream).
   - Copy your **Primary Stream Key**.

2. **Configure the App**:
   - Open MediaTech Streamer.
   - Click **"Start Producer Engine"** to initialize your camera.
   - Paste your **Stream Key** into the settings panel on the right.
   - Click **"Go Live"**.

3. **Monitor Connection**:
   - Check the **Engine Logs** at the bottom right.
   - Look for `Twitch handshake successful`.
   - Your stream will appear on your Twitch channel with <1s latency.

---

## 🧪 Testing and Validation

- **Desktop**: Test on Chrome or Edge for the best WebRTC performance.
- **Mobile**: Supports iOS Safari and Android Chrome. Ensure you have granted "Camera" and "Microphone" permissions in system settings.
- **Firewalls**: WHIP uses UDP port `4443` for the initial handshake and standard WebRTC ports for media. Ensure your network doesn't block outgoing UDP traffic.

---

## 🔧 Troubleshooting Deployment

- **Blank Screen**: Check the browser console (F12). Ensure `index.tsx` is being loaded and that the `importmap` is valid.
- **MIME Type Errors**: If you see "Failed to load module script: The server responded with a non-JavaScript MIME type", ensure your web server is configured to serve `.tsx` and `.ts` as `text/javascript` (This is handled automatically in the included `nginx.conf`).
- **WebRTC Failed**: Usually caused by a restrictive corporate firewall or VPN. Try switching to a different network.