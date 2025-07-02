# Protoweb Proxy

This project is a web proxy server for Protoweb, enabling users to access archived websites directly from modern browsers without setting up a virtual machine or configuring browser proxy settings.

## Features

- Rewrites all links, images, scripts, and stylesheets to route through the proxy
- FTP servers route through the proxy
- Injects Ruffle to emulate Flash content
- Scales and frames pages to simulate a legacy browsing experience (4:3 resolution)
- Fastify-based architecture for performance and plugin flexibility

## How to Run

1. Install dependencies:

   npm install

2. Run the server:

   npm start

By default, the server runs at:

http://localhost:3000

You can visit a proxied site via:

http://localhost:3000/proxy?url=http://www.inode.com

## Development Notes

- All HTTP(S) requests are routed via the wayback.protoweb.org:7851 proxy
- /proxy handles HTML rewriting and Ruffle injection
- /asset streams binary/images/static content
- Static files like Ruffle are served under /public/ruffle/

## Requirements

- Node.js (18.x or higher recommended for compatibility with undici)
- wayback.protoweb.org:7851 must be accessible from your machine

## License

This project is part of the Protoweb effort. License TBD.
