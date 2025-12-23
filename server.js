const express = require('express');
const ytdl = require('@distube/ytdl-core');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
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

  const info = await ytdl.getInfo(url);
  infoCache.set(id, info);

  // auto-expire after 30 minutes
  setTimeout(() => infoCache.delete(id), 1000 * 60 * 30);

  return info;
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
    if (process.env.NODE_ENV !== 'production') {
      return res.status(500).json({ error: err.message || 'Video processing failed', stack: err.stack });
    }
    res.status(500).json({ error: err.message || 'Video processing failed' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Media Processor running on port ${PORT}`);
});
