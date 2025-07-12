# Security Features

This document outlines the security measures implemented in the protoweb-proxy application.

## Rate Limiting

The application implements multiple layers of rate limiting to prevent abuse:

### Global Rate Limiting
- **Development**: 1000 requests per minute per IP
- **Production**: 100 requests per minute per IP
- **Strict**: 50 requests per minute per IP

### Proxy-Specific Rate Limiting
- **Development**: 100 requests per minute per IP
- **Production**: 30 requests per minute per IP
- **Strict**: 15 requests per minute per IP

### POST Request Rate Limiting
- **Development**: 50 requests per minute per IP
- **Production**: 10 requests per minute per IP
- **Strict**: 5 requests per minute per IP

## IP Blocking

The application supports IP-based blocking:

### Blocked IPs
- Configure blocked IPs in `config/security.js`
- Blocked IPs receive a 403 Forbidden response

### Trusted IPs
- Configure trusted IPs in `config/security.js`
- Trusted IPs can bypass certain restrictions

## User Agent Filtering

The application blocks requests from common bot/crawler user agents:
- Bot patterns
- Crawler patterns
- Spider patterns
- Scraper patterns

## Security Headers

The application automatically adds the following security headers:

- `X-Content-Type-Options: nosniff` - Prevents MIME type sniffing
- `X-Frame-Options: DENY` - Prevents clickjacking
- `X-XSS-Protection: 1; mode=block` - Enables XSS protection
- `Referrer-Policy: strict-origin-when-cross-origin` - Controls referrer information
- `Content-Security-Policy` - Restricts resource loading
- `Strict-Transport-Security` - Enforces HTTPS (in production)
- `Permissions-Policy` - Controls browser features

## Request Size Limits

- Maximum body size: 10MB
- Maximum header size: 8KB

## Timeout Configuration

- Request timeout: 30 seconds
- Proxy timeout: 60 seconds
- Keep-alive timeout: 5 seconds

## Environment Configuration

The application uses different security settings based on the `NODE_ENV` environment variable:

- `development`: More lenient rate limits for testing
- `production`: Stricter rate limits for public deployment
- `strict`: Very strict limits for high-security environments

## Monitoring and Logging

The application logs:
- All requests with response times
- Rate limit violations
- Access denied events
- Security-related events

## Health Check Endpoint

A health check endpoint is available at `/health` for monitoring:
```bash
curl http://localhost:3000/health
```

## Configuration

Security settings can be customized in `config/security.js`:

```javascript
module.exports = {
  rateLimits: {
    development: { /* development settings */ },
    production: { /* production settings */ },
    strict: { /* strict settings */ }
  },
  securityHeaders: { /* security headers */ },
  blockedIPs: [ /* IPs to block */ ],
  trustedIPs: [ /* trusted IPs */ ],
  blockedUserAgents: [ /* user agent patterns */ ]
};
```

## Deployment Considerations

### Production Deployment
1. Set `NODE_ENV=production` for stricter rate limits
2. Configure a reverse proxy (nginx) for additional security
3. Use HTTPS in production
4. Monitor logs for security events
5. Consider using a CDN for static assets

### Security Best Practices
1. Regularly update dependencies
2. Monitor application logs
3. Set up alerts for rate limit violations
4. Consider implementing additional authentication for sensitive endpoints
5. Use environment variables for sensitive configuration

## Testing Security Features

You can test the rate limiting by making multiple rapid requests:

```bash
# Test global rate limiting
for i in {1..150}; do curl http://localhost:3000/health; done

# Test proxy rate limiting
for i in {1..50}; do curl "http://localhost:3000/proxy?url=https://example.com"; done
```

## Troubleshooting

### Common Issues

1. **Rate limit errors (429)**: Reduce request frequency or increase limits in development
2. **Access denied (403)**: Check if IP is blocked or user agent is filtered
3. **Timeout errors**: Increase timeout values in configuration

### Debug Mode

Enable debug logging by setting the log level:
```javascript
const fastify = require('fastify')({ 
  logger: { level: 'debug' } 
});
``` 