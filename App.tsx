import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Camera, Mic, Activity, RefreshCcw, Terminal, Monitor, 
  Layers, Video, Volume2, ChevronDown, ChevronUp, 
  Zap, Radio, Cpu, Layout, SlidersHorizontal
} from 'lucide-react';
import { StreamStatus, LogEntry, StreamConfig, DeviceInfo } from './types';
import { WHIPClient } from './services/whipClient';

const TWITCH_WHIP_URL = 'https://g.webrtc.live-video.net:4443/v2/offer';

const App: React.FC = () => {
  const [status, setStatus] = useState<StreamStatus>(StreamStatus.IDLE);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [videoDevices, setVideoDevices] = useState<DeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<DeviceInfo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<string>('');
  const [selectedAudio, setSelectedAudio] = useState<string>('');
  
  // UI Layout States
  const [isLogsMinimized, setIsLogsMinimized] = useState<boolean>(false);
  
  // Production Scene States
  const [isScreenPrimary, setIsScreenPrimary] = useState<boolean>(false);
  const [isPipEnabled, setIsPipEnabled] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [isScreenActive, setIsScreenActive] = useState<boolean>(false);

  // PiP Geometry (Normalized 0-1)
  const [pipX, setPipX] = useState(0.82);
  const [pipY, setPipY] = useState(0.8);
  const [pipSize, setPipSize] = useState(0.22);

  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [config, setConfig] = useState<StreamConfig>({
    streamKey: '',
    resolution: '1920x1080',
    bitrate: 4500,
    fps: 30
  });

  // Media References
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const compositeStreamRef = useRef<MediaStream | null>(null);
  
  // Composition State
  const camVideoEl = useRef<HTMLVideoElement>(Object.assign(document.createElement('video'), { muted: true, autoplay: true, playsInline: true }));
  const screenVideoEl = useRef<HTMLVideoElement>(Object.assign(document.createElement('video'), { muted: true, autoplay: true, playsInline: true }));
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const requestRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioAnimRef = useRef<number | null>(null);
  
  const whipClientRef = useRef<WHIPClient | null>(null);
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startPipPos = useRef({ x: 0.82, y: 0.8 });

  const addLog = useCallback((entry: LogEntry) => {
    setLogs(prev => [...prev.slice(-49), entry]);
  }, []);

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

  const composite = useCallback(() => {
    const ctx = canvasRef.current.getContext('2d', { alpha: false });
    if (!ctx) return;

    const w = canvasRef.current.width;
    const h = canvasRef.current.height;

    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, w, h);

    const mainSource = isScreenPrimary ? screenVideoEl.current : camVideoEl.current;
    const pipSource = isScreenPrimary ? camVideoEl.current : screenVideoEl.current;
    const isMainActive = isScreenPrimary ? isScreenActive : isCameraActive;
    const isPipActive = isScreenPrimary ? isCameraActive : isScreenActive;

    // Background Layer
    if (isMainActive && mainSource.readyState >= 2) {
      const ratio = Math.max(w / mainSource.videoWidth, h / mainSource.videoHeight);
      const nw = mainSource.videoWidth * ratio;
      const nh = mainSource.videoHeight * ratio;
      ctx.drawImage(mainSource, (w - nw) / 2, (h - nh) / 2, nw, nh);
    }

    // PiP Layer (Fixed 16:9 Aspect Ratio)
    if (isPipEnabled && isPipActive && pipSource.readyState >= 2) {
      const pW = w * pipSize;
      const pH = pW * (9 / 16); // Strict 16:9 aspect ratio for PiP
      const px = (w * pipX) - (pW / 2);
      const py = (h * pipY) - (pH / 2);

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 30;
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 4;
      ctx.strokeRect(px, py, pW, pH);

      // Perform 'cover' crop for the source within the fixed 16:9 PiP frame
      const sourceAspect = pipSource.videoWidth / pipSource.videoHeight;
      const targetAspect = 16 / 9;
      let sX, sY, sW, sH;

      if (sourceAspect > targetAspect) {
        sH = pipSource.videoHeight;
        sW = sH * targetAspect;
        sX = (pipSource.videoWidth - sW) / 2;
        sY = 0;
      } else {
        sW = pipSource.videoWidth;
        sH = sW / targetAspect;
        sX = 0;
        sY = (pipSource.videoHeight - sH) / 2;
      }

      ctx.drawImage(pipSource, sX, sY, sW, sH, px, py, pW, pH);
      ctx.restore();
    }
    requestRef.current = requestAnimationFrame(composite);
  }, [isScreenPrimary, isPipEnabled, pipX, pipY, pipSize, isCameraActive, isScreenActive, config.resolution]);

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
    } catch (e) {
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'warn', message: 'Capture aborted.' });
    }
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
    return 'text-indigo-400';
  };

  return (
    <div className="h-screen w-full flex bg-[#09090b] text-[#fafafa] overflow-hidden">
      {/* Left Navigation Bar - Minimalist Branding */}
      <nav className="w-16 border-r border-zinc-800 flex flex-col items-center py-6 bg-[#0c0c0e]">
        <div className="p-3 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-500/20">
          <Activity className="w-6 h-6 text-white" />
        </div>
      </nav>

      {/* Main Production Stage */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-8 bg-[#09090b]">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-black uppercase tracking-[0.2em] text-zinc-400">MediaTech <span className="text-indigo-500">Studio Engine</span></h1>
            <div className={`h-1.5 w-1.5 rounded-full ${status === StreamStatus.STREAMING ? 'bg-red-500 status-pulse' : 'bg-zinc-700'}`} />
          </div>
          
          <div className="flex items-center gap-6">
            <div className="hidden md:flex flex-col items-end">
              <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Protocol</span>
              <span className="text-xs font-mono text-indigo-400">WHIP / WebRTC 1.0</span>
            </div>
            <button 
              onClick={handleBroadcast}
              className={`px-8 h-10 rounded-lg font-bold text-xs uppercase tracking-widest transition-all ${
                status === StreamStatus.STREAMING 
                ? 'bg-zinc-800 hover:bg-zinc-700' 
                : 'bg-indigo-600 hover:bg-indigo-500 shadow-xl shadow-indigo-600/10'
              }`}
            >
              {status === StreamStatus.STREAMING ? 'End Broadcast' : 'Go Live'}
            </button>
          </div>
        </header>

        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar space-y-6">
          {/* Program Monitor */}
          <div 
            ref={previewContainerRef}
            className="relative w-full max-w-6xl mx-auto aspect-video rounded-2xl bg-black shadow-2xl overflow-hidden border border-zinc-800 group"
          >
            <video ref={videoPreviewRef} autoPlay muted playsInline className="w-full h-full object-contain" />
            
            {/* Visual Overlays */}
            <div className="absolute top-6 left-6 flex gap-3">
              <div className="px-3 py-1.5 studio-glass rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Program Out
              </div>
              <div className="px-3 py-1.5 studio-glass rounded-lg text-[10px] font-mono text-zinc-300">
                {config.resolution} @ {config.fps}fps
              </div>
            </div>

            {/* Draggable PiP Indicator */}
            {isPipEnabled && (
              <div 
                className="absolute border-2 border-indigo-500 cursor-move bg-indigo-500/10"
                style={{
                  left: `${(pipX - pipSize/2) * 100}%`,
                  top: `${(pipY - (pipSize * 0.5625 / 2)) * 100}%`,
                  width: `${pipSize * 100}%`,
                  aspectRatio: '16/9'
                }}
                onMouseDown={(e) => {
                  isDragging.current = true;
                  startPos.current = { x: e.clientX, y: e.clientY };
                  startPipPos.current = { x: pipX, y: pipY };
                  const move = (me: MouseEvent) => {
                    if (!isDragging.current) return;
                    const r = previewContainerRef.current!.getBoundingClientRect();
                    setPipX(Math.max(0.1, Math.min(0.9, startPipPos.current.x + (me.clientX - startPos.current.x) / r.width)));
                    setPipY(Math.max(0.1, Math.min(0.9, startPipPos.current.y + (me.clientY - startPos.current.y) / r.height)));
                  };
                  const up = () => { isDragging.current = false; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
                  window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
                }}
              />
            )}

            {/* Floating Action HUD */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 studio-glass rounded-2xl flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-4 group-hover:translate-y-0">
              <button onClick={() => !isCameraActive ? startCamera() : setIsCameraActive(!isCameraActive)} className={`p-3 rounded-xl transition-all ${isCameraActive ? 'bg-zinc-800 text-white' : 'bg-red-500/20 text-red-500'}`}><Camera className="w-5 h-5" /></button>
              <button className="p-3 bg-zinc-800 rounded-xl hover:text-indigo-400"><Mic className="w-5 h-5" /></button>
              <button onClick={toggleScreen} className={`p-3 rounded-xl transition-all ${isScreenActive ? 'bg-indigo-600' : 'bg-zinc-800'}`}><Monitor className="w-5 h-5" /></button>
              <div className="w-px h-6 bg-zinc-700 mx-2" />
              <button onClick={() => setIsPipEnabled(!isPipEnabled)} className={`p-3 rounded-xl transition-all ${isPipEnabled ? 'bg-indigo-600' : 'bg-zinc-800'}`}><Layers className="w-5 h-5" /></button>
              <button onClick={() => setIsScreenPrimary(!isScreenPrimary)} className="p-3 bg-zinc-800 rounded-xl hover:text-indigo-400"><RefreshCcw className="w-5 h-5" /></button>
            </div>

            {/* Empty State */}
            {!isCameraActive && !isScreenActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#09090b]">
                <Cpu className="w-12 h-12 text-zinc-800 mb-4 animate-pulse" />
                <button onClick={startCamera} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold text-sm shadow-2xl">Initialize Ingest</button>
              </div>
            )}
          </div>

          {/* Mixer & Source Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full max-w-6xl mx-auto">
             {/* Video Module */}
             <div className="bg-[#121214] p-6 rounded-2xl border border-zinc-800 flex flex-col gap-5">
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-3">
                      <div className="p-2 bg-indigo-500/10 rounded-lg"><Video className="w-4 h-4 text-indigo-500" /></div>
                      <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Video Ingest</h3>
                   </div>
                   <div className="px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 rounded text-[9px] font-black text-indigo-400 uppercase tracking-tighter">HD PRO 10-BIT</div>
                </div>

                <div className="flex gap-2">
                   <select className="flex-1 bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-medium outline-none focus:border-indigo-500 transition-colors" value={selectedVideo} onChange={e => setSelectedVideo(e.target.value)}>
                      {videoDevices.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                   </select>
                   <button onClick={enumerateMedia} className="p-2 bg-zinc-800 rounded-lg hover:text-indigo-400 transition-all"><RefreshCcw className="w-4 h-4" /></button>
                </div>

                <div className="flex items-center justify-between px-1">
                   <span className="text-[9px] font-bold text-zinc-600 uppercase">Hardware ID: {selectedVideo.slice(0, 12)}...</span>
                   <button className="text-[9px] font-bold text-indigo-500 hover:underline uppercase">Settings</button>
                </div>
             </div>

             {/* Audio Module */}
             <div className="bg-[#121214] p-6 rounded-2xl border border-zinc-800 flex flex-col gap-5">
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-3">
                      <div className="p-2 bg-indigo-500/10 rounded-lg"><Volume2 className="w-4 h-4 text-indigo-500" /></div>
                      <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Audio Mixer</h3>
                   </div>
                   <span className="text-[10px] font-mono font-bold text-zinc-500 tracking-tighter">GAIN: {Math.round(audioLevel)}%</span>
                </div>
                
                <div className="flex gap-2">
                   <select className="flex-1 bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-medium outline-none focus:border-indigo-500 transition-colors" value={selectedAudio} onChange={e => setSelectedAudio(e.target.value)}>
                      {audioDevices.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                   </select>
                   <button onClick={enumerateMedia} className="p-2 bg-zinc-800 rounded-lg hover:text-indigo-400 transition-all"><RefreshCcw className="w-4 h-4" /></button>
                </div>

                <div className="h-4 w-full bg-black/40 rounded-full flex gap-[2px] p-1 overflow-hidden border border-zinc-800">
                   {[...Array(40)].map((_, i) => (
                      <div key={i} className={`flex-1 rounded-sm transition-colors duration-75 ${audioLevel > (i/40)*100 ? (i > 32 ? 'bg-red-500' : i > 26 ? 'bg-yellow-400' : 'bg-indigo-500') : 'bg-zinc-900'}`} />
                   ))}
                </div>
             </div>
          </div>
        </div>
      </main>

      {/* Right Properties & Telemetry Panel */}
      <aside className="w-80 border-l border-zinc-800 flex flex-col bg-[#0c0c0e]">
        <div className="p-6 space-y-8 overflow-y-auto flex-1 custom-scrollbar">
          {/* Destination Config */}
          <section>
            <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4 flex items-center gap-2">
               <Radio className="w-3.5 h-3.5" /> Destination
            </h4>
            <div className="space-y-4">
               <div>
                  <label className="text-[9px] font-bold text-zinc-600 uppercase block mb-1.5">Stream Token</label>
                  <input type="password" placeholder="live_..." className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-indigo-500 transition-colors" value={config.streamKey} onChange={e => setConfig({...config, streamKey: e.target.value})} />
               </div>
            </div>
          </section>

          {/* Encoder Config */}
          <section>
            <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4 flex items-center gap-2">
               <Zap className="w-3.5 h-3.5" /> Encoder Engine
            </h4>
            <div className="space-y-6">
               <div className="grid grid-cols-2 gap-3">
                  <div>
                     <label className="text-[9px] font-bold text-zinc-600 uppercase block mb-1">FPS</label>
                     <select className="w-full bg-black/40 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs font-bold" value={config.fps} onChange={e => setConfig({...config, fps: Number(e.target.value)})}>
                        <option value="60">60</option><option value="30">30</option>
                     </select>
                  </div>
                  <div>
                     <label className="text-[9px] font-bold text-zinc-600 uppercase block mb-1">Resolution</label>
                     <select className="w-full bg-black/40 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs font-bold" value={config.resolution} onChange={e => setConfig({...config, resolution: e.target.value})}>
                        <option value="1920x1080">1080p</option><option value="1280x720">720p</option>
                     </select>
                  </div>
               </div>

               {/* Precision Bitrate Fine Tuning */}
               <div className="space-y-3 p-4 bg-black/20 rounded-xl border border-zinc-800/50">
                  <div className="flex items-center justify-between">
                     <div className="flex items-center gap-2">
                        <SlidersHorizontal className="w-3 h-3 text-zinc-500" />
                        <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Fine Bitrate</label>
                     </div>
                     <span className={`text-[10px] font-mono font-bold ${getBitrateColor(config.bitrate)}`}>
                        {config.bitrate} <span className="text-zinc-600">KBPS</span>
                     </span>
                  </div>
                  <input 
                    type="range" 
                    min="500" 
                    max="10000" 
                    step="100"
                    value={config.bitrate}
                    onChange={(e) => setConfig({...config, bitrate: parseInt(e.target.value)})}
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <div className="flex justify-between text-[8px] font-bold text-zinc-700 uppercase px-0.5">
                     <span>500k</span>
                     <span>Twitch Opt (4-6m)</span>
                     <span>10m</span>
                  </div>
               </div>
            </div>
          </section>
        </div>

        {/* Telemetry Console */}
        <div className={`border-t border-zinc-800 flex flex-col transition-all duration-300 ${isLogsMinimized ? 'h-12' : 'h-64'}`}>
           <div className="h-12 bg-black/20 flex items-center justify-between px-4 cursor-pointer hover:bg-black/40 transition-colors" onClick={() => setIsLogsMinimized(!isLogsMinimized)}>
              <div className="flex items-center gap-2">
                 <Terminal className="w-3.5 h-3.5 text-zinc-500" />
                 <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Telemetry Terminal</span>
              </div>
              {isLogsMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
           </div>
           {!isLogsMinimized && (
              <div className="flex-1 p-4 bg-black overflow-y-auto font-mono text-[10px] space-y-1.5 custom-scrollbar">
                 {logs.map((log, i) => (
                    <div key={i} className="flex gap-2">
                       <span className="text-zinc-700 shrink-0">[{log.timestamp}]</span>
                       <span className={`${log.level === 'error' ? 'text-red-500' : log.level === 'success' ? 'text-emerald-500' : log.level === 'warn' ? 'text-yellow-500' : 'text-zinc-400'}`}>{log.message}</span>
                    </div>
                 ))}
                 {logs.length === 0 && <div className="text-zinc-800 italic uppercase font-bold text-center py-8">Standby for telemetry...</div>}
              </div>
           )}
        </div>
      </aside>
    </div>
  );
};

export default App;