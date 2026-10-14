// Startup file for cPanel "Setup Node.js App".
// cPanel loads this with require(), which cannot load ES modules directly,
// so this small CommonJS file hands off to server.js.
// Kept to old-Node-compatible syntax so a wrong Node version shows a clear message.
var major = parseInt(process.versions.node.split('.')[0], 10);

if (major < 20) {
  var message = 'Client Suite needs Node.js 20 or newer, but this app is running on Node.js ' +
    process.versions.node + '. In cPanel open "Setup Node.js App", edit this application, ' +
    'choose Node.js version 20 or higher, click Save, then "Run NPM Install" and "Restart".';
  console.error(message);
  require('http').createServer(function (req, res) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(message);
  }).listen(process.env.PORT || 3000);
} else {
  import('./server.js').catch(function (err) {
    console.error('Failed to start Client Suite:', err);
    process.exit(1);
  });
}
