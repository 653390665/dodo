import express from 'express';
import path from 'path';
import { initDb } from './server/lib/db.js';
import { authMiddleware, getAuthToken } from './server/middleware/auth';
import { registerRoutes } from './server/routes/index.js';

// Initialize local database on startup
initDb();

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const allowPortRetry = !process.env.PORT || process.env.NODE_ENV === 'production';

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

  // [NEW] Bootstrap endpoint for browser dev mode. Exempt from auth.
  if (process.env.NODE_ENV !== 'production') {
    app.get('/api/dev-auth-token', (_req, res) => {
      res.json({ token: getAuthToken() });
    });
  }

  // Auth middleware for API routes
  app.use('/api', authMiddleware);
  // DB + SSE routes registered via registerRoutes()
  registerRoutes(app);

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

// Global process-level error handlers to prevent silent backend crashes in production
process.on('uncaughtException', (error) => {
  console.error('[Fatal] Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Fatal] Unhandled Rejection at:', promise, 'reason:', reason);
});

startServer();
