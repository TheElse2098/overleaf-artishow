module.exports = {
  internal: {
    git: { host: process.env.LISTEN_ADDRESS || '127.0.0.1', port: 3099 },
  },
  apis: {
    web: {                          // ← pour les callbacks (upsert-doc, compile…)
      url: `http://${process.env.WEB_HOST || '127.0.0.1'}:3000`,
      user: process.env.WEB_API_USER || 'overleaf',
      pass: process.env.WEB_API_PASSWORD || 'password',
    },
  },
}
