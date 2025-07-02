const fastify = require('fastify')();
const cheerio = require('cheerio');
const request = require('supertest');

const htmlSample = `
<html>
  <head>
    <meta http-equiv="refresh" content="5; url=http://example.com">
  </head>
  <body>
    <p>Hello!</p>
  </body>
</html>
`;

beforeAll(async () => {
  // Stub fetchRemote plugin
  fastify.decorate('fetchRemote', async () => ({
    statusCode: 200,
    headers: { 'content-type': 'text/html' },
    body: htmlSample
  }));

  // Register only necessary plugins and routes
  await fastify.register(require('../plugins/html-rewriter'));
  await fastify.register(require('../routes/proxy'));
  await fastify.listen({ port: 0 });
});

afterAll(async () => {
  await fastify.close();
});

test('should rewrite meta refresh URL', async () => {
  const res = await request(fastify.server)
    .get('/proxy?url=http://example.org');

  const $ = cheerio.load(res.text);
  const meta = $('meta[http-equiv="refresh"]');
  expect(meta.length).toBe(1);

  const content = meta.attr('content');
  expect(content).toMatch(/^5;\s*url=\/proxy\?url=http/);
});
