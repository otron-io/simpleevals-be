# SimpleEvals Backend

A backend service for evaluating AI model responses against reference answers.

## Features

- Evaluate responses from multiple AI models (OpenAI, Anthropic Claude, Google Gemini) 
- Compare model outputs against reference answers
- Store evaluation results
- API endpoints for single and batch evaluations

## Setup

1. Clone the repository
```bash
git clone https://github.com/Arnasltlt/simpleevals-be.git
cd simpleevals-be
```

2. Install dependencies
```bash
npm install
```

3. Set up environment variables
```bash
cp .env.example .env
# Edit .env with your API keys
```

4. Start the server
```bash
npm run dev
```

## API Endpoints

- `POST /api/mvp/evaluate` - Evaluate a single question across models
- `POST /api/mvp/evaluate-set` - Evaluate multiple questions in batch
- `GET /api/mvp/sets` - Get all evaluation sets
- `GET /api/mvp/sets/:id` - Get a specific evaluation set
- `GET /api/mvp/share/:id` - Get a shareable evaluation set

## License

MIT
