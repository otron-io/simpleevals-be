const { createClient } = require('@supabase/supabase-js');

// Create Supabase client for auth verification only
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Middleware to verify JWT token from Supabase
const verifyAuth = async (req, res, next) => {
  // Get the token from the request headers
  console.log('Verifying auth token...');
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // No token provided, this route can be accessed without authentication
    console.log('No auth token provided in headers');
    req.user = null;
    return next();
  }

  // Extract the token - validate token format
  const token = authHeader.split(' ')[1];
  if (!token || token.length < 20) {
    console.error('Invalid token format');
    req.user = null;
    return next();
  }

  // Only log first few characters for security
  console.log(`Auth token found: ${token.substring(0, 10)}...`);

  try {
    // Add timeout for token verification
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Token verification timed out')), 5000)
    );

    // Verify the JWT token using Supabase's admin API
    console.log('Verifying token with Supabase...');
    const authPromise = supabase.auth.getUser(token);

    // Race against timeout
    const { data: { user }, error } = await Promise.race([
      authPromise,
      timeoutPromise
    ]);

    if (error) {
      console.error('Auth verification error:', error.message);
      req.user = null;
    } else if (!user || !user.id) {
      console.error('Invalid user data returned');
      req.user = null;
    } else {
      // Token is valid, set the user in the request object
      // Only log minimal info for user privacy/security
      console.log(`User authenticated: ${user.id.substring(0, 8)}... (${user.email ? user.email.split('@')[0] + '@...' : 'no email'})`);
      req.user = user;
    }

    // Continue to the route handler
    next();
  } catch (error) {
    console.error('Unexpected error in auth middleware:', error.message);
    req.user = null;
    next();
  }
};

// Middleware to require authentication
const requireAuth = async (req, res, next) => {
  // First run the verification
  await verifyAuth(req, res, () => {});
  
  // Check if user exists in request
  if (!req.user) {
    return res.status(401).json({ 
      error: 'Authentication required',
      message: 'You must be logged in to access this resource' 
    });
  }
  
  // User is authenticated, continue
  next();
};

module.exports = {
  verifyAuth,
  requireAuth
};