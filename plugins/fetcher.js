const fp = require('fastify-plugin');
const { execa } = require('execa');

// Helper to parse curl -i output into { statusCode, headers, body }
function parseCurlResponse(output, defaultStatus = 200) {
  const headerEnd = output.indexOf('\n\n');
  const rawHeaders = output.slice(0, headerEnd);
  const body = output.slice(headerEnd);
  const headerLines = rawHeaders.split(/\r?\n/);
  const statusLine = headerLines.shift();
  const statusMatch = statusLine && statusLine.match(/HTTP\/\d+\.\d+\s+(\d+)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : defaultStatus;
  const headers = {};
  for (const line of headerLines) {
    const idx = line.indexOf(':');
    if (idx !== -1) {
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      headers[key] = value;
    }
  }
  return { statusCode, headers, body };
}

async function fetcherPlugin(fastify, opts) {
  fastify.decorate('fetchRemote', async (url, options = {}) => {
    try {
      // Use -i to include headers, and do NOT use --location so redirects are not followed
      const { stdout } = await execa('curl', [
        '--silent',
        '-i',
        '--proxy', 'http://wayback.protoweb.org:7851',
        url
      ]);

      const { statusCode, headers, body } = parseCurlResponse(stdout, 200);
      fastify.log.info('[fetchRemote] Parsed headers:', headers);
      fastify.log.info('[fetchRemote] Parsed statusCode:', statusCode);
      return { statusCode, headers, body };
    } catch (err) {
      if (err.exitCode === 18 && err.stdout) {
        // treat it as a soft failure: return partial response
        fastify.log.warn(`Partial file from curl, using partial data for ${url}`);
        const { statusCode, headers, body } = parseCurlResponse(err.stdout, 206);
        return { statusCode, headers, body };
      }
      fastify.log.error(`Error fetching via curl: ${url}`);
      throw err;
    }
  });
}

module.exports = fp(fetcherPlugin);
