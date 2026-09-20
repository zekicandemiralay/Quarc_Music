// Express 4 does not catch a rejected promise from an async route handler.
// It doesn't 500, it doesn't log — the rejection escapes to the process, and
// Node's default for an unhandled rejection is to exit. Verified: one throw
// inside an async handler and the whole backend dies, taking every in-flight
// stream with it and cold-starting the cover cache on the way back up.
//
// Wrapping a handler in this forwards the rejection to Express's error
// middleware instead, so the one request that failed gets a 500 and everyone
// else keeps listening.
//
//   router.get('/x', asyncRoute(async (req, res) => { ... }))
//
// Express 5 does this natively; when that upgrade happens this can go.
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { asyncRoute };
