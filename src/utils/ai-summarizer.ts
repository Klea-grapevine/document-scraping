import OpenAI from 'openai';

// Rough estimation: 1 token ≈ 4 characters for most text
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function chunkText(text: string, maxTokensPerChunk: number = 30000): string[] {
    const chunks: string[] = [];
    const maxCharsPerChunk = maxTokensPerChunk * 4; // Rough conversion
    
    if (text.length <= maxCharsPerChunk) {
        return [text];
    }
    
    // Split by documents first (using the separator from the main function)
    const documents = text.split(/\n--- Content from .+ ---\n/);
    
    let currentChunk = '';
    for (const doc of documents) {
        if (!doc.trim()) continue;
        
        // If adding this document would exceed the limit, start a new chunk
        if (currentChunk.length + doc.length > maxCharsPerChunk && currentChunk.length > 0) {
            chunks.push(currentChunk.trim());
            currentChunk = doc;
        } else {
            currentChunk += (currentChunk ? '\n\n' : '') + doc;
        }
    }
    
    // Add the last chunk if it has content
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }
    
    // If we still have chunks that are too large, split them further
    const finalChunks: string[] = [];
    for (const chunk of chunks) {
        if (chunk.length <= maxCharsPerChunk) {
            finalChunks.push(chunk);
        } else {
            // Split large chunks by paragraphs
            const paragraphs = chunk.split(/\n\s*\n/);
            let subChunk = '';
            
            for (const paragraph of paragraphs) {
                if (subChunk.length + paragraph.length > maxCharsPerChunk && subChunk.length > 0) {
                    finalChunks.push(subChunk.trim());
                    subChunk = paragraph;
                } else {
                    subChunk += (subChunk ? '\n\n' : '') + paragraph;
                }
            }
            
            if (subChunk.trim()) {
                finalChunks.push(subChunk.trim());
            }
        }
    }
    
    return finalChunks;
}

export async function summarizeText(text: string, promptPrefix: string = ''): Promise<string> {
    if (!text.trim()) {
        return '(AI Summary) Document appears to be empty or could not be parsed.';
    }

    // Check if OpenAI API key is available
    if (!process.env.OPENAI_API_KEY) {
        console.log('⚠️  OpenAI API key not found. Skipping AI summarization.');
        console.log('📝  To enable AI summarization, create a .env file with your OpenAI API key:');
        console.log('   OPENAI_API_KEY=your_api_key_here');
        console.log('   Get your API key from: https://platform.openai.com/api-keys');
        return `(Manual Summary) AI summarization disabled. Document content length: ${text.length} characters.\n\nFirst 1000 characters:\n${text.substring(0, 1000)}...`;
    }

    const estimatedTokens = estimateTokens(text + promptPrefix);
    console.log(`Estimated tokens for summarization: ${estimatedTokens}`);
    
    // If text is small enough, process directly
    if (estimatedTokens < 100000) { // Leave some buffer under the 128k limit
        try {
            const openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY || '',
            });
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{
                    role: "user",
                    content: `${promptPrefix}Please summarize the following document content:\n\n${text}`
                }],
            });
            return completion.choices[0].message.content || '(No summary generated)';
        } catch (error) {
            console.error('Error summarizing text with OpenAI:', error);
            // If it still fails, fall back to chunking
        }
    }
    
    // Text is too large, need to chunk it
    console.log('Text is too large for direct processing. Chunking into smaller pieces...');
    const chunks = chunkText(text);
    console.log(`Split into ${chunks.length} chunks for processing`);
    
    const chunkSummaries: string[] = [];
    
    for (let i = 0; i < chunks.length; i++) {
        console.log(`Processing chunk ${i + 1}/${chunks.length}...`);
        try {
            const openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY || '',
            });
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{
                    role: "user",
                    content: `Please provide a detailed summary of the following document content (chunk ${i + 1} of ${chunks.length}):\n\n${chunks[i]}`
                }],
            });
            const summary = completion.choices[0].message.content || '(No summary generated)';
            chunkSummaries.push(`--- Chunk ${i + 1} Summary ---\n${summary}`);
        } catch (error) {
            console.error(`Error summarizing chunk ${i + 1}:`, error);
            chunkSummaries.push(`--- Chunk ${i + 1} Summary ---\n(Error processing this chunk)`);
        }
        
        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Now create a final consolidated summary from the chunk summaries
    const consolidatedText = chunkSummaries.join('\n\n');
    console.log('Creating final consolidated summary from chunk summaries...');
    
    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY || '',
        });
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{
                role: "user",
                content: `${promptPrefix}Please create a consolidated summary from the following chunk summaries:\n\n${consolidatedText}`
            }],
        });
        return completion.choices[0].message.content || '(No consolidated summary generated)';
    } catch (error) {
        console.error('Error creating consolidated summary:', error);
        return `(Partial Summary) Unable to create final consolidated summary. Here are the individual chunk summaries:\n\n${consolidatedText}`;
    }
}
