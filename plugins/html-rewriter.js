const fp = require('fastify-plugin');
const cheerio = require('cheerio');

async function htmlRewriterPlugin(fastify, opts) {
  fastify.decorate('rewriteHtml', async (html, originalUrl) => {
    const $ = cheerio.load(html);
    const domainName = 'http://localhost';
    const baseProxyUrl = '/proxy?url=';
    const assetProxyUrl = '/asset?url=';

    function rewriteAttr(el, attr) {
      const orig = $(el).attr(attr);
      if (!orig || orig.startsWith('data:') || orig.startsWith('javascript:')) return;
      const absoluteUrl = new URL(orig, originalUrl).toString();
      if (el.name === 'a' || el.name === 'form') {
        $(el).attr(attr, '/proxy?url=' + encodeURIComponent(absoluteUrl));
      } else {
        $(el).attr(attr, '/asset?url=' + encodeURIComponent(absoluteUrl));
      }
    }

    $('a[href]').each((_, el) => rewriteAttr(el, 'href'));
    $('link[href]').each((_, el) => rewriteAttr(el, 'href'));
    $('form[action]').each((_, el) => {
      const $el = $(el);
      const orig = $el.attr('action');
      if (!orig || orig.startsWith('javascript:') || orig.startsWith('data:')) return;
      const absolute = new URL(orig, originalUrl).toString();
      $el.attr('data-original-action', absolute);
      $el.attr('action', '/proxy');
    });
    $('script[src], img[src]').each((_, el) => rewriteAttr(el, 'src'));
    $('meta[http-equiv="refresh"]').each((_, el) => {
      const $el = $(el);
      const content = $el.attr('content');
      if (!content) return;

      const match = content.match(/^\s*\d+\s*;\s*url\s*=\s*(.+)$/i);
      if (match) {
        const urlPart = match[1].trim().replace(/^['"]|['"]$/g, '');
        const absoluteUrl = new URL(urlPart, originalUrl).toString();
        const proxiedUrl = baseProxyUrl + encodeURIComponent(absoluteUrl);
        const delay = content.split(';')[0].trim();
        $el.attr('content', `${delay}; url=${proxiedUrl}`);
      }
    });
    $('style').each((_, el) => {
      const $el = $(el);
      const css = $el.html();

      const rewrittenCss = css.replace(/url\(["']?(.*?)["']?\)/g, (match, url) => {
        if (url.startsWith('data:') || url.startsWith('javascript:')) return match;

        try {
          const absoluteUrl = new URL(url, originalUrl).toString();
          return `url("${assetProxyUrl}${encodeURIComponent(absoluteUrl)}")`;
        } catch {
          return match; // skip malformed URLs
        }
      });

      $el.html(rewrittenCss);
    });
    $('embed[src], object[data]').each((_, el) => {
      const $el = $(el);
      const attr = el.name === 'embed' ? 'src' : 'data';
      const orig = $el.attr(attr);
      if (!orig) return;

      const absoluteUrl = new URL(orig, originalUrl).toString();
      $el.attr(attr, absoluteUrl);
      $el.attr('data-base', absoluteUrl); // <-- Ruffle will use this
    });

    // TODO: move all this junk into real js files or something
    const patchScript = `
  <script>
    window.RufflePlayer = window.RufflePlayer || {};
    window.RufflePlayer.config = {
      publicPath: "/public/ruffle/",
      base: "${assetProxyUrl}"
    };

    const proxyUrl = "${assetProxyUrl}";
    const originalDomain = new URL("${originalUrl}").origin;

    // Patch fetch for proxying, including warpstream hacks
    const _fetch = window.fetch;
    window.fetch = async function(resource, options) {
      let resourceURL = new URL(resource instanceof Request ? resource.url : resource, window.location);

      if (resourceURL.protocol === "blob:" || resourceURL.href.startsWith("${domainName}"))
        return _fetch(resource, options);

      // Warpstream hack: replace v=undefined/video_id=undefined with hardcoded id
      let redirectURL = resourceURL.href;
      if (
        (redirectURL.includes("warpstream") || redirectURL.includes("warpstream.net")) &&
        (redirectURL.includes("?v=undefined") || redirectURL.includes("?video_id=undefined"))
      ) {
        redirectURL = redirectURL.replace("?v=undefined", "?v=aP0yUqcyY18").replace("?video_id=undefined", "?video_id=aP0yUqcyY18");
      }

      // Proxy all HTTP requests
      const proxied = proxyUrl + encodeURIComponent(redirectURL);

      const response = await _fetch(proxied, options);

      // Spoof URL for sitelocks
      try {
        Object.defineProperty(response, "url", { value: resourceURL.href });
      } catch {}

      return response;
    };

    // Patch XHR
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      if (url && !url.startsWith(proxyUrl) && url.startsWith("http")) {
        url = proxyUrl + encodeURIComponent(url);
      }
      return originalOpen.call(this, method, url, ...rest);
    };

    // Intercept ActiveXObject (old IE)
    if (window.ActiveXObject) {
      const originalActiveXObject = window.ActiveXObject;
      window.ActiveXObject = function(progid) {
        if (progid.toLowerCase().includes("xmlhttp")) {
          const xhr = new originalActiveXObject(progid);
          const origOpen = xhr.open;
          xhr.open = function(method, url, ...rest) {
            const absolute = new URL(url, originalDomain).toString();
            const proxied = proxyUrl + encodeURIComponent(absolute);
            return origOpen.call(this, method, proxied, ...rest);
          };
          return xhr;
        }
        return new originalActiveXObject(progid);
      };
    }
  </script>
<script>
  // Form Handling
  document.addEventListener("DOMContentLoaded", function() {
    document.querySelectorAll("form[data-original-action]").forEach(form => {
      const absolute = form.getAttribute("data-original-action");
      if (!absolute) return;

      form.addEventListener("submit", function(e) {
        e.preventDefault();
        const params = new URLSearchParams(new FormData(form)).toString();
        const fullUrl = absolute + (params ? "?" + params : "");
        window.location.href = "/proxy?url=" + encodeURIComponent(fullUrl);
      });
    });
  });
</script>
  <script src="/public/ruffle/ruffle.js"></script>
  `;
    $('head').append(patchScript);

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