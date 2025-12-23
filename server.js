const express = require('express');
const ytdl = require('@distube/ytdl-core');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// Basic per-IP rate limiting to protect upstream and prevent abuse
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // limit each IP to 20 requests per windowMs (tune as needed)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', limiter);
app.use(express.json());

// ==========================
// SIMPLE IN-MEMORY CACHE
// ==========================
const infoCache = new Map(); // videoId -> info

async function getCachedInfo(url) {
  const id = ytdl.getURLVideoID(url);

  if (infoCache.has(id)) {
    return infoCache.get(id);
  }

  // Try a small number of retries for transient errors (but don't hammer upstream).
  const maxRetries = 2;
  let attempt = 0;

  while (true) {
    try {
      const info = await ytdl.getInfo(url);
      infoCache.set(id, info);

      // auto-expire after 30 minutes
      setTimeout(() => infoCache.delete(id), 1000 * 60 * 30);

      return info;
    } catch (err) {
      attempt += 1;

      // If upstream responds with 429 (Too Many Requests), bubble that up immediately
      // so caller can return a 429 to clients and avoid retry storms.
      if (err && err.statusCode === 429) {
        const e = new Error('Upstream rate limit (429) from video host');
        e.statusCode = 429;
        e.original = err;
        throw e;
      }

      if (attempt > maxRetries) throw err;

      // Exponential backoff (short) for transient network issues
      const delayMs = 500 * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// ==========================
// HEALTH CHECK
// ==========================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ==========================
// INFO ENDPOINT
// ==========================
app.post('/api/info', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !ytdl.validateURL(url)) {
      return res.status(400).json({ error: 'Invalid media URL' });
    }

    const info = await getCachedInfo(url);
    const v = info.videoDetails;

    res.json({
      title: v.title,
      channel: v.author?.name || 'Unknown',
      thumbnail: v.thumbnails[v.thumbnails.length - 1].url,
      duration: v.lengthSeconds
    });

  } catch (err) {
    console.error(err);
    if (err && err.statusCode === 429) {
      const retryAfter = err.original?.headers?.['retry-after'] || 60;
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Upstream rate limit: please retry later' });
    }

    if (process.env.NODE_ENV !== 'production') {
      return res.status(500).json({ error: err.message || 'Failed to fetch media info', stack: err.stack });
    }
    res.status(500).json({ error: err.message || 'Failed to fetch media info' });
  }
});

// ==========================
// AUDIO (MP3)
// ==========================
app.post('/api/download/mp3', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !ytdl.validateURL(url)) {
      return res.status(400).json({ error: 'Invalid media URL' });
    }

    const info = await getCachedInfo(url);

    const format = ytdl.chooseFormat(info.formats, {
      quality: 'highestaudio',
      filter: 'audioonly'
    });

    const title = info.videoDetails.title
      .replace(/[^\w\s-]/g, '')
      .slice(0, 80);

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${title}.mp3"`
    );
    res.setHeader('Content-Type', 'audio/mpeg');

    ytdl.downloadFromInfo(info, {
      format,
      highWaterMark: 1 << 25
    }).pipe(res);

  } catch (err) {
    console.error(err);
    if (err && err.statusCode === 429) {
      const retryAfter = err.original?.headers?.['retry-after'] || 60;
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Upstream rate limit: please retry later' });
    }

    if (process.env.NODE_ENV !== 'production') {
      return res.status(500).json({ error: err.message || 'Audio processing failed', stack: err.stack });
    }
    res.status(500).json({ error: err.message || 'Audio processing failed' });
  }
});

// ==========================
// VIDEO (MP4) — PROGRESSIVE ONLY
// ==========================
app.post('/api/download/mp4', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !ytdl.validateURL(url)) {
      return res.status(400).json({ error: 'Invalid media URL' });
    }

    const info = await getCachedInfo(url);

    const format = ytdl.chooseFormat(info.formats, {
      filter: f =>
        f.container === 'mp4' &&
        f.hasAudio &&
        f.hasVideo &&
        f.isProgressive
    });

    if (!format) {
      return res.status(400).json({ error: 'No compatible MP4 stream' });
    }

    const title = info.videoDetails.title
      .replace(/[^\w\s-]/g, '')
      .slice(0, 80);

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${title}.mp4"`
    );
    res.setHeader('Content-Type', 'video/mp4');

    ytdl.downloadFromInfo(info, {
      format,
      highWaterMark: 1 << 25
    }).pipe(res);

  } catch (err) {
    console.error(err);
    if (err && err.statusCode === 429) {
      const retryAfter = err.original?.headers?.['retry-after'] || 60;
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Upstream rate limit: please retry later' });
    }

    if (process.env.NODE_ENV !== 'production') {
      return res.status(500).json({ error: err.message || 'Video processing failed', stack: err.stack });
    }
    res.status(500).json({ error: err.message || 'Video processing failed' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Media Processor running on port ${PORT}`);
});
