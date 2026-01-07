import { ChatMessage, TwitchBadge } from '../types';

export class TwitchChatService {
  private ws: WebSocket | null = null;
  private reconnectInterval = 1000;
  private maxReconnectInterval = 30000;
  private channel: string = '';
  private onMessageCallback: (msg: ChatMessage) => void;
  private onStatusCallback: (status: 'connected' | 'disconnected' | 'connecting') => void;

  constructor(
    onMessage: (msg: ChatMessage) => void,
    onStatus: (status: 'connected' | 'disconnected' | 'connecting') => void
  ) {
    this.onMessageCallback = onMessage;
    this.onStatusCallback = onStatus;
  }

  connect(channel: string) {
    this.channel = channel.toLowerCase().replace('#', '');
    if (this.ws) this.ws.close();

    this.onStatusCallback('connecting');
    this.ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

    this.ws.onopen = () => {
      this.reconnectInterval = 1000;
      // Use anonymous login by default for safety
      this.ws?.send('CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership');
      this.ws?.send('PASS SCHMOOPIIE');
      this.ws?.send(`NICK justinfan${Math.floor(Math.random() * 80000) + 1000}`);
      this.ws?.send(`JOIN #${this.channel}`);
      this.onStatusCallback('connected');
    };

    this.ws.onmessage = (event) => {
      const rawMessages = event.data.split('\r\n');
      rawMessages.forEach((raw: string) => this.parseIRCMessage(raw));
    };

    this.ws.onclose = () => {
      this.onStatusCallback('disconnected');
      setTimeout(() => this.connect(this.channel), this.reconnectInterval);
      this.reconnectInterval = Math.min(this.reconnectInterval * 2, this.maxReconnectInterval);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private parseIRCMessage(raw: string) {
    if (!raw) return;

    // Handle PING/PONG to keep connection alive
    if (raw.startsWith('PING')) {
      this.ws?.send('PONG :tmi.twitch.tv');
      return;
    }

    // Example PRIVMSG with tags:
    // @badge-info=;badges=broadcaster/1;color=#0000FF;display-name=User;emotes=;id=123-abc;mod=0;room-id=456;subscriber=0;tmi-sent-ts=1620000000000;turbo=0;user-id=789;user-type= :user!user@user.tmi.twitch.tv PRIVMSG #channel :message text
    const match = raw.match(/^@([^ ]+) :([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.+)$/);
    if (match) {
      const [, tagStr, username, message] = match;
      const tags = this.parseTags(tagStr);
      
      const chatMsg: ChatMessage = {
        id: tags['id'] || Math.random().toString(36),
        username: username,
        displayName: tags['display-name'] || username,
        message: message,
        color: tags['color'] || '#6366f1',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        badges: this.parseBadges(tags['badges']),
        isAction: message.startsWith('\x01ACTION ')
      };

      if (chatMsg.isAction) {
        chatMsg.message = chatMsg.message.replace(/^\x01ACTION (.*)\x01$/, '$1');
      }

      this.onMessageCallback(chatMsg);
    }
  }

  private parseTags(tagStr: string): Record<string, string> {
    const tags: Record<string, string> = {};
    tagStr.split(';').forEach(tag => {
      const [key, value] = tag.split('=');
      tags[key] = value;
    });
    return tags;
  }

  private parseBadges(badgeStr: string): TwitchBadge[] {
    if (!badgeStr) return [];
    return badgeStr.split(',').map(b => {
      const [name, version] = b.split('/');
      return { name, version };
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}