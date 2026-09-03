let app;
let initError = null;

try {
  const loaded = require('../dist/src/index');
  app = loaded.default || loaded;
} catch (err) {
  console.error('[Vercel Boot Error]', err);
  initError = err.message || String(err);
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
