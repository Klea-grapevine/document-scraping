import dotenv from 'dotenv';
import puppeteer from 'puppeteer';

// Import host-specific handlers
import { isTedNoticeUrl, extractDocumentsBaseUrlFromTed } from './hosts/ted';
import { isServiceBundUrl, extractDocumentsPageFromServiceBund } from './hosts/service-bund';
import { handleVergabeNiedersachsen } from './hosts/vergabe-niedersachsen';
import { handleSubreportElvis } from './hosts/subreport-elvis';
import { handleDtvp } from './hosts/dtvp';
import { handleVergabekooperationBerlin } from './hosts/vergabekooperation-berlin';
import { handleVergabeMetropoleruhr } from './hosts/vergabe-metropoleruhr';
import { handleVergabemarktplatzBrandenburg } from './hosts/vergabemarktplatz-brandenburg';
import { handleVergabeportalBw } from './hosts/vergabeportal-bw';
import { handleEvergabeOnline } from './hosts/evergabe-online';
import { handleEvergabeSachsen } from './hosts/evergabe-sachsen';

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
    // Special handling for DTVP: always collect tab content regardless of document collection method
    let tabContentCollected = false;
    
    // 1) ZIP pathway
    const zipLink = await getZipDocumentLink(documentsPageUrl);
    let files: Map<string, Buffer> | null = null;
    if (zipLink) {
        console.log(`Found ZIP archive link: ${zipLink}`);
        const zipBuffer = await downloadDocument(zipLink);
        if (zipBuffer) {
            console.log('Extracting documents from ZIP...');
            files = await extractDocumentsFromZip(zipBuffer);
            
            // For DTVP, collect tab content even when ZIP download works
            if (documentsPageUrl.includes('dtvp.de') && files && files.size > 0) {
                console.log('DTVP detected - collecting additional tab content...');
                try {
                    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                    const page = await browser.newPage();
                    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
                    await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' });
                    
                    // Navigate to the documents page first
                    await page.goto(documentsPageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
                    
                    // Use the DTVP handler to collect tab content
                    const tabOnlyFiles = await handleDtvp(page, documentsPageUrl);
                    
                    // Add any tab content to our existing files
                    for (const [fileName, fileBuffer] of tabOnlyFiles.entries()) {
                        if (fileName.includes('Tab_Information')) {
                            files.set(fileName, fileBuffer);
                            console.log(`Added tab content: ${fileName}`);
                        }
                    }
                    
                    await browser.close();
                    tabContentCollected = true;
                } catch (error) {
                    console.log('Failed to collect DTVP tab content:', error);
                }
            }
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
                const fs = require('fs');
                const path = require('path');
                const os = require('os');
                
                // Create a temporary download directory
                const downloadPath = path.join(os.tmpdir(), `subreport_downloads_${Date.now()}`);
                if (!fs.existsSync(downloadPath)) {
                    fs.mkdirSync(downloadPath, { recursive: true });
                }
                
                const browser = await puppeteer.launch({ 
                    headless: true, 
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--disable-features=VizDisplayCompositor'] 
                });
                try {
                    const page = await browser.newPage();
                    
                    // Set download behavior
                    const client = await page.target().createCDPSession();
                    await client.send('Page.setDownloadBehavior', {
                        behavior: 'allow',
                        downloadPath: downloadPath
                    });
                    
                    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
                    await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' });
                    
                    // Navigate to the page
                    await page.goto(documentsPageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
                    
                    // Use host-specific handler
                    files = await handleSubreportElvis(page, documentsPageUrl);
                    
                    // Wait for downloads to complete and check the download directory
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    // Read any downloaded files from the directory
                    const downloadedFiles = fs.readdirSync(downloadPath);
                    console.log('Downloaded files found:', downloadedFiles);
                    
                    for (const fileName of downloadedFiles) {
                        const filePath = path.join(downloadPath, fileName);
                        const fileStats = fs.statSync(filePath);
                        
                        if (fileStats.size > 1000) { // Only include files larger than 1KB
                            const buffer = fs.readFileSync(filePath);
                            console.log(`Adding downloaded file: ${fileName} (${buffer.length} bytes)`);
                            if (!files) files = new Map();
                            files.set(fileName, buffer);
                        }
                    }
                    
                    // Clean up download directory
                    try {
                        fs.rmSync(downloadPath, { recursive: true, force: true });
                    } catch (error) {
                        console.log('Error cleaning up download directory:', error);
                    }
                } finally {
                    await browser.close();
                }
            } else if (documentsPageUrl.includes('dtvp.de') && !tabContentCollected) {
                const browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                try {
                    const page = await browser.newPage();
                    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
                    await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' });
                    
                    // Navigate to the page
                    await page.goto(documentsPageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
                    
                    // Use host-specific handler (this will collect both documents and tab content)
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
            } else if (documentsPageUrl.includes('vergabe.metropoleruhr.de')) {
                const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                try {
                    const page = await browser.newPage();
                    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
                    await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' });
                    
                    // Navigate to the page
                    await page.goto(documentsPageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
                    
                    // Use host-specific handler
                    files = await handleVergabeMetropoleruhr(page, documentsPageUrl);
                } finally {
                    await browser.close();
                }
            } else if (documentsPageUrl.includes('vergabemarktplatz.brandenburg.de')) {
                const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                try {
                    const page = await browser.newPage();
                    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
                    await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' });
                    
                    // Navigate to the page
                    await page.goto(documentsPageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
                    
                    // Use host-specific handler
                    files = await handleVergabemarktplatzBrandenburg(page, documentsPageUrl);
                } finally {
                    await browser.close();
                }
            } else if (documentsPageUrl.includes('vergabeportal-bw.de')) {
                const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                try {
                    const page = await browser.newPage();
                    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
                    await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' });
                    
                    // Navigate to the page
                    await page.goto(documentsPageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
                    
                    // Use host-specific handler
                    files = await handleVergabeportalBw(page, documentsPageUrl);
                } finally {
                    await browser.close();
                }
            } else if (documentsPageUrl.includes('evergabe-online.de')) {
                const browser = await puppeteer.launch({ 
                    headless: false, 
                    args: [
                        '--no-sandbox', 
                        '--disable-setuid-sandbox',
                        '--disable-web-security',
                        '--disable-features=VizDisplayCompositor',
                        '--enable-cookies'
                    ] 
                });
                try {
                    const page = await browser.newPage();
                    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
                    
                    // Navigate to the page
                    await page.goto(documentsPageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
                    
                    // Use host-specific handler (now uses response interception instead of file downloads)
                    files = await handleEvergabeOnline(page, documentsPageUrl);
                    
                } finally {
                    await browser.close();
                }
            } else if (documentsPageUrl.includes('evergabe.sachsen.de')) {
                const browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                try {
                    const page = await browser.newPage();
                    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
                    await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' });
                    
                    // Navigate to the page
                    await page.goto(documentsPageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
                    
                    // Use host-specific handler
                    files = await handleEvergabeSachsen(page, documentsPageUrl);
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
        } else if (lower.endsWith('.txt')) {
            try {
                const content = fileBuffer.toString('utf-8');
                allDocumentContent += `\n--- Content from ${fileName} ---\n${content}\n`;
                processedCount++;
                console.log(`✅ Text file processed successfully`);
            } catch (error) {
                console.log(`❌ Failed to process text file: ${error}`);
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
                    } else if (lname.endsWith('.txt')) {
                        try {
                            const content = nestedBuf.toString('utf-8');
                            allDocumentContent += `\n--- Content from ${nestedName} ---\n${content}\n`;
                            processedCount++;
                            console.log(`✅ Nested text file processed successfully`);
                        } catch (error) {
                            console.log(`❌ Failed to process nested text file: ${error}`);
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
        const customPrompt = `Please provide a detailed, comprehensive summary of the following tender documents and webpage information. This content includes both document files AND information extracted from the tender portal's tabs (Übersicht, Verfahrensangaben). Extract ALL specific details, numbers, percentages, point values, and weightings:

1. **Übersicht:**
   • Abgabefrist (exact date and time)
   • Budget/Finanzvolumen (exact amounts, ranges, or "Nicht angegeben")
   • Vertragslaufzeit (exact duration, start/end dates)
   • Vergabeart (specific type - e.g., VgV, Verhandlungsverfahren mit Teilnahmewettbewerb)
   • Status (current status)
   • Projekt-ID/Referenz (if available)

2. **Zusammenfassung:**
   • **Geforderte Leistungen:** List ALL specific services, deliverables, and requirements mentioned (check both documents and tab content)
   • **Eignungskriterien:** Include ALL specific criteria, minimum requirements, certifications, experience levels, financial requirements, etc.
   • **Zuschlagskriterien:** Extract ALL point values, weightings, percentages, and detailed breakdowns. For example:
     - If it says "Qualität (60%)" with subcategories, include ALL subcategories with their point values
     - If it mentions "Preis (40%)" with specific breakdowns, include ALL price components
     - Include maximum points for each criterion and subcriterion
     - Include scoring methodologies and evaluation criteria
   • **Einzureichende Unterlagen:** List ALL required documents, forms, certificates, etc.
   • **Formalitäten und Besonderheiten:** Include ALL special requirements, conditions, deadlines, submission formats, etc.
   • **Kommunikation und Teilnahme:** Information about participation, communication procedures, and submission methods

IMPORTANT: For each section, extract and include:
- Exact numbers, percentages, and point values
- Specific weightings and scoring systems
- Detailed breakdowns of criteria
- All subcategories and their respective values
- Exact dates, amounts, and requirements
- Cross-reference information between documents and portal tabs

If information is not available, indicate with "Nicht angegeben" or "Nicht verfügbar".

Here are the combined document contents and portal information:`;
        
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
        console.log('❌ No URL provided. Usage: npm start <TED_URL_OR_SERVICE_BUND_URL_OR_DOCUMENTS_URL>');
        console.log('Example: npm start "https://ted.europa.eu/de/notice/-/detail/488905-2025"');
        console.log('Example: npm start "https://www.service.bund.de/IMPORTE/Ausschreibungen/dtvp/2025/08/288749.html"');
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
    } else if (isServiceBundUrl(argUrl)) {
        console.log(`📋 service.bund.de notice detected: ${argUrl}`);
        console.log('🔍 Extracting documents page URL from service.bund.de notice...');
        
        const extracted = await extractDocumentsPageFromServiceBund(argUrl);
        if (extracted) {
            documentsPageUrl = extracted;
            console.log(`✅ Successfully extracted documents page URL: ${documentsPageUrl}`);
        } else {
            console.log('❌ Could not extract documents page URL from service.bund.de notice.');
            console.log('💡 This might be because:');
            console.log('   - The notice doesn\'t have a "Bekanntmachung (HTML-Seite)" link');
            console.log('   - The link doesn\'t lead to a DTVP page');
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
