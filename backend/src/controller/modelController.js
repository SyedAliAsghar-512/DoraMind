import { listModels, pullModel, deleteModel, checkOllamaHealth } from '../services/ollamaService.js';

/**
 * GET /api/models
 * Returns all installed models with capability metadata.
 */
export async function getModels(req, res) {
  const health = await checkOllamaHealth();
  if (!health.healthy) {
    return res.status(503).json({
      error: 'Ollama is not reachable. Please ensure Ollama is running.',
      details: health.error,
    });
  }

  const models = await listModels(req.query.refresh === 'true');
  res.json({ models, ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434' });
}

/**
 * GET /api/models/health
 * Quick Ollama health check.
 */
export async function getHealth(req, res) {
  const health = await checkOllamaHealth();
  res.status(health.healthy ? 200 : 503).json(health);
}

/**
 * POST /api/models/pull
 * Pull a new model from Ollama registry. Streams progress.
 * Body: { model: "llama3:8b" }
 */
export async function pullModelController(req, res) {
  const { model } = req.body;
  if (!model || typeof model !== 'string') {
    return res.status(400).json({ error: 'model name is required' });
  }

  // Validate model name format (basic sanity check)
  if (!/^[a-z0-9._\-:]+$/i.test(model)) {
    return res.status(400).json({ error: 'Invalid model name format' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    for await (const event of pullModel(model)) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.status === 'success') break;
    }
    res.write('data: {"status":"done"}\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ status: 'error', error: err.message })}\n\n`);
    res.end();
  }
}

/**
 * DELETE /api/models/:model
 * Delete a model from Ollama.
 */
export async function deleteModelController(req, res) {
  const model = decodeURIComponent(req.params.model);
  if (!model) return res.status(400).json({ error: 'model name required' });

  try {
    await deleteModel(model);
    res.json({ ok: true, deleted: model });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}