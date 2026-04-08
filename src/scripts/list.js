const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
async function getModels() {
  const models = await ai.models.list();
  const found = [];
  for await (const m of models) {
    if (m.name.includes('embed')) found.push(m.name);
  }
  console.log('Embedding models via list():', found);
}
getModels().catch(console.error);
