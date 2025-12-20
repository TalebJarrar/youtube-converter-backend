// Backend Server using yt-dlp (more stable than ytdl-core)
// First install yt-dlp: npm install yt-dlp-exec express cors

const express = require('express');
const ytdlp = require('yt-dlp-exec');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Temporary downloads folder
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR);
}

// Validate YouTube URL
function isValidYouTubeUrl(url) {
    const patterns = [
        /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=.+$/,
        /^(https?:\/\/)?(www\.)?youtu\.be\/.+$/
    ];
    return patterns.some(pattern => pattern.test(url));
}

// Get video info endpoint
app.post('/api/info', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url || !isValidYouTubeUrl(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }
        
        // Get video info without downloading
        const info = await ytdlp(url, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
        });
        
        res.json({
            title: info.title,
            channel: info.uploader || info.channel,
            thumbnail: info.thumbnail,
            duration: info.duration,
            videoId: info.id
        });
        
    } catch (error) {
        console.error('Error fetching video info:', error);
        res.status(500).json({ error: 'Failed to fetch video information' });
    }
});

// Download MP3 endpoint
app.post('/api/download/mp3', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url || !isValidYouTubeUrl(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }
        
        // Generate unique filename
        const timestamp = Date.now();
        const outputPath = path.join(DOWNLOADS_DIR, `${timestamp}.mp3`);
        
        // Download audio
        await ytdlp(url, {
            extractAudio: true,
            audioFormat: 'mp3',
            audioQuality: 0, // Best quality
            output: outputPath,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
        });
        
        // Get video info for filename
        const info = await ytdlp(url, {
            dumpSingleJson: true,
            noCheckCertificates: true,
        });
        
        const title = info.title.replace(/[^\w\s-]/g, '').substring(0, 100);
        
        // Send file
        res.download(outputPath, `${title}.mp3`, (err) => {
            // Delete file after download
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
            if (err) {
                console.error('Download error:', err);
            }
        });
        
    } catch (error) {
        console.error('Error downloading MP3:', error);
        res.status(500).json({ error: 'Failed to download audio' });
    }
});

// Download MP4 endpoint
app.post('/api/download/mp4', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url || !isValidYouTubeUrl(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }
        
        // Generate unique filename
        const timestamp = Date.now();
        const outputPath = path.join(DOWNLOADS_DIR, `${timestamp}.mp4`);
        
        // Download video
        await ytdlp(url, {
            format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            output: outputPath,
            noCheckCertificates: true,
            noWarnings: true,
            mergeOutputFormat: 'mp4',
        });
        
        // Get video info for filename
        const info = await ytdlp(url, {
            dumpSingleJson: true,
            noCheckCertificates: true,
        });
        
        const title = info.title.replace(/[^\w\s-]/g, '').substring(0, 100);
        
        // Send file
        res.download(outputPath, `${title}.mp4`, (err) => {
            // Delete file after download
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
            if (err) {
                console.error('Download error:', err);
            }
        });
        
    } catch (error) {
        console.error('Error downloading MP4:', error);
        res.status(500).json({ error: 'Failed to download video' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is running' });
});

// Clean up old files on startup
function cleanupDownloads() {
    if (fs.existsSync(DOWNLOADS_DIR)) {
        const files = fs.readdirSync(DOWNLOADS_DIR);
        files.forEach(file => {
            const filePath = path.join(DOWNLOADS_DIR, file);
            fs.unlinkSync(filePath);
        });
    }
}

cleanupDownloads();

// Start server
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║         YouTube Converter Server Running (yt-dlp)             ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  Server URL: http://localhost:${PORT}                           ║
║                                                               ║
║  Using: yt-dlp (more stable than ytdl-core)                  ║
║                                                               ║
║  Endpoints:                                                   ║
║  - POST /api/info        (Get video information)             ║
║  - POST /api/download/mp3 (Download as MP3)                  ║
║  - POST /api/download/mp4 (Download as MP4)                  ║
║  - GET  /api/health      (Health check)                      ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
    `);
});