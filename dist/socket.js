"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = void 0;
exports.initSocket = initSocket;
const socket_io_1 = require("socket.io");
// `io` starts as null — initialized by calling initSocket() in index.ts
exports.io = null;
/**
 * Initialize Socket.IO with the HTTP server.
 * Must be called once in index.ts before any route handlers run.
 */
function initSocket(server) {
    const configuredOrigins = process.env.CORS_ORIGIN?.split(',').map(o => o.trim()) || ['http://localhost:3000', 'http://localhost:3001'];
    exports.io = new socket_io_1.Server(server, {
        cors: {
            origin: (origin, callback) => {
                if (!origin)
                    return callback(null, true);
                if (configuredOrigins.includes(origin) ||
                    /^http:\/\/(localhost|127\.0\.0\.1):[0-9]+$/.test(origin) ||
                    /\.vercel\.app$/.test(origin)) {
                    return callback(null, true);
                }
                return callback(null, false);
            },
            methods: ['GET', 'POST']
        }
    });
    return exports.io;
}
