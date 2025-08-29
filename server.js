require('dotenv').config(); // This line loads the .env file

const express = require('express');
const cors = require('cors');
const formidable = require('formidable');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

const app = express();
app.use(cors());

// Use the PORT environment variable provided by Render, or 3000 for local development
const PORT = process.env.PORT || 3000;
const KLANGIO_API_BASE_URL = 'https://api.klang.io';

// --- Endpoint 1: Create a new transcription job ---
app.post('/transcribe', (req, res) => {
    const form = new formidable.IncomingForm();

    form.parse(req, async (err, fields, files) => {
        if (err) {
            console.error('Error parsing the form:', err);
            return res.status(500).json({ error: 'Error processing file upload.' });
        }
        
        // Read the API key from environment variables
        const apiKey = process.env.KLANGIO_API_KEY; 
        if (!apiKey) {
            console.error("API key is not set.");
            return res.status(500).json({ error: "API key is not configured on the server." });
        }

        try {
            const file = Array.isArray(files.file) ? files.file[0] : files.file;
            const instrument = Array.isArray(fields.instrument) ? fields.instrument[0] : fields.instrument;
            const rawOutputs = Array.isArray(fields.outputs) ? fields.outputs : [fields.outputs];
            const outputs = rawOutputs.map(output => output === 'xml' ? 'mxml' : output);

            if (!file) return res.status(400).json({ error: 'No file was uploaded.' });
            if (!instrument) return res.status(400).json({ error: 'No instrument was selected.' });
            if (!outputs || outputs.length === 0) return res.status(400).json({ error: 'No output format was selected.' });

            const formData = new FormData();
            formData.append('file', fs.createReadStream(file.filepath), file.originalFilename);
            outputs.forEach(output => formData.append('outputs', output));
            
            const klangioResponse = await axios.post(`${KLANGIO_API_BASE_URL}/transcription`, formData, {
                headers: {
                    ...formData.getHeaders(),
                    'kl-api-key': apiKey 
                },
                params: {
                    'model': instrument
                }
            });
            
            res.json(klangioResponse.data);

        } catch (error) {
            console.error('Error creating Klangio job:', error.response ? error.response.data : error.message);
            res.status(error.response ? error.response.status : 500).json({
                error: 'Failed to create transcription job.',
                details: error.response ? error.response.data : 'An unknown error occurred.'
            });
        }
    });
});

// --- Endpoint 2: Check the status of a job ---
app.get('/status/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const apiKey = process.env.KLANGIO_API_KEY;

    try {
        const statusResponse = await axios.get(`${KLANGIO_API_BASE_URL}/job/${jobId}/status`, {
            headers: { 'kl-api-key': apiKey }
        });
        res.json(statusResponse.data);
    } catch (error) {
        console.error('Error checking job status:', error.response ? error.response.data : error.message);
        res.status(error.response ? error.response.status : 500).json({
            error: 'Failed to check job status.',
            details: error.response ? error.response.data : 'An unknown error occurred.'
        });
    }
});

// --- Endpoint 3: Get the final result file ---
app.get('/result/:jobId/:format', async (req, res) => {
    const { jobId, format } = req.params;
    const apiKey = process.env.KLANGIO_API_KEY;

    const formatMap = {
        pdf: { ext: 'pdf', contentType: 'application/pdf', endpoint: 'pdf' },
        midi: { ext: 'mid', contentType: 'audio/midi', endpoint: 'midi' },
        xml: { ext: 'xml', contentType: 'application/xml', endpoint: 'mxml' }
    };

    const fileFormat = formatMap[format];
    if (!fileFormat) {
        return res.status(400).json({ error: 'Invalid format requested.' });
    }

    try {
        const resultResponse = await axios.get(`${KLANGIO_API_BASE_URL}/job/${jobId}/${fileFormat.endpoint}`, {
            headers: { 'kl-api-key': apiKey },
            responseType: 'stream'
        });
        
        res.setHeader('Content-Disposition', `attachment; filename="transcription-${jobId}.${fileFormat.ext}"`);
        res.setHeader('Content-Type', fileFormat.contentType);

        resultResponse.data.pipe(res);

    } catch (error) {
        console.error(`Error fetching result for format ${format}:`, error.message);
        
        if (error.response) {
            res.status(error.response.status).json({
                error: `API returned status ${error.response.status} for format '${format}'`,
                details: `Could not download the requested file.`
            });
        } else {
            res.status(500).json({
                error: `Failed to fetch transcription result for format: ${format}`,
                details: 'An unknown error occurred.'
            });
        }
    }
});

// Serve the index.html file for the root URL
app.use(express.static(__dirname));
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
