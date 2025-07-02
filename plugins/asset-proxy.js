const fp = require('fastify-plugin');
const { spawn } = require('child_process');
const { once } = require('events');
const { fileTypeFromBuffer } = require('file-type');
const { LRUCache } = require('lru-cache');

const assetCache = new LRUCache({
  maxSize: 100 * 1024 * 1024, // 100 MB total
  ttl: 1000 * 60 * 60,    // 1 hour TTL
  sizeCalculation: (value, key) => value.length,
});

async function assetProxyPlugin(fastify, opts) {
  fastify.get('/asset', async (req, reply) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return reply.code(400).send('Missing URL');

    // Try in-memory cache
    if (assetCache.has(targetUrl)) {
      const buffer = assetCache.get(targetUrl);
      const type = await fileTypeFromBuffer(buffer);
      reply.header('X-Cache-Hit', 'true');
      reply.header('Content-Type', type?.mime || 'application/octet-stream');
      return reply.send(buffer);
    }

    // Fetch via curl
    const curl = spawn('curl', [
      '--silent',
      '--location',
      '--proxy', 'http://wayback.protoweb.org:7851',
      targetUrl
    ]);

    const chunks = [];
    curl.stdout.on('data', chunk => chunks.push(chunk));

    const [code] = await once(curl, 'close');

    if (code !== 0) {
      req.log.error(`curl exited with code ${code}`);
      return reply.code(502).send('Curl failed');
    }

    try {
      const buffer = Buffer.concat(chunks);
      assetCache.set(targetUrl, buffer); // Store in cache

      const type = await fileTypeFromBuffer(buffer);
      reply.header('X-Cache-Hit', 'false');
      reply.header('Content-Type', type?.mime || 'application/octet-stream');
      return reply.send(buffer);
    } catch (err) {
      req.log.error(err, 'Error in processing asset');
      return reply.code(500).send('Asset processing error');
    }
  });
}

module.exports = fp(assetProxyPlugin);