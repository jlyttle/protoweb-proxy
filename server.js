// server.js
const fastify = require('fastify')({ logger: true });
const path = require('path');

fastify.register(require('./plugins/fetcher'));
fastify.register(require('./plugins/html-rewriter'));
fastify.register(require('./plugins/asset-proxy'));

fastify.register(require('./routes/proxy'));

const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
