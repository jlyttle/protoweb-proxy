const fp = require('fastify-plugin');
const { execa } = require('execa');

//TODO: We will want to replace this with something like undici
//Protoweb doesn't send HTTP/1.0 compliant headers (missing CR)
//Until this is addressed, we need to use something lenient like curl
async function fetcherPlugin(fastify, opts) {
  fastify.decorate('fetchRemote', async (url, options = {}) => {
    try {
      const { stdout } = await execa('curl', [
        '--silent',
        '--location',
        '--proxy', 'http://wayback.protoweb.org:7851',
        url
      ]);

      return {
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: stdout,
      };
    } catch (err) {
      if (err.exitCode === 18 && err.stdout) {
        // treat it as a soft failure: return partial response
        fastify.log.warn(`Partial file from curl, using partial data for ${url}`);
        return {
          statusCode: 206,
          headers: { 'content-type': 'text/html' },
          body: err.stdout,
        };
      }
      fastify.log.error(`Error fetching via curl: ${url}`);
      throw err;
    }
  });
}

module.exports = fp(fetcherPlugin);
