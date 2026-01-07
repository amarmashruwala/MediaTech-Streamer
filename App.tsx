
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, Mic, Settings, Activity, ShieldCheck, Play, Square, RefreshCcw, Terminal, ExternalLink, Monitor, MonitorOff, Layers, User, Move, Maximize2, Video, VideoOff, MicOff, Volume2, VolumeX } from 'lucide-react';
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
  
  // Capability detection
  const [canCaptureScreen, setCanCaptureScreen] = useState<boolean>(true);

  // Decoupled states
  const [isScreenPrimary, setIsScreenPrimary] = useState<boolean>(false);
  const [isPipEnabled, setIsPipEnabled] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [isScreenActive, setIsScreenActive] = useState<boolean>(false);

  // Mute States
  const [isCamVideoMuted, setIsCamVideoMuted] = useState(false);
  const [isCamAudioMuted, setIsCamAudioMuted] = useState(false);
  const [isScreenVideoMuted, setIsScreenVideoMuted] = useState(false);
  const [isScreenAudioMuted, setIsScreenAudioMuted] = useState(false);
  
  // PiP Geometry (Normalized 0-1)
  const [pipX, setPipX] = useState(0.75);
  const [pipY, setPipY] = useState(0.75);
  const [pipSize, setPipSize] = useState(0.25);

  // Audio Monitoring
  const [audioLevel, setAudioLevel] = useState<number>(0);
  
  const [config, setConfig] = useState<StreamConfig>({
    streamKey: '',
    resolution: '1280x720',
    bitrate: 4500,
    fps: 30
  });

  // Media References
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const compositeStreamRef = useRef<MediaStream | null>(null);
  
  // Interaction state
  const isDragging = useRef(false);
  const isResizing = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startPipPos = useRef({ x: 0.75, y: 0.75, size: 0.25 });

  // Hidden elements for composition
  const camVideoEl = useRef<HTMLVideoElement>(document.createElement('video'));
  const screenVideoEl = useRef<HTMLVideoElement>(document.createElement('video'));
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const requestRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioAnimRef = useRef<number | null>(null);
  
  const whipClientRef = useRef<WHIPClient | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((entry: LogEntry) => {
    setLogs(prev => [...prev.slice(-99), entry]);
  }, []);

  // Check for Screen Share support on mount
  useEffect(() => {
    const supported = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
    setCanCaptureScreen(supported);
    if (!supported) {
      addLog({ 
        timestamp: new Date().toLocaleTimeString(), 
        level: 'warn', 
        message: 'Screen sharing is not supported on this device/browser (typical for mobile).' 
      });
    }
  }, [addLog]);

  // Helper to draw images with "cover" behavior (maintaining aspect ratio)
  const drawImageCover = (
    ctx: CanvasRenderingContext2D, 
    img: HTMLVideoElement, 
    x: number, 
    y: number, 
    w: number, 
    h: number
  ) => {
    const imgW = img.videoWidth;
    const imgH = img.videoHeight;
    if (!imgW || !imgH) return;

    const imgRatio = imgW / imgH;
    const targetRatio = w / h;
    
    let sx, sy, sw, sh;
    
    if (imgRatio > targetRatio) {
      sw = imgH * targetRatio;
      sh = imgH;
      sx = (imgW - sw) / 2;
      sy = 0;
    } else {
      sw = imgW;
      sh = imgW / targetRatio;
      sx = 0;
      sy = (imgH - sh) / 2;
    }
    
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  };

  // Audio Monitoring Logic
  const startAudioMonitoring = useCallback((stream: MediaStream) => {
    if (audioAnimRef.current) cancelAnimationFrame(audioAnimRef.current);
    
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      const ctx = audioContextRef.current;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioAnalyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateMeter = () => {
        if (!audioAnalyserRef.current) return;
        audioAnalyserRef.current.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const normalized = Math.min(100, (average / 128) * 100);
        setAudioLevel(normalized);
        audioAnimRef.current = requestAnimationFrame(updateMeter);
      };

      updateMeter();
    } catch (err) {
      console.error('Audio monitoring failed', err);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (audioAnimRef.current) cancelAnimationFrame(audioAnimRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  // Initialization & Resolution Management
  useEffect(() => {
    const setupVideo = (el: HTMLVideoElement) => {
      el.muted = true;
      el.autoplay = true;
      el.playsInline = true;
    };
    setupVideo(camVideoEl.current);
    setupVideo(screenVideoEl.current);

    const [w, h] = config.resolution.split('x').map(Number);
    canvasRef.current.width = w;
    canvasRef.current.height = h;
    
    addLog({ timestamp: new Date().toLocaleTimeString(), level: 'info', message: `Canvas resized to ${config.resolution}` });

    if (isCameraActive) {
      startCamera();
    }

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [config.resolution]);

  const enumerateMedia = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const video = devices.filter(d => d.kind === 'videoinput').map(d => ({ 
        id: d.deviceId, 
        label: d.label || `Camera ${d.deviceId.slice(0, 5)}` 
      }));
      const audio = devices.filter(d => d.kind === 'audioinput').map(d => ({ 
        id: d.deviceId, 
        label: d.label || `Mic ${d.deviceId.slice(0, 5)}` 
      }));
      
      setVideoDevices(video);
      setAudioDevices(audio);
      
      if (video.length && !selectedVideo) setSelectedVideo(video[0].id);
      if (audio.length && !selectedAudio) setSelectedAudio(audio[0].id);
    } catch (err) {
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'error', message: 'Enum failed: ' + (err as Error).message });
    }
  }, [selectedVideo, selectedAudio, addLog]);

  useEffect(() => {
    enumerateMedia();
  }, [enumerateMedia]);

  // Composition Loop
  const composite = useCallback(() => {
    const ctx = canvasRef.current.getContext('2d', { alpha: false });
    if (!ctx) return;

    const width = canvasRef.current.width;
    const height = canvasRef.current.height;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const mainSource = isScreenPrimary ? screenVideoEl.current : camVideoEl.current;
    const pipSource = isScreenPrimary ? camVideoEl.current : screenVideoEl.current;
    
    const isMainActive = isScreenPrimary ? isScreenActive : isCameraActive;
    const isPipActive = isScreenPrimary ? isCameraActive : isScreenActive;

    const isMainMuted = isScreenPrimary ? isScreenVideoMuted : isCamVideoMuted;
    const isPipMuted = isScreenPrimary ? isCamVideoMuted : isScreenVideoMuted;

    if (isMainActive && !isMainMuted && mainSource.readyState >= 2 && !mainSource.paused) {
      drawImageCover(ctx, mainSource, 0, 0, width, height);
    }

    if (isPipEnabled && isPipActive && !isPipMuted && pipSource.readyState >= 2 && !pipSource.paused) {
      const pipW = width * pipSize;
      const pipH = (pipSource.videoHeight / pipSource.videoWidth) * pipW;
      const px = (width * pipX) - (pipW / 2);
      const py = (height * pipY) - (pipH / 2);

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 20;
      ctx.strokeStyle = '#9146ff';
      ctx.lineWidth = 4;
      ctx.strokeRect(px - 2, py - 2, pipW + 4, pipH + 4);
      ctx.drawImage(pipSource, px, py, pipW, pipH);
      ctx.restore();
    }

    requestRef.current = requestAnimationFrame(composite);
  }, [isScreenPrimary, isPipEnabled, pipX, pipY, pipSize, isCamVideoMuted, isScreenVideoMuted, config.resolution, isCameraActive, isScreenActive]);

  useEffect(() => {
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    requestRef.current = requestAnimationFrame(composite);
  }, [composite]);

  useEffect(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getAudioTracks().forEach(t => t.enabled = !isCamAudioMuted);
    }
  }, [isCamAudioMuted]);

  useEffect(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getAudioTracks().forEach(t => t.enabled = !isScreenAudioMuted);
    }
  }, [isScreenAudioMuted]);

  const updateCompositeStream = useCallback(() => {
    if (!canvasRef.current) return;
    
    if (!compositeStreamRef.current) {
      compositeStreamRef.current = canvasRef.current.captureStream(config.fps);
    }

    const cameraAudio = cameraStreamRef.current?.getAudioTracks() || [];
    const currentTracks = compositeStreamRef.current.getAudioTracks();

    if (cameraAudio.length > 0 && (currentTracks.length === 0 || currentTracks[0].id !== cameraAudio[0].id)) {
      currentTracks.forEach(t => compositeStreamRef.current?.removeTrack(t));
      compositeStreamRef.current.addTrack(cameraAudio[0]);
    }

    if (videoPreviewRef.current && videoPreviewRef.current.srcObject !== compositeStreamRef.current) {
      videoPreviewRef.current.srcObject = compositeStreamRef.current;
    }
  }, [config.fps]);

  const startCamera = async () => {
    try {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(t => t.stop());
      }
      const [width, height] = config.resolution.split('x').map(Number);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: selectedVideo ? { exact: selectedVideo } : undefined, width, height, frameRate: config.fps },
        audio: { deviceId: selectedAudio ? { exact: selectedAudio } : undefined }
      });
      cameraStreamRef.current = stream;
      camVideoEl.current.srcObject = stream;
      await camVideoEl.current.play();
      setIsCameraActive(true);
      updateCompositeStream();
      startAudioMonitoring(stream);
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'success', message: 'Camera active.' });
    } catch (err) {
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'error', message: 'Camera error: ' + (err as Error).message });
    }
  };

  const startScreen = async () => {
    if (!canCaptureScreen) {
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'error', message: 'Screen capture is not available on this device.' });
      return false;
    }
    try {
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'info', message: 'Requesting screen capture...' });
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      screenStreamRef.current = stream;
      screenVideoEl.current.srcObject = stream;
      await screenVideoEl.current.play();
      
      stream.getVideoTracks()[0].onended = () => {
        setIsScreenActive(false);
        setIsScreenPrimary(false);
        setIsPipEnabled(false);
      };

      setIsScreenActive(true);
      updateCompositeStream();
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'success', message: 'Screen capture active.' });
      return true;
    } catch (err) {
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'warn', message: 'Screen failed: ' + (err as Error).message });
      return false;
    }
  };

  const togglePrimaryView = async () => {
    if (!canCaptureScreen) return;
    if (!isScreenPrimary) {
      if (!isScreenActive) {
        const success = await startScreen();
        if (!success) return;
      }
      setIsScreenPrimary(true);
    } else {
      setIsScreenPrimary(false);
    }
  };

  const togglePip = async () => {
    if (!isPipEnabled) {
      if (isScreenPrimary) {
        if (!isCameraActive) await startCamera();
      } else {
        if (!canCaptureScreen) {
            addLog({ timestamp: new Date().toLocaleTimeString(), level: 'warn', message: 'Cannot enable Screen PiP: Feature not supported.' });
            return;
        }
        if (!isScreenActive) {
          const success = await startScreen();
          if (!success) return;
        }
      }
      setIsPipEnabled(true);
    } else {
      setIsPipEnabled(false);
    }
  };

  const handleMouseDown = (e: React.MouseEvent, type: 'drag' | 'resize') => {
    if (!isPipEnabled) return;
    e.preventDefault();
    if (type === 'drag') isDragging.current = true;
    else isResizing.current = true;
    
    startPos.current = { x: e.clientX, y: e.clientY };
    startPipPos.current = { x: pipX, y: pipY, size: pipSize };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!previewContainerRef.current) return;
    const rect = previewContainerRef.current.getBoundingClientRect();
    const deltaX = (e.clientX - startPos.current.x) / rect.width;
    const deltaY = (e.clientY - startPos.current.y) / rect.height;

    if (isDragging.current) {
      setPipX(Math.max(0.1, Math.min(0.9, startPipPos.current.x + deltaX)));
      setPipY(Math.max(0.1, Math.min(0.9, startPipPos.current.y + deltaY)));
    } else if (isResizing.current) {
      setPipSize(Math.max(0.1, Math.min(0.5, startPipPos.current.size + deltaX)));
    }
  };

  const handleMouseUp = () => {
    isDragging.current = false;
    isResizing.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  const toggleStream = async () => {
    if (status === StreamStatus.STREAMING || status === StreamStatus.CONNECTING) {
      whipClientRef.current?.stop();
      whipClientRef.current = null;
      setStatus(StreamStatus.IDLE);
      return;
    }
    if (!config.streamKey) {
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'warn', message: 'Stream Key missing.' });
      return;
    }
    if (!isCameraActive) await startCamera();
    updateCompositeStream();
    if (!compositeStreamRef.current) return;
    try {
      setStatus(StreamStatus.CONNECTING);
      whipClientRef.current = new WHIPClient(TWITCH_WHIP_URL, config.streamKey, addLog);
      await whipClientRef.current.start(compositeStreamRef.current, config.bitrate);
      setStatus(StreamStatus.STREAMING);
    } catch (err) {
      addLog({ timestamp: new Date().toLocaleTimeString(), level: 'error', message: 'Handshake error: ' + (err as Error).message });
      setStatus(StreamStatus.ERROR);
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col gap-6 max-w-7xl mx-auto">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#18181b] p-6 rounded-xl border border-[#26262b] shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="p-3 twitch-purple rounded-lg shadow-[0_0_20px_rgba(145,70,255,0.3)]">
            <Activity className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">MediaTech Streamer</h1>
            <p className="text-gray-400 text-sm flex items-center gap-1">
              <ShieldCheck className="w-4 h-4 text-green-500" /> WHIP protocol ingest
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border ${
            status === StreamStatus.STREAMING ? 'bg-red-500/10 border-red-500 text-red-500 animate-pulse' : 
            status === StreamStatus.CONNECTING ? 'bg-yellow-500/10 border-yellow-500 text-yellow-500' :
            'bg-gray-500/10 border-gray-500 text-gray-400'
          }`}>
            <span className={`w-2 h-2 rounded-full ${status === StreamStatus.STREAMING ? 'bg-red-500' : 'bg-gray-500'}`} />
            {status}
          </div>
          <button 
            onClick={toggleStream}
            disabled={status === StreamStatus.CONNECTING}
            className={`flex items-center gap-2 px-8 py-3 rounded-lg font-bold transition-all transform hover:scale-[1.02] active:scale-[0.98] ${
              status === StreamStatus.STREAMING 
                ? 'bg-zinc-800 hover:bg-zinc-700 text-white' 
                : 'twitch-purple twitch-purple-hover text-white'
            }`}
          >
            {status === StreamStatus.STREAMING ? (
              <><Square className="w-5 h-5 fill-current" /> Stop Broadcast</>
            ) : (
              <><Play className="w-5 h-5 fill-current" /> Go Live</>
            )}
          </button>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        <div className="lg:col-span-8 flex flex-col gap-6">
          <div 
            ref={previewContainerRef}
            className="relative aspect-video bg-black rounded-xl overflow-hidden shadow-2xl border border-[#26262b] group select-none"
          >
            <video ref={videoPreviewRef} autoPlay muted playsInline className="w-full h-full object-cover pointer-events-none" />
            
            {isPipEnabled && (
              <div 
                className="absolute border-2 border-dashed border-[#9146ff]/50 bg-[#9146ff]/10 cursor-move group/pip"
                style={{
                  left: `${(pipX - (pipSize / 2)) * 100}%`,
                  top: `${(pipY - (pipSize / 2 * (isScreenPrimary ? (camVideoEl.current.videoHeight/camVideoEl.current.videoWidth || 1) : (screenVideoEl.current.videoHeight/screenVideoEl.current.videoWidth || 1)))) * 100}%`,
                  width: `${pipSize * 100}%`,
                  aspectRatio: isScreenPrimary 
                    ? `${camVideoEl.current.videoWidth}/${camVideoEl.current.videoHeight}` 
                    : `${screenVideoEl.current.videoWidth}/${screenVideoEl.current.videoHeight}`
                }}
                onMouseDown={(e) => handleMouseDown(e, 'drag')}
              >
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/pip:opacity-100 transition-opacity">
                  <Move className="text-white w-6 h-6 drop-shadow-lg" />
                </div>
                <div 
                  className="absolute -right-2 -bottom-2 w-6 h-6 bg-[#9146ff] rounded-full flex items-center justify-center cursor-nwse-resize shadow-lg active:scale-125 transition-transform"
                  onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'resize'); }}
                >
                  <Maximize2 className="text-white w-3 h-3" />
                </div>
              </div>
            )}

            <div className="absolute top-4 left-4 flex gap-2 pointer-events-none">
              <div className="bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-md text-[10px] font-bold border border-white/10 uppercase tracking-tighter text-white">
                {isScreenPrimary ? 'Main: Screen' : 'Main: Camera'} {isPipEnabled && ' (PiP Enabled)'}
              </div>
            </div>

            <div className="absolute bottom-4 left-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="flex bg-black/60 backdrop-blur-md p-1.5 rounded-lg border border-white/10 gap-1.5 items-center">
                <span className="text-[9px] font-bold text-zinc-500 uppercase px-1">Cam</span>
                <button 
                  onClick={() => setIsCamVideoMuted(!isCamVideoMuted)}
                  className={`p-1.5 rounded-md transition-all ${isCamVideoMuted ? 'bg-red-500/20 text-red-500' : 'bg-white/10 text-white hover:bg-white/20'}`}
                  title={isCamVideoMuted ? "Show Camera" : "Hide Camera"}
                >
                  {isCamVideoMuted ? <VideoOff className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
                </button>
                <button 
                  onClick={() => setIsCamAudioMuted(!isCamAudioMuted)}
                  className={`p-1.5 rounded-md transition-all ${isCamAudioMuted ? 'bg-red-500/20 text-red-500' : 'bg-white/10 text-white hover:bg-white/20'}`}
                  title={isCamAudioMuted ? "Unmute Mic" : "Mute Mic"}
                >
                  {isCamAudioMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                </button>
              </div>

              {canCaptureScreen && (
                <div className="flex bg-black/60 backdrop-blur-md p-1.5 rounded-lg border border-white/10 gap-1.5 items-center">
                    <span className="text-[9px] font-bold text-zinc-500 uppercase px-1">Screen</span>
                    <button 
                    onClick={() => setIsScreenVideoMuted(!isScreenVideoMuted)}
                    className={`p-1.5 rounded-md transition-all ${isScreenVideoMuted ? 'bg-red-500/20 text-red-500' : 'bg-white/10 text-white hover:bg-white/20'}`}
                    title={isScreenVideoMuted ? "Show Screen" : "Hide Screen"}
                    >
                    {isScreenVideoMuted ? <MonitorOff className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
                    </button>
                    <button 
                    onClick={() => setIsScreenAudioMuted(!isScreenAudioMuted)}
                    className={`p-1.5 rounded-md transition-all ${isScreenAudioMuted ? 'bg-red-500/20 text-red-500' : 'bg-white/10 text-white hover:bg-white/20'}`}
                    title={isScreenAudioMuted ? "Unmute Screen Audio" : "Mute Screen Audio"}
                    >
                    {isScreenAudioMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                </div>
              )}
            </div>

            <div className="absolute bottom-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
               <button 
                onClick={togglePip}
                className={`p-3 rounded-full backdrop-blur-xl border border-white/20 transition-all ${
                  isPipEnabled ? 'bg-green-500 text-white' : 'bg-black/60 text-white hover:bg-black/80'
                } ${!canCaptureScreen && !isScreenPrimary ? 'opacity-50 cursor-not-allowed' : ''}`}
                title="Toggle Picture-in-Picture"
              >
                <Layers className="w-5 h-5" />
              </button>
              {canCaptureScreen && (
                <button 
                    onClick={togglePrimaryView}
                    className={`p-3 rounded-full backdrop-blur-xl border border-white/20 transition-all ${
                    isScreenPrimary ? 'bg-[#9146ff] text-white' : 'bg-black/60 text-white hover:bg-black/80'
                    }`}
                    title={isScreenPrimary ? "Switch to Camera Background" : "Switch to Screen Background"}
                >
                    {isScreenPrimary ? <Camera className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
                </button>
              )}
            </div>

            {!isCameraActive && !isScreenActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-[#0e0e10]">
                <div className="w-20 h-20 rounded-full bg-zinc-900 flex items-center justify-center border border-zinc-800 animate-pulse">
                   <User className="w-8 h-8 text-zinc-600" />
                </div>
                <button 
                  onClick={() => startCamera()}
                  className="px-8 py-3 bg-white text-black hover:bg-zinc-200 rounded-lg text-sm font-bold transition-all shadow-xl"
                >
                  Start Producer Engine
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#18181b] p-6 rounded-xl border border-[#26262b]">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 block">Video Device</label>
              <div className="flex gap-2">
                <select 
                  className="flex-1 bg-[#26262b] border border-[#3f3f46] rounded-lg px-4 py-2.5 text-sm outline-none cursor-pointer"
                  value={selectedVideo}
                  onChange={(e) => { setSelectedVideo(e.target.value); if (isCameraActive) startCamera(); }}
                >
                  {videoDevices.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
                <button onClick={enumerateMedia} className="p-2.5 bg-[#26262b] rounded-lg border border-[#3f3f46]"><RefreshCcw className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="bg-[#18181b] p-6 rounded-xl border border-[#26262b]">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 block flex justify-between">
                <span>Audio Device</span>
                {isCameraActive && !isCamAudioMuted && <span className="text-zinc-600 font-mono text-[9px]">{Math.round(audioLevel)}%</span>}
              </label>
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <select 
                    className="flex-1 bg-[#26262b] border border-[#3f3f46] rounded-lg px-4 py-2.5 text-sm outline-none cursor-pointer"
                    value={selectedAudio}
                    onChange={(e) => { setSelectedAudio(e.target.value); if (isCameraActive) startCamera(); }}
                  >
                    {audioDevices.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                  <button onClick={enumerateMedia} className="p-2.5 bg-[#26262b] rounded-lg border border-[#3f3f46]"><RefreshCcw className="w-4 h-4" /></button>
                </div>
                
                {/* Audio Monitor Meter */}
                <div className="h-1.5 w-full bg-[#0e0e10] rounded-full overflow-hidden border border-[#26262b]">
                   <div 
                    className={`h-full transition-all duration-75 rounded-full ${isCamAudioMuted ? 'bg-zinc-800' : 'bg-gradient-to-r from-green-500 via-yellow-400 to-red-500'}`}
                    style={{ 
                      width: `${isCamAudioMuted ? 0 : audioLevel}%`,
                      boxShadow: audioLevel > 80 ? '0 0 10px rgba(239, 68, 68, 0.4)' : 'none'
                    }} 
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="bg-[#18181b] p-6 rounded-xl border border-[#26262b] shadow-xl">
            <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2 mb-6 text-zinc-400"><Settings className="w-3.5 h-3.5" /> Stream Config</h3>
            <div className="space-y-6">
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1.5 flex justify-between items-center">
                  Twitch Key 
                  <a href="https://dashboard.twitch.tv/settings/stream" target="_blank" rel="noreferrer" className="text-[#9146ff] hover:underline flex items-center gap-1">Dashboard <ExternalLink className="w-2.5 h-2.5" /></a>
                </label>
                <input type="password" placeholder="Paste stream key here..." className="w-full bg-[#0e0e10] border border-[#26262b] rounded-lg px-4 py-2.5 text-sm font-mono focus:ring-1 focus:ring-[#9146ff] outline-none" value={config.streamKey} onChange={(e) => setConfig({...config, streamKey: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1.5">Canvas</label>
                  <select className="w-full bg-[#0e0e10] border border-[#26262b] rounded-lg px-3 py-2 text-xs font-bold outline-none" value={config.resolution} onChange={(e) => setConfig({...config, resolution: e.target.value})}>
                    <option value="1920x1080">1080p</option><option value="1280x720">720p</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1.5">Target FPS</label>
                  <select className="w-full bg-[#0e0e10] border border-[#26262b] rounded-lg px-3 py-2 text-xs font-bold outline-none" value={config.fps} onChange={(e) => setConfig({...config, fps: Number(e.target.value)})}>
                    <option value="60">60 FPS</option><option value="30">30 FPS</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1.5 flex justify-between"><span>Bitrate</span><span className="text-[#9146ff]">{config.bitrate} kbps</span></label>
                <input type="range" min="1500" max="8000" step="500" className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#9146ff]" value={config.bitrate} onChange={(e) => setConfig({...config, bitrate: Number(e.target.value)})} />
              </div>
            </div>
          </div>

          <div className="bg-[#0e0e10] rounded-xl border border-[#26262b] flex-1 flex flex-col min-h-[350px] overflow-hidden shadow-2xl">
            <div className="bg-[#18181b] px-4 py-3 border-b border-[#26262b] flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 text-zinc-400"><Terminal className="w-3.5 h-3.5" /> Engine Logs</span>
              <button onClick={() => setLogs([])} className="text-[9px] text-zinc-600 hover:text-zinc-300 font-black">CLEAR</button>
            </div>
            <div ref={logContainerRef} className="flex-1 p-4 overflow-y-auto space-y-1.5 font-mono text-[11px] bg-black/40">
              {logs.map((log, i) => (
                <div key={i} className="flex gap-2.5 leading-relaxed">
                  <span className="text-zinc-700">[{log.timestamp}]</span>
                  <span className={`${log.level === 'error' ? 'text-red-500' : log.level === 'warn' ? 'text-yellow-500' : log.level === 'success' ? 'text-green-500' : 'text-zinc-400'}`}>{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <footer className="text-center text-zinc-800 text-[9px] uppercase font-black tracking-[0.3em] py-8 border-t border-zinc-900 mt-6">
        MediaTech Streamer 1.0 • Composite WHIP Engine • Mobile Optimized • Track Muting
      </footer>
    </div>
  );
};

export default App;
