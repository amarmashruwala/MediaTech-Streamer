
import { LogEntry } from '../types';

export class WHIPClient {
  private pc: RTCPeerConnection | null = null;
  private sessionUrl: string | null = null;
  private keepAliveInterval: number | null = null;

  constructor(
    private endpoint: string,
    private streamKey: string,
    private onLog: (entry: LogEntry) => void
  ) {}

  private log(message: string, level: LogEntry['level'] = 'info') {
    this.onLog({
      timestamp: new Date().toLocaleTimeString(),
      level,
      message
    });
  }

  async start(stream: MediaStream, targetBitrateKbps: number): Promise<void> {
    this.log('Initializing WebRTC PeerConnection for WHIP...', 'info');

    const config: RTCConfiguration = {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      bundlePolicy: 'max-bundle'
    };

    this.pc = new RTCPeerConnection(config);

    // Add tracks to peer connection
    stream.getTracks().forEach(track => {
      this.pc?.addTrack(track, stream);
      this.log(`Track added: ${track.kind} (${track.label})`, 'info');
    });

    // Create and set local description
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    this.log('Broadcasting SDP offer to Twitch WHIP ingest...', 'info');

    // POST offer to Twitch
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
        'Authorization': `Bearer ${this.streamKey}`
      },
      body: offer.sdp
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`WHIP Request Error (${response.status}): ${errorText || 'Unknown Error'}`);
    }

    // RFC 9421: Resource URL for session management
    this.sessionUrl = response.headers.get('Location');
    const answerSdp = await response.text();

    this.log('Twitch handshake successful. Applying answer.', 'success');

    await this.pc.setRemoteDescription({
      type: 'answer',
      sdp: answerSdp
    });

    // Apply bitrate limits after connection is established
    await this.applyBitrateLimit(targetBitrateKbps);
    
    this.setupIceHandlers();
    this.startKeepAlive();
  }

  /**
   * Replaces the current video track in the PeerConnection with a new one.
   * Useful for switching between camera and screen share without re-negotiation.
   */
  async replaceVideoTrack(newTrack: MediaStreamTrack | null) {
    if (!this.pc) return;
    const sender = this.pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender) {
      await sender.replaceTrack(newTrack);
      this.log(`Video track replaced: ${newTrack ? newTrack.label : 'None'}`, 'info');
    }
  }

  /**
   * Replaces the current audio track in the PeerConnection.
   */
  async replaceAudioTrack(newTrack: MediaStreamTrack | null) {
    if (!this.pc) return;
    const sender = this.pc.getSenders().find(s => s.track?.kind === 'audio');
    if (sender) {
      await sender.replaceTrack(newTrack);
      this.log(`Audio track replaced: ${newTrack ? newTrack.label : 'None'}`, 'info');
    }
  }

  private async applyBitrateLimit(kbps: number) {
    if (!this.pc) return;
    const senders = this.pc.getSenders();
    for (const sender of senders) {
      if (sender.track?.kind === 'video') {
        const parameters = sender.getParameters();
        if (!parameters.encodings) parameters.encodings = [{}];
        parameters.encodings[0].maxBitrate = kbps * 1000;
        await sender.setParameters(parameters);
        this.log(`Bitrate cap set to ${kbps}kbps`, 'info');
      }
    }
  }

  private setupIceHandlers() {
    if (!this.pc) return;
    this.pc.oniceconnectionstatechange = () => {
      this.log(`ICE State: ${this.pc?.iceConnectionState}`, 'info');
      if (this.pc?.iceConnectionState === 'failed') {
        this.log('ICE connection failed. Network may be blocking WebRTC.', 'error');
      }
    };
    this.pc.onconnectionstatechange = () => {
      this.log(`Overall Connection: ${this.pc?.connectionState}`, 'info');
    };
  }

  private startKeepAlive() {
    if (!this.sessionUrl) return;
    this.keepAliveInterval = window.setInterval(async () => {
      if (!this.sessionUrl) return;
      try {
        const res = await fetch(this.sessionUrl, {
          method: 'OPTIONS',
          headers: { 'Authorization': `Bearer ${this.streamKey}` }
        });
        if (!res.ok) this.log('Keep-alive session check failed.', 'warn');
      } catch (e) {
        this.log('Network error during keep-alive.', 'warn');
      }
    }, 30000);
  }

  stop() {
    this.log('Shutting down WHIP session...', 'info');
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    
    if (this.pc) {
      this.pc.getSenders().forEach(sender => {
        try { this.pc?.removeTrack(sender); } catch(e) {}
      });
      this.pc.close();
      this.pc = null;
    }
    
    if (this.sessionUrl) {
      const url = this.sessionUrl;
      const key = this.streamKey;
      fetch(url, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${key}` }
      }).catch(() => {});
      this.sessionUrl = null;
    }
  }
}
