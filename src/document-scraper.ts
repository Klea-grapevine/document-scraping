import dotenv from 'dotenv';
import puppeteer from 'puppeteer';

// Import host-specific handlers
import { isTedNoticeUrl, extractDocumentsBaseUrlFromTed } from './hosts/ted';
import { handleVergabeNiedersachsen } from './hosts/vergabe-niedersachsen';
import { handleSubreportElvis } from './hosts/subreport-elvis';
import { handleDtvp } from './hosts/dtvp';
import { handleVergabekooperationBerlin } from './hosts/vergabekooperation-berlin';

// Import general utilities
import { 
    getZipDocumentLink, 
    collectStaticDocumentLinks, 
    collectDocumentsViaPuppeteer,
    downloadDocument,
    fetchFileBufferViaPage
} from './hosts/general';

// Import document parsers
import { parsePdf, parseDocx, parseExcel, extractDocumentsFromZip } from './utils/document-parsers';

// Import AI summarizer
import { summarizeText } from './utils/ai-summarizer';

dotenv.config();

// Default website URL
const WEBSITE_URL = 'https://www.dtvp.de/Satellite/public/company/project/CXP4YAP5BAG/de/documents';

export async function runDocumentScrapeFromDocumentsPage(documentsPageUrl: string) {
    // 1) ZIP pathway
    const zipLink = await getZipDocumentLink(documentsPageUrl);
    let files: Map<string, Buffer> | null = null;
    if (zipLink) {
        console.log(`Found ZIP archive link: ${zipLink}`);
        const zipBuffer = await downloadDocument(zipLink);
        if (zipBuffer) {
            console.log('Extracting documents from ZIP...');
            files = await extractDocumentsFromZip(zipBuffer);
        }
    }

    // 2) Static anchors on the page
    if (!files || files.size === 0) {
        const links = await collectStaticDocumentLinks(documentsPageUrl);
        if (links.length) {
            files = new Map<string, Buffer>();
            for (const link of links) {
                const buf = await downloadDocument(link);
                if (buf) {
                    const nameGuess = new URL(link).pathname.split('/').filter(Boolean).pop() || 'download';
                    files.set(nameGuess, buf);
                }
            }
        }
    }

    // 3) Dynamic scraping via Puppeteer with host-specific handling
    if (!files || files.size === 0) {
        try {
            console.log('No direct links found; trying dynamic scraping via headless browser...');
            
            // Check for specific hosts that need special handling
            if (documentsPageUrl.includes('vergabe.niedersachsen.de')) {
                const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                try {
                    const page = await browser.newPage();
                    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
                    await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' });
                    
                    // Navigate to the page
                    await page.goto(documentsPageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
                    
                    // Use host-specific handler
                    files = await handleVergabeNiedersachsen(page, documentsPageUrl);
                } finally {
                    await browser.close();
                }
            } else if (documentsPageUrl.includes('subreport-elvis.de')) {
                const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                try {
                    const page = await browser.newPage();
                    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
                    await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' });
                    
                    // Navigate to the page
                    await page.goto(documentsPageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
                    
                    // Use host-specific handler
                    files = await handleSubreportElvis(page, documentsPageUrl);
                } finally {
                    await browser.close();
                }
            } else if (documentsPageUrl.includes('dtvp.de')) {
                const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                try {
                    const page = await browser.newPage();
                    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
                    await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' });
                    
                    // Navigate to the page
                    await page.goto(documentsPageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
                    
                    // Use host-specific handler
                    files = await handleDtvp(page, documentsPageUrl);
                } finally {
                    await browser.close();
                }
            } else if (documentsPageUrl.includes('vergabekooperation.berlin')) {
                const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                try {
                    const page = await browser.newPage();
                    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
                    await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' });
                    
                    // Navigate to the page
                    await page.goto(documentsPageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
                    
                    // Use host-specific handler
                    files = await handleVergabekooperationBerlin(page, documentsPageUrl);
                } finally {
                    await browser.close();
                }
            } else {
                // Use general Puppeteer approach for other hosts
                files = await collectDocumentsViaPuppeteer(documentsPageUrl);
            }
        } catch (error) {
            console.error('Dynamic scraping failed:', error);
        }
    }

    if (!files || files.size === 0) {
        console.log('No documents could be collected to summarize.');
        return;
    }

    // Process collected files
    console.log(`\n📄 Processing ${files.size} downloaded documents...`);
    let allDocumentContent = '';
    let processedCount = 0;
    
    for (const [fileName, fileBuffer] of files.entries()) {
        const lower = fileName.toLowerCase();
        console.log(`\n🔍 Processing: ${fileName} (${(fileBuffer.length / 1024).toFixed(1)} KB)`);
        
        if (lower.endsWith('.pdf')) {
            try {
                const content = await parsePdf(fileBuffer);
                allDocumentContent += `\n--- Content from ${fileName} ---\n${content}\n`;
                processedCount++;
                console.log(`✅ PDF processed successfully`);
            } catch (error) {
                console.log(`❌ Failed to process PDF: ${error}`);
            }
        } else if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
            try {
                const content = await parseDocx(fileBuffer);
                allDocumentContent += `\n--- Content from ${fileName} ---\n${content}\n`;
                processedCount++;
                console.log(`✅ DOC/DOCX processed successfully`);
            } catch (error) {
                console.log(`❌ Failed to process DOC/DOCX: ${error}`);
            }
        } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
            try {
                const content = await parseExcel(fileBuffer);
                allDocumentContent += `\n--- Content from ${fileName} ---\n${content}\n`;
                processedCount++;
                console.log(`✅ Excel file processed successfully`);
            } catch (error) {
                console.log(`❌ Failed to process Excel file: ${error}`);
            }
        } else if (lower.endsWith('.zip')) {
            console.log(`📦 Extracting nested ZIP archive...`);
            try {
                const nested = await extractDocumentsFromZip(fileBuffer);
                console.log(`📦 Found ${nested.size} files in ZIP`);
                
                for (const [nestedName, nestedBuf] of nested.entries()) {
                    const lname = nestedName.toLowerCase();
                    console.log(`🔍 Processing nested file: ${nestedName}`);
                    
                    if (lname.endsWith('.pdf')) {
                        try {
                            const content = await parsePdf(nestedBuf);
                            allDocumentContent += `\n--- Content from ${nestedName} ---\n${content}\n`;
                            processedCount++;
                            console.log(`✅ Nested PDF processed successfully`);
                        } catch (error) {
                            console.log(`❌ Failed to process nested PDF: ${error}`);
                        }
                    } else if (lname.endsWith('.docx') || lname.endsWith('.doc')) {
                        try {
                            const content = await parseDocx(nestedBuf);
                            allDocumentContent += `\n--- Content from ${nestedName} ---\n${content}\n`;
                            processedCount++;
                            console.log(`✅ Nested DOC/DOCX processed successfully`);
                        } catch (error) {
                            console.log(`❌ Failed to process nested DOC/DOCX: ${error}`);
                        }
                    } else if (lname.endsWith('.xlsx') || lname.endsWith('.xls')) {
                        try {
                            const content = await parseExcel(nestedBuf);
                            allDocumentContent += `\n--- Content from ${nestedName} ---\n${content}\n`;
                            processedCount++;
                            console.log(`✅ Nested Excel file processed successfully`);
                        } catch (error) {
                            console.log(`❌ Failed to process nested Excel file: ${error}`);
                        }
                    } else {
                        console.log(`⏭️ Skipping unsupported nested file format: ${nestedName}`);
                    }
                }
            } catch (error) {
                console.log(`❌ Failed to extract nested ZIP: ${error}`);
            }
        } else {
            console.log(`⏭️ Skipping unsupported file format: ${fileName}`);
        }
    }
    
    console.log(`\n📊 Document processing complete: ${processedCount} documents processed successfully`);

    if (allDocumentContent.trim()) {
        console.log('\n🤖 Generating AI summary...');
        const customPrompt = `Please provide a consolidated summary of the following tender documents with the following structure and bullet points:

1. **Übersicht:**
   • Abgabefrist
   • Budget/Finanzvolumen
   • Vertragslaufzeit
   • Vergabeart
   • Status

2. **Zusammenfassung:**
   • Geforderte Leistungen
   • Eignungskriterien
   • Zuschlagskriterien
   • Einzureichende Unterlagen
   • Formalitäten und Besonderheiten

Please extract the most important information from the documents and present it in a clear, structured format. If certain information is not available in the documents, indicate this with "Nicht angegeben" or "Nicht verfügbar".

Here are the document contents:`;
        
        const consolidatedSummary = await summarizeText(allDocumentContent, customPrompt);
        console.log('\n' + '='.repeat(80));
        console.log('📋 DOCUMENT SUMMARY');
        console.log('='.repeat(80));
        console.log(consolidatedSummary);
        console.log('='.repeat(80));
        console.log('\n✅ Summary generation completed!');
    } else {
        console.log('❌ No document content found to summarize.');
        console.log('💡 This might be because:');
        console.log('   - Documents are password protected');
        console.log('   - Documents are in an unsupported format');
        console.log('   - No documents were successfully downloaded');
    }
}

export async function main() {
    console.log('🚀 Starting Document Scraper & Summarizer...\n');
    const argUrl = process.argv[2];
    let documentsPageUrl = WEBSITE_URL;

    if (!argUrl) {
        console.log('❌ No URL provided. Usage: npm start <TED_URL_OR_DOCUMENTS_URL>');
        console.log('Example: npm start "https://ted.europa.eu/de/notice/-/detail/488905-2025"');
        console.log('Example: npm start "https://www.dtvp.de/Satellite/notice/CXP4YDK5GK4/documents"');
        return;
    }

    if (isTedNoticeUrl(argUrl)) {
        console.log(`📋 TED notice detected: ${argUrl}`);
        console.log('🔍 Extracting document URL from TED notice...');
        
        const extracted = await extractDocumentsBaseUrlFromTed(argUrl);
        if (extracted) {
            documentsPageUrl = extracted;
            console.log(`✅ Successfully extracted documents page URL: ${documentsPageUrl}`);
        } else {
            console.log('❌ Could not extract documents page URL from TED notice.');
            console.log('💡 This might be because:');
            console.log('   - The notice doesn\'t have document links yet');
            console.log('   - The document URL is in a different format');
            console.log('   - The page structure has changed');
            return;
        }
    } else {
        documentsPageUrl = argUrl;
        console.log(`📄 Using provided URL as documents page: ${documentsPageUrl}`);
    }

    console.log('\n📥 Starting document collection...');
    await runDocumentScrapeFromDocumentsPage(documentsPageUrl);
}
