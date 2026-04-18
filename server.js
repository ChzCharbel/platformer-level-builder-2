require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { processLevelImage }       = require('./src/levelConverter');
const { verifyLevelSolvability }  = require('./src/verificationEngine');

const app    = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));

// POST /upload — convert image → level JSON
app.post('/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });

  try {
    const level = await processLevelImage(req.file.buffer);
    fs.writeFileSync(path.join(__dirname, 'level_output.json'), JSON.stringify(level, null, 2));
    res.json(level);
  } catch (err) {
    console.error('Conversion error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /verify — stream K2 reasoning trace + final solvability verdict via SSE
app.post('/verify', async (req, res) => {
  const { grid, physicsParams } = req.body;

  if (!Array.isArray(grid) || grid.length === 0) {
    return res.status(400).json({ error: 'No grid provided.' });
  }

  // Server-Sent Events headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    for await (const chunk of verifyLevelSolvability(grid, physicsParams || {})) {
      if (chunk.type === 'thinking') {
        send('thinking', { text: chunk.text });
      } else if (chunk.type === 'answer') {
        send('answer',   { text: chunk.text });
      } else if (chunk.type === 'done') {
        send('result',   chunk.result);
      }
    }
  } catch (err) {
    console.error('Verification error:', err.message);
    send('error', { message: err.message });
  }

  res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
