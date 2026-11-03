// Tiny static server for the built app (dist/). npm run build first.
const http = require('http'), fs = require('fs'), path = require('path');
const BASE = '/family-history/', root = path.join(__dirname, 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith(BASE)) p = p.slice(BASE.length - 1);
  if (p.startsWith('/private/')) {
    // The git-ignored family dataset, available only on this computer.
    const pf = path.join(__dirname, 'data', 'private', p.slice('/private/'.length));
    if (fs.existsSync(pf) && !fs.statSync(pf).isDirectory()) { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return fs.createReadStream(pf).pipe(res); }
    res.writeHead(404); return res.end();
  }
  let f = path.join(root, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, 'index.html');
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(4178, () => console.log('http://localhost:4178' + BASE));
