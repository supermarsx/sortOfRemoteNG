import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import jwt from 'jsonwebtoken';
import { Server } from 'http';
import dns from 'node:dns/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { Connection, ConnectionSession } from '../types/connection';
import { debugLog } from './debugLogger';
import { generateId } from './id';

const execAsync = promisify(exec);

interface ApiConfig {
  port: number;
  authentication: boolean;
  apiKey?: string;
  corsEnabled: boolean;
  rateLimiting: boolean;
  jwtSecret?: string;
  userStorePath?: string;
}

interface ResolvedApiConfig extends ApiConfig {
  apiKey: string;
  jwtSecret: string;
  userStorePath: string;
}

interface AuthRequest extends express.Request {
  user?: jwt.JwtPayload | string;
}

export class RestApiServer {
  private app: express.Application;
  private server?: Server;
  private config: ResolvedApiConfig;
  private rateLimiter?: RateLimiterMemory;
  private connections: Connection[] = [];
  private sessions: ConnectionSession[] = [];
  private users: Record<string, string> = {};

  constructor(config: ApiConfig) {
    const defaultConfig: ResolvedApiConfig = {
      port: config.port,
      authentication: config.authentication,
      corsEnabled: config.corsEnabled,
      rateLimiting: config.rateLimiting,
      apiKey: config.apiKey ?? process.env.API_KEY ?? '',
      jwtSecret: config.jwtSecret ?? process.env.JWT_SECRET ?? 'defaultsecret',
      userStorePath: config.userStorePath ?? process.env.USER_STORE_PATH ?? 'users.json',
    };
    this.config = defaultConfig;
    this.app = express();
    this.users = this.loadUserStore(this.config.userStorePath);
    this.setupMiddleware();
    this.setupRoutes();
  }

  private loadUserStore(filePath: string): Record<string, string> {
    try {
      const fullPath = path.resolve(filePath);
      const data = fs.readFileSync(fullPath, 'utf8');
      const users: { username: string; passwordHash: string }[] = JSON.parse(data);
      const store: Record<string, string> = {};
      users.forEach(u => {
        store[u.username] = u.passwordHash;
      });
      return store;
    } catch {
      return {};
    }
  }

  private setupMiddleware(): void {
    // Security
    this.app.use(helmet());

    // CORS
    if (this.config.corsEnabled) {
      this.app.use(cors({
        origin: true,
        credentials: true,
      }));
    }

    // Rate limiting
    if (this.config.rateLimiting) {
      this.rateLimiter = new RateLimiterMemory({
        keyGenerator: (req) => req.ip,
        points: 100, // Number of requests
        duration: 60, // Per 60 seconds
      });

      this.app.use(async (req, res, next) => {
        try {
          if (this.rateLimiter) {
            await this.rateLimiter.consume(req.ip);
          }
          next();
        } catch {
          res.status(429).json({ error: 'Too many requests' });
        }
      });
    }

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Authentication middleware
    if (this.config.authentication) {
      this.app.use('/api', this.authenticateRequest.bind(this));
    }
  }

  private authenticateRequest(req: express.Request, res: express.Response, next: express.NextFunction): void {
    // Skip auth for login endpoint
    if (req.path === '/auth/login') {
      return next();
    }

    const authHeader = req.headers.authorization;
    const apiKey = req.headers['x-api-key'] as string;

    // API Key authentication
    if (apiKey) {
      if (apiKey === this.config.apiKey) {
        return next();
      } else {
        return res.status(401).json({ error: 'Invalid API key' });
      }
    }

    // JWT authentication
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      try {
        const decoded = jwt.verify(token, this.config.jwtSecret);
        (req as AuthRequest).user = decoded;
        next();
      } catch {
        res.status(401).json({ error: 'Invalid token' });
      }
    } else {
      res.status(401).json({ error: 'Authentication required' });
    }
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Network utilities
    this.app.get('/api/resolve-hostname', async (req, res) => {
      const ip = req.query.ip as string;
      if (!ip) {
        return res.status(400).json({ error: 'IP parameter required' });
      }
      try {
        const hostnames = await dns.reverse(ip);
        if (hostnames.length > 0) {
          res.json({ hostname: hostnames[0] });
        } else {
          res.status(404).json({ error: 'Hostname not found' });
        }
      } catch {
        res.status(500).json({ error: 'Lookup failed' });
      }
    });

