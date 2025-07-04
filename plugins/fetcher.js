const fp = require('fastify-plugin');
const { execa } = require('execa');

// Helper to parse curl -i output into { statusCode, headers, body }
function parseCurlResponse(output, defaultStatus = 200) {
  const lines = output.split(/\r?\n/);
  const headers = {};
  let statusCode = defaultStatus;
  let bodyStartIndex = -1;
  
  // Find where headers end and body begins
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // First line should be HTTP status
    if (i === 0) {
      const statusMatch = line.match(/HTTP\/\d+\.\d+\s+(\d+)/);
      if (statusMatch) {
        statusCode = parseInt(statusMatch[1], 10);
      }
      continue;
    }
    
    // Empty line marks end of headers
    if (line.trim() === '') {
      bodyStartIndex = i + 1;
      break;
    }
    
    // Parse header line
    const idx = line.indexOf(':');
    if (idx !== -1) {
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      headers[key] = value;
    }
  }
  
  // If no empty line found, try to detect body start by looking for content that doesn't look like headers
  if (bodyStartIndex === -1) {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // If line doesn't contain ':' or looks like content (starts with '[' or other non-header patterns)
      if (!line.includes(':') || line.trim().startsWith('[') || line.trim().startsWith('File1=')) {
        bodyStartIndex = i;
        break;
      }
    }
  }
  
  // If still no body start found, assume everything after first line is body
  if (bodyStartIndex === -1) {
    bodyStartIndex = 1;
  }
  
  const body = lines.slice(bodyStartIndex).join('\n');
  
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
      console.log('[fetchRemote] Parsed headers:', headers);
      console.log('[fetchRemote] Parsed statusCode:', statusCode);
      // console.log('full response:', stdout);
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
