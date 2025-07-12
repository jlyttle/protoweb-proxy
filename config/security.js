module.exports = {
  // Rate limiting configurations for different environments
  rateLimits: {
    development: {
      global: {
        max: 1000, // More lenient in development
        timeWindow: '1 minute'
      },
      proxy: {
        max: 100,
        timeWindow: '1 minute'
      },
      post: {
        max: 50,
        timeWindow: '1 minute'
      }
    },
    production: {
      global: {
        max: 100, // Stricter in production
        timeWindow: '1 minute'
      },
      proxy: {
        max: 30,
        timeWindow: '1 minute'
      },
      post: {
        max: 10,
        timeWindow: '1 minute'
      }
    },
    strict: {
      global: {
        max: 50,
        timeWindow: '1 minute'
      },
      proxy: {
        max: 15,
        timeWindow: '1 minute'
      },
      post: {
        max: 5,
        timeWindow: '1 minute'
      }
    }
  },

  // Security headers configuration
  securityHeaders: {
    'X-Content-Type-Options': 'nosniff',
    // Note: X-Frame-Options is commented out to allow iframe embedding
    // 'X-Frame-Options': 'SAMEORIGIN', // Uncomment if you want to restrict iframe embedding
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:;",
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
  },

  // IP whitelist for trusted sources (optional)
  trustedIPs: [
    // Add your trusted IPs here
    // '127.0.0.1',
    // '::1'
  ],

  // Blocked IPs (optional)
  blockedIPs: [
    // Add IPs to block here
  ],

  // User agent blocking patterns
  blockedUserAgents: [
    /bot/i,
    /crawler/i,
    /spider/i,
    /scraper/i
  ],

  // Request size limits
  requestLimits: {
    maxBodySize: '10mb',
    maxHeaderSize: 8192
  },

  // Timeout configurations
  timeouts: {
    requestTimeout: 30000, // 30 seconds
    proxyTimeout: 60000,   // 60 seconds
    keepAliveTimeout: 5000 // 5 seconds
  }
}; 