
export enum StreamStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  STREAMING = 'STREAMING',
  ERROR = 'ERROR'
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export interface StreamConfig {
  streamKey: string;
  resolution: string;
  bitrate: number;
  fps: number;
}

export interface DeviceInfo {
  id: string;
  label: string;
}
