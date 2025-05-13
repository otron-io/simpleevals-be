const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { checkApiKeys } = require('./utils/apiKeyCheck');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet'); // You'll need to install this: npm install helmet

const app = express();
const port = process.env.PORT || 3001;

// Check API keys at startup
checkApiKeys();

// Add security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://simpleevals.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://simpleevals.com"],
      connectSrc: ["'self'", "https://simpleevals.com", "https://*.supabase.co"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  xssFilter: true,
  noSniff: true,
  referrerPolicy: { policy: 'same-origin' }
}));

// Configure CORS for production and localhost
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:4200', // For frontend dev server
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
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true, // Allow cookies for auth sessions if needed
  maxAge: 86400 // Cache preflight requests for 24 hours
}));

// Parse JSON bodies with size limits
app.use(express.json({ limit: '1mb' }));

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

// Define rate limiters
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs for general API
  message: 'Too many API requests, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

const evaluateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 evaluate requests per windowMs
  message: 'Too many evaluation requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to API routes
app.use('/api/', apiLimiter); // General API rate limit
app.use('/api/mvp/evaluate-set', evaluateLimiter); // Stricter limit for evaluations

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
}); 