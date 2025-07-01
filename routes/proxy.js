module.exports = async function (fastify, opts) {
  fastify.get('/proxy', async (req, reply) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
      return reply.code(400).send('Missing URL');
    }

    const acceptHeader = req.headers.accept || '';
    const wantsHtml = acceptHeader.includes('text/html');

    try {
      const { statusCode, headers, body } = await fastify.fetchRemote(targetUrl);

      // For HTML, parse and rewrite content
      if (wantsHtml || headers['content-type']?.includes('text/html')) {
        //const rawHtml = await body.text();
        const rewritten = await fastify.rewriteHtml(body, targetUrl);
        reply.header('content-type', 'text/html');
        return reply.send(rewritten);
      }

      // For all other content, just stream as-is
      reply.headers(headers);
      reply.status(statusCode);
      return reply.send(body);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send('Proxy error');
    }
  });
};
