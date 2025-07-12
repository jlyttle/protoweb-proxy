const { test } = require('tap');
const Fastify = require('fastify');

test('Rate Limiting', async (t) => {
  let fastify;

  t.beforeEach(async () => {
    fastify = Fastify({ logger: false });
    
    // Register the rate limiter plugin
    await fastify.register(require('../plugins/rate-limiter'), {
      global: {
        max: 5,
        timeWindow: '1 minute'
      }
    });

    // Add a test route
    fastify.get('/test', async (request, reply) => {
      return { message: 'success' };
    });

    await fastify.ready();
  });

  t.afterEach(async () => {
    await fastify.close();
  });

  await t.test('should allow requests within rate limit', async (t) => {
    // Make 5 requests (within the limit)
    for (let i = 0; i < 5; i++) {
      const response = await fastify.inject({
        method: 'GET',
        url: '/test'
      });
      t.equal(response.statusCode, 200);
    }
  });

  await t.test('should block requests exceeding rate limit', async (t) => {
    // Make 6 requests (exceeding the limit)
    for (let i = 0; i < 5; i++) {
      const response = await fastify.inject({
        method: 'GET',
        url: '/test'
      });
      t.equal(response.statusCode, 200);
    }

    // The 6th request should be blocked
    const blockedResponse = await fastify.inject({
      method: 'GET',
      url: '/test'
    });
    t.equal(blockedResponse.statusCode, 429);
  });

  await t.test('should allow health check endpoint', async (t) => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/health'
    });
    t.equal(response.statusCode, 200);
    const payload = JSON.parse(response.payload);
    t.equal(payload.status, 'ok');
    t.ok(payload.timestamp);
  });

  await t.test('should add security headers', async (t) => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/test'
    });
    
    t.ok(response.headers['x-content-type-options']);
    t.ok(response.headers['x-frame-options']);
    t.ok(response.headers['x-xss-protection']);
    t.ok(response.headers['referrer-policy']);
  });
}); 