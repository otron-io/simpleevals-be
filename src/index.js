const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { checkApiKeys } = require('./utils/apiKeyCheck');
const rateLimit = require('express-rate-limit');

const app = express();
const port = process.env.PORT || 3001;

// Check API keys at startup
checkApiKeys();

// Configure CORS for production and localhost
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://simpleevals.com'
];
app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      return callback(new Error('CORS policy: This origin is not allowed.'), false);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parse JSON bodies
app.use(express.json());

// Basic route
app.get('/', (req, res) => {
  res.send('SimpleEvals MVP Backend is running!');
});

// Simple test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'API test route is working!', timestamp: new Date().toISOString() });
});

// MVP API routes
const mvpRoutes = require('./routes/mvp');
app.use('/api/mvp', mvpRoutes);

const evaluateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 requests per windowMs
  message: 'Too many requests, please try again later.'
});
app.use('/api/mvp/evaluate-set', evaluateLimiter);

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
}); 