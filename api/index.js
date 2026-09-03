const app = require('../dist/src/index').default;

module.exports = (req, res) => {
  return app(req, res);
};
