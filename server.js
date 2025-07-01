const fastify = require('fastify')({ logger: true });
const path = require('path');
const fastifyStatic = require('@fastify/static');

fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/public/', // so /public/ruffle/ruffle.js works
});

fastify.register(require('./plugins/fetcher'));
fastify.register(require('./plugins/html-rewriter'));
fastify.register(require('./plugins/asset-proxy'));

fastify.register(require('./routes/proxy'));

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
