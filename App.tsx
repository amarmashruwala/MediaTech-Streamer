import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Camera, Mic, Activity, RefreshCcw, Terminal, Monitor, 
  Layers, Video, Volume2, ChevronDown, ChevronUp, 
  Zap, Radio, Cpu, SlidersHorizontal, Sun, Moon, Palette,
  MessageSquare, User, ShieldCheck, Crown, Wifi, Repeat, Settings2
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
  
  // Reconnection State
  const [retryCount, setRetryCount] = useState(0);
  const isStreamingIntent = useRef(false);
  const retryTimerRef = useRef<number | null>(null);

  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatStatus, setChatStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const twitchChatRef = useRef<TwitchChatService | null>(null);

  // UI Layout States
  const [isLogsMinimized, setIsLogsMinimized] = useState<boolean>(false);
  const [isDestinationMinimized, setIsDestinationMinimized] = useState<boolean>(false);
  const [isEncoderMinimized, setIsEncoderMinimized] = useState<boolean>(false);
  const [isSettingsMinimized, setIsSettingsMinimized] = useState<boolean>(false);
  const [isChatMinimized, setIsChatMinimized] = useState<boolean>(false);
  
  const [isScreenPrimary, setIsScreenPrimary] = useState<boolean>(false);
  const [isPipEnabled, setIsPipEnabled] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [isScreenActive, setIsScreenActive] = useState<boolean>(false);

  // Coordinates calculated for 0.5 inch (48px) margins at 1080p
  // pipX: (1920 - 48 - (1920 * 0.22 / 2)) / 1920 = ~0.865
  // pipY: (48 + (1080 * 0.22 * (9/16) / 2)) / 1080 = ~0.154
  const [pipX, setPipX] = useState(0.865);
  const [pipY, setPipY] = useState(0.154);
  const [pipSize, setPipSize] = useState(0.22);

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
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'error', message: 'Hardware discovery failed.' });
    }
  }, [selectedVideo, selectedAudio, addLog]);

  useEffect(() => { enumerateMedia(); }, [enumerateMedia]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('studio-theme', theme);
  }, [theme]);

  const camVideoEl = useRef<HTMLVideoElement>(Object.assign(document.createElement('video'), { muted: true, autoplay: true, playsInline: true }));
  const screenVideoEl = useRef<HTMLVideoElement>(Object.assign(document.createElement('video'), { muted: true, autoplay: true, playsInline: true }));
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const requestRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const compositeStreamRef = useRef<MediaStream | null>(null);
  const whipClientRef = useRef<WHIPClient | null>(null);

  const composite = useCallback((timestamp: number) => {
    const fpsInterval = 1000 / config.fps;
    const elapsed = timestamp - lastFrameTimeRef.current;

    if (elapsed < fpsInterval) {
      requestRef.current = requestAnimationFrame(composite);
      return;
    }

    lastFrameTimeRef.current = timestamp - (elapsed % fpsInterval);

    const ctx = canvasRef.current.getContext('2d', { 
      alpha: false,
      desynchronized: true,
      willReadFrequently: false 
    });
    
    if (!ctx) return;
    
    const w = canvasRef.current.width;
    const h = canvasRef.current.height;

    const bgColor = theme === 'light' ? '#f4f4f5' : theme === 'midnight' ? '#020617' : '#09090b';
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    let effectiveScreenPrimary = isScreenPrimary;
    if (isScreenActive && !isCameraActive) effectiveScreenPrimary = true;
    if (isCameraActive && !isScreenActive) effectiveScreenPrimary = false;

    const mainSource = effectiveScreenPrimary ? screenVideoEl.current : camVideoEl.current;
    const pipSource = effectiveScreenPrimary ? camVideoEl.current : screenVideoEl.current;
    const isMainActive = effectiveScreenPrimary ? isScreenActive : isCameraActive;
    const isPipActive = effectiveScreenPrimary ? isCameraActive : isScreenActive;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low'; 

    if (isMainActive && mainSource.readyState >= 2 && mainSource.videoWidth > 0) {
      const ratio = Math.max(w / mainSource.videoWidth, h / mainSource.videoHeight);
      const drawWidth = mainSource.videoWidth * ratio;
      const drawHeight = mainSource.videoHeight * ratio;
      ctx.drawImage(mainSource, (w - drawWidth) / 2, (h - drawHeight) / 2, drawWidth, drawHeight);
    }

    if (isPipEnabled && isPipActive && pipSource.readyState >= 2 && pipSource.videoWidth > 0) {
      const pW = w * pipSize;
      const pH = pW * (9 / 16);
      ctx.save();
      ctx.strokeStyle = theme === 'light' ? '#4f46e5' : '#6366f1';
      ctx.lineWidth = 4;
      ctx.strokeRect((w * pipX) - (pW / 2), (h * pipY) - (pH / 2), pW, pH);
      ctx.drawImage(pipSource, (w * pipX) - (pW / 2), (h * pipY) - (pH / 2), pW, pH);
      ctx.restore();
    }
    
    requestRef.current = requestAnimationFrame(composite);
  }, [isScreenPrimary, isPipEnabled, pipX, pipY, pipSize, isCameraActive, isScreenActive, theme, config.fps]);

  useEffect(() => {
    const [w, h] = config.resolution.split('x').map(Number);
    canvasRef.current.width = w;
    canvasRef.current.height = h;

    const newStream = canvasRef.current.captureStream(config.fps);
    
    if (compositeStreamRef.current) {
        compositeStreamRef.current.getAudioTracks().forEach(track => {
            newStream.addTrack(track);
        });
    }

    compositeStreamRef.current = newStream;

    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = compositeStreamRef.current;
    }

    requestRef.current = requestAnimationFrame(composite);
    addLog({ 
      timestamp: new Date().toLocaleTimeString(), 
      level: 'info', 
      message: `Canvas reconfigured: ${config.resolution} @ ${config.fps}fps` 
    });

    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [config.resolution, config.fps, composite]);

  const toggleScreenShare = async () => {
    if (isScreenActive) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
      }
      setIsScreenActive(false);
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'info', message: 'Screen capture ended.' });
    } else {
      try {
        const [targetWidth, targetHeight] = config.resolution.split('x').map(Number);
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { 
            width: { ideal: targetWidth },
            height: { ideal: targetHeight },
            frameRate: { ideal: config.fps } 
          },
          audio: true
        });
        
        const videoTrack = stream.getVideoTracks()[0];
        videoTrack.onended = () => {
          setIsScreenActive(false);
          screenStreamRef.current = null;
          addLog({ timestamp: new Date().toLocaleTimeString(), level: 'info', message: 'User terminated screen share.' });
        };
        
        if ('contentHint' in videoTrack) {
          // @ts-ignore
          videoTrack.contentHint = 'text';
        }

        screenStreamRef.current = stream;
        screenVideoEl.current.srcObject = stream;
        
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack && compositeStreamRef.current) {
          compositeStreamRef.current.addTrack(audioTrack);
        }

        await screenVideoEl.current.play();
        setIsScreenActive(true);
        addLog({ timestamp: new Date().toLocaleTimeString(), level: 'success', message: 'Screen capture optimized and active.' });
      } catch (err) {
        addLog({ timestamp: new Date().toLocaleTimeString(), level: 'error', message: 'Screen capture failed or blocked.' });
      }
    }
  };

  useEffect(() => {
    let mounted = true;

    const startCamera = async () => {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(t => t.stop());
      }

      if (!isCameraActive) return;

      try {
        const [targetWidth, targetHeight] = config.resolution.split('x').map(Number);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            deviceId: selectedVideo ? { exact: selectedVideo } : undefined,
            width: { ideal: targetWidth },
            height: { ideal: targetHeight },
            frameRate: { ideal: config.fps }
          },
          audio: { deviceId: selectedAudio ? { exact: selectedAudio } : undefined }
        });

        if (!mounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        cameraStreamRef.current = stream;
        camVideoEl.current.srcObject = stream;
        await camVideoEl.current.play();

        const micTrack = stream.getAudioTracks()[0];
        if (micTrack && compositeStreamRef.current) {
          const currentAudio = compositeStreamRef.current.getAudioTracks();
          if (currentAudio.length === 0) {
            compositeStreamRef.current.addTrack(micTrack);
          }
        }

        addLog({ timestamp: new Date().toLocaleTimeString(), level: 'success', message: 'Camera performance link stable.' });
      } catch (err) {
        addLog({ timestamp: new Date().toLocaleTimeString(), level: 'error', message: 'Camera device unavailable.' });
        setIsCameraActive(false);
      }
    };

    startCamera();
    return () => { mounted = false; };
  }, [isCameraActive, selectedVideo, selectedAudio, config.fps, config.resolution, addLog]);

  const onConnectionStateChange = useCallback((state: RTCIceConnectionState) => {
    if ((state === 'failed' || state === 'disconnected') && isStreamingIntent.current) {
      handleReconnect();
    }
  }, []);

  const handleReconnect = useCallback(() => {
    if (retryCount >= 5) {
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'error', message: 'Max reconnection attempts reached. Stream terminated.' });
      isStreamingIntent.current = false;
      setStatus(StreamStatus.ERROR);
      return;
    }

    if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);

    const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 10000);
    setRetryCount(prev => prev + 1);
    
    addLog({ 
      timestamp: new Date().toLocaleTimeString(), 
      level: 'warn', 
      message: `Transport lost. Attempting recovery ${retryCount + 1}/5 in ${(backoffDelay/1000).toFixed(1)}s...` 
    });

    retryTimerRef.current = window.setTimeout(() => {
      if (isStreamingIntent.current) {
        handleBroadcast(true);
      }
    }, backoffDelay);
  }, [retryCount, addLog]);

  const handleBroadcast = async (isAutoRetry = false) => {
    if (!isAutoRetry) {
      if (status === StreamStatus.STREAMING) {
        isStreamingIntent.current = false;
        if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
        whipClientRef.current?.stop();
        setStatus(StreamStatus.IDLE);
        setRetryCount(0);
        return;
      }
      isStreamingIntent.current = true;
    }

    if (!config.streamKey) {
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'warn', message: 'Auth token missing.' });
      isStreamingIntent.current = false;
      return;
    }
    
    if (!isCameraActive && !isScreenActive) {
      setIsCameraActive(true);
      await new Promise(r => setTimeout(r, 1000));
    }
    
    try {
      if (!compositeStreamRef.current) throw new Error("Composition fault");
      setStatus(StreamStatus.CONNECTING);
      
      whipClientRef.current?.stop();
      
      whipClientRef.current = new WHIPClient(
        TWITCH_WHIP_URL, 
        config.streamKey, 
        addLog,
        onConnectionStateChange
      );
      
      await whipClientRef.current.start(compositeStreamRef.current, config.bitrate);
      setStatus(StreamStatus.STREAMING);
      setRetryCount(0);
    } catch (e) { 
      setStatus(StreamStatus.ERROR); 
      if (isStreamingIntent.current) {
        handleReconnect();
      }
    }
  };

  return (
    <div className="h-screen w-full flex bg-[var(--studio-bg)] text-[var(--studio-text)] overflow-hidden transition-colors duration-300">
      <nav className="w-16 border-r border-[var(--studio-border)] flex flex-col items-center py-6 gap-8 bg-[var(--studio-panel)]">
        <div className="p-3 bg-[var(--accent)] rounded-xl shadow-lg shadow-[var(--accent-glow)]"><Activity className="w-6 h-6 text-white" /></div>
        <div className="flex flex-col gap-4 mt-auto">
          {['light', 'dark', 'midnight'].map((t) => (
            <button key={t} onClick={() => setTheme(t as Theme)} className={`p-2.5 rounded-lg transition-all ${theme === t ? 'bg-[var(--accent)] text-white' : 'text-[var(--studio-text-muted)] hover:bg-[var(--studio-border)]'}`}>
              {t === 'light' ? <Sun className="w-5 h-5" /> : t === 'dark' ? <Moon className="w-5 h-5" /> : <Palette className="w-5 h-5" />}
            </button>
          ))}
        </div>
      </nav>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-[var(--studio-border)] flex items-center justify-between px-8 bg-[var(--studio-bg)]">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-black uppercase tracking-[0.2em] text-[var(--studio-text-muted)]">MediaTech <span className="text-[var(--accent)]">Studio</span></h1>
            {status === StreamStatus.STREAMING && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-500">
                <div className="w-2 h-2 rounded-full bg-red-500 status-pulse" />
                <span className="text-[10px] font-black uppercase tracking-widest">Live</span>
              </div>
            )}
            {status === StreamStatus.CONNECTING && retryCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500">
                <div className="w-2 h-2 rounded-full bg-amber-500 status-pulse" />
                <span className="text-[10px] font-black uppercase tracking-widest">Recovering</span>
              </div>
            )}
          </div>
          <button onClick={() => handleBroadcast()} className={`px-8 h-10 rounded-lg font-bold text-xs uppercase tracking-widest transition-all ${status === StreamStatus.STREAMING ? 'bg-[var(--studio-border)] text-[var(--studio-text)]' : 'bg-[var(--accent)] text-white shadow-xl hover:scale-[1.02] active:scale-[0.98]'}`}>
            {status === StreamStatus.STREAMING ? 'End Stream' : status === StreamStatus.CONNECTING ? 'Connecting...' : 'Go Live'}
          </button>
        </header>

        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar flex flex-col items-center justify-center gap-6 bg-[radial-gradient(circle_at_center,var(--studio-panel),var(--studio-bg))]">
          <div className="relative w-full max-w-5xl aspect-video rounded-2xl bg-black shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden border border-[var(--studio-border)] group">
            <video ref={videoPreviewRef} autoPlay muted playsInline className="w-full h-full object-contain" />
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 bg-black/40 backdrop-blur-2xl rounded-2xl flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-all border border-white/10 shadow-2xl scale-95 group-hover:scale-100">
              <button 
                onClick={() => setIsCameraActive(!isCameraActive)} 
                className={`p-3 rounded-xl transition-all hover:scale-110 ${isCameraActive ? 'bg-zinc-800 text-white shadow-lg' : 'bg-red-500/20 text-red-500'}`}
                title={isCameraActive ? "Stop Camera" : "Start Camera"}
              >
                <Camera className="w-5 h-5" />
              </button>
              <button 
                onClick={toggleScreenShare} 
                className={`p-3 rounded-xl transition-all hover:scale-110 ${isScreenActive ? 'bg-zinc-800 text-white shadow-lg' : 'bg-zinc-600/20 text-zinc-400'}`}
                title={isScreenActive ? "Stop Screen Share" : "Start Screen Share"}
              >
                <Monitor className="w-5 h-5" />
              </button>
              <div className="w-px h-6 bg-white/10 mx-1" />
              <button 
                onClick={() => setIsScreenPrimary(!isScreenPrimary)} 
                className={`p-3 rounded-xl transition-all hover:scale-110 bg-zinc-800 text-white shadow-lg`}
                title="Swap Main Source"
              >
                <Repeat className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setIsPipEnabled(!isPipEnabled)} 
                className={`p-3 rounded-xl transition-all hover:scale-110 ${isPipEnabled ? 'bg-[var(--accent)] text-white shadow-lg shadow-[var(--accent-glow)]' : 'bg-zinc-800 text-white'}`}
                title="Toggle Picture-in-Picture"
              >
                <Layers className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[var(--studio-panel)] p-4 rounded-xl border border-[var(--studio-border)] shadow-sm hover:border-[var(--accent)] transition-all">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--studio-text-muted)] mb-2 flex items-center gap-2">
                <Video className="w-3 h-3 text-[var(--accent)]" /> Optical Source
              </h3>
              <select 
                className="w-full bg-black/20 border border-[var(--studio-border)] rounded-lg px-3 py-2 text-xs text-[var(--studio-text)] outline-none focus:border-[var(--accent)] transition-colors cursor-pointer" 
                value={selectedVideo} 
                onChange={e => setSelectedVideo(e.target.value)}
              >
                 {videoDevices.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                 {videoDevices.length === 0 && <option value="">No cameras found</option>}
              </select>
            </div>
            <div className="bg-[var(--studio-panel)] p-4 rounded-xl border border-[var(--studio-border)] shadow-sm hover:border-[var(--accent)] transition-all">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--studio-text-muted)] mb-2 flex items-center gap-2">
                <Volume2 className="w-3 h-3 text-[var(--accent)]" /> Audio Feed
              </h3>
              <select 
                className="w-full bg-black/20 border border-[var(--studio-border)] rounded-lg px-3 py-2 text-xs text-[var(--studio-text)] outline-none focus:border-[var(--accent)] transition-colors cursor-pointer" 
                value={selectedAudio} 
                onChange={e => setSelectedAudio(e.target.value)}
              >
                 {audioDevices.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                 {audioDevices.length === 0 && <option value="">No microphones found</option>}
              </select>
            </div>
          </div>
        </div>
      </main>

      <aside className="w-80 border-l border-[var(--studio-border)] flex flex-col bg-[var(--studio-panel)]">
        <div className="p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
          <section>
            <div className="flex items-center justify-between cursor-pointer group" onClick={() => setIsDestinationMinimized(!isDestinationMinimized)}>
              <h4 className="text-[10px] font-black uppercase tracking-widest text-[var(--studio-text-muted)] flex items-center gap-2 group-hover:text-[var(--studio-text)] transition-colors"><Radio className="w-3.5 h-3.5" /> Link Verification</h4>
              {isDestinationMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
            {!isDestinationMinimized && (
              <div className="mt-4 space-y-4">
                <input type="text" placeholder="Twitch User" className="w-full bg-black/20 border border-[var(--studio-border)] rounded-lg px-3 py-2 text-xs text-[var(--studio-text)] outline-none focus:border-[var(--accent)]" value={config.channelName} onChange={e => setConfig({...config, channelName: e.target.value})} />
                <input type="password" placeholder="Twitch Link Key" className="w-full bg-black/20 border border-[var(--studio-border)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--studio-text)] outline-none focus:border-[var(--accent)]" value={config.streamKey} onChange={e => setConfig({...config, streamKey: e.target.value})} />
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between cursor-pointer group" onClick={() => setIsSettingsMinimized(!isSettingsMinimized)}>
              <h4 className="text-[10px] font-black uppercase tracking-widest text-[var(--studio-text-muted)] flex items-center gap-2 group-hover:text-[var(--studio-text)] transition-colors"><Settings2 className="w-3.5 h-3.5" /> Engine Config</h4>
              {isSettingsMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
            {!isSettingsMinimized && (
              <div className="mt-4 space-y-4">
                <div className="p-3 bg-black/20 rounded-xl border border-[var(--studio-border)] space-y-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold uppercase text-[var(--studio-text-muted)]">Output Resolution</label>
                    <select 
                      className="w-full bg-black/40 border border-[var(--studio-border)] rounded-lg px-2 py-1.5 text-[10px] text-[var(--studio-text)] outline-none focus:border-[var(--accent)]"
                      value={config.resolution}
                      onChange={e => setConfig({...config, resolution: e.target.value})}
                    >
                      <option value="1920x1080">1080p (1920x1080)</option>
                      <option value="1280x720">720p (1280x720)</option>
                      <option value="960x540">540p (960x540)</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold uppercase text-[var(--studio-text-muted)]">Target Framerate</label>
                    <select 
                      className="w-full bg-black/40 border border-[var(--studio-border)] rounded-lg px-2 py-1.5 text-[10px] text-[var(--studio-text)] outline-none focus:border-[var(--accent)]"
                      value={config.fps}
                      onChange={e => setConfig({...config, fps: parseInt(e.target.value)})}
                    >
                      <option value="30">30 FPS</option>
                      <option value="60">60 FPS</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between cursor-pointer group" onClick={() => setIsEncoderMinimized(!isEncoderMinimized)}>
              <h4 className="text-[10px] font-black uppercase tracking-widest text-[var(--studio-text-muted)] flex items-center gap-2 group-hover:text-[var(--studio-text)] transition-colors"><Zap className="w-3.5 h-3.5" /> Performance Hub</h4>
              {isEncoderMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
            {!isEncoderMinimized && (
              <div className="mt-4 space-y-4">
                <div className="p-4 bg-black/20 rounded-xl border border-[var(--studio-border)]">
                  <div className="flex justify-between text-[9px] font-bold uppercase mb-2"><span>Target Link Rate</span><span className="text-[var(--accent)]">{config.bitrate}K</span></div>
                  <input type="range" min="1000" max="8000" step="500" value={config.bitrate} onChange={e => setConfig({...config, bitrate: parseInt(e.target.value)})} className="w-full h-1 bg-[var(--studio-border)] rounded-lg appearance-none cursor-pointer accent-[var(--accent)]" />
                </div>
              </div>
            )}
          </section>

          <section className={`flex flex-col transition-all duration-300 ${isChatMinimized ? 'h-auto' : 'h-[350px]'}`}>
            <div className="flex items-center justify-between cursor-pointer group mb-2" onClick={() => setIsChatMinimized(!isChatMinimized)}>
              <h4 className="text-[10px] font-black uppercase tracking-widest text-[var(--studio-text-muted)] flex items-center gap-2 group-hover:text-[var(--studio-text)] transition-colors"><MessageSquare className="w-3.5 h-3.5" /> Community Feed</h4>
              {isChatMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
            {!isChatMinimized && (
              <div className="flex-1 bg-black/20 border border-[var(--studio-border)] rounded-xl overflow-hidden flex flex-col shadow-inner min-h-0">
                <div ref={chatScrollRef} className="flex-1 p-3 overflow-y-auto custom-scrollbar space-y-2">
                  {chatMessages.map(msg => (
                    <div key={msg.id} className="text-[11px] leading-tight animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <span style={{ color: msg.color }} className="font-bold">{msg.displayName}:</span> <span className="text-zinc-300">{msg.message}</span>
                    </div>
                  ))}
                  {chatMessages.length === 0 && <p className="text-[10px] text-center text-zinc-600 mt-8 italic px-4">Establishing secure chat link...</p>}
                </div>
                <button onClick={toggleChat} className="p-3 text-[9px] font-black uppercase tracking-widest border-t border-[var(--studio-border)] hover:bg-[var(--accent)] hover:text-white transition-all text-[var(--studio-text)] shrink-0">
                  {chatStatus === 'connected' ? 'Terminate Chat' : 'Synchronize Chat'}
                </button>
              </div>
            )}
          </section>
        </div>

        <div className={`border-t border-[var(--studio-border)] flex flex-col transition-all duration-300 ${isLogsMinimized ? 'h-12' : 'h-40'}`}>
           <div className="h-12 flex items-center justify-between px-4 cursor-pointer hover:bg-black/10 transition-colors" onClick={() => setIsLogsMinimized(!isLogsMinimized)}>
              <span className="text-[10px] font-black uppercase tracking-widest text-[var(--studio-text-muted)] flex items-center gap-2"><Terminal className="w-3.5 h-3.5" /> Studio Terminal</span>
              {isLogsMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
           </div>
           {!isLogsMinimized && (
              <div className="flex-1 p-4 bg-black/20 overflow-y-auto font-mono text-[10px] space-y-1 custom-scrollbar text-[var(--studio-text)]">
                 {logs.map((log, i) => (
                    <div key={i} className="flex gap-2">
                       <span className="text-zinc-600">[{log.timestamp}]</span>
                       <span className={log.level === 'error' ? 'text-red-400' : log.level === 'success' ? 'text-emerald-400' : 'text-zinc-400'}>{log.message}</span>
                    </div>
                 ))}
                 {logs.length === 0 && <p className="text-zinc-600 italic">Systems Nominal...</p>}
              </div>
           )}
        </div>
      </aside>
    </div>
  );
};

export default App;