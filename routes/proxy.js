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

      // Handle redirects (3xx)
      if (statusCode >= 300 && statusCode < 400 && headers['location']) {
        // Rewrite the Location header to go through the proxy
        let redirectUrl = headers['location'];
        // If the redirect is relative, resolve it against the original URL
        try {
          redirectUrl = new URL(redirectUrl, targetUrl).toString();
        } catch {}
        const proxiedLocation = `/proxy?url=${encodeURIComponent(redirectUrl)}`;
        reply.header('location', proxiedLocation);
        reply.status(statusCode);
        return reply.send();
      }

      // For HTML, parse and rewrite content
      if (wantsHtml || headers['content-type']?.includes('text/html')) {
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
