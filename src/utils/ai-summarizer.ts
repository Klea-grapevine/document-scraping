import OpenAI from 'openai';

// A strict output template to force exhaustive, structured extraction in German
const STRICT_OUTPUT_TEMPLATE = `
**Übersicht:**
- Abgabefrist: <Datum, Uhrzeit oder "Nicht angegeben">
- Budget/Finanzvolumen: <konkrete Beträge/Spannen oder "Nicht angegeben">
- Vertragslaufzeit: <konkrete Dauer/Start-Ende oder "Nicht angegeben">
- Vergabeart: <z. B. VgV, Verhandlungsverfahren mit Teilnahmewettbewerb oder "Nicht angegeben">
- Status: <Status oder "Nicht angegeben">
- Projekt-ID/Referenz: <ID/Referenz oder "Nicht angegeben">

**Zusammenfassung:**

**Geforderte Leistungen**
- <Jeden geforderten Leistungsbaustein als einzelnen Punkt exakt benennen>

**Eignungskriterien**
- <Alle Mindestanforderungen, Nachweise, Erfahrungen, Umsätze, Versicherungen, Zertifikate – jeweils als eigene Punkte mit genauen Zahlen/Zeiträumen>

**Zuschlagskriterien**
Qualität (<Gesamt max. Punkte falls angegeben>, Gewichtung <xx% falls angegeben>)
- <Unterkriterium 1> (max. <Punkte> Punkte, Gewichtung <xx% falls angegeben>)
- <Unterkriterium 2> (max. <Punkte> Punkte, Gewichtung <xx% falls angegeben>)
  - <Sub-Teil falls vorhanden> (max. <Punkte> Punkte)

Preis (<Gesamt max. Punkte falls angegeben>, Gewichtung <xx% falls angegeben>)
- <Preisbaustein 1> (max. <Punkte> Punkte, Gewichtung <xx% falls angegeben>)
- <Preisbaustein 2> (max. <Punkte> Punkte, Gewichtung <xx% falls angegeben>)

Hinweise zur Bewertung/Scoring
- <Methodik/Notenskalen/Schwellenwerte genau wiedergeben>

**Einzureichende Unterlagen**
- <Jedes Dokument/Formular/Nachweis als eigener Punkt>

**Formalitäten und Besonderheiten**
- <Abgabemodalitäten, Formvorschriften, Fristen, Losaufteilungen, Bieterfragen etc.>

**Kommunikation und Teilnahme**
- <Kommunikationskanäle, Registrierungs-/Teilnahmeschritte, Angebotsabgabe>
`;

