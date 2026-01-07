import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Camera, Mic, Activity, RefreshCcw, Terminal, Monitor, 
  Layers, Video, Volume2, ChevronDown, ChevronUp, 
  Zap, Radio, Cpu, SlidersHorizontal, Sun, Moon, Palette,
  MessageSquare, User, ShieldCheck, Crown
} from 'lucide-react';
import { StreamStatus, LogEntry, StreamConfig, DeviceInfo, Theme, ChatMessage } from './types';
import { WHIPClient } from './services/whipClient';
import { TwitchChatService } from './services/twitchChat';

const TWITCH_WHIP_URL = 'https://g.webrtc.live-video.net:4443/v2/offer';

const App: React.FC = () => {
  const [status, setStatus] = useState<StreamStatus>(StreamStatus.IDLE);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [videoDevices, setVideoDevices] = useState<DeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<DeviceInfo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<string>('');
  const [selectedAudio, setSelectedAudio] = useState<string>('');
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('studio-theme') as Theme) || 'dark');
  
  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatStatus, setChatStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const twitchChatRef = useRef<TwitchChatService | null>(null);

  // UI Layout States
  const [isLogsMinimized, setIsLogsMinimized] = useState<boolean>(false);
  const [isDestinationMinimized, setIsDestinationMinimized] = useState<boolean>(false);
  const [isEncoderMinimized, setIsEncoderMinimized] = useState<boolean>(false);
  const [isChatMinimized, setIsChatMinimized] = useState<boolean>(false);
  
  // Production Scene States
  const [isScreenPrimary, setIsScreenPrimary] = useState<boolean>(false);
  const [isPipEnabled, setIsPipEnabled] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [isScreenActive, setIsScreenActive] = useState<boolean>(false);

  // PiP Geometry
  const [pipX, setPipX] = useState(0.82);
  const [pipY, setPipY] = useState(0.8);
  const [pipSize, setPipSize] = useState(0.22);

  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [config, setConfig] = useState<StreamConfig>({
    channelName: localStorage.getItem('twitch-channel') || '',
    streamKey: '',
    resolution: '1920x1080',
    bitrate: 4500,
    fps: 30
  });

  const addLog = useCallback((entry: LogEntry) => {
    setLogs(prev => [...prev.slice(-49), entry]);
  }, []);

  // Twitch Chat Handlers
  const handleChatMessage = useCallback((msg: ChatMessage) => {
    setChatMessages(prev => [...prev.slice(-99), msg]);
  }, []);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const toggleChat = () => {
    if (chatStatus === 'connected') {
      twitchChatRef.current?.disconnect();
    } else if (config.channelName) {
      localStorage.setItem('twitch-channel', config.channelName);
      if (!twitchChatRef.current) {
        twitchChatRef.current = new TwitchChatService(handleChatMessage, setChatStatus);
      }
      twitchChatRef.current.connect(config.channelName);
    }
  };

  const enumerateMedia = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const video = devices.filter(d => d.kind === 'videoinput').map(d => ({ id: d.deviceId, label: d.label || 'Camera' }));
      const audio = devices.filter(d => d.kind === 'audioinput').map(d => ({ id: d.deviceId, label: d.label || 'Mic' }));
      setVideoDevices(video);
      setAudioDevices(audio);
      if (video.length && !selectedVideo) setSelectedVideo(video[0].id);
      if (audio.length && !selectedAudio) setSelectedAudio(audio[0].id);
    } catch (err) {
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'error', message: 'Handshake Error: Failed to list devices' });
    }
  }, [selectedVideo, selectedAudio, addLog]);

  useEffect(() => { enumerateMedia(); }, [enumerateMedia]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('studio-theme', theme);
  }, [theme]);

  const composite = useCallback(() => {
    const ctx = canvasRef.current.getContext('2d', { alpha: false });
    if (!ctx) return;
    const w = canvasRef.current.width;
    const h = canvasRef.current.height;
    ctx.fillStyle = theme === 'light' ? '#f4f4f5' : theme === 'midnight' ? '#020617' : '#09090b';
    ctx.fillRect(0, 0, w, h);

    const camVideo = camVideoEl.current;
    const screenVideo = screenVideoEl.current;
    const mainSource = isScreenPrimary ? screenVideo : camVideo;
    const pipSource = isScreenPrimary ? camVideo : screenVideo;
    const isMainActive = isScreenPrimary ? isScreenActive : isCameraActive;
    const isPipActive = isScreenPrimary ? isCameraActive : isScreenActive;

    if (isMainActive && mainSource.readyState >= 2) {
      const ratio = Math.max(w / mainSource.videoWidth, h / mainSource.videoHeight);
      const nw = mainSource.videoWidth * ratio;
      const nh = mainSource.videoHeight * ratio;
      ctx.drawImage(mainSource, (w - nw) / 2, (h - nh) / 2, nw, nh);
    }

    if (isPipEnabled && isPipActive && pipSource.readyState >= 2) {
      const pW = w * pipSize;
      const pH = pW * (9 / 16);
      const px = (w * pipX) - (pW / 2);
      const py = (h * pipY) - (pH / 2);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 30;
      ctx.strokeStyle = theme === 'light' ? '#4f46e5' : theme === 'midnight' ? '#38bdf8' : '#6366f1';
      ctx.lineWidth = 4;
      ctx.strokeRect(px, py, pW, pH);
      ctx.drawImage(pipSource, px, py, pW, pH);
      ctx.restore();
    }
    requestRef.current = requestAnimationFrame(composite);
  }, [isScreenPrimary, isPipEnabled, pipX, pipY, pipSize, isCameraActive, isScreenActive, theme]);

  // Ref cleanup
  const camVideoEl = useRef<HTMLVideoElement>(Object.assign(document.createElement('video'), { muted: true, autoplay: true, playsInline: true }));
  const screenVideoEl = useRef<HTMLVideoElement>(Object.assign(document.createElement('video'), { muted: true, autoplay: true, playsInline: true }));
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const requestRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioAnimRef = useRef<number | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const compositeStreamRef = useRef<MediaStream | null>(null);
  const whipClientRef = useRef<WHIPClient | null>(null);
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startPipPos = useRef({ x: 0.82, y: 0.8 });

  useEffect(() => {
    const [w, h] = config.resolution.split('x').map(Number);
    canvasRef.current.width = w;
    canvasRef.current.height = h;
    requestRef.current = requestAnimationFrame(composite);
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [config.resolution, composite]);

  const startAudioMonitoring = useCallback((stream: MediaStream) => {
    if (audioAnimRef.current) cancelAnimationFrame(audioAnimRef.current);
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    const source = audioContextRef.current.createMediaStreamSource(stream);
    const analyser = audioContextRef.current.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    audioAnalyserRef.current = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const frame = () => {
      if (!audioAnalyserRef.current) return;
      audioAnalyserRef.current.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setAudioLevel(Math.min(100, (avg / 128) * 100));
      audioAnimRef.current = requestAnimationFrame(frame);
    };
    frame();
  }, []);

  const startCamera = async () => {
    try {
      if (cameraStreamRef.current) cameraStreamRef.current.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: selectedVideo ? { exact: selectedVideo } : undefined },
        audio: { deviceId: selectedAudio ? { exact: selectedAudio } : undefined }
      });
      cameraStreamRef.current = stream;
      camVideoEl.current.srcObject = stream;
      await camVideoEl.current.play();
      setIsCameraActive(true);
      startAudioMonitoring(stream);
      if (!compositeStreamRef.current) {
        compositeStreamRef.current = canvasRef.current.captureStream(config.fps);
        compositeStreamRef.current.addTrack(stream.getAudioTracks()[0]);
      }
      if (videoPreviewRef.current) videoPreviewRef.current.srcObject = compositeStreamRef.current;
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'success', message: 'Video ingest core initialized.' });
    } catch (err) {
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'error', message: 'Ingest error: ' + (err as Error).message });
    }
  };

  const toggleScreen = async () => {
    if (isScreenActive) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      setIsScreenActive(false);
      setIsScreenPrimary(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      screenStreamRef.current = stream;
      screenVideoEl.current.srcObject = stream;
      await screenVideoEl.current.play();
      setIsScreenActive(true);
      setIsScreenPrimary(true);
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'info', message: 'Surface capture linked.' });
    } catch (e) { addLog({ timestamp: new Date().toLocaleTimeString(), level: 'warn', message: 'Capture aborted.' }); }
  };

  const handleBroadcast = async () => {
    if (status === StreamStatus.STREAMING) {
      whipClientRef.current?.stop();
      setStatus(StreamStatus.IDLE);
      return;
    }
    if (!config.streamKey) {
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'warn', message: 'Auth token missing.' });
      return;
    }
    if (!isCameraActive) await startCamera();
    try {
      setStatus(StreamStatus.CONNECTING);
      whipClientRef.current = new WHIPClient(TWITCH_WHIP_URL, config.streamKey, addLog);
      await whipClientRef.current.start(compositeStreamRef.current!, config.bitrate);
      setStatus(StreamStatus.STREAMING);
    } catch (e) { setStatus(StreamStatus.ERROR); }
  };

  const getBitrateColor = (bitrate: number) => {
    if (bitrate > 8000) return 'text-red-500';
    if (bitrate > 6000) return 'text-amber-500';
    return theme === 'light' ? 'text-indigo-600' : theme === 'midnight' ? 'text-sky-400' : 'text-indigo-400';
  };

  return (
    <div className="h-screen w-full flex bg-[var(--studio-bg)] text-[var(--studio-text)] overflow-hidden transition-colors duration-300">
      {/* Left Navigation Bar */}
      <nav className="w-16 border-r border-[var(--studio-border)] flex flex-col items-center py-6 gap-8 bg-[var(--studio-panel)] transition-colors duration-300">
        <div className="p-3 bg-[var(--accent)] rounded-xl shadow-lg transition-all">
          <Activity className="w-6 h-6 text-white" />
        </div>
        <div className="flex flex-col gap-4 mt-auto">
          {['light', 'dark', 'midnight'].map((t) => (
            <button 
              key={t}
              onClick={() => setTheme(t as Theme)}
              className={`p-2.5 rounded-lg transition-all ${theme === t ? 'bg-[var(--accent)] text-white' : 'text-[var(--studio-text-muted)] hover:bg-[var(--studio-border)]'}`}
              title={`${t.charAt(0).toUpperCase() + t.slice(1)} Mode`}
            >
              {t === 'light' && <Sun className="w-5 h-5" />}
              {t === 'dark' && <Moon className="w-5 h-5" />}
              {t === 'midnight' && <Palette className="w-5 h-5" />}
            </button>
          ))}
        </div>
      </nav>

      {/* Main Production Stage */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-[var(--studio-border)] flex items-center justify-between px-8 bg-[var(--studio-bg)]">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-black uppercase tracking-[0.2em] text-[var(--studio-text-muted)]">MediaTech <span className="text-[var(--accent)]">Studio</span></h1>
            <div className={`h-1.5 w-1.5 rounded-full ${status === StreamStatus.STREAMING ? 'bg-red-500 status-pulse' : 'bg-[var(--studio-border)]'}`} />
          </div>
          <button 
            onClick={handleBroadcast}
            className={`px-8 h-10 rounded-lg font-bold text-xs uppercase tracking-widest transition-all ${
              status === StreamStatus.STREAMING ? 'bg-[var(--studio-border)] text-[var(--studio-text)]' : 'bg-[var(--accent)] text-white hover:opacity-90 shadow-xl'
            }`}
          >
            {status === StreamStatus.STREAMING ? 'End Broadcast' : 'Go Live'}
          </button>
        </header>

        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar space-y-6">
          <div ref={previewContainerRef} className="relative w-full max-w-6xl mx-auto aspect-video rounded-2xl bg-black shadow-2xl overflow-hidden border border-[var(--studio-border)] group">
            <video ref={videoPreviewRef} autoPlay muted playsInline className="w-full h-full object-contain" />
            {!isCameraActive && !isScreenActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
                <Cpu className="w-12 h-12 text-zinc-800 mb-4 animate-pulse" />
                <button onClick={startCamera} className="px-6 py-3 bg-[var(--accent)] text-white hover:opacity-90 rounded-xl font-bold text-sm">Initialize Studio</button>
              </div>
            )}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 bg-black/40 backdrop-blur-xl rounded-2xl flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-all">
              <button onClick={() => setIsCameraActive(!isCameraActive)} className={`p-3 rounded-xl ${isCameraActive ? 'bg-zinc-800' : 'bg-red-500/20 text-red-500'}`}><Camera className="w-5 h-5" /></button>
              <button onClick={toggleScreen} className={`p-3 rounded-xl ${isScreenActive ? 'bg-[var(--accent)]' : 'bg-zinc-800'}`}><Monitor className="w-5 h-5" /></button>
              <button onClick={() => setIsPipEnabled(!isPipEnabled)} className={`p-3 rounded-xl ${isPipEnabled ? 'bg-[var(--accent)]' : 'bg-zinc-800'}`}><Layers className="w-5 h-5" /></button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full max-w-6xl mx-auto">
             <div className="bg-[var(--studio-panel)] p-6 rounded-2xl border border-[var(--studio-border)] flex flex-col gap-5">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--studio-text-muted)] flex items-center gap-3">
                   <div className="p-2 bg-[var(--accent)] bg-opacity-10 rounded-lg"><Video className="w-4 h-4 text-[var(--accent)]" /></div> Video Ingest
                </h3>
                <select className="bg-black/20 border border-[var(--studio-border)] rounded-lg px-3 py-2 text-xs text-[var(--studio-text)] outline-none" value={selectedVideo} onChange={e => setSelectedVideo(e.target.value)}>
                   {videoDevices.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
             </div>
             <div className="bg-[var(--studio-panel)] p-6 rounded-2xl border border-[var(--studio-border)] flex flex-col gap-5">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--studio-text-muted)] flex items-center gap-3">
                   <div className="p-2 bg-[var(--accent)] bg-opacity-10 rounded-lg"><Volume2 className="w-4 h-4 text-[var(--accent)]" /></div> Audio Mixer
                </h3>
                <div className="h-4 w-full bg-black/20 rounded-full flex gap-[2px] p-1 overflow-hidden">
                   {[...Array(40)].map((_, i) => (
                      <div key={i} className={`flex-1 rounded-sm transition-colors ${audioLevel > (i/40)*100 ? (i > 32 ? 'bg-red-500' : 'bg-[var(--accent)]') : 'bg-zinc-800'}`} />
                   ))}
                </div>
             </div>
          </div>
        </div>
      </main>

      {/* Right Properties & Chat Panel */}
      <aside className="w-80 border-l border-[var(--studio-border)] flex flex-col bg-[var(--studio-panel)]">
        <div className="p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
          {/* Destination & Key */}
          <section>
            <div className="flex items-center justify-between cursor-pointer mb-4" onClick={() => setIsDestinationMinimized(!isDestinationMinimized)}>
              <h4 className="text-[10px] font-black uppercase tracking-widest text-[var(--studio-text-muted)] flex items-center gap-2"><Radio className="w-3.5 h-3.5" /> Destination</h4>
              {isDestinationMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
            {!isDestinationMinimized && (
              <div className="space-y-4">
                <div>
                  <label className="text-[9px] font-bold text-[var(--studio-text-muted)] uppercase block mb-1">Twitch Channel</label>
                  <input type="text" placeholder="twitch_user" className="w-full bg-black/20 border border-[var(--studio-border)] rounded-lg px-3 py-2 text-xs text-[var(--studio-text)]" value={config.channelName} onChange={e => setConfig({...config, channelName: e.target.value})} />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-[var(--studio-text-muted)] uppercase block mb-1">Stream Key</label>
                  <input type="password" placeholder="live_..." className="w-full bg-black/20 border border-[var(--studio-border)] rounded-lg px-3 py-2 text-xs font-mono" value={config.streamKey} onChange={e => setConfig({...config, streamKey: e.target.value})} />
                </div>
              </div>
            )}
          </section>

          {/* Encoder Controls */}
          <section>
            <div className="flex items-center justify-between cursor-pointer mb-4" onClick={() => setIsEncoderMinimized(!isEncoderMinimized)}>
              <h4 className="text-[10px] font-black uppercase tracking-widest text-[var(--studio-text-muted)] flex items-center gap-2"><Zap className="w-3.5 h-3.5" /> Encoder</h4>
              {isEncoderMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
            {!isEncoderMinimized && (
              <div className="space-y-4">
                <div className="p-4 bg-black/20 rounded-xl border border-[var(--studio-border)]">
                  <div className="flex justify-between text-[9px] font-bold uppercase mb-2"><span>Bitrate</span><span className={getBitrateColor(config.bitrate)}>{config.bitrate}K</span></div>
                  <input type="range" min="500" max="10000" step="100" value={config.bitrate} onChange={e => setConfig({...config, bitrate: parseInt(e.target.value)})} className="w-full h-1 bg-[var(--studio-border)] rounded-lg appearance-none cursor-pointer accent-[var(--accent)]" />
                </div>
              </div>
            )}
          </section>

          {/* Native Chat Integration */}
          <section className="flex flex-col h-[400px]">
            <div className="flex items-center justify-between cursor-pointer mb-2" onClick={() => setIsChatMinimized(!isChatMinimized)}>
              <h4 className="text-[10px] font-black uppercase tracking-widest text-[var(--studio-text-muted)] flex items-center gap-2"><MessageSquare className="w-3.5 h-3.5" /> Live Chat</h4>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${chatStatus === 'connected' ? 'bg-emerald-500' : chatStatus === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'}`} />
                {isChatMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </div>
            {!isChatMinimized && (
              <div className="flex-1 flex flex-col bg-black/20 border border-[var(--studio-border)] rounded-xl overflow-hidden">
                <div ref={chatScrollRef} className="flex-1 p-3 overflow-y-auto custom-scrollbar space-y-3 font-medium">
                  {chatMessages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-4">
                      <MessageSquare className="w-8 h-8 text-zinc-800 mb-2" />
                      <p className="text-[9px] uppercase font-black text-zinc-600 tracking-widest">Awaiting Feed...</p>
                    </div>
                  ) : (
                    chatMessages.map(msg => (
                      <div key={msg.id} className="text-xs leading-relaxed group">
                        <span className="text-[10px] text-zinc-600 mr-2 font-mono">{msg.timestamp}</span>
                        <span className="inline-flex items-center gap-1 mr-1.5">
                          {msg.badges.map((b, i) => (
                            <span key={i} title={b.name} className="opacity-80">
                              {b.name === 'broadcaster' && <Crown className="w-3 h-3 text-amber-400" />}
                              {b.name === 'moderator' && <ShieldCheck className="w-3 h-3 text-emerald-500" />}
                            </span>
                          ))}
                        </span>
                        <span style={{ color: msg.color }} className="font-bold tracking-tight">{msg.displayName}</span>
                        <span className={`ml-2 ${msg.isAction ? 'italic opacity-80' : 'text-[var(--studio-text)]'}`}>
                          {msg.message}
                        </span>
                      </div>
                    ))
                  )}
                </div>
                <div className="p-3 border-t border-[var(--studio-border)] bg-black/10">
                  <button 
                    onClick={toggleChat}
                    className={`w-full py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                      chatStatus === 'connected' ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' : 'bg-[var(--accent)] text-white hover:opacity-90'
                    }`}
                  >
                    {chatStatus === 'connected' ? 'Disconnect Chat' : 'Connect Feed'}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Console */}
        <div className={`border-t border-[var(--studio-border)] flex flex-col ${isLogsMinimized ? 'h-12' : 'h-48'}`}>
           <div className="h-12 flex items-center justify-between px-4 cursor-pointer hover:bg-black/10" onClick={() => setIsLogsMinimized(!isLogsMinimized)}>
              <span className="text-[10px] font-black uppercase tracking-widest text-[var(--studio-text-muted)] flex items-center gap-2"><Terminal className="w-3.5 h-3.5" /> Engine Telemetry</span>
              {isLogsMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
           </div>
           {!isLogsMinimized && (
              <div className="flex-1 p-4 bg-black/20 overflow-y-auto font-mono text-[10px] space-y-1 custom-scrollbar">
                 {logs.map((log, i) => (
                    <div key={i} className="flex gap-2">
                       <span className="text-zinc-600 shrink-0">[{log.timestamp}]</span>
                       <span className={log.level === 'error' ? 'text-red-500' : log.level === 'success' ? 'text-emerald-500' : 'text-zinc-300'}>{log.message}</span>
                    </div>
                 ))}
              </div>
           )}
        </div>
      </aside>
    </div>
  );
};

export default App;