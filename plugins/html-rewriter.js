const fp = require('fastify-plugin');
const cheerio = require('cheerio');

async function htmlRewriterPlugin(fastify, opts) {
  fastify.decorate('rewriteHtml', async (html, originalUrl) => {
    const $ = cheerio.load(html);
    const domainName = 'http://localhost:3000';
    const baseProxyUrl = '/proxy?url=';
    const assetProxyUrl = '/asset?url=';

    function rewriteAttr(el, attr) {
      const orig = $(el).attr(attr);
      if (!orig || orig.startsWith('data:') || orig.startsWith('javascript:') || orig.startsWith('mailto:')) return;
      const absoluteUrl = new URL(orig, originalUrl).toString();
      let rewrittenUrl;
      if (el.name === 'a' || el.name === 'form' || el.name === 'frame') {
        rewrittenUrl = domainName + '/proxy?url=' + encodeURIComponent(absoluteUrl);
        $(el).attr(attr, rewrittenUrl);
      } else {
        rewrittenUrl = domainName + '/asset?url=' + encodeURIComponent(absoluteUrl);
        $(el).attr(attr, rewrittenUrl);
      }
      console.log(`[rewriteAttr] ${el.name} [${attr}]: original='${orig}', rewritten='${rewrittenUrl}'`);
    }

    $('a[href]').each((_, el) => rewriteAttr(el, 'href'));
    $('link[href]').each((_, el) => rewriteAttr(el, 'href'));
    $('frame[src]').each((_, el) => rewriteAttr(el, 'src'));
    $('form[action]').each((_, el) => {
      const $el = $(el);
      const orig = $el.attr('action');
      if (!orig || orig.startsWith('javascript:') || orig.startsWith('data:')) return;
      const absolute = new URL(orig, originalUrl).toString();
      $el.attr('data-original-action', absolute);
      $el.attr('action', '/proxy');
      console.log(`[form[action] rewrite] form[action]: original='${orig}', absolute='${absolute}', rewritten='/proxy'`);
    });
    $('body[background], td[background], tr[background], table[background]').each((_, el) => rewriteAttr(el, 'background'));
    $('script[src], img[src], input[src]').each((_, el) => rewriteAttr(el, 'src'));
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
        console.log(`[meta refresh] original='${urlPart}', absolute='${absoluteUrl}', rewritten='${proxiedUrl}'`);
      }
    });
    $('style').each((_, el) => {
      const $el = $(el);
      const css = $el.html();

      const rewrittenCss = css.replace(/url\(["']?(.*?)["']?\)/g, (match, url) => {
        if (url.startsWith('data:') || url.startsWith('javascript:')) return match;

        try {
          const absoluteUrl = new URL(url, originalUrl).toString();
          const rewrittenUrl = `${assetProxyUrl}${encodeURIComponent(absoluteUrl)}`;
          console.log(`[style url()] original='${url}', absolute='${absoluteUrl}', rewritten='${rewrittenUrl}'`);
          return `url("${rewrittenUrl}")`;
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
      const proxiedUrl = domainName + '/asset?url=' + encodeURIComponent(absoluteUrl);
      $el.attr(attr, proxiedUrl);
      $el.attr('data-base', absoluteUrl); // <-- Ruffle will use this
      console.log(`[embed/object] ${el.name} [${attr}]: original='${orig}', absolute='${absoluteUrl}', proxied='${proxiedUrl}'`);
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

    // Proxy window.location navigation
    (function() {
      function rewriteAndNavigate(url) {
        try {
          var abs = new URL(url, window.location.href).toString();
          window.location.assign('${domainName}/proxy?url=' + encodeURIComponent(abs));
        } catch (e) {
          window.location.assign(url); // fallback
        }
      }
      var origAssign = window.location.assign.bind(window.location);
      window.location.assign = function(url) {
        rewriteAndNavigate(url);
      };
      var origReplace = window.location.replace.bind(window.location);
      window.location.replace = function(url) {
        rewriteAndNavigate(url);
      };
    })();

    // Patch popup windows and _target blank
    (function() {
      // Patch window.open
      const originalWindowOpen = window.open;
      window.open = function(url, name, features) {
        if (url && typeof url === 'string') {
          try {
            const absoluteUrl = new URL(url, originalDomain).toString();
            const proxiedUrl = '${domainName}/proxy?url=' + encodeURIComponent(absoluteUrl);
            
            // Parse features to extract width and height
            let width = 800;
            let height = 600;
            if (features) {
              const widthMatch = features.match(/width=(\d+)/);
              const heightMatch = features.match(/height=(\d+)/);
              if (widthMatch) width = parseInt(widthMatch[1]);
              if (heightMatch) height = parseInt(heightMatch[1]);
            }
            
            // Post message to parent window
            window.parent.postMessage({
              type: 'OPEN_POPUP',
              url: proxiedUrl,
              originalUrl: absoluteUrl,
              name: name || '_blank',
              width: width,
              height: height,
              features: features || ''
            }, 'http://localhost:3001');
            
            console.log('[popup patch] Intercepted window.open:', url, '->', proxiedUrl, 'size:', width + 'x' + height);
            
            // Return null to prevent actual popup
            return null;
          } catch (e) {
            console.log('[popup patch] Error processing window.open:', e);
            return originalWindowOpen.call(this, url, name, features);
          }
        }
        return originalWindowOpen.call(this, url, name, features);
      };

      // Patch _target blank links
      document.addEventListener('click', function(e) {
        const target = e.target.closest('a[target="_blank"]');
        if (target) {
          e.preventDefault();
          const href = target.getAttribute('href');
          if (href && !href.startsWith('javascript:') && !href.startsWith('mailto:') && !href.startsWith('#')) {
            try {
              const absoluteUrl = new URL(href, originalDomain).toString();
              const proxiedUrl = '${domainName}/proxy?url=' + encodeURIComponent(absoluteUrl);
              
              // Post message to parent window
              window.parent.postMessage({
                type: 'OPEN_POPUP',
                url: proxiedUrl,
                originalUrl: absoluteUrl,
                name: '_blank',
                width: 800,
                height: 600,
                features: 'width=800,height=600'
              }, 'http://localhost:3001');
              
              console.log('[popup patch] Intercepted _target blank link:', href, '->', proxiedUrl);
            } catch (e) {
              console.log('[popup patch] Error processing _target blank link:', e);
              // Fallback to original behavior
              window.open(href, '_blank');
            }
          }
        }
      }, true);

      // Patch onclick handlers that might open popups
      const originalAddEventListener = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (type === 'click' && typeof listener === 'function') {
          const wrappedListener = function(event) {
            try {
              // Check if the listener might open a popup
              const result = listener.call(this, event);
              if (result === false) return false; // Prevent default
              
              // If the element has target="_blank" or onclick contains window.open, we've already handled it
              return result;
            } catch (e) {
              return listener.call(this, event);
            }
          };
          return originalAddEventListener.call(this, type, wrappedListener, options);
        }
        return originalAddEventListener.call(this, type, listener, options);
      };
    })();
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
  <script src="${domainName}/public/ruffle/ruffle.js"></script>
  `;
    $('head').append(patchScript);

    // Special handling for .pls files from shoutcast.com
    if (originalUrl.includes('shoutcast.com') && originalUrl.endsWith('.pls')) {
      console.log('Redirecting shoutcast playlist to webamp');
      // Check if the content looks like a playlist file
      const bodyText = $('body').text() || html;
      console.log('Body text:', bodyText);
      if (bodyText.includes('[playlist]') && bodyText.includes('File1=')) {
        // Extract stream URL from File1= line
        const fileMatch = bodyText.match(/File1=(.+)/);
        if (fileMatch) {
          const streamUrl = fileMatch[1].trim();
          
          // Extract station name from Title1= line if available
          const titleMatch = bodyText.match(/Title1=(.+)/);
          const stationName = titleMatch ? titleMatch[1].trim() : 'Unknown Station';
          
          // Replace the entire body content with our script
          const plsScript = `
    <script>
      // Post message to parent window
      window.parent.postMessage({
        type: 'LOAD_STREAM',
        streamUrl: '${streamUrl}',
        stationName: '${stationName}'
      }, 'http://localhost:3001');
      
      // Go back to previous page
      window.history.back();
    </script>
    <p>Loading stream: ${stationName}</p>
    <p>Redirecting back...</p>`;
          
          $('body').html(plsScript);
        }
      }
    }

    // $('head').append('<link rel="stylesheet" href="https://unpkg.com/@sakun/system.css" />');
    // $('head').append('<link rel="stylesheet" href="https://unpkg.com/98.css@0.1.4/build/98.css" />');

    // Wrap body content
//     const bodyHtml = $('body').html();
//     $('body').html(`
//   <div id="protoweb-outer">
//     <div id="protoweb-frame">${bodyHtml}</div>
//   </div>
// `);

    // Patch document.write and document.writeln to rewrite embed/bgsound src attributes
    const patchDocumentWriteScript = `
  <script>
    var PROTOWEB_ORIGINAL_URL = "${originalUrl}";
    (function() {
      function rewriteMediaSrc(str) {
        var rewritten = str.replace(/(<(?:embed|bgsound)[^>]*src\\s*=\\s*)(['\\"]?)([^'\\"> ]+)\\2/gi, function(match, prefix, quote, url) {
          try {
            var abs = new URL(url, PROTOWEB_ORIGINAL_URL).toString();
            var proxied = '${domainName}/asset?url=' + encodeURIComponent(abs);
            console.log('[document.write patch] Rewriting media src:', url, '->', proxied);
            return prefix + quote + proxied + quote;
          } catch {
            return match;
          }
        });
        if (rewritten !== str) {
          console.log('[document.write patch] Rewrote string:', rewritten);
        }
        return rewritten;
      }
      var origWrite = document.write.bind(document);
      document.write = function(str) {
        console.log('[document.write patch] document.write called with:', str);
        if (typeof str === 'string') str = rewriteMediaSrc(str);
        return origWrite(str);
      };
      var origWriteln = document.writeln.bind(document);
      document.writeln = function(str) {
        console.log('[document.write patch] document.writeln called with:', str);
        if (typeof str === 'string') str = rewriteMediaSrc(str);
        return origWriteln(str);
      };
    })();
  </script>
  `;
    $('head').prepend(patchDocumentWriteScript);

    return $.html();
  });
}

module.exports = fp(htmlRewriterPlugin);