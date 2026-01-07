
# 🎯 Twitch WHIP Broadcaster Pro

A production-grade WebRTC streaming application that broadcasts high-quality video directly to Twitch using the modern **WHIP (WebRTC-HTTP Ingestion Protocol)**.

## 🚀 Setup Instructions

1.  **Local Development**:
    *   This app requires a secure context (HTTPS) or `localhost` to access the camera and microphone.
    *   Host these files on any static web server or development environment.

2.  **Twitch Configuration**:
    *   Go to your [Twitch Stream Settings](https://dashboard.twitch.tv/settings/stream).
    *   Find your **Primary Stream Key**.
    *   Paste this key into the "Twitch Stream Key" field in the app.

3.  **Permissions**:
    *   When you click "Enable Camera & Mic", the browser will prompt for permissions.
    *   The app uses the **VDO.Ninja SDK** principles for robust media capture and device handling.

## 🧱 Technical Details

*   **Ingest Protocol**: WHIP (RFC 9421).
*   **Media Management**: Utilizes `getUserMedia` with ideal constraints for high-fidelity 1080p/720p capture.
*   **WebRTC Stack**: Standard `RTCPeerConnection` with SDP munging logic implemented in `whipClient.ts` to ensure Twitch compatibility.
*   **Keep-Alive**: Implements periodic `OPTIONS` requests to keep the WHIP session active during long broadcasts.

## 🧪 Testing Procedure

1.  Open the app in a browser.
2.  Enable your camera and verify the local preview looks correct.
3.  Enter your Twitch Stream Key.
4.  Click **"Start Broadcast"**.
5.  Check the **Output Monitor** (System Logs) for a "Handshake successful" message.
6.  Open your [Twitch Channel](https://twitch.tv/) to see your live stream with sub-second latency.

## 🔧 Troubleshooting

*   **Error: Handshake failed**: Verify your Stream Key is correct and that your network allows outgoing POST requests on port 4443.
*   **No Devices Found**: Ensure no other application (like OBS or Zoom) is exclusively locking your camera.
*   **Stuttering Video**: Lower the "Target Bitrate" if your upload speed is limited. Twitch recommended max is 6000-8000kbps.
*   **Mobile Usage**: Supported on iOS (Safari) and Android (Chrome). Note that mobile devices might throttle background WebRTC connections.
