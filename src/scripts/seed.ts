import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { readFileSync } from 'fs';
import { join } from 'path';
import { env } from '../config/env';
import { Question } from '../models/question.model';
import { embedDocument } from '../rag/embeddings';

interface RawQuestion {
  id: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  interviewType: 'dsa' | 'backend' | 'system-design';
  questionText: string;
  idealAnswer: string;
  keyConcepts: string[];
  tags: string[];
  followUpHints: string[];
}

async function seed() {
  console.log('🌱 Seeding knowledge base...\n');

  await mongoose.connect(env.MONGODB_URI, { dbName: 'interview-copilot' });
  console.log('✅ MongoDB connected\n');

  const files = ['dsa.json', 'backend.json', 'system-design.json'];
  const dataDir = join(__dirname, '../../data/questions');

  let totalSeeded = 0;
  let totalSkipped = 0;

  for (const file of files) {
    const filePath = join(dataDir, file);
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as RawQuestion[];

    console.log(`📂 Processing ${file} (${raw.length} questions)...`);

    for (let i = 0; i < raw.length; i++) {
      const q = raw[i];
      if (!q) continue;
      // Check if already seeded
      const existing = await Question.findOne({ questionId: q.id });
      if (existing?.embedding && existing.embedding.length > 0) {
        console.log(`  ⏭️  [${i + 1}/${raw.length}] Skipping "${q.topic}" (already embedded)`);
        totalSkipped++;
        continue;
      }

      // Embed: question text + key concepts for richer semantic matching
      const textToEmbed = `${q.questionText}\n\nKey concepts: ${q.keyConcepts.join(', ')}\n\nTopic: ${q.topic}`;

      try {
        const embedding = await embedDocument(textToEmbed);

        await Question.findOneAndUpdate(
          { questionId: q.id },
          {
            questionId: q.id,
            topic: q.topic,
            difficulty: q.difficulty,
            interviewType: q.interviewType,
            questionText: q.questionText,
            idealAnswer: q.idealAnswer,
            keyConcepts: q.keyConcepts,
            tags: q.tags,
            followUpHints: q.followUpHints,
            embedding,
          },
          { upsert: true }
        );

        console.log(`  ✅ [${i + 1}/${raw.length}] "${q.topic}" — ${q.difficulty}`);
        totalSeeded++;

        // Small delay between embedding calls to avoid rate limits
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        console.error(`  ❌ Failed to embed "${q.topic}":`, err);
      }
    }

    console.log('');
  }

  console.log('══════════════════════════════════');
  console.log(`✅ Seeding complete!`);
  console.log(`   Seeded:  ${totalSeeded} questions`);
  console.log(`   Skipped: ${totalSkipped} questions (already embedded)`);
  console.log('══════════════════════════════════');
  console.log('');
  console.log('Next: Run `npm run setup-index` to create the Atlas Vector Search index');

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
