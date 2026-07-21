// api/proxy.js — Vercel Serverless Function
// Runs on Vercel's server. The Gemini key NEVER reaches the browser.

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const { prompt, history, category, style, difficulty } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt in request body.' });
  }

  // Build the system prompt for Gemini
  const systemPrompt = `You are Campfire Narrator, a master storyteller. 
Create immersive ${style || 'cinematic'} ${category || 'fantasy'} story content.
Never break character. Never mention you are AI. Never say "as an AI".
Write 2-3 vivid, sensory paragraphs. End with exactly 3 choices labeled A), B), C).
Keep responses under 800 tokens.`;

  const fullPrompt = history 
    ? `${systemPrompt}\n\nStory so far:\n${history}\n\nPlayer chooses: "${prompt}"\n\nContinue the story:`
    : `${systemPrompt}\n\nBegin the adventure:\n${prompt}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
          generationConfig: {
            temperature: 0.9,
            maxOutputTokens: 800,
            topP: 0.95,
            topK: 40
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
          ]
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Gemini API Error]', response.status, errorText);
      throw new Error(`Gemini API returned ${response.status}`);
    }

    const data = await response.json();
    
    // Handle blocked content
    if (data.promptFeedback?.blockReason) {
      return res.status(200).json({
        narration: "The path ahead remains shrouded in mist. The ancient voices hesitate to speak further. What do you do?",
        choices: [
          "Press forward with determination",
          "Wait and listen to the silence",
          "Search for another way around"
        ],
        blocked: true
      });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'The story continues...';

    // Parse choices (A), B), C))
    const choiceMatches = text.match(/[A-C][\).]\s*(.+)/g) || [];
    const choices = choiceMatches.map(c => c.replace(/^[A-C][\).]\s*/, '').trim());

    // Clean narration (remove choice lines)
    let narration = text;
    choiceMatches.forEach(c => {
      narration = narration.replace(c, '');
    });
    narration = narration.replace(/[A-C]\)/g, '').trim();

    // If no choices parsed, provide defaults
    if (choices.length === 0) {
      choices.push(
        "Investigate your surroundings",
        "Call out to anyone nearby",
        "Proceed with caution"
      );
    }

    res.status(200).json({
      success: true,
      narration,
      choices,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Proxy Error]', error);
    
    // Graceful fallback — app never breaks
    res.status(200).json({
      success: true,
      fallback: true,
      narration: "The path ahead shimmers with possibility, though the ancient voices remain silent for now. A cool breeze carries the scent of pine and distant smoke. What do you do?",
      choices: [
        "Press forward boldly",
        "Wait and observe your surroundings",
        "Try a different approach"
      ]
    });
  }
}