// Function to generate a manual summary with detailed extraction
function generateManualSummary(text: string): string {
    const lines = text.split('\n');
    let summary = '';
    
    // Extract key sections
    const sections: { [key: string]: string[] } = {
        'Übersicht': [],
        'Zuschlagskriterien': [],
        'Eignungskriterien': [],
        'Einzureichende Unterlagen': [],
        'Formalitäten': []
    };
    
    let currentSection = '';
    let inZuschlagskriterien = false;
    let inEignungskriterien = false;
    let inUnterlagen = false;
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        // Detect sections
        if (trimmedLine.toUpperCase().includes('ZUSCHLAGSKRITERIEN')) {
            currentSection = 'Zuschlagskriterien';
            inZuschlagskriterien = true;
            inEignungskriterien = false;
            inUnterlagen = false;
            sections[currentSection].push(trimmedLine);
        } else if (trimmedLine.toUpperCase().includes('EIGNUNGSKRITERIEN')) {
            currentSection = 'Eignungskriterien';
            inZuschlagskriterien = false;
            inEignungskriterien = true;
            inUnterlagen = false;
            sections[currentSection].push(trimmedLine);
        } else if (trimmedLine.toUpperCase().includes('EINZUREICHENDE UNTERLAGEN') || 
                   trimmedLine.toUpperCase().includes('UNTERLAGEN')) {
            currentSection = 'Einzureichende Unterlagen';
            inZuschlagskriterien = false;
            inEignungskriterien = false;
            inUnterlagen = true;
            sections[currentSection].push(trimmedLine);
        } else if (trimmedLine.toUpperCase().includes('ABGABEFRIST') || 
                   trimmedLine.toUpperCase().includes('BUDGET') || 
                   trimmedLine.toUpperCase().includes('VERTRAGSLAUFZEIT')) {
            currentSection = 'Übersicht';
            inZuschlagskriterien = false;
            inEignungskriterien = false;
            inUnterlagen = false;
            sections[currentSection].push(trimmedLine);
        } else if (inZuschlagskriterien && (trimmedLine.includes('Punkte') || 
                                           trimmedLine.includes('%') || 
                                           trimmedLine.includes('Gewichtung') ||
                                           trimmedLine.includes('max.'))) {
            sections['Zuschlagskriterien'].push(trimmedLine);
        } else if (inEignungskriterien && (trimmedLine.includes('-') || 
                                          trimmedLine.includes('Mindest') ||
                                          trimmedLine.includes('Nachweis'))) {
            sections['Eignungskriterien'].push(trimmedLine);
        } else if (inUnterlagen && (trimmedLine.includes('-') || 
                                   trimmedLine.includes('Nachweis'))) {
            sections['Einzureichende Unterlagen'].push(trimmedLine);
        }
    }
    
    // Build summary
    summary += '**Übersicht:**\n';
    if (sections['Übersicht'].length > 0) {
        summary += sections['Übersicht'].map(line => `• ${line}`).join('\n');
    } else {
        summary += '• Abgabefrist: Nicht angegeben\n';
        summary += '• Budget/Finanzvolumen: Nicht angegeben\n';
        summary += '• Vertragslaufzeit: Nicht angegeben\n';
    }
    
    summary += '\n\n**Zuschlagskriterien:**\n';
    if (sections['Zuschlagskriterien'].length > 0) {
        // Format Zuschlagskriterien with better structure
        let inQualitaet = false;
        let inPreis = false;
        
        for (const line of sections['Zuschlagskriterien']) {
            if (line.includes('Qualität') && line.includes('60%')) {
                summary += `• ${line}\n`;
                inQualitaet = true;
                inPreis = false;
            } else if (line.includes('Preis') && line.includes('40%')) {
                summary += `• ${line}\n`;
                inQualitaet = false;
                inPreis = true;
            } else if (inQualitaet || inPreis) {
                summary += `  ${line}\n`;
            } else {
                summary += `• ${line}\n`;
            }
        }
    } else {
        summary += '• Nicht angegeben';
    }
    
    summary += '\n\n**Eignungskriterien:**\n';
    if (sections['Eignungskriterien'].length > 0) {
        summary += sections['Eignungskriterien'].map(line => `• ${line}`).join('\n');
    } else {
        summary += '• Nicht angegeben';
    }
    
    summary += '\n\n**Einzureichende Unterlagen:**\n';
    if (sections['Einzureichende Unterlagen'].length > 0) {
        summary += sections['Einzureichende Unterlagen'].map(line => `• ${line}`).join('\n');
    } else {
        summary += '• Nicht angegeben';
    }
    
    return summary;
}

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
        return `(Manual Summary) AI summarization disabled. Document content length: ${text.length} characters.\n\n${generateManualSummary(text)}`;
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
                model: "gpt-4o",
                temperature: 0.1,
                messages: [
                    {
                        role: "system",
                        content: `Du bist ein Experte für die Extraktion von Vergabe-/Ausschreibungsinformationen. Antworte ausschließlich auf Deutsch. Sei vollständig und präzise. Gib keine allgemeinen Zusammenfassungen, sondern extrahiere ALLE konkreten Details (Zahlen, Prozente, Punkte, Gewichtungen, Fristen, Beträge, Anforderungen). Struktur: Verwende GENAU die folgende Vorlage und fülle jede Zeile so konkret wie möglich aus. Wenn etwas fehlt, schreibe "Nicht angegeben".\n\nVorlage:\n\n${STRICT_OUTPUT_TEMPLATE}`
                    },
                    {
                        role: "user",
                        content: `${promptPrefix}\n\nAnalysiere den folgenden Inhalt und extrahiere ALLE Details in der oben vorgegebenen Vorlage. Wichtig:\n- Liste alle Unterkriterien und Subkriterien mit max. Punkten und ggf. Gewichtungen.\n- Für Zuschlagskriterien: gliedere klar nach Qualität und Preis, inkl. Unterpunkten.\n- Bewahr alle Zahlenformate (z. B. 12:00 Uhr, 150.000 EUR).\n- Nichts erfinden; wenn unklar, "Nicht angegeben".\n\n<BEGIN_INHALT>\n${text}\n<END_INHALT>`
                    }
                ],
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
                temperature: 0.1,
                messages: [
                    {
                        role: "system",
                        content: `Du bist ein Experte für die Extraktion von Vergabe-/Ausschreibungsinformationen. Antworte ausschließlich auf Deutsch. Verwende GENAU die folgende Vorlage; fülle sie so vollständig wie möglich. Wenn Informationen im Chunk nicht vorhanden sind, schreibe "Nicht angegeben".\n\nVorlage:\n\n${STRICT_OUTPUT_TEMPLATE}`
                    },
                    {
                        role: "user",
                        content: `Dies ist Chunk ${i + 1} von ${chunks.length}. Extrahiere ALLE Details (Zahlen, Prozente, Punkte, Gewichtungen, Fristen, Beträge, Anforderungen) streng nach Vorlage. Bewahre alle Unterkriterien (Qualität/Preis) inkl. Subkriterien und max. Punkte.\n\n<BEGIN_CHUNK_${i + 1}>\n${chunks[i]}\n<END_CHUNK_${i + 1}>`
                    }
                ],
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
            model: "gpt-4o",
            temperature: 0.1,
            messages: [
                {
                    role: "system",
                    content: `Du konsolidierst mehrere Zwischenergebnisse in EINEN vollständigen, deduplizierten und strukturierten Auszug. Antworte ausschließlich auf Deutsch und verwende GENAU die folgende Vorlage. Bewahre ALLE konkreten Zahlen/Prozente/Punkte/Gewichtungen. Bei widersprüchlichen Angaben nenne beide Werte und markiere sie mit (Konflikt).\n\nVorlage:\n\n${STRICT_OUTPUT_TEMPLATE}`
                },
                {
                    role: "user",
                    content: `${promptPrefix}Konsolidiere die folgenden Chunk-Zusammenfassungen in eine EINZIGE Ausgabe nach obiger Vorlage. Behalte alle Unterkriterien (Qualität/Preis) und Subkriterien mit max. Punkten/Gewichtungen bei. Entferne Duplikate, führe Teilangaben zusammen, und setze fehlende Felder auf "Nicht angegeben".\n\n<BEGIN_CHUNK_SUMMARIES>\n${consolidatedText}\n<END_CHUNK_SUMMARIES>`
                }
            ],
        });
        return completion.choices[0].message.content || '(No consolidated summary generated)';
    } catch (error) {
        console.error('Error creating consolidated summary:', error);
        return `(Partial Summary) Unable to create final consolidated summary. Here are the individual chunk summaries:\n\n${consolidatedText}`;
    }
}
