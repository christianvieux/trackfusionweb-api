// corsOptions.js

import {
  parseBrowserOrigin,
  resolveAllowedBrowserOrigins,
} from '../utils/browserOrigins.js';

const allowedOrigins = resolveAllowedBrowserOrigins();

console.log('Allowed Origins:', allowedOrigins);

const corsOptions = {
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc)
    if (!origin) {
      return callback(null, true);
    }

    let normalizedOrigin;
    try {
      normalizedOrigin = parseBrowserOrigin('Origin', origin).origin;
    } catch {
      normalizedOrigin = origin;
    }

    if (allowedOrigins.includes(normalizedOrigin)) {
      callback(null, true);
    } else {
      console.log(`CORS blocked origin: ${normalizedOrigin}`);
      const error = new Error('Origin not allowed by CORS');
      error.status = 403;
      error.code = 'CORS_ORIGIN_DENIED';
      callback(error);
    }
  },
  credentials: true, // Allow credentials (cookies, authorization headers, etc)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 86400 // Cache preflight request results for 24 hours
};

export { corsOptions };
