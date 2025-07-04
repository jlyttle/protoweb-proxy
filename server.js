const fastify = require('fastify')({ logger: true });
const path = require('path');
const fastifyStatic = require('@fastify/static');

// Register CORS plugin
fastify.register(require('@fastify/cors'), {
  origin: true, // Allow all origins in development
  credentials: true, // Allow credentials (cookies, authorization headers)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
});

fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/public/', // so /public/ruffle/ruffle.js works
});

fastify.register(require('./plugins/fetcher'));
fastify.register(require('./plugins/html-rewriter'));
fastify.register(require('./plugins/asset-proxy'));

fastify.register(require('./routes/proxy'));
fastify.setNotFoundHandler(require('./routes/notfound'));

console.log('Running with Node.js version:', process.version);

const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
