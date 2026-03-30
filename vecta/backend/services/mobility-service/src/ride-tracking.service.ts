// services/mobility-service/src/ride-tracking.service.ts
import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import type { IncomingMessage } from 'http';
import { createLogger } from '@vecta/logger';
import { query } from '@vecta/database';

const logger = createLogger('ride-tracking');

const rideRooms = new Map<string, Set<WebSocket>>();
const driverSockets = new Map<string, WebSocket>();

let attachedWss: WebSocketServer | null = null;

export function attachRideWebSocketServer(httpServer: HttpServer): WebSocketServer {
  if (attachedWss) {
    return attachedWss;
  }

  const wss = new WebSocketServer({ noServer: true });
  attachedWss = wss;

  httpServer.on('upgrade', (request, socket, head) => {
    const host = request.headers.host ?? '127.0.0.1';
    const url = new URL(request.url ?? '/', `http://${host}`);
    if (!url.pathname.startsWith('/ws/ride') && !url.pathname.startsWith('/ws/driver')) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const host = req.headers.host ?? '127.0.0.1';
    const url = new URL(req.url ?? '/', `http://${host}`);
    const segments = url.pathname.split('/').filter(Boolean);

    // Presence socket for matched drivers (incoming ride requests)
    if (url.pathname.startsWith('/ws/driver')) {
      const driverId = url.searchParams.get('driverId');
      if (!driverId) {
        ws.close(1008, 'driverId required');
        return;
      }
      driverSockets.set(driverId, ws);
      logger.info({ driverId }, 'Driver presence WebSocket connected');
      ws.on('close', () => {
        driverSockets.delete(driverId);
      });
      ws.send(JSON.stringify({ type: 'CONNECTED', role: 'driver' }));
      return;
    }

    const rideId = segments[2] ?? url.searchParams.get('rideId');
    const driverId = url.searchParams.get('driverId');
    const role = url.searchParams.get('role');

    if (!rideId) {
      ws.close(1008, 'rideId required');
      return;
    }

    if (!rideRooms.has(rideId)) rideRooms.set(rideId, new Set());
    rideRooms.get(rideId)!.add(ws);

    if (role === 'driver' && driverId) {
      driverSockets.set(driverId, ws);
    }

    logger.info({ rideId, role, driverId }, 'Client connected to ride room');

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString()) as {
          type?: string;
          lat?: number;
          lng?: number;
          heading?: number;
          status?: string;
        };

        if (msg.type === 'DRIVER_LOCATION_UPDATE' && driverId) {
          const { lat, lng, heading } = msg;
          if (lat == null || lng == null) return;

          await query(
            `UPDATE driver_locations SET lat=$1, lng=$2, heading=$3 WHERE driver_id=$4`,
            [lat, lng, heading ?? null, driverId],
          );

          broadcastToRide(
            rideId,
            {
              type: 'DRIVER_LOCATION',
              lat,
              lng,
              heading,
              timestamp: Date.now(),
            },
            ws,
          );
        }

        if (msg.type === 'RIDE_STATUS_UPDATE') {
          broadcastToRide(rideId, {
            type: 'RIDE_STATUS',
            status: msg.status,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        logger.error({ err }, 'WebSocket message error');
      }
    });

    ws.on('close', () => {
      rideRooms.get(rideId)?.delete(ws);
      if (driverId && driverSockets.get(driverId) === ws) {
        driverSockets.delete(driverId);
      }
      if (rideRooms.get(rideId)?.size === 0) rideRooms.delete(rideId);
    });

    ws.send(JSON.stringify({ type: 'CONNECTED', rideId }));
  });

  logger.info('Ride WebSocket server attached to HTTP server');
  return wss;
}

export function getRideWebSocketServer(): WebSocketServer | null {
  return attachedWss;
}

function broadcastToRide(rideId: string, message: object, exclude?: WebSocket) {
  const room = rideRooms.get(rideId);
  if (!room) return;
  const data = JSON.stringify(message);
  for (const client of room) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

export function notifyDriver(driverId: string, message: object): boolean {
  const sock = driverSockets.get(driverId);
  if (sock?.readyState === WebSocket.OPEN) {
    sock.send(JSON.stringify(message));
    return true;
  }
  return false;
}
