// ============================================
// STATIC FILE SERVING - FIXED VERSION
// ============================================

// Clean WEBAPP_URL - remove any trailing slashes
const rawWebAppUrl = process.env.WEBAPP_URL || 'https://your-app.railway.app';
const WEBAPP_URL = rawWebAppUrl.replace(/\/+$/, ''); // Remove trailing slashes

console.log(`🌐 WebApp URL configured as: ${WEBAPP_URL}`);

// Try multiple possible paths for frontend files
let staticPath = null;
const possiblePaths = [
  path.join(__dirname, '../frontend'),
  path.join(__dirname, 'frontend'),
  path.join(process.cwd(), 'frontend'),
  path.join(process.cwd(), '..', 'frontend'),
  '/app/frontend',
  '/app/backend/../frontend'
];

console.log('🔍 Searching for frontend directory...');
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    staticPath = p;
    console.log(`✅ Found frontend at: ${p}`);
    break;
  }
}

// If no frontend found, create a basic one
if (!staticPath) {
  console.error('❌ Could not find frontend directory in any location!');
  staticPath = path.join(process.cwd(), 'frontend');
  fs.mkdirSync(staticPath, { recursive: true });
  
  // Create basic HTML files
  const basicHtml = `<!DOCTYPE html>
<html>
<head>
    <title>Bingo Game</title>
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        h1 { color: #4a90e2; }
    </style>
</head>
<body>
    <h1>🎯 BIG GTO BINGO</h1>
    <p>Server is running!</p>
</body>
</html>`;

  fs.writeFileSync(path.join(staticPath, 'index.html'), basicHtml);
  fs.writeFileSync(path.join(staticPath, 'game.html'), basicHtml);
  fs.writeFileSync(path.join(staticPath, 'select-card.html'), basicHtml);
  fs.writeFileSync(path.join(staticPath, 'admin.html'), basicHtml);
  
  console.log('📄 Created fallback HTML files in:', staticPath);
}

// List all files in the static directory
console.log('📄 Files in static directory:');
try {
  const files = fs.readdirSync(staticPath);
  files.forEach(file => {
    const filePath = path.join(staticPath, file);
    const stats = fs.statSync(filePath);
    console.log(`   - ${file} (${stats.size} bytes)`);
  });
} catch (err) {
  console.error('❌ Error reading directory:', err.message);
}

// FIX: Serve static files with absolute paths
app.use(express.static(staticPath));

// Explicit routes for HTML files - using absolute paths
app.get('/index.html', (req, res) => {
  const filePath = path.join(staticPath, 'index.html');
  console.log(`🔍 Looking for: ${filePath}`);
  if (fs.existsSync(filePath)) {
    console.log(`✅ Serving index.html from: ${filePath}`);
    res.sendFile(filePath);
  } else {
    console.error(`❌ File not found: ${filePath}`);
    res.status(404).send('index.html not found');
  }
});

app.get('/game.html', (req, res) => {
  const filePath = path.join(staticPath, 'game.html');
  console.log(`🔍 Looking for: ${filePath}`);
  if (fs.existsSync(filePath)) {
    console.log(`✅ Serving game.html from: ${filePath}`);
    res.sendFile(filePath);
  } else {
    console.error(`❌ File not found: ${filePath}`);
    res.status(404).send('game.html not found');
  }
});

app.get('/select-card.html', (req, res) => {
  const filePath = path.join(staticPath, 'select-card.html');
  console.log(`🔍 Looking for: ${filePath}`);
  if (fs.existsSync(filePath)) {
    console.log(`✅ Serving select-card.html from: ${filePath}`);
    res.sendFile(filePath);
  } else {
    console.error(`❌ File not found: ${filePath}`);
    res.status(404).send('select-card.html not found');
  }
});

app.get('/admin.html', (req, res) => {
  const filePath = path.join(staticPath, 'admin.html');
  console.log(`🔍 Looking for: ${filePath}`);
  if (fs.existsSync(filePath)) {
    console.log(`✅ Serving admin.html from: ${filePath}`);
    res.sendFile(filePath);
  } else {
    console.error(`❌ File not found: ${filePath}`);
    res.status(404).send('admin.html not found');
  }
});

// Serve other static files (CSS, JS)
app.get('*.js', (req, res) => {
  const fileName = req.path.substring(1);
  const filePath = path.join(staticPath, fileName);
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

app.get('*.css', (req, res) => {
  const fileName = req.path.substring(1);
  const filePath = path.join(staticPath, fileName);
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'text/css');
    res.sendFile(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

// Redirect root to index.html
app.get('/', (req, res) => {
  const indexPath = path.join(staticPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>🎯 BIG GTO BINGO</h1>
          <p>Server is running!</p>
          <p><a href="/test">Test Page</a> | <a href="/debug-files">Debug Files</a></p>
        </body>
      </html>
    `);
  }
});

// Test page to verify server is working
app.get('/test', (req, res) => {
  res.send(`
    <html>
      <head><title>Server Test</title></head>
      <body style="font-family: Arial; text-align: center; padding: 50px;">
        <h1>✅ Server is Working!</h1>
        <p>Current time: ${new Date().toISOString()}</p>
        <p>Static path: ${staticPath}</p>
        <p>WebApp URL: ${WEBAPP_URL}</p>
        <h2>Navigation:</h2>
        <p><a href="/debug-files">Check Files</a></p>
        <p><a href="/index.html">Index.html</a></p>
        <p><a href="/game.html">Game.html</a></p>
        <p><a href="/select-card.html">Select Card</a></p>
        <p><a href="/admin.html">Admin</a></p>
        <p><a href="/health">Health Check</a></p>
      </body>
    </html>
  `);
});

// Debug endpoint to check file system
app.get('/debug-files', (req, res) => {
  const result = {
    cwd: process.cwd(),
    __dirname: __dirname,
    staticPath: staticPath,
    staticPathExists: fs.existsSync(staticPath),
    frontendFiles: [],
    fileContents: {}
  };
  
  if (fs.existsSync(staticPath)) {
    try {
      const files = fs.readdirSync(staticPath);
      result.frontendFiles = files;
      
      files.forEach(file => {
        const filePath = path.join(staticPath, file);
        const stats = fs.statSync(filePath);
        result.fileContents[file] = {
          size: stats.size,
          path: filePath,
          exists: fs.existsSync(filePath),
          readable: true
        };
      });
    } catch (e) {
      result.error = e.message;
    }
  }
  
  res.json(result);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    webappUrl: WEBAPP_URL,
    staticPath: staticPath,
    staticPathExists: fs.existsSync(staticPath)
  });
});