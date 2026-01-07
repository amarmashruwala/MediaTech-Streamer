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

export interface TwitchBadge {
  name: string;
  version: string;
}

export interface ChatMessage {
  id: string;
  username: string;
  displayName: string;
  message: string;
  color: string;
  timestamp: string;
  badges: TwitchBadge[];
  isAction: boolean;
}

export interface StreamConfig {
  channelName: string;
  streamKey: string;
  resolution: string;
  bitrate: number;
  fps: number;
  streamType: 'twitch' | 'custom';
  customEndpoint?: string;
}

export interface DeviceInfo {
  id: string;
  label: string;
}

export type Theme = 'dark' | 'light' | 'midnight';