const fp = require('fastify-plugin');
const cheerio = require('cheerio');

async function htmlRewriterPlugin(fastify, opts) {
  fastify.decorate('rewriteHtml', async (html, originalUrl) => {
    const $ = cheerio.load(html);
    const baseProxyUrl = '/proxy?url=';
    const assetProxyUrl = '/asset?url=';

    function rewriteAttr(el, attr) {
      const orig = $(el).attr(attr);
      if (!orig || orig.startsWith('data:') || orig.startsWith('javascript:')) return;
      const absoluteUrl = new URL(orig, originalUrl).toString();
      if (el.name === 'a') {
        $(el).attr(attr, '/proxy?url=' + encodeURIComponent(absoluteUrl));
      } else {
        $(el).attr(attr, '/asset?url=' + encodeURIComponent(absoluteUrl));
      }
    }

    $('a[href]').each((_, el) => rewriteAttr(el, 'href'));
    $('link[href]').each((_, el) => rewriteAttr(el, 'href'));
    $('script[src], img[src]').each((_, el) => rewriteAttr(el, 'src'));
    $('meta[http-equiv="refresh"]').each((_, el) => {
      const $el = $(el);
      const content = $el.attr('content');
      if (!content) return;

      const match = content.match(/^\s*\d+\s*;\s*url\s*=\s*(.+)$/i);
      if (match) {
        const originalUrl = match[1].trim().replace(/^['"]|['"]$/g, '');
        const absoluteUrl = new URL(originalUrl, originalUrl).toString();
        const proxiedUrl = baseProxyUrl + encodeURIComponent(absoluteUrl);
        const delay = content.split(';')[0].trim();
        $el.attr('content', `${delay}; url=${proxiedUrl}`);
      }
    });
    $('embed[src], object[data]').each((_, el) => {
      const $el = $(el);
      const attr = el.name === 'embed' ? 'src' : 'data';
      const orig = $el.attr(attr);
      if (!orig) return;

      const absoluteUrl = new URL(orig, originalUrl).toString();
      // const proxiedUrl = assetProxyUrl + encodeURIComponent(absoluteUrl);

      $el.attr(attr, absoluteUrl);
      $el.attr('data-base', absoluteUrl); // <-- Ruffle will use this
    });

    if ($('embed[src$=".swf"], object[data$=".swf"]').length > 0) {
      // Inject Ruffle config and fetch/XHR patch
      const patchScript = `
      <script>
        window.RufflePlayer = window.RufflePlayer || {};
        window.RufflePlayer.config = {
          publicPath: "/public/ruffle/",
          base: "${assetProxyUrl}"
        };

        // Patch fetch
        const originalFetch = window.fetch;
        window.fetch = function(input, init) {
          const url = typeof input === "string" ? input : input.url;
          if (url && url.startsWith("http")) {
            return originalFetch("${assetProxyUrl}" + encodeURIComponent(url), init);
          }
          return originalFetch(input, init);
        };

        // Patch XHR
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          if (url && url.startsWith("http")) {
            url = "${assetProxyUrl}" + encodeURIComponent(url);
          }
          return originalOpen.call(this, method, url, ...rest);
        };
      </script>
      <script src="/public/ruffle/ruffle.js"></script>
    `;

      $('body').append(patchScript);
    }

    // Inject zoom + 4:3 container CSS
    $('head').append(`
<style id="protoweb-style">
  html, body {
    margin: 0;
    padding: 0;
    height: 100vh;
    overflow: hidden;
  }

  body {
  font-family: "Times New Roman", "Tahoma", "Verdana", "Arial", sans-serif;
}

  #protoweb-outer {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
    overflow: hidden;
  }

  #protoweb-frame {
    width: 1024px;
    height: 768px;
    overflow-y: auto;
    border: 6px solid #333;
    box-shadow: 0 0 20px rgba(0,0,0,0.7);
    padding: 20px;
    box-sizing: border-box;
    scrollbar-width: thin;
  }

  @media (max-width: 1024px) {
    #protoweb-frame {
      transform: scale(0.85);
      transform-origin: top center;
    }
  }

  @media (max-width: 768px) {
    #protoweb-frame {
      transform: scale(0.65);
    }
  }
</style>
  `);

    // Wrap body content
    const bodyHtml = $('body').html();
    $('body').html(`
  <div id="protoweb-outer">
    <div id="protoweb-frame">${bodyHtml}</div>
  </div>
`);

    return $.html();
  });
}

module.exports = fp(htmlRewriterPlugin);