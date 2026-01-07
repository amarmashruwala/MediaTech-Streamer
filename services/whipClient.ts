import { LogEntry } from '../types';

export class WHIPClient {
  private pc: RTCPeerConnection | null = null;
  private sessionUrl: string | null = null;
  private keepAliveInterval: number | null = null;

  constructor(
    private endpoint: string,
    private streamKey: string,
    private onLog: (entry: LogEntry) => void,
    private onConnectionStateChange?: (state: RTCIceConnectionState) => void
  ) {}

  private log(message: string, level: LogEntry['level'] = 'info') {
    this.onLog({
      timestamp: new Date().toLocaleTimeString(),
      level,
      message
    });
  }

  private mungeSdp(sdp: string, bitrateKbps: number): string {
    const lines = sdp.split('\r\n');
    const munged: string[] = [];
    let inVideoSection = false;
    let bitrateAdded = false;

    for (const line of lines) {
      munged.push(line);
      
      if (line.startsWith('m=video')) {
        inVideoSection = true;
        bitrateAdded = false;
      } else if (line.startsWith('m=audio')) {
        inVideoSection = false;
      }

      if (inVideoSection && !bitrateAdded && (line.startsWith('c=IN') || line.startsWith('a=mid'))) {
        munged.push(`b=AS:${bitrateKbps}`);
        bitrateAdded = true;
      }
    }
    return munged.join('\r\n');
  }

  async start(stream: MediaStream, bitrateKbps: number): Promise<void> {
    this.log(`Establishing optimized link at ${bitrateKbps}kbps...`, 'info');

    const config: RTCConfiguration = {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      bundlePolicy: 'max-bundle'
    };

    if (this.pc) this.stop();

    this.pc = new RTCPeerConnection(config);

    stream.getTracks().forEach(track => {
      if (track.kind === 'video') {
        track.contentHint = 'motion';
      }
      this.pc?.addTrack(track, stream);
    });

    const offer = await this.pc.createOffer();
    const mungedSdp = this.mungeSdp(offer.sdp, bitrateKbps);

    await this.pc.setLocalDescription({ type: 'offer', sdp: mungedSdp });

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
          'Authorization': `Bearer ${this.streamKey}`
        },
        body: this.pc.localDescription?.sdp
      });

      if (!response.ok) throw new Error(`WHIP Server error: ${response.status}`);

      this.sessionUrl = response.headers.get('Location');
      const answerSdp = await response.text();

      await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      
      const videoSender = this.pc.getSenders().find(s => s.track?.kind === 'video');
      if (videoSender) {
        const params = videoSender.getParameters();
        // @ts-ignore
        params.degradationPreference = 'maintain-framerate';
        if (params.encodings && params.encodings.length > 0) {
          params.encodings[0].maxBitrate = bitrateKbps * 1000;
        }
        await videoSender.setParameters(params);
      }

      this.log('Signal stabilized. Hardware encoder engaged.', 'success');
      this.setupIceHandlers();
      this.startKeepAlive();
    } catch (error) {
      this.log(`Handshake failed: ${(error as Error).message}`, 'error');
      throw error;
    }
  }

  private setupIceHandlers() {
    if (!this.pc) return;
    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc?.iceConnectionState;
      if (state) {
        this.log(`Transport Path: ${state.toUpperCase()}`, state === 'failed' ? 'error' : 'info');
        this.onConnectionStateChange?.(state);
      }
    };
  }

  private startKeepAlive() {
    if (!this.sessionUrl) return;
    this.keepAliveInterval = window.setInterval(async () => {
      if (!this.sessionUrl) return;
      try {
        await fetch(this.sessionUrl, {
          method: 'OPTIONS',
          headers: { 'Authorization': `Bearer ${this.streamKey}` }
        });
      } catch (e) {
        console.warn('Session refresh heartbeat failed');
      }
    }, 25000);
  }

  stop() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    if (this.pc) {
      this.pc.oniceconnectionstatechange = null;
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