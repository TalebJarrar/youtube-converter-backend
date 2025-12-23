// Backend Server with Cookie support to bypass YouTube rate limiting
const express = require('express');
const ytdl = require('@distube/ytdl-core');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Cookie agent to bypass YouTube bot detection
const cookieString = process.env.YOUTUBE_COOKIE || '';
const agent = cookieString ? ytdl.createAgent(JSON.parse(cookieString)) : undefined;

// Temporary downloads folder
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR);
}

// Validate YouTube URL
function isValidYouTubeUrl(url) {
    return ytdl.validateURL(url);
}

// Clean URL (remove playlist params that cause issues)
function cleanYouTubeUrl(url) {
    try {
        const urlObj = new URL(url);
        // Keep only the video ID parameter
        const videoId = urlObj.searchParams.get('v');
        if (videoId) {
            return `https://www.youtube.com/watch?v=${videoId}`;
        }
        return url;
    } catch (e) {
        return url;
    }
}

// Get video info endpoint
app.post('/api/info', async (req, res) => {
    try {
        let { url } = req.body;
        
        console.log('Fetching info for:', url);
        
        if (!url || !isValidYouTubeUrl(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }
        
        // Clean the URL
        url = cleanYouTubeUrl(url);
        console.log('Cleaned URL:', url);
        
        const info = await ytdl.getInfo(url, { agent });
        const videoDetails = info.videoDetails;
        
        console.log('Video info fetched:', videoDetails.title);
        
        res.json({
            title: videoDetails.title,
            channel: videoDetails.author.name,
            thumbnail: videoDetails.thumbnails[videoDetails.thumbnails.length - 1].url,
            duration: videoDetails.lengthSeconds,
            videoId: videoDetails.videoId
        });
        
    } catch (error) {
        console.error('Error fetching video info:', error.message);
        
        // Check if it's a rate limit error
        if (error.message.includes('429') || error.message.includes('rate limit')) {
            return res.status(429).json({ 
                error: 'YouTube is currently rate limiting requests. Please try again in a few minutes, or try a different video.' 
            });
        }
        
        res.status(500).json({ error: 'Failed to fetch video information. Please check the URL and try again.' });
    }
});

// Download MP3 endpoint
app.post('/api/download/mp3', async (req, res) => {
    try {
        let { url } = req.body;
        
        console.log('Downloading MP3 for:', url);
        
        if (!url || !isValidYouTubeUrl(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }
        
        // Clean the URL
        url = cleanYouTubeUrl(url);
        
        const info = await ytdl.getInfo(url, { agent });
        const title = info.videoDetails.title.replace(/[^\w\s-]/g, '').substring(0, 100);
        
        console.log('Starting MP3 download:', title);
        
        res.header('Content-Disposition', `attachment; filename="${title}.mp3"`);
        res.header('Content-Type', 'audio/mpeg');
        
        const stream = ytdl(url, {
            quality: 'highestaudio',
            filter: 'audioonly',
            agent
        });
        
        stream.pipe(res);
        
        stream.on('error', (error) => {
            console.error('Stream error:', error.message);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Download failed' });
            }
        });
        
        stream.on('end', () => {
            console.log('MP3 download complete:', title);
        });
        
    } catch (error) {
        console.error('Error downloading MP3:', error.message);
        if (!res.headersSent) {
            if (error.message.includes('429')) {
                res.status(429).json({ error: 'Rate limited. Please try again later.' });
            } else {
                res.status(500).json({ error: 'Failed to download audio. Please try again.' });
            }
        }
    }
});

// Download MP4 endpoint
app.post('/api/download/mp4', async (req, res) => {
    try {
        let { url } = req.body;
        
        console.log('Downloading MP4 for:', url);
        
        if (!url || !isValidYouTubeUrl(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }
        
        // Clean the URL
        url = cleanYouTubeUrl(url);
        
        const info = await ytdl.getInfo(url, { agent });
        const title = info.videoDetails.title.replace(/[^\w\s-]/g, '').substring(0, 100);
        
        console.log('Starting MP4 download:', title);
        
        res.header('Content-Disposition', `attachment; filename="${title}.mp4"`);
        res.header('Content-Type', 'video/mp4');
        
        const stream = ytdl(url, {
            quality: 'highest',
            filter: format => format.container === 'mp4',
            agent
        });
        
        stream.pipe(res);
        
        stream.on('error', (error) => {
            console.error('Stream error:', error.message);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Download failed' });
            }
        });
        
        stream.on('end', () => {
            console.log('MP4 download complete:', title);
        });
        
    } catch (error) {
        console.error('Error downloading MP4:', error.message);
        if (!res.headersSent) {
            if (error.message.includes('429')) {
                res.status(429).json({ error: 'Rate limited. Please try again later.' });
            } else {
                res.status(500).json({ error: 'Failed to download video. Please try again.' });
            }
        }
    }
});

// Health check
app.get('/api/health', (req, res) => {
    console.log('Health check requested');
    res.json({ status: 'ok', message: 'Server is running' });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({ message: 'YouTube Converter API', status: 'running' });
});

// Clean up old files on startup
function cleanupDownloads() {
    if (fs.existsSync(DOWNLOADS_DIR)) {
        const files = fs.readdirSync(DOWNLOADS_DIR);
        files.forEach(file => {
            const filePath = path.join(DOWNLOADS_DIR, file);
            try {
                fs.unlinkSync(filePath);
                console.log('Cleaned up:', file);
            } catch (err) {
                console.error('Error cleaning file:', err);
            }
        });
    }
}

cleanupDownloads();

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║         YouTube Converter Server Running                      ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  Port: ${PORT}                                                  ║
║  Status: Ready to accept requests                            ║
║  Rate Limit Protection: ${cookieString ? 'Enabled' : 'Disabled'}                        ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
    `);
});