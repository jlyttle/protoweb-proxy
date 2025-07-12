const fp = require('fastify-plugin');
const securityConfig = require('../config/security');

async function rateLimiter(fastify, options) {
  // Get environment-specific configuration
  const env = process.env.NODE_ENV || 'development';
  const rateLimits = securityConfig.rateLimits[env] || securityConfig.rateLimits.development;
  
  // Default rate limiting configuration
  const defaultConfig = {
    global: {
      ...rateLimits.global,
      errorMessage: 'Too many requests from this IP, please try again later.',
      keyGenerator: (request) => {
        // Use IP address as the key for rate limiting
        return request.ip;
      },
      onExceeded: (request, reply) => {
        fastify.log.warn(`Rate limit exceeded for IP: ${request.ip}`);
      }
    },
    proxy: {
      ...rateLimits.proxy,
      errorMessage: 'Too many proxy requests from this IP, please try again later.',
      keyGenerator: (request) => {
        return `proxy:${request.ip}`;
      },
      onExceeded: (request, reply) => {
        fastify.log.warn(`Proxy rate limit exceeded for IP: ${request.ip}`);
      }
    },
    post: {
      ...rateLimits.post,
      errorMessage: 'Too many POST requests from this IP, please try again later.',
      keyGenerator: (request) => {
        return `post:${request.ip}`;
      },
      onExceeded: (request, reply) => {
        fastify.log.warn(`POST rate limit exceeded for IP: ${request.ip}`);
      }
    }
  };

  // Merge with provided options
  const config = { ...defaultConfig, ...options };

  // IP blocking and user agent filtering (disabled for iframe compatibility)
  fastify.addHook('onRequest', async (request, reply) => {
    const clientIP = request.ip;
    const userAgent = request.headers['user-agent'] || '';

    // Check if IP is blocked (only if not empty)
    if (securityConfig.blockedIPs.length > 0 && securityConfig.blockedIPs.includes(clientIP)) {
      fastify.log.warn(`Blocked request from IP: ${clientIP}`);
      return reply.code(403).send('Access denied');
    }

    // Check if user agent is blocked (disabled for iframe compatibility)
    // Uncomment the following lines if you want to block bots
    /*
    const isBlockedUserAgent = securityConfig.blockedUserAgents.some(pattern => 
      pattern.test(userAgent)
    );
    if (isBlockedUserAgent) {
      fastify.log.warn(`Blocked request from user agent: ${userAgent}`);
      return reply.code(403).send('Access denied');
    }
    */

    // Add security headers (excluding frame-blocking headers)
    Object.entries(securityConfig.securityHeaders).forEach(([key, value]) => {
      // Skip X-Frame-Options to allow iframe embedding
      if (key !== 'X-Frame-Options') {
        reply.header(key, value);
      }
    });
  });

  // Register global rate limiting
  await fastify.register(require('@fastify/rate-limit'), {
    ...config.global,
    // Allow bypass for health checks and static files
    skipOnError: true,
    skip: (request) => {
      // Skip rate limiting for static files and health checks
      return request.url.startsWith('/public/') || 
             request.url === '/health' ||
             request.url === '/favicon.ico';
    }
  });

  // Add a health check endpoint
  fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Add rate limiting decorators for per-route configuration
  if (!fastify.hasDecorator('rateLimit')) {
    fastify.decorate('rateLimit', {
      // Apply proxy-specific rate limiting
      proxy: async (request, reply) => {
        const rateLimit = require('@fastify/rate-limit');
        await fastify.register(rateLimit, {
          ...config.proxy,
          // Only apply to proxy routes
          skip: (req) => !req.url.startsWith('/proxy')
        });
      },
      
      // Apply POST-specific rate limiting
      post: async (request, reply) => {
        const rateLimit = require('@fastify/rate-limit');
        await fastify.register(rateLimit, {
          ...config.post,
          // Only apply to POST requests
          skip: (req) => req.method !== 'POST'
        });
      }
    });
  }

  // Enhanced logging for security events
  fastify.addHook('onResponse', async (request, reply) => {
    const logData = {
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      timestamp: new Date().toISOString()
    };

    // Log security events more prominently
    if (reply.statusCode === 429) {
      fastify.log.warn(`Rate limit hit: ${JSON.stringify(logData)}`);
    } else if (reply.statusCode === 403) {
      fastify.log.warn(`Access denied: ${JSON.stringify(logData)}`);
    } else {
      fastify.log.info(logData);
    }
  });
}

module.exports = fp(rateLimiter, {
  name: 'rate-limiter'
}); 