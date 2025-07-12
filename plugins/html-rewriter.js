const fp = require('fastify-plugin');
const cheerio = require('cheerio');

async function htmlRewriterPlugin(fastify, opts) {
  fastify.decorate('rewriteHtml', async (html, originalUrl, charset) => {
    const $ = cheerio.load(html);
    const domainName = 'http://localhost:3000';
    const baseProxyUrl = '/proxy?url=';
    const assetProxyUrl = '/asset?url=';

    // Ensure correct <meta charset> or <meta http-equiv> tag
    if (charset) {
      let found = false;
      $('meta').each((_, el) => {
        const $el = $(el);
        const httpEquiv = $el.attr('http-equiv');
        const metaCharset = $el.attr('charset');
        if (metaCharset) {
          $el.attr('charset', charset);
          found = true;
        } else if (httpEquiv && httpEquiv.toLowerCase() === 'content-type') {
          let content = $el.attr('content') || '';
          content = content.replace(/charset=([^;\s]+)/i, `charset=${charset}`);
          $el.attr('content', content);
          found = true;
        }
      });
      if (!found) {
        // Insert <meta charset=...> at the start of <head>
        $('head').prepend(`<meta charset="${charset}">`);
      }
    }

    function rewriteAttr(el, attr) {
      const orig = $(el).attr(attr);
      if (!orig || orig.startsWith('data:') || orig.startsWith('javascript:') || orig.startsWith('mailto:')) return;
      const absoluteUrl = new URL(orig, originalUrl).toString();
      let rewrittenUrl;

      if (el.name === 'a' || el.name === 'form' || el.name === 'frame' || el.name === 'area') {
        // Use /asset only for known asset extensions, otherwise /proxy
        // Asset extension allowlist
        const assetExtensions = [
          'zip', 'exe', 'msi', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
          'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
          'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico',
          'mp3', 'wav', 'ogg', 'flac', 'aac',
          'mp4', 'avi', 'mov', 'wmv', 'mkv', 'webm',
          'swf', 'ttf', 'otf', 'woff', 'woff2', 'eot', 'css', 'js', 'mid', 'midi'
        ];
        const urlPath = new URL(absoluteUrl).pathname;
        const extMatch = urlPath.match(/\.([a-z0-9]{1,5})$/i);
        const ext = extMatch ? extMatch[1].toLowerCase() : null;
        const isAsset = ext && assetExtensions.includes(ext);

        if (isAsset && !absoluteUrl.includes('?') && !absoluteUrl.includes('#')) {
          rewrittenUrl = domainName + '/asset?url=' + encodeURIComponent(absoluteUrl);
        } else {
          rewrittenUrl = domainName + '/proxy?url=' + encodeURIComponent(absoluteUrl);
        }
        $(el).attr(attr, rewrittenUrl);
      } else {
        // For other elements (img, script, etc.), always use /asset
        rewrittenUrl = domainName + '/asset?url=' + encodeURIComponent(absoluteUrl);
        $(el).attr(attr, rewrittenUrl);
      }
      console.log(`[rewriteAttr] ${el.name} [${attr}]: original='${orig}', rewritten='${rewrittenUrl}'`);
    }

    $('a[href]').each((_, el) => {
      // Remove target="_top" if present
      if ($(el).attr('target') === '_top') {
        $(el).removeAttr('target');
      }
      rewriteAttr(el, 'href');
    });
    $('link[href]').each((_, el) => rewriteAttr(el, 'href'));
    $('area[href]').each((_, el) => rewriteAttr(el, 'href'));
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

    // ============================================================================
    // MEDIA HANDLING SECTION
    // ============================================================================
    // Unified handling for embed, object, bgsound elements and MIDI detection
    let midiSrc = null;
    let processedAudioFiles = new Set(); // Track processed audio files to avoid conflicts
    let processedAudioBaseNames = new Set(); // Track base names to detect same content with different extensions
    
    // Helper function to get base name without extension
    const getBaseName = (url) => {
      const path = new URL(url).pathname;
      return path.replace(/\.[^.]*$/, '').toLowerCase();
    };
    
    // Process bgsound elements first (they take priority)
    $('bgsound[src]').each((_, el) => {
      const $el = $(el);
      const src = $el.attr('src');
      if (!src) return;

      const absoluteUrl = new URL(src, originalUrl).toString();
      
      // Check if this is a MIDI file
      if (/\.mid(i)?(\?.*)?$/i.test(src)) {
        midiSrc = absoluteUrl;
        console.log(`[MIDI detection] Found MIDI file in bgsound: ${src} -> ${absoluteUrl}`);
        $el.remove(); // Remove bgsound, MIDI will be handled by player
      } else {
        // For non-MIDI files, convert to audio element
        const proxiedUrl = domainName + '/asset?url=' + encodeURIComponent(absoluteUrl);
        const audioHtml = `<audio src="${proxiedUrl}" autoplay controls width="100" height="20" style="display:inline-block; vertical-align:middle; min-width:100px; max-width:120px; height:20px; padding:0; margin:0; background:transparent; border:none;"></audio>`;
        $el.after(audioHtml);
        $el.remove();
        console.log(`[bgsound->audio] Converted: ${src} -> ${proxiedUrl}`);
        
        // Track this audio file as processed to avoid conflicts with embed fallbacks
        processedAudioFiles.add(absoluteUrl);
        processedAudioBaseNames.add(getBaseName(absoluteUrl));
        console.log(`[audio tracking] Added to processed list: ${getBaseName(absoluteUrl)}`);
      }
    });
    
    // Process embed and object elements
    $('embed[src], object[data]').each((_, el) => {
      const $el = $(el);
      const attr = el.name === 'embed' ? 'src' : 'data';
      const orig = $el.attr(attr);
      if (!orig) return;

      const absoluteUrl = new URL(orig, originalUrl).toString();
      
      // Check if this is a MIDI file; midi player calls overridden fetch and proxies on request
      if (/\.mid(i)?(\?.*)?$/i.test(orig)) {
        midiSrc = absoluteUrl;
        console.log(`[MIDI detection] Found MIDI file: ${orig} -> ${absoluteUrl}`);
        $el.remove(); // Remove embed, MIDI will be handled by player
      } else {
        // Check if this is an audio file that was already handled by a bgsound element
        const isAudioFile = /\.(wav|aif|aiff|mp3|ogg|flac|aac|m4a)(\?.*)?$/i.test(orig);
        if (isAudioFile && (processedAudioFiles.has(absoluteUrl) || processedAudioBaseNames.has(getBaseName(absoluteUrl)))) {
          // This is a fallback embed for an audio file already handled by bgsound
          const baseName = getBaseName(absoluteUrl);
          console.log(`[embed fallback] Skipping embed fallback for audio already handled by bgsound: ${orig} (base: ${baseName})`);
          $el.remove(); // Remove the embed element to prevent conflicts
        } else {
          const proxiedUrl = domainName + '/asset?url=' + encodeURIComponent(absoluteUrl);
          $el.attr(attr, proxiedUrl);
          $el.attr('data-base', absoluteUrl); // <-- Ruffle will use this
          console.log(`[embed/object] ${el.name} [${attr}]: original='${orig}', absolute='${absoluteUrl}', proxied='${proxiedUrl}'`);
        }
      }
    });

    // ============================================================================
    // SCRIPT INJECTION SECTION
    // ============================================================================
    // Main patch script (Ruffle, fetch, XHR, popup handling, etc.)
    const patchScript = `
  <script>
    window.RufflePlayer = window.RufflePlayer || {};
    window.RufflePlayer.config = {
      publicPath: "/public/ruffle/",
      base: "${assetProxyUrl}"
    };

    // Clean up Ruffle/Flash on navigation (aggressive)
    function cleanupRuffle() {
      // Destroy/remove all ruffle-player, object, and embed elements
      document.querySelectorAll('object, embed, ruffle-player').forEach(el => {
        try { if (typeof el.destroy === 'function') el.destroy(); } catch(e){}
        try { while (el.firstChild) el.removeChild(el.firstChild); } catch(e){}
        try { el.src = ''; } catch(e){}
        try { el.data = ''; } catch(e){}
        try { if (el.remove) el.remove(); } catch(e){}
      });
      // Destroy all active Ruffle players if possible
      if (window.RufflePlayer && window.RufflePlayer.active_players) {
        try {
          window.RufflePlayer.active_players.forEach(player => {
            if (typeof player.destroy === 'function') player.destroy();
          });
        } catch(e){}
      }
      // Nullify RufflePlayer global
      try { window.RufflePlayer = null; } catch(e){}
    }
    window.addEventListener('beforeunload', cleanupRuffle);
    window.addEventListener('pagehide', cleanupRuffle);
    window.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') cleanupRuffle();
    });

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
    document.addEventListener("DOMContentLoaded", function() {
      document.querySelectorAll("form[data-original-action]").forEach(form => {
        const absolute = form.getAttribute("data-original-action");
        if (!absolute) return;

        form.addEventListener("submit", function(e) {
          e.preventDefault();
          const method = (form.method || "get").toLowerCase();
          const params = new URLSearchParams(new FormData(form)).toString();
          if (method === "post") {
            fetch("/proxy?url=" + encodeURIComponent(absolute), {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded"
              },
              body: params,
              credentials: "same-origin"
            })
            .then(async response => {
              // If HTML, replace document; otherwise, handle as blob/download
              const contentType = response.headers.get("content-type") || "";
              if (contentType.includes("text/html")) {
                const text = await response.text();
                document.open();
                document.write(text);
                document.close();
              } else {
                // For non-HTML, try to download or display
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                window.location.href = url;
              }
            });
          } else {
            // GET: redirect as before
            const fullUrl = absolute + (params ? "?" + params : "");
            window.location.href = "/proxy?url=" + encodeURIComponent(fullUrl);
          }
        });
      });
    });
  </script>
  <script src="${domainName}/public/ruffle/ruffle.js"></script>
  `;
    $('head').append(patchScript);

    // Additional scripts based on content
    let additionalScripts = '';

    // MIDI player scripts if MIDI file detected
    if (midiSrc) {
      additionalScripts += `
        <script src="/public/WebAudioFontPlayer.js"></script>
        <script src="/public/MIDIFile.js"></script>
        <script src="/public/MIDIPlayer.js"></script>
        <script>
        // autoplay flag
        var autoplay=true;
        // create the player object using a file input by id or DOM Element
        var player=new MIDIPlayer('${midiSrc}');
        // register the onload function to start playing
        player.onload = function(song){
            if (autoplay){
                player.play();
            }
        }
        // the tick event is triggered in every position change
        player.ontick=function(song,position){
            var pos= document.getElementById("position");
            if(pos) pos.value=Math.round(position*10);
        }
        // the end event is triggered when the song ends
        player.onend=function(){
            player.play();
        }
        // stop playing when the window is unfocused
        window.onblur=function(){
            player.pause();
        }
        </script>
      `;
    }

    // Document.write patch for dynamic content
    additionalScripts += `
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

    // Inject all additional scripts
    if (additionalScripts) {
      $('head').append(additionalScripts);
    }

    // ============================================================================
    // SPECIAL CONTENT HANDLING SECTION
    // ============================================================================
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



    return $.html();
  });
}

module.exports = fp(htmlRewriterPlugin);