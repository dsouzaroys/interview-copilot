import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { env } from '../config/env';
import { EMBEDDING_DIMENSIONS } from '../rag/embeddings';

async function createVectorIndex() {
  console.log('🔧 Creating Atlas Vector Search index...\n');

  await mongoose.connect(env.MONGODB_URI, { dbName: 'interview-copilot' });
  console.log('✅ MongoDB connected\n');

  const db = mongoose.connection.db;
  if (!db) throw new Error('No database connection');

  const indexDefinition = {
    name: 'question_vector_index',
    type: 'vectorSearch',
    definition: {
      fields: [
        {
          type: 'vector',
          path: 'embedding',
          numDimensions: EMBEDDING_DIMENSIONS, // 768 for text-embedding-001
          similarity: 'cosine',
        },
        {
          type: 'filter',
          path: 'interviewType',
        },
        {
          type: 'filter',
          path: 'difficulty',
        },
        {
          type: 'filter',
          path: 'tags',
        },
        {
          type: 'filter',
          path: 'questionType',
        },
      ],
    },
  };

  try {
    // Check if index already exists
    const collection = db.collection('questions');
    const existingIndexes = await collection.listSearchIndexes().toArray();
    const exists = existingIndexes.some((idx) => idx['name'] === 'question_vector_index');

    if (exists) {
      console.log('⚠️  Index "question_vector_index" already exists. Dropping and recreating...');
      await collection.dropSearchIndex('question_vector_index');
      await new Promise((r) => setTimeout(r, 2000)); // Wait for drop to propagate
    }

    await collection.createSearchIndex(indexDefinition);

    console.log('✅ Vector Search index created successfully!');
    console.log('');
    console.log('Index details:');
    console.log(`  Name:       question_vector_index`);
    console.log(`  Dimensions: ${EMBEDDING_DIMENSIONS} (Google text-embedding-001)`);
    console.log(`  Similarity: cosine`);
    console.log(`  Filters:    interviewType, difficulty, questionType, tags`);
    console.log('');
    console.log('⏳ Note: Index may take 1-2 minutes to become active on Atlas.');
    console.log('   You can monitor status in Atlas UI → Search → Indexes');
  } catch (err) {
    console.error('❌ Failed to create index:', err);
    console.log('');
    console.log('Manual alternative — run this in Atlas UI → Collections → Search Indexes:');
    console.log(JSON.stringify(indexDefinition, null, 2));
  }

  await mongoose.disconnect();
  process.exit(0);
}

createVectorIndex().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
