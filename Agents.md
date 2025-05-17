# SimpleEvals Backend - Technical Documentation

## Overview

The SimpleEvals backend is a Node.js Express application that acts as the API server for the SimpleEvals platform. It handles AI model evaluations, integrates with Supabase for data persistence, and implements authentication middleware for securing endpoints.

## Architecture

### Technologies Used

- **Node.js**: Runtime environment
- **Express**: Web framework
- **Supabase**: Authentication and database
- **OpenAI**, **Anthropic**, **Google Generative AI**: AI model integrations via OpenRouter API

### Key Components

- **Controllers**:
  - `mvpController.js`: Main controller handling evaluation logic
  
- **Routes**:
  - `mvp.js`: Defines API routes for evaluation features
  
- **Middleware**:
  - `auth.js`: Authentication middleware using Supabase JWT verification

- **Utils**:
  - `apiKeyCheck.js`: API key validation
  - `testModelAPIs.js`: Testing utilities for model integrations

## Supabase Integration

### Authentication

The backend uses Supabase for user authentication validation. The authentication flow works as follows:

1. JWT tokens are passed from the frontend in the `Authorization` header
2. The `auth.js` middleware validates these tokens with Supabase's auth API
3. User information is attached to the request object for use in protected routes

```javascript
// Verify JWT token from Supabase
const verifyAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error) {
      console.error('Auth verification error:', error.message);
      req.user = null;
    } else if (!user || !user.id) {
      console.error('Invalid user data returned');
      req.user = null;
    } else {
      req.user = user;
    }
    
    next();
  } catch (error) {
    req.user = null;
    next();
  }
};
```

### Database Access

The backend uses Supabase as its primary database with the following schema:

#### Evaluations Table
- **id**: UUID, primary key
- **name**: text, name of the evaluation
- **created_at**: timestamp with time zone
- **models**: jsonb, containing model configurations
- **questions**: jsonb, containing evaluation questions
- **results**: jsonb, containing evaluation results
- **user_id**: UUID, foreign key to auth.users
- **evaluate_automatically**: boolean
- **updated_at**: timestamp with time zone

Row Level Security (RLS) is enabled on the evaluations table to ensure users can only access their own data.

### Database Operations

The backend performs the following operations with Supabase:

1. **Create Evaluations**: 
```javascript
const { data, error } = await supabase
  .from("evaluations")
  .insert(insertData)
  .select("id")
  .single();
```

2. **Retrieve Evaluations**: 
```javascript
const { data, error } = await supabase
  .from("evaluations")
  .select("*")
  .eq("user_id", req.user.id)
  .order('created_at', { ascending: false })
  .range(from, to);
```

3. **Update Evaluations**: 
```javascript
const { error: updateError } = await supabase
  .from("evaluations")
  .update({ 
    questions: preparedEvaluation.questions,
    updated_at: new Date().toISOString()
  })
  .eq("id", evaluationId);
```

## AI Model Integration

The backend integrates with multiple AI models (OpenAI, Anthropic, Google) via the OpenRouter API for consistent access and formatting. The system provides:

1. Question answering with multiple models
2. Automatic evaluation of model responses
3. Manual evaluation capabilities

## Data Flow

1. **User Request**: Frontend sends evaluation request with question, reference answer, and selected models
2. **Model Processing**: Backend fetches responses from selected AI models
3. **Evaluation**: Responses are evaluated automatically or marked for manual review
4. **Storage**: Results are stored both in-memory and in Supabase
5. **Response**: Complete results are returned to the frontend

## Dual Storage Architecture

The system uses both in-memory storage and Supabase:

1. **In-Memory Store**: For quick access and development purposes
2. **Supabase Database**: For persistence and sharing

When evaluations are created, they are first stored in memory, then persisted to Supabase, and the in-memory record is updated with the Supabase ID.

## Deployment

The application is configured for deployment on various platforms, including Heroku (as indicated by the Procfile).