    this.app.get('/api/arp-lookup', async (req, res) => {
      const ip = req.query.ip as string;
      if (!ip) {
        return res.status(400).json({ error: 'IP parameter required' });
      }
      try {
        const { stdout } = await execAsync(`arp -n ${ip}`);
        const match = stdout.match(/([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i);
        if (match) {
          res.json({ mac: match[0].toLowerCase() });
        } else {
          res.status(404).json({ error: 'MAC not found' });
        }
      } catch {
        res.status(500).json({ error: 'Lookup failed' });
      }
    });

    // Authentication
    this.app.post('/auth/login', async (req, res) => {
      const { username, password } = req.body;

      const storedHash = this.users[username];
      if (!storedHash) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const valid = await bcrypt.compare(password, storedHash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { username, role: 'admin' },
        this.config.jwtSecret,
        { expiresIn: '24h' }
      );

      res.json({ token, expiresIn: '24h' });
    });

    // Connections API
    this.app.get('/api/connections', (req, res) => {
      res.json(this.connections);
    });

    this.app.post('/api/connections', (req, res) => {
      const connection: Connection = {
        ...req.body,
        id: generateId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      this.connections.push(connection);
      res.status(201).json(connection);
    });

    this.app.get('/api/connections/:id', (req, res) => {
      const connection = this.connections.find(c => c.id === req.params.id);
      if (connection) {
        res.json(connection);
      } else {
        res.status(404).json({ error: 'Connection not found' });
      }
    });

    this.app.put('/api/connections/:id', (req, res) => {
      const index = this.connections.findIndex(c => c.id === req.params.id);
      if (index >= 0) {
        this.connections[index] = {
          ...this.connections[index],
          ...req.body,
          updatedAt: new Date(),
        };
        res.json(this.connections[index]);
      } else {
        res.status(404).json({ error: 'Connection not found' });
      }
    });

    this.app.delete('/api/connections/:id', (req, res) => {
      const index = this.connections.findIndex(c => c.id === req.params.id);
      if (index >= 0) {
        this.connections.splice(index, 1);
        res.status(204).send();
      } else {
        res.status(404).json({ error: 'Connection not found' });
      }
    });

    // Sessions API
    this.app.get('/api/sessions', (req, res) => {
      res.json(this.sessions);
    });

    this.app.post('/api/sessions', (req, res) => {
      const { connectionId } = req.body;
      const connection = this.connections.find(c => c.id === connectionId);
      
      if (!connection) {
        return res.status(404).json({ error: 'Connection not found' });
      }

      const session: ConnectionSession = {
        id: generateId(),
        connectionId,
        name: connection.name,
        status: 'connecting',
        startTime: new Date(),
        protocol: connection.protocol,
        hostname: connection.hostname,
      };

      this.sessions.push(session);
      res.status(201).json(session);
    });

    this.app.delete('/api/sessions/:id', (req, res) => {
      const index = this.sessions.findIndex(s => s.id === req.params.id);
      if (index >= 0) {
        this.sessions.splice(index, 1);
        res.status(204).send();
      } else {
        res.status(404).json({ error: 'Session not found' });
      }
    });

    // Bulk operations
    this.app.post('/api/connections/bulk', (req, res) => {
      const { action, connectionIds } = req.body;
      
      switch (action) {
        case 'delete':
          this.connections = this.connections.filter(c => !connectionIds.includes(c.id));
          break;
        case 'connect':
          connectionIds.forEach((id: string) => {
            const connection = this.connections.find(c => c.id === id);
            if (connection) {
              const session: ConnectionSession = {
                id: generateId(),
                connectionId: id,
                name: connection.name,
                status: 'connecting',
                startTime: new Date(),
                protocol: connection.protocol,
                hostname: connection.hostname,
              };
              this.sessions.push(session);
            }
          });
          break;
        default:
          return res.status(400).json({ error: 'Invalid action' });
      }
      
      res.json({ success: true, affected: connectionIds.length });
    });

    // Import/Export
    this.app.post('/api/connections/import', (req, res) => {
      const { connections } = req.body;
      
      if (!Array.isArray(connections)) {
        return res.status(400).json({ error: 'Invalid import data' });
      }

      const imported = connections.map(conn => ({
        ...conn,
        id: generateId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      this.connections.push(...imported);
      res.json({ imported: imported.length });
    });

    this.app.get('/api/connections/export', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=connections.json');
      res.json({
        version: '1.0',
        exportDate: new Date().toISOString(),
        connections: this.connections,
      });
    });

    // Statistics
    this.app.get('/api/stats', (req, res) => {
      res.json({
        totalConnections: this.connections.length,
        activeSessions: this.sessions.length,
        connectionsByProtocol: this.getConnectionsByProtocol(),
        sessionsByStatus: this.getSessionsByStatus(),
      });
    });

    // Error handling
    this.app.use(
      (
        err: Error,
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
      ) => {
        console.error('API Error:', err);
        if (res.headersSent) {
          return next(err);
        }
        res.status(500).json({ error: 'Internal server error' });
      }
    );

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Endpoint not found' });
    });
  }

  private getConnectionsByProtocol(): Record<string, number> {
    const stats: Record<string, number> = {};
    this.connections.forEach(conn => {
      stats[conn.protocol] = (stats[conn.protocol] || 0) + 1;
    });
    return stats;
  }

  private getSessionsByStatus(): Record<string, number> {
    const stats: Record<string, number> = {};
    this.sessions.forEach(session => {
      stats[session.status] = (stats[session.status] || 0) + 1;
    });
    return stats;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port);
        this.server.once('listening', () => {
          debugLog(`REST API server started on port ${this.config.port}`);
          resolve();
        });
        this.server.once('error', (error: Error) => {
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          debugLog('REST API server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // Update data from main application
  updateConnections(connections: Connection[]): void {
    this.connections = connections;
  }

  updateSessions(sessions: ConnectionSession[]): void {
    this.sessions = sessions;
  }
}
