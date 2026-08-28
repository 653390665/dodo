import express from 'express';
import path from 'path';
import helmet from 'helmet';
import { initDb } from './server/lib/db.js';
import { authMiddleware, getAuthToken, isIdentityTokenValid } from './server/middleware/auth';
import { registerRoutes } from './server/routes/index.js';
import { registerChapterCompletionRoutes } from './server/routes/chapter-completion.js';
import { closeDb, drainWriteQueue } from './server/lib/db-instance.js';
import type { Server } from 'http';

let activeHttpServer: Server | null = null;
let fatalShutdownStarted = false;

// Initialize local database on startup
initDb();

async function startServer() {
  const app = express();
  // Register helmet for secure headers (CSP, XSS, MIME Sniffing, Clickjacking)
  const isProduction = process.env.NODE_ENV === 'production';
  app.use(helmet({
    contentSecurityPolicy: isProduction ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    } : false,
  }));
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const allowPortRetry = process.env.INKFLOW_FIXED_PORT !== 'true'
    && (!process.env.PORT || process.env.NODE_ENV === 'production');

  app.use((_req, res, next) => {
    if (fatalShutdownStarted) {
      res.setHeader('Connection', 'close');
      return res.status(503).json({ error: 'Server is shutting down' });
    }
    next();
  });

  app.use(express.json({ limit: '50mb' })); // Increase limit for text upload
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Global request timeout safety net — prevents hung requests from blocking the server
  app.use((_req, res, next) => {
    const timeoutMs = 120_000; // 2 minutes max for any request
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({ error: 'Request timed out — server took too long to respond' });
      }
    }, timeoutMs);
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    next();
  });

  // Development token bootstrap is opt-in and remains loopback-only.
  if (process.env.NODE_ENV !== 'production' && process.env.INKFLOW_ENABLE_DEV_AUTH_TOKEN === 'true') {
    app.get('/api/dev-auth-token', (req, res) => {
      const remoteAddress = req.socket.remoteAddress?.replace(/^::ffff:/, '');
      if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::1') {
        return res.status(404).end();
      }
      res.json({ token: getAuthToken() });
    });
  }

  // Identity challenge for the Electron main process: proves the responder on
  // this port is the real InkFlow server before it is trusted or loaded.
  // Without the header the endpoint answers 404 so it reveals nothing.
  app.get('/api/identity', (req, res) => {
    if (!isIdentityTokenValid(req.headers['x-inkflow-identity'])) {
      return res.status(404).end();
    }
    res.json({ ok: true, name: 'inkflow-server' });
  });

  // Auth middleware for API routes
  app.use('/api', authMiddleware);
  // DB + SSE routes registered via registerRoutes()
  registerRoutes(app);
  registerChapterCompletionRoutes(app);

  const serveStaticApp = () => {
    const distPath = process.env.INKFLOW_STATIC_DIR || path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  };

  const disableDevViteMiddleware = process.env.DISABLE_VITE_DEV_MIDDLEWARE === '1';

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production" && !disableDevViteMiddleware) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log('Vite dev middleware enabled');
  } else {
    serveStaticApp();
  }

  const listen = (port: number) => {
    const server = app.listen(port, "127.0.0.1", () => {
      console.log(`Server running on http://localhost:${port}`);
      // In production (Electron), notify the main process of the port via stdout JSON
      if (process.env.NODE_ENV === 'production') {
        console.log(JSON.stringify({ port }));
      }
    });
    activeHttpServer = server;

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && allowPortRetry && port < PORT + 50) {
        listen(port + 1);
        return;
      }
      throw error;
    });
  };

  listen(PORT);
}

async function shutdownAfterFatalError(label: string, error: unknown): Promise<void> {
  if (fatalShutdownStarted) return;
  fatalShutdownStarted = true;
  console.error(`[Fatal] ${label}:`, error);
  process.exitCode = 1;

  const forceExit = setTimeout(() => process.exit(1), 5000);
  forceExit.unref();

  try {
    activeHttpServer?.close();
    await Promise.race([
      drainWriteQueue(),
      new Promise<void>((resolve) => setTimeout(resolve, 4000)),
    ]);
  } catch (shutdownError) {
    console.error('[Fatal] Failed while draining database writes:', shutdownError);
  } finally {
    try {
      closeDb();
    } catch (closeError) {
      console.error('[Fatal] Failed to close database:', closeError);
    }
    activeHttpServer?.closeAllConnections?.();
    clearTimeout(forceExit);
    process.exit(1);
  }
}

// A fatal process error invalidates in-memory state. Exit non-zero so Electron restarts us.
process.on('uncaughtException', (error) => {
  void shutdownAfterFatalError('Uncaught Exception', error);
});

process.on('unhandledRejection', (reason, promise) => {
  void shutdownAfterFatalError(`Unhandled Rejection at ${String(promise)}`, reason);
});

startServer();
