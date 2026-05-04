import { chatWithOllama, streamOllamaChat } from '../services/ollamaService.js';
import {Chat} from '../models/Chat.js';

const ALLOWED_MODELS = ['mistral', 'llama3', 'qwen:latest'];
const MAX_MSG_LENGTH = 4096;

// Helper: Validate and normalize
function validateAIInput(messages, model) {
    if (!model || !ALLOWED_MODELS.includes(model))
        return { error: `Invalid or unsupported model. Allowed: ${ALLOWED_MODELS.join(', ')}` };
    if (!Array.isArray(messages) || !messages.length)
        return { error: "messages array is required and must not be empty" };
    for (const m of messages) {
        if (!m.role || typeof m.content !== 'string' || m.content.length > MAX_MSG_LENGTH)
            return { error: `Each message must have role and content <= ${MAX_MSG_LENGTH} chars` };
    }
    return {};
}

// --- Non-streaming ---
export const aiChat = async (req, res) => {
    const { messages, model } = req.body;
    const { error } = validateAIInput(messages, model);
    if (error) return res.status(400).json({ error });

    try {
        // Save user prompt(s) to DB before calling LLM
        const chat = new Chat({
            userId: req.user.id,
            messages: messages.map(m => ({
                text: m.content,
                role: m.role,
                model
            }))
        });
        await chat.save();

        // Call AI model
        const response = await chatWithOllama({ model, messages });

        // Optionally: Save AI response as new message in chat
        if (response?.message?.content) {
            chat.messages.push({
                text: response.message.content,
                role: 'assistant',
                model
            });
            await chat.save();
        }

        // Return full response (incl. model metadata, etc)
        res.json(response);
    } catch (err) {
        console.error('AI chat error:', err);
        res.status(500).json({ error: err.response?.data?.error || err.message });
    }
};

export const aiStream = async (req, res) => {
    const { messages, model } = req.body;
    const { error } = validateAIInput(messages, model);
    if (error) {
        res.writeHead(400, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ error })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    let aiResponseContent = '';
    const safeEnd = () => { try { res.write('data: [DONE]\n\n'); res.end(); } catch {} };

    req.on('close', safeEnd);

    await streamOllamaChat({
        model,
        messages,
        onDelta: (delta) => {
            aiResponseContent += delta;
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        },
                onEnd: async () => {
            res.write('data: [DONE]\n\n');
            res.end();

            // Optional: Save both sides to DB after full generation
            try {
                const chat = new Chat({
                    userId: req.user.id,
                    messages: [
                        ...messages.map(m => ({
                            text: m.content,
                            role: m.role,
                            model
                        })),
                        {
                            text: aiResponseContent,
                            role: 'assistant',
                            model
                        }
                    ]
                });
                await chat.save();
            } catch (err) {
                // Non-fatal; log but don't break streaming
                console.error('DB save failed after streaming:', err);
            }
        },
        onError: (err) => {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            safeEnd();
        }
    });
};