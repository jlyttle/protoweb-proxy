const { execa } = require('execa');

module.exports = async function (req, reply) {
  const referer = req.headers.referer;
  if (referer && referer.includes('/proxy?url=')) {
    const match = referer.match(/\/proxy\?url=([^&]+)/);
    if (match) {
      try {
        const baseUrl = decodeURIComponent(match[1]);
        const missingPath = req.url.replace(/^\//, '');
        const newUrl = new URL(missingPath, baseUrl).toString();
        // Use curl to get headers only
        const { stdout } = await execa('curl', [
          '--silent',
          '--head',
          '--proxy', 'http://wayback.protoweb.org:7851',
          newUrl
        ]);
        // Find the content-type header (case-insensitive)
        const contentTypeMatch = stdout.match(/^[Cc]ontent-[Tt]ype:\s*([^\r\n]+)/m);
        const contentType = contentTypeMatch ? contentTypeMatch[1].trim() : '';
        if (contentType.startsWith('text/html') || contentType.startsWith('text/plain')) {
          console.log(`[notfound handler] Redirecting missing path '${missingPath}' (referer: ${referer}) to /proxy?url=${encodeURIComponent(newUrl)}`);
          return reply.redirect(`/proxy?url=${encodeURIComponent(newUrl)}`);
        } else {
          console.log(`[notfound handler] Redirecting missing path '${missingPath}' (referer: ${referer}) to /asset?url=${encodeURIComponent(newUrl)}`);
          return reply.redirect(`/asset?url=${encodeURIComponent(newUrl)}`);
        }
      } catch (e) {
        // fallback to normal 404
      }
    }
  }
  reply.code(404).send({ error: 'Not Found' });
}; 