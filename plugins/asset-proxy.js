const fp = require('fastify-plugin');
const { spawn } = require('child_process');
const { once } = require('events');
const { fileTypeFromBuffer } = require('file-type');
const { LRUCache } = require('lru-cache');

const assetCache = new LRUCache({
  maxSize: 500 * 1024 * 1024, // 500 MB total
  ttl: 1000 * 60 * 60,    // 1 hour TTL
  sizeCalculation: (value, key) => value.length,
});

// Maximum file size to cache (5MB)
const MAX_CACHE_SIZE = 5 * 1024 * 1024;

async function assetProxyPlugin(fastify, opts) {
  // Helper function to extract filename from URL
  function getFilenameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop();
      return filename || 'download';
    } catch {
      return 'download';
    }
  }

  fastify.get('/asset', async (req, reply) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return reply.code(400).send('Missing URL');

    // Try in-memory cache for small files
    if (assetCache.has(targetUrl)) {
      const buffer = assetCache.get(targetUrl);
      const type = await fileTypeFromBuffer(buffer);
      reply.header('X-Cache-Hit', 'true');
      reply.header('Content-Type', type?.mime || 'application/octet-stream');
      return reply.send(buffer);
    }

    // Fetch via curl with headers to get content length
    const curl = spawn('curl', [
      '--silent',
      '--location',
      '--head',
      '--proxy', 'http://wayback.protoweb.org:7851',
      '--user-agent', 'JSProtoBrowser',
      targetUrl
    ]);

    let headerOutput = '';
    curl.stdout.on('data', chunk => {
      headerOutput += chunk.toString();
    });

    const [headCode] = await once(curl, 'close');
    
    if (headCode !== 0) {
      req.log.error(`curl head exited with code ${headCode}`);
      return reply.code(502).send('Curl failed');
    }

    // Parse content length and type from headers
    const contentLengthMatch = headerOutput.match(/content-length:\s*(\d+)/i);
    const contentLength = contentLengthMatch ? parseInt(contentLengthMatch[1], 10) : null;
    
    const contentTypeMatch = headerOutput.match(/content-type:\s*([^\r\n]+)/i);
    const contentType = contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream';
    
    // Parse all headers from the curl response
    const allHeaders = {};
    const headerLines = headerOutput.split(/\r?\n/);
    for (const line of headerLines) {
      const idx = line.indexOf(':');
      if (idx !== -1) {
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        
        // Handle multiple values for the same header (like set-cookie)
        if (allHeaders[key]) {
          if (Array.isArray(allHeaders[key])) {
            allHeaders[key].push(value);
          } else {
            allHeaders[key] = [allHeaders[key], value];
          }
        } else {
          allHeaders[key] = value;
        }
      }
    }
    
    // Check if file is too large to cache
    // If no content length, assume it's small enough to cache
    const shouldCache = !contentLength || (contentLength && contentLength <= MAX_CACHE_SIZE);

    if (shouldCache) {
      // For small files, buffer and cache
      const curlFetch = spawn('curl', [
        '--silent',
        '--location',
        '--proxy', 'http://wayback.protoweb.org:7851',
        '--user-agent', 'JSProtoBrowser',
        targetUrl
      ]);

      const chunks = [];
      curlFetch.stdout.on('data', chunk => chunks.push(chunk));

      const [fetchCode] = await once(curlFetch, 'close');

      if (fetchCode !== 0) {
        req.log.error(`curl fetch exited with code ${fetchCode}`);
        return reply.code(502).send('Curl failed');
      }

      try {
        const buffer = Buffer.concat(chunks);
        assetCache.set(targetUrl, buffer); // Store in cache

        const type = await fileTypeFromBuffer(buffer);
        reply.header('X-Cache-Hit', 'false');
        
        // Set all headers from the proxied response
        for (const [key, value] of Object.entries(allHeaders)) {
          if (Array.isArray(value)) {
            // For repeated headers like set-cookie, set each value
            value.forEach(v => reply.header(key, v));
          } else {
            reply.header(key, value);
          }
        }
        
        reply.header('Content-Type', allHeaders['content-type'] || type?.mime || 'application/octet-stream');
        
        // Set Content-Disposition for downloads only if not already set
        if (!allHeaders['content-disposition']) {
          const downloadTypes = [
            'application/octet-stream',
            'application/pdf',
            'application/zip',
            'application/x-zip-compressed',
            'application/x-rar-compressed',
            'application/x-executable',
            'application/x-msdownload',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          ];
          
          const contentType = allHeaders['content-type'] || type?.mime || 'application/octet-stream';
          const isFtpUrl = targetUrl.toLowerCase().startsWith('ftp://');
          const isDownloadType = downloadTypes.some(t => contentType.includes(t));
          
          if (isDownloadType || isFtpUrl) {
            const filename = getFilenameFromUrl(targetUrl);
            reply.header('Content-Disposition', `attachment; filename="${filename}"`);
          }
        }
        
        return reply.send(buffer);
      } catch (err) {
        req.log.error(err, 'Error in processing asset');
        return reply.code(500).send('Asset processing error');
      }
    } else {
      // For large files, stream directly
      const curlStream = spawn('curl', [
        '--silent',
        '--location',
        '--proxy', 'http://wayback.protoweb.org:7851',
        '--user-agent', 'JSProtoBrowser',
        '--output', '-',
        targetUrl
      ]);

      reply.header('X-Cache-Hit', 'false');
      reply.header('X-Streaming', 'true');
      reply.header('Connection', 'close');
      
      // Set all headers from the proxied response
      for (const [key, value] of Object.entries(allHeaders)) {
        if (Array.isArray(value)) {
          // For repeated headers like set-cookie, set each value
          value.forEach(v => reply.header(key, v));
        } else {
          reply.header(key, value);
        }
      }
      
      if (contentType) reply.header('Content-Type', contentType);
      reply.header('Content-Length', contentLength);
      
      // Set Content-Disposition for downloads only if not already set
      if (!allHeaders['content-disposition']) {
        const downloadTypes = [
          'application/octet-stream',
          'application/pdf',
          'application/zip',
          'application/x-zip-compressed',
          'application/x-rar-compressed',
          'application/x-executable',
          'application/x-msdownload',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        
        const contentType = allHeaders['content-type'] || contentType || 'application/octet-stream';
        const isFtpUrl = targetUrl.toLowerCase().startsWith('ftp://');
        const isDownloadType = downloadTypes.some(t => contentType.includes(t));
        
        if (isDownloadType || isFtpUrl) {
          const filename = getFilenameFromUrl(targetUrl);
          reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        }
      }

      const cleanup = () => {
        if (!curlStream.killed) {
          curlStream.kill('SIGKILL');  // immediate termination
          console.log(`Curl stream forcibly killed for ${targetUrl}`);
        }
        if (!reply.raw.destroyed) reply.raw.destroy();
      };

      req.raw.on('close', cleanup);
      req.raw.on('aborted', cleanup);
      reply.raw.on('close', cleanup);
      reply.raw.on('aborted', cleanup);
      curlStream.on('close', cleanup);
      curlStream.on('error', cleanup);

      return reply.send(curlStream.stdout);
    }
  });
}

module.exports = fp(assetProxyPlugin);