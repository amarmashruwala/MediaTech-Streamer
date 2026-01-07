
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

  /**
   * Munges the SDP to inject bitrate limits directly into the handshake.
   * This is more effective than setParameters alone for some browsers.
   */
  private mungeSdp(sdp: string, bitrateKbps: number): string {
    const lines = sdp.split('\r\n');
    const newLines: string[] = [];
    let inVideoSection = false;

    for (let line of lines) {
      newLines.push(line);
      if (line.startsWith('m=video')) {
        inVideoSection = true;
      } else if (line.startsWith('m=audio')) {
        inVideoSection = false;
      }

      // Inject b=AS (Application Specific) bitrate line right after the media header
      if (inVideoSection && line.startsWith('c=IN')) {
        newLines.push(`b=AS:${bitrateKbps}`);
      }
    }
    return newLines.join('\r\n');
  }

  async start(stream: MediaStream, targetBitrateKbps: number): Promise<void> {
    this.log('Initializing optimized WebRTC pipeline...', 'info');

    const config: RTCConfiguration = {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };

    this.pc = new RTCPeerConnection(config);

    // Add tracks with specific optimization hints
    stream.getTracks().forEach(track => {
      // Set content hint for smoother motion
      if (track.kind === 'video') {
        track.contentHint = 'motion';
      }
      this.pc?.addTrack(track, stream);
      this.log(`Track linked: ${track.kind} (${track.label})`, 'info');
    });

    // Create offer and munge it for strict bitrate control
    let offer = await this.pc.createOffer();
    const mungedSdp = this.mungeSdp(offer.sdp, targetBitrateKbps);
    
    await this.pc.setLocalDescription({
      type: 'offer',
      sdp: mungedSdp
    });

    this.log(`Handshaking with Twitch @ ${targetBitrateKbps}kbps...`, 'info');

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
        'Authorization': `Bearer ${this.streamKey}`
      },
      body: this.pc.localDescription?.sdp
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`WHIP Error (${response.status}): ${errorText || 'Handshake failed'}`);
    }

    this.sessionUrl = response.headers.get('Location');
    const answerSdp = await response.text();

    await this.pc.setRemoteDescription({
      type: 'answer',
      sdp: answerSdp
    });

    // Apply strict encoding parameters to the senders
    await this.optimizeEncodings(targetBitrateKbps);
    
    this.log('Stream linked and optimized. Handover complete.', 'success');
    this.setupIceHandlers();
    this.startKeepAlive();
  }

  private async optimizeEncodings(kbps: number) {
    if (!this.pc) return;
    const senders = this.pc.getSenders();
    
    for (const sender of senders) {
      const parameters = sender.getParameters();
      if (!parameters.encodings) parameters.encodings = [{}];

      if (sender.track?.kind === 'video') {
        // High priority ensures video packets are sent first in congestion
        parameters.encodings[0].priority = 'high';
        parameters.encodings[0].networkPriority = 'high';
        parameters.encodings[0].maxBitrate = kbps * 1000;
        // Maintain-framerate is better for Twitch to prevent "stutter"
        // @ts-ignore - some TS versions don't have degradationPreference in types yet
        parameters.degradationPreference = 'maintain-framerate';
      } else if (sender.track?.kind === 'audio') {
        // Cap audio to 128kbps to avoid spikes
        parameters.encodings[0].maxBitrate = 128 * 1000;
      }

      await sender.setParameters(parameters);
    }
    this.log('Real-time encoding parameters applied.', 'info');
  }

  async replaceVideoTrack(newTrack: MediaStreamTrack | null) {
    if (!this.pc) return;
    const sender = this.pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender) {
      if (newTrack) newTrack.contentHint = 'motion';
      await sender.replaceTrack(newTrack);
      this.log(`Video hot-swapped: ${newTrack ? newTrack.label : 'IDLE'}`, 'info');
    }
  }

  async replaceAudioTrack(newTrack: MediaStreamTrack | null) {
    if (!this.pc) return;
    const sender = this.pc.getSenders().find(s => s.track?.kind === 'audio');
    if (sender) {
      await sender.replaceTrack(newTrack);
      this.log(`Audio hot-swapped: ${newTrack ? newTrack.label : 'IDLE'}`, 'info');
    }
  }

  private setupIceHandlers() {
    if (!this.pc) return;
    this.pc.oniceconnectionstatechange = () => {
      this.log(`Network Layer: ${this.pc?.iceConnectionState.toUpperCase()}`, 'info');
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
        if (!res.ok) this.log('Session heartbeat missed.', 'warn');
      } catch (e) {
        this.log('Heartbeat connection error.', 'warn');
      }
    }, 25000); // 25s for safer Twitch compatibility
  }

  stop() {
    this.log('Terminating broadcast session...', 'info');
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    
    if (this.sessionUrl) {
      fetch(this.sessionUrl, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.streamKey}` }
      }).catch(() => {});
      this.sessionUrl = null;
    }
  }
}
