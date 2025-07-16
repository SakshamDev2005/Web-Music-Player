import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const app = express();
app.use(cors());
app.use(express.json());

function extractDriveFileId(url) {
  const patterns = [
    /\/d\/([a-zA-Z0-9_-]{25,})/, // .../d/FILEID/...
    /id=([a-zA-Z0-9_-]{25,})/,   // ...id=FILEID
    /file\/d\/([a-zA-Z0-9_-]{25,})/, // ...file/d/FILEID/...
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

app.post('/download', async (req, res) => {
  const { link } = req.body;
  if (!link) return res.status(400).send('Missing Google Drive link');
  const fileId = extractDriveFileId(link);
  if (!fileId) return res.status(400).send('Invalid Google Drive link');
  const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
  try {
    // Download the file to a temp location
    const gRes = await fetch(url, { method: 'GET' });
    if (!gRes.ok) {
      const text = await gRes.text();
      return res.status(gRes.status).send(text);
    }
    // Get filename from headers or fallback
    let fileName = `drivefile_${fileId}.mp3`;
    const disposition = gRes.headers.get('content-disposition');
    if (disposition) {
      const match = disposition.match(/filename="(.+)"/);
      if (match) fileName = match[1];
    }
    const tempPath = path.join(tmpdir(), fileName);
    const fileStream = fs.createWriteStream(tempPath);
    await new Promise((resolve, reject) => {
      gRes.body.pipe(fileStream);
      gRes.body.on('error', reject);
      fileStream.on('finish', resolve);
    });
    // Stream the file to the client
    res.set('Content-Type', gRes.headers.get('content-type') || 'audio/mpeg');
    res.set('Content-Disposition', `attachment; filename="${fileName}"`);
    const readStream = fs.createReadStream(tempPath);
    readStream.pipe(res);
    readStream.on('close', () => {
      fs.unlink(tempPath, () => {}); // Clean up temp file
    });
  } catch (err) {
    res.status(500).send('Proxy error: ' + err.message);
  }
});

app.listen(3003, () => console.log('Google Drive download server running on http://localhost:3003')); 