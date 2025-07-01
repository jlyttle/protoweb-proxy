const fp = require('fastify-plugin');
const { spawn } = require('child_process');
const { once } = require('events');

async function assetProxyPlugin(fastify, opts) {
  fastify.get('/asset', async (req, reply) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return reply.code(400).send('Missing URL');

    const curl = spawn('curl', [
      '--silent',
      '--location',
      '--proxy', 'http://wayback.protoweb.org:7851',
      targetUrl
    ]);

    const chunks = [];
    curl.stdout.on('data', chunk => chunks.push(chunk));

    const [code] = await once(curl, 'close'); // wait until fully done

    if (code !== 0) {
      req.log.error(`curl exited with code ${code}`);
      return reply.code(502).send('Curl failed');
    }

    try {
      const buffer = Buffer.concat(chunks);
      const { fileTypeFromBuffer } = await import('file-type');
      const type = await fileTypeFromBuffer(buffer);
      const contentType = type ? type.mime : 'application/octet-stream';

      reply.header('Content-Type', contentType);
      return reply.send(buffer);
    } catch (err) {
      req.log.error(err, 'Error in processing asset');
      return reply.code(500).send('Asset processing error');
    }
  });
}

module.exports = fp(assetProxyPlugin);