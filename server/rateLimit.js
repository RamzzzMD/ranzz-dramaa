export function createRateLimiter({ windowMs = 60000, max = 120, message = 'Terlalu banyak permintaan, coba lagi sebentar.' } = {}) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of hits.entries()) {
      if (now > data.resetAt) hits.delete(ip);
    }
  }, windowMs).unref();

  return function rateLimitMiddleware(req, res, next) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress) || 'unknown';
    const now = Date.now();

    let record = hits.get(ip);
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + windowMs };
      hits.set(ip, record);
    }

    record.count += 1;
    const remaining = Math.max(0, max - record.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(record.resetAt / 1000)));

    if (record.count > max) {
      return res.status(429).json({ error: message });
    }

    return next();
  };
}

