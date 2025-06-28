{\rtf1\ansi\ansicpg1252\cocoartf2822
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 const express = require('express');\
const multer = require('multer');\
const cors = require('cors');\
const \{ OpenAI \} = require('openai');\
const Anthropic = require('@anthropic-ai/sdk');\
const pdf = require('pdf-parse');\
const mammoth = require('mammoth');\
const \{ Pool \} = require('pg');\
const \{ v4: uuidv4 \} = require('uuid');\
require('dotenv').config();\
\
const app = express();\
const port = process.env.PORT || 3001;\
\
// Middleware\
app.use(cors());\
app.use(express.json(\{ limit: '50mb' \}));\
\
// File upload\
const upload = multer(\{ \
  storage: multer.memoryStorage(),\
  limits: \{ fileSize: 50 * 1024 * 1024 \}\
\});\
\
// Database connection\
const pool = new Pool(\{\
  connectionString: process.env.DATABASE_URL,\
  ssl: process.env.NODE_ENV === 'production' ? \{ rejectUnauthorized: false \} : false\
\});\
\
// AI clients\
const openai = new OpenAI(\{ apiKey: process.env.OPENAI_API_KEY \});\
const anthropic = new Anthropic(\{ apiKey: process.env.ANTHROPIC_API_KEY \});\
\
// Initialize database\
async function initDB() \{\
  const client = await pool.connect();\
  try \{\
    await client.query(`\
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";\
      \
      CREATE TABLE IF NOT EXISTS projects (\
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),\
        name VARCHAR(255) NOT NULL,\
        created_at TIMESTAMP DEFAULT NOW(),\
        metadata JSONB DEFAULT '\{\}'\
      );\
\
      CREATE TABLE IF NOT EXISTS documents (\
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),\
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,\
        category VARCHAR(50) NOT NULL,\
        filename VARCHAR(255) NOT NULL,\
        content_text TEXT,\
        file_metadata JSONB DEFAULT '\{\}',\
        uploaded_at TIMESTAMP DEFAULT NOW()\
      );\
\
      CREATE TABLE IF NOT EXISTS analyses (\
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),\
        document_id UUID REFERENCES documents(id) ON DELETE CASCADE,\
        category VARCHAR(50) NOT NULL,\
        prompt_text TEXT NOT NULL,\
        response_text TEXT NOT NULL,\
        created_at TIMESTAMP DEFAULT NOW()\
      );\
\
      CREATE TABLE IF NOT EXISTS ideas (\
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),\
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,\
        idea_text TEXT NOT NULL,\
        generation_method VARCHAR(100),\
        desirability_score FLOAT DEFAULT 0,\
        viability_score FLOAT DEFAULT 0,\
        feasibility_score FLOAT DEFAULT 0,\
        overall_score FLOAT DEFAULT 0,\
        created_at TIMESTAMP DEFAULT NOW()\
      );\
    `);\
    console.log('\uc0\u9989  Database initialized');\
  \} catch (error) \{\
    console.error('\uc0\u10060  Database init error:', error);\
  \} finally \{\
    client.release();\
  \}\
\}\
\
// Basic prompts\
const prompts = \{\
  desirability: [\
    "Analyze the user needs and pain points in this document. What problems are being addressed?",\
    "Evaluate the target market and customer segments. How well-defined is the audience?",\
    "Assess the value proposition. How compelling is the solution for users?"\
  ],\
  viability: [\
    "Analyze the business model and revenue streams described.",\
    "Evaluate the cost structure and financial projections mentioned.",\
    "Assess the market opportunity and scalability potential."\
  ],\
  feasibility: [\
    "Analyze the technical requirements and implementation approach.",\
    "Evaluate the resource requirements (team, budget, timeline).",\
    "Assess the technical risks and challenges identified."\
  ]\
\};\
\
// Extract text from files\
async function extractText(file) \{\
  try \{\
    if (file.mimetype === 'application/pdf') \{\
      const data = await pdf(file.buffer);\
      return data.text;\
    \} else if (file.mimetype.includes('word')) \{\
      const result = await mammoth.extractRawText(\{ buffer: file.buffer \});\
      return result.value;\
    \} else if (file.mimetype === 'text/plain') \{\
      return file.buffer.toString('utf-8');\
    \} else \{\
      return `File: $\{file.originalname\}\\nContent extraction not supported for this file type.`;\
    \}\
  \} catch (error) \{\
    return `File: $\{file.originalname\}\\nError extracting content: $\{error.message\}`;\
  \}\
\}\
\
// Call AI\
async function callAI(prompt, content) \{\
  try \{\
    if (process.env.OPENAI_API_KEY) \{\
      const response = await openai.chat.completions.create(\{\
        model: 'gpt-4',\
        messages: [\
          \{ role: 'system', content: 'You are an expert business analyst.' \},\
          \{ role: 'user', content: `$\{prompt\}\\n\\nDocument content:\\n$\{content\}` \}\
        ],\
        max_tokens: 1000,\
        temperature: 0.7\
      \});\
      return response.choices[0].message.content;\
    \} else \{\
      // Demo response if no API key\
      return `Demo analysis for: $\{prompt.substring(0, 50)\}...\\n\\nThis is a simulated response. The document appears to address relevant business considerations with moderate strength in this area.`;\
    \}\
  \} catch (error) \{\
    console.error('AI call error:', error);\
    return `Analysis error: $\{error.message\}`;\
  \}\
\}\
\
// Routes\
app.get('/', (req, res) => \{\
  res.json(\{ message: '\uc0\u55357 \u56960  AI Innovation Platform Backend is running!' \});\
\});\
\
app.get('/api/projects', async (req, res) => \{\
  try \{\
    const client = await pool.connect();\
    const result = await client.query('SELECT * FROM projects ORDER BY created_at DESC');\
    client.release();\
    res.json(result.rows);\
  \} catch (error) \{\
    console.error('Get projects error:', error);\
    res.status(500).json(\{ error: error.message \});\
  \}\
\});\
\
app.post('/api/projects', async (req, res) => \{\
  try \{\
    const \{ name \} = req.body;\
    const client = await pool.connect();\
    const result = await client.query(\
      'INSERT INTO projects (name) VALUES ($1) RETURNING *',\
      [name]\
    );\
    client.release();\
    res.json(result.rows[0]);\
  \} catch (error) \{\
    console.error('Create project error:', error);\
    res.status(500).json(\{ error: error.message \});\
  \}\
\});\
\
app.post('/api/projects/:projectId/documents', upload.array('files'), async (req, res) => \{\
  try \{\
    const \{ projectId \} = req.params;\
    const \{ category \} = req.body;\
    const files = req.files;\
    \
    const uploadedDocs = [];\
    const client = await pool.connect();\
    \
    for (const file of files) \{\
      const textContent = await extractText(file);\
      \
      const result = await client.query(\
        'INSERT INTO documents (project_id, category, filename, content_text, file_metadata) VALUES ($1, $2, $3, $4, $5) RETURNING *',\
        [projectId, category, file.originalname, textContent, JSON.stringify(\{ size: file.size, mimetype: file.mimetype \})]\
      );\
      \
      uploadedDocs.push(result.rows[0]);\
    \}\
    \
    client.release();\
    res.json(uploadedDocs);\
  \} catch (error) \{\
    console.error('Upload error:', error);\
    res.status(500).json(\{ error: error.message \});\
  \}\
\});\
\
app.post('/api/projects/:projectId/analyze', async (req, res) => \{\
  try \{\
    const \{ projectId \} = req.params;\
    const client = await pool.connect();\
    \
    // Get documents\
    const docsResult = await client.query(\
      'SELECT * FROM documents WHERE project_id = $1',\
      [projectId]\
    );\
    \
    const results = \{\};\
    \
    for (const doc of docsResult.rows) \{\
      const categoryPrompts = prompts[doc.category] || prompts.desirability;\
      results[doc.category] = results[doc.category] || [];\
      \
      for (const prompt of categoryPrompts) \{\
        const response = await callAI(prompt, doc.content_text);\
        \
        await client.query(\
          'INSERT INTO analyses (document_id, category, prompt_text, response_text) VALUES ($1, $2, $3, $4)',\
          [doc.id, doc.category, prompt, response]\
        );\
        \
        results[doc.category].push(\{\
          documentName: doc.filename,\
          prompt,\
          response\
        \});\
      \}\
    \}\
    \
    client.release();\
    res.json(results);\
  \} catch (error) \{\
    console.error('Analysis error:', error);\
    res.status(500).json(\{ error: error.message \});\
  \}\
\});\
\
app.post('/api/projects/:projectId/ideate', async (req, res) => \{\
  try \{\
    const \{ projectId \} = req.params;\
    const \{ ideasPerInsight = 5 \} = req.body;\
    \
    // Get recent analyses\
    const client = await pool.connect();\
    const analysesResult = await client.query(\
      'SELECT DISTINCT response_text FROM analyses a JOIN documents d ON a.document_id = d.id WHERE d.project_id = $1',\
      [projectId]\
    );\
    \
    const ideas = [];\
    \
    // Generate ideas from analyses\
    for (const analysis of analysesResult.rows.slice(0, 10)) \{ // Limit for demo\
      const ideaPrompt = `Based on this insight: "$\{analysis.response_text\}", generate $\{ideasPerInsight\} innovative solution ideas.`;\
      const ideaResponse = await callAI(ideaPrompt, '');\
      \
      // Split response into individual ideas\
      const ideaList = ideaResponse.split('\\n').filter(line => line.trim().length > 20);\
      \
      for (const idea of ideaList.slice(0, ideasPerInsight)) \{\
        const result = await client.query(\
          'INSERT INTO ideas (project_id, idea_text, generation_method) VALUES ($1, $2, $3) RETURNING *',\
          [projectId, idea.trim(), 'analysis_based']\
        );\
        ideas.push(result.rows[0]);\
      \}\
    \}\
    \
    client.release();\
    res.json(\{ generatedIdeas: ideas.length, ideas \});\
  \} catch (error) \{\
    console.error('Ideation error:', error);\
    res.status(500).json(\{ error: error.message \});\
  \}\
\});\
\
app.post('/api/projects/:projectId/evaluate', async (req, res) => \{\
  try \{\
    const \{ projectId \} = req.params;\
    const client = await pool.connect();\
    \
    const ideasResult = await client.query(\
      'SELECT * FROM ideas WHERE project_id = $1 AND desirability_score = 0',\
      [projectId]\
    );\
    \
    for (const idea of ideasResult.rows) \{\
      // Generate random scores for demo (replace with real AI evaluation)\
      const desirability = Math.random() * 3 + 7; // 7-10 range\
      const viability = Math.random() * 3 + 6; // 6-9 range  \
      const feasibility = Math.random() * 3 + 5; // 5-8 range\
      const overall = (desirability + viability + feasibility) / 3;\
      \
      await client.query(\
        'UPDATE ideas SET desirability_score = $1, viability_score = $2, feasibility_score = $3, overall_score = $4 WHERE id = $5',\
        [desirability, viability, feasibility, overall, idea.id]\
      );\
    \}\
    \
    client.release();\
    res.json(\{ evaluated: ideasResult.rows.length \});\
  \} catch (error) \{\
    console.error('Evaluation error:', error);\
    res.status(500).json(\{ error: error.message \});\
  \}\
\});\
\
app.get('/api/projects/:projectId/top-ideas', async (req, res) => \{\
  try \{\
    const \{ projectId \} = req.params;\
    const \{ limit = 20 \} = req.query;\
    \
    const client = await pool.connect();\
    const result = await client.query(\
      'SELECT * FROM ideas WHERE project_id = $1 AND overall_score > 0 ORDER BY overall_score DESC LIMIT $2',\
      [projectId, limit]\
    );\
    client.release();\
    \
    res.json(result.rows);\
  \} catch (error) \{\
    console.error('Top ideas error:', error);\
    res.status(500).json(\{ error: error.message \});\
  \}\
\});\
\
// Start server\
app.listen(port, async () => \{\
  console.log(`\uc0\u55357 \u56960  Server running on port $\{port\}`);\
  await initDB();\
  console.log('\uc0\u9989  AI Innovation Platform ready!');\
\});}