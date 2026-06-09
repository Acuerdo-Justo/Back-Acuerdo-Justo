import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { pool } from '../database/pool.js';
import { getAuthToken } from '../services/authCookie.js';
import { verifyAccessToken } from '../services/tokenService.js';
import type { AuthUser } from '../types/auth.js';

interface MeetingSocket extends WebSocket {
  meetingId?: string;
  user?: AuthUser;
  microphoneOn?: boolean;
  cameraOn?: boolean;
  sessionId?: string;
}

interface ClientMessage {
  type: 'join' | 'signal' | 'chat' | 'finish' | 'media-state';
  meetingId?: string;
  targetUserId?: string;
  data?: unknown;
  text?: string;
  microphoneOn?: boolean;
  cameraOn?: boolean;
}

const rooms = new Map<string, Map<string, MeetingSocket>>();

export function attachMeetingSignaling(server: Server) {
  const websocketServer = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request, socket, head) => {
    if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const authentication = await authenticate(request);
    if (!authentication || authentication.user.role === 'admin') {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      const meetingSocket = websocket as MeetingSocket;
      meetingSocket.user = authentication.user;
      meetingSocket.sessionId = authentication.sessionId;
      websocketServer.emit('connection', meetingSocket);
    });
  });

  websocketServer.on('connection', (socket: MeetingSocket) => {
    socket.on('message', async (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString()) as ClientMessage;
        await handleMessage(socket, message);
      } catch {
        send(socket, { type: 'error', message: 'Mensaje de reunión inválido.' });
      }
    });

    socket.on('close', () => leaveRoom(socket));
  });
}

async function authenticate(request: IncomingMessage) {
  try {
    const token = getAuthToken(request);
    if (!token) return null;

    const tokenUser = verifyAccessToken(token);
    const result = await pool.query<AuthUser>(
      `update auth_sessions session set last_activity = now()
       from users where session.id = $1 and session.user_id = $2 and users.id = session.user_id
         and users.is_active = true and session.revoked_at is null
         and session.last_activity > now() - interval '5 minutes'
       returning users.id, users.full_name as "fullName", users.username, users.role`,
      [tokenUser.sessionId, tokenUser.id],
    );
    const user = result.rows[0];
    return user ? { user, sessionId: tokenUser.sessionId } : null;
  } catch {
    return null;
  }
}

async function handleMessage(socket: MeetingSocket, message: ClientMessage) {
  if (!socket.user || !socket.sessionId || !(await touchSession(socket.sessionId))) {
    socket.close(4001, 'Sesion expirada.');
    return;
  }

  if (message.type === 'join') {
    if (!message.meetingId?.trim()) return;
    leaveRoom(socket);

    const meetingId = message.meetingId.trim();
    const authorizedParticipant = await pool.query(
      `select id from appointments
       where id::text = $1 and mode = 'virtual' and (client_id = $2 or advisor_id = $2)`,
      [meetingId, socket.user.id],
    );
    if (!authorizedParticipant.rows[0]) {
      send(socket, { type: 'error', message: 'No tienes acceso a esta reunión.' });
      return;
    }
    const existingEvent = await pool.query<{ finished_at: Date | null }>(
      'select finished_at from virtual_meeting_events where meeting_id = $1',
      [meetingId],
    );
    if (existingEvent.rows[0]?.finished_at) {
      send(socket, { type: 'error', message: 'Esta reunión ya fue finalizada.' });
      return;
    }
    const room = rooms.get(meetingId) ?? new Map<string, MeetingSocket>();
    rooms.set(meetingId, room);

    send(socket, {
      type: 'participants',
      participants: [...room.values()].flatMap((participant) =>
        participant.user ? [publicUser(participant.user, participant)] : [],
      ),
    });

    socket.meetingId = meetingId;
    const previousSocket = room.get(socket.user.id);
    if (previousSocket && previousSocket !== socket) {
      previousSocket.meetingId = undefined;
      previousSocket.close(4000, 'Sesion reemplazada.');
    }
    room.set(socket.user.id, socket);
    broadcast(room, { type: 'participant-joined', participant: publicUser(socket.user, socket) }, socket.user.id);

    await pool.query(
      `insert into virtual_meeting_events (meeting_id, started_by)
       values ($1, $2)
       on conflict (meeting_id) do nothing`,
      [meetingId, socket.user.id],
    );
    return;
  }

  const room = socket.meetingId ? rooms.get(socket.meetingId) : undefined;
  if (!room) return;

  if (message.type === 'signal' && message.targetUserId && message.data !== undefined) {
    const target = room.get(message.targetUserId);
    if (target) send(target, { type: 'signal', fromUserId: socket.user.id, data: message.data });
  }

  if (message.type === 'chat' && message.text?.trim()) {
    broadcast(room, {
      type: 'chat',
      id: randomUUID(),
      sender: socket.user.fullName,
      text: message.text.trim().slice(0, 2000),
    });
  }

  if (message.type === 'media-state') {
    socket.microphoneOn = Boolean(message.microphoneOn);
    socket.cameraOn = Boolean(message.cameraOn);
    broadcast(room, {
      type: 'media-state',
      fromUserId: socket.user.id,
      microphoneOn: Boolean(message.microphoneOn),
      cameraOn: Boolean(message.cameraOn),
    }, socket.user.id);
  }

  if (message.type === 'finish' && socket.user.role === 'legal_advisor' && socket.meetingId) {
    await pool.query(
      `update virtual_meeting_events
       set finished_at = coalesce(finished_at, now()), finished_by = coalesce(finished_by, $2)
       where meeting_id = $1`,
      [socket.meetingId, socket.user.id],
    );
    broadcast(room, { type: 'meeting-finished' });
  }
}

async function touchSession(sessionId: string) {
  const result = await pool.query(
    `update auth_sessions set last_activity = now()
     where id = $1 and revoked_at is null and last_activity > now() - interval '5 minutes'
     returning id`,
    [sessionId],
  );
  return Boolean(result.rows[0]);
}

function leaveRoom(socket: MeetingSocket) {
  if (!socket.meetingId || !socket.user) return;
  const room = rooms.get(socket.meetingId);
  if (!room) return;

  room.delete(socket.user.id);
  broadcast(room, { type: 'participant-left', userId: socket.user.id });
  if (room.size === 0) rooms.delete(socket.meetingId);
  socket.meetingId = undefined;
}

function broadcast(room: Map<string, MeetingSocket>, payload: unknown, excludedUserId?: string) {
  for (const [userId, socket] of room) {
    if (userId !== excludedUserId) send(socket, payload);
  }
}

function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function publicUser(user: AuthUser, socket: MeetingSocket) {
  return { id: user.id, fullName: user.fullName, role: user.role, microphoneOn: Boolean(socket?.microphoneOn), cameraOn: Boolean(socket?.cameraOn) };
}
