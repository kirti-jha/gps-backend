/**
 * socket.ts — Centralized Socket.IO instance.
 *
 * All routes import `io` from here instead of from `index.ts`,
 * which eliminates the circular dependency issue.
 */
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';

// `io` starts as null — initialized by calling initSocket() in index.ts
export let io: SocketIOServer | null = null;

/**
 * Initialize Socket.IO with the HTTP server.
 * Must be called once in index.ts before any route handlers run.
 */
export function initSocket(server: http.Server): SocketIOServer {
  const corsOrigins = process.env.CORS_ORIGIN?.split(',').map(o => o.trim()) ?? ['http://localhost:3000'];

  io = new SocketIOServer(server, {
    cors: {
      origin: corsOrigins,
      methods: ['GET', 'POST']
    }
  });

  return io;
}
