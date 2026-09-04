let app;
let initError = null;

try {
  const loaded = require('../dist/src/index');
  app = loaded.default || loaded;
} catch (err1) {
  try {
    const loadedRoot = require('../dist/index');
    app = loadedRoot.default || loadedRoot;
  } catch (err2) {
    console.error('[Vercel Boot Error]', err1, err2);
    initError = err1.message || String(err1);
  }
}

module.exports = (req, res) => {
  if (!app || initError) {
    return res.status(500).json({
      success: false,
      error: 'Vercel Function Initialization Error',
      details: initError
    });
  }
  return app(req, res);
};

