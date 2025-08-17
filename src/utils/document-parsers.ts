import * as pdf from 'pdf-parse';
import * as mammoth from 'mammoth';
import * as yauzl from 'yauzl';

// Suppress PDF font warnings globally at process level
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

process.stdout.write = function(chunk: any, encoding?: any, callback?: any) {
    if (typeof chunk === 'string' && (chunk.includes('TT: undefined function') || chunk.includes('TT: invalid function'))) {
        return true; // Suppress the output
    }
    return originalStdoutWrite.call(this, chunk, encoding, callback);
};

process.stderr.write = function(chunk: any, encoding?: any, callback?: any) {
    if (typeof chunk === 'string' && (chunk.includes('TT: undefined function') || chunk.includes('TT: invalid function'))) {
        return true; // Suppress the output
    }
    return originalStderrWrite.call(this, chunk, encoding, callback);
};

export async function parsePdf(buffer: Buffer): Promise<string> {
    try {
        const data = await pdf.default(buffer);
        return data.text;
    } catch (error) {
        console.error('Error parsing PDF:', error);
        return '';
    }
}

export async function parseDocx(buffer: Buffer): Promise<string> {
    try {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
    } catch (error) {
        console.error('Error parsing DOCX:', error);
        return '';
    }
}

export async function parseExcel(buffer: Buffer): Promise<string> {
    try {
        // For Excel files, we'll extract basic text content
        // This is a simplified approach - for more complex parsing you might want to use a dedicated Excel library
        const xlsx = require('xlsx');
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        let extractedText = '';
        
        workbook.SheetNames.forEach((sheetName: string) => {
            const worksheet = workbook.Sheets[sheetName];
            const csvData = xlsx.utils.sheet_to_csv(worksheet);
            extractedText += `\n--- Sheet: ${sheetName} ---\n${csvData}\n`;
        });
        
        return extractedText;
    } catch (error) {
        console.error('Error parsing Excel file:', error);
        return '';
    }
}

export async function extractDocumentsFromZip(zipBuffer: Buffer): Promise<Map<string, Buffer>> {
    return new Promise((resolve, reject) => {
        const documents = new Map<string, Buffer>();
        yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);

            zipfile.on('entry', (entry) => {
                console.log(`📁 ZIP entry: ${entry.fileName} (${entry.uncompressedSize} bytes)`);
                
                // Skip directories
                if (/\/$/.test(entry.fileName)) {
                    console.log(`📂 Skipping directory: ${entry.fileName}`);
                    zipfile.readEntry();
                } else {
                    // Check if this is a document file we want to extract
                    const fileName = entry.fileName.toLowerCase();
                    const isDocumentFile = fileName.endsWith('.pdf') || 
                                          fileName.endsWith('.docx') || 
                                          fileName.endsWith('.doc') || 
                                          fileName.endsWith('.xlsx') || 
                                          fileName.endsWith('.xls') ||
                                          fileName.endsWith('.txt');
                    
                    if (isDocumentFile) {
                        console.log(`📄 Extracting document: ${entry.fileName}`);
                        zipfile.openReadStream(entry, (err, readStream) => {
                            if (err) {
                                console.log(`❌ Error opening read stream for ${entry.fileName}:`, err);
                                zipfile.readEntry();
                                return;
                            }

                            const chunks: Buffer[] = [];
                            readStream.on('data', (chunk) => chunks.push(chunk));
                            readStream.on('end', () => {
                                const fileBuffer = Buffer.concat(chunks);
                                if (fileBuffer.length > 0) {
                                    // Use just the filename without the full path for cleaner processing
                                    const cleanFileName = entry.fileName.split('/').pop() || entry.fileName;
                                    documents.set(cleanFileName, fileBuffer);
                                    console.log(`✅ Extracted: ${cleanFileName} (${fileBuffer.length} bytes)`);
                                } else {
                                    console.log(`⚠️ Empty file skipped: ${entry.fileName}`);
                                }
                                zipfile.readEntry();
                            });
                            readStream.on('error', (streamErr) => {
                                console.log(`❌ Stream error for ${entry.fileName}:`, streamErr);
                                zipfile.readEntry();
                            });
                        });
                    } else {
                        console.log(`⏭️ Skipping non-document file: ${entry.fileName}`);
                        zipfile.readEntry();
                    }
                }
            });

            zipfile.on('end', () => {
                console.log(`📦 ZIP extraction complete: ${documents.size} documents extracted`);
                resolve(documents);
            });
            zipfile.on('error', reject);
            zipfile.readEntry(); // Start reading entries
        });
    });
}
