module.exports = async function (fastify, opts) {
  fastify.get('/proxy', async (req, reply) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
      return reply.code(400).send('Missing URL');
    }

    const acceptHeader = req.headers.accept || '';
    const wantsHtml = acceptHeader.includes('text/html');

    try {
      const { statusCode, headers, body } = await fastify.fetchRemote(targetUrl, {
        headers: req.headers
      });

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
      // Set all headers from the proxied response
      for (const [key, value] of Object.entries(headers)) {
        if (Array.isArray(value)) {
          // For repeated headers like set-cookie, set each value
          value.forEach(v => reply.header(key, v));
        } else {
          reply.header(key, value);
        }
      }
      reply.status(statusCode);
      return reply.send(body);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send('Proxy error');
    }
  });

  fastify.post('/proxy', async (req, reply) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
      return reply.code(400).send('Missing URL');
    }

    const acceptHeader = req.headers.accept || '';
    const wantsHtml = acceptHeader.includes('text/html');

    // Serialize body if urlencoded
    const isUrlEncoded = req.headers['content-type'] && req.headers['content-type'].includes('application/x-www-form-urlencoded');
    let body = req.body;
    if (isUrlEncoded && typeof body === 'object' && body !== null) {
      body = new URLSearchParams(body).toString();
    }

    try {
      const { statusCode, headers, body: responseBody } = await fastify.fetchRemote(targetUrl, {
        method: 'POST',
        headers: req.headers,
        body
      });

      // Handle redirects (3xx)
      if (statusCode >= 300 && statusCode < 400 && headers['location']) {
        let redirectUrl = headers['location'];
        try {
          redirectUrl = new URL(redirectUrl, targetUrl).toString();
        } catch {}
        const proxiedLocation = `/proxy?url=${encodeURIComponent(redirectUrl)}`;
        reply.header('location', proxiedLocation);
        reply.status(statusCode);
        return reply.send();
      }

      if (wantsHtml || headers['content-type']?.includes('text/html')) {
        const rewritten = await fastify.rewriteHtml(responseBody, targetUrl);
        reply.header('content-type', 'text/html');
        return reply.send(rewritten);
      }

      // Set all headers from the proxied response
      for (const [key, value] of Object.entries(headers)) {
        if (Array.isArray(value)) {
          // For repeated headers like set-cookie, set each value
          value.forEach(v => reply.header(key, v));
        } else {
          reply.header(key, value);
        }
      }
      reply.status(statusCode);
      return reply.send(responseBody);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send('Proxy error');
    }
  });
};
