import puppeteer from 'puppeteer';

async function collectTabContent(page: any, currentUrl: string): Promise<string> {
    let allTabContent = '';
    
    try {
        // Extract base URL and project ID from the current URL
        const urlParts = currentUrl.split('/');
        const projectIndex = urlParts.findIndex(part => part === 'project');
        if (projectIndex === -1 || projectIndex + 1 >= urlParts.length) {
            console.log('Could not extract project ID from URL');
            return '';
        }
        
        const projectId = urlParts[projectIndex + 1];
        const baseUrl = urlParts.slice(0, projectIndex + 2).join('/');
        
        console.log(`Collected project ID: ${projectId}, base URL: ${baseUrl}`);
        
        // Tab URLs to visit - updated to current DTVP structure
        const tabUrls = [
            { url: `${baseUrl}/de/overview`, name: 'Übersicht' },                 // Overview
            { url: `${baseUrl}/de/processdata/eforms`, name: 'Verfahrensangaben' }, // Procedure (eForms)
            { url: `${baseUrl}/de/communication/anonym`, name: 'Kommunikation' },  // Public communication
        ];
        
        for (const tab of tabUrls) {
            try {
                console.log(`Navigating to tab: ${tab.name} (${tab.url})`);
                await page.goto(tab.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                
                // Wait for content to load
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Extract meaningful content from the page
                const tabText = await page.evaluate((tabName: string) => {
                    // Remove script and style elements
                    const scripts = document.querySelectorAll('script, style');
                    scripts.forEach(el => el.remove());
                    
                    // Get main content area
                    const content = document.querySelector('main, .content, .main-content, .container, body') || document.body;
                    
                    // Look for specific sections based on tab type
                    let specificContent = '';
                    
                    if (tabName.includes('Übersicht') || tabName.includes('Overview')) {
                        // Look for overview-specific content
                        const overviewElements = content.querySelectorAll('table, .overview, .summary, .details');
                        overviewElements.forEach(el => {
                            const text = el.textContent || '';
                            if (text.includes('VO:') || text.includes('Vergabeart:') || text.includes('Status:') || 
                                text.includes('Abgabefrist') || text.includes('Budget') || text.includes('Finanzvolumen')) {
                                specificContent += ' ' + text;
                            }
                        });
                    } else if (tabName.includes('Verfahrensangaben') || tabName.includes('Procedure')) {
                        // Look for procedure-specific content
                        const procedureElements = content.querySelectorAll('table, .procedure, .requirements, .criteria');
                        procedureElements.forEach(el => {
                            const text = el.textContent || '';
                            if (text.includes('Zuschlagskriterien') || text.includes('Eignungskriterien') || 
                                text.includes('Bewertung') || text.includes('Punkte') || text.includes('Gewichtung')) {
                                specificContent += ' ' + text;
                            }
                        });
                    }
                    
                    // If no specific content found, get general content
                    if (!specificContent.trim()) {
                        specificContent = content.textContent || '';
                    }
                    
                    // Clean up the text
                    let text = specificContent.replace(/\s+/g, ' ').trim();
                    
                    // Filter out common navigation and footer text
                    const linesToFilter = [
                        'Schließen',
                        'Zurück zum Center',
                        'Seite drucken',
                        'DTVP 9.8.4',
                        'Deutsches Vergabeportal GmbH',
                        'Systemzeit:',
                        'Impressum',
                        'Mandantennummer',
                        'Bitte warten...',
                        'Die systemweite interne Identifikationsnummer',
                        'Teilnehmen',
                        'Übersicht',
                        'Verfahrensangaben',
                        'Teilnahmeunterlagen',
                        'Kommunikation',
                        'Teilnahmeanträge'
                    ];
                    
                    const lines = text.split('. ');
                    const filteredLines = lines.filter(line => {
                        const cleanLine = line.trim();
                        return cleanLine.length > 15 && 
                               !linesToFilter.some(filter => cleanLine.includes(filter));
                    });
                    
                    return filteredLines.join('. ');
                }, tab.name);
                
                if (tabText.trim() && tabText.length > 50) { // Only include substantial content
                    allTabContent += `\n\n=== Content from ${tab.name} (${tab.url}) ===\n${tabText}`;
                    console.log(`Successfully extracted content from ${tab.name} (${tabText.length} characters)`);
                    
                    // If this is an 'Alt' tab and we already have content for the main tab, skip
                    if (tab.name.includes('Alt') && allTabContent.includes(`=== Content from ${tab.name.replace(' Alt', '')}`)) {
                        console.log(`Skipping ${tab.name} as we already have content for the main tab`);
                        continue;
                    }
                } else {
                    console.log(`No substantial content found at ${tab.name}`);
                }
                
            } catch (error) {
                console.log(`Failed to load tab ${tab.name}:`, error instanceof Error ? error.message : String(error));
            }
        }
        
        // Navigate back to documents page
        console.log('Navigating back to documents page...');
        await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
    } catch (error) {
        console.log('Error collecting tab content:', error);
    }
    
    return allTabContent;
}

export async function handleDtvp(page: any, url: string): Promise<Map<string, Buffer>> {
    const documents = new Map<string, Buffer>();
    
    try {
        console.log('Detected DTVP (Deutsches Vergabeportal) - applying special handling...');
        
        // First, collect text content from other tabs (Übersicht and Verfahrensangaben)
        const tabContent = await collectTabContent(page, url);
        
        // Store tab content as a text "document" for summarization
        if (tabContent.trim()) {
            const tabContentBuffer = Buffer.from(tabContent, 'utf-8');
            documents.set('DTVP_Tab_Information.txt', tabContentBuffer);
            console.log('Successfully collected tab information from Übersicht and Verfahrensangaben');
        }
        
        // Wait for the page to load completely
        console.log('Waiting for page to fully load...');
        await page.waitForSelector('body', { timeout: 15000 });
        
        // Wait for content to appear
        let contentLoaded = false;
        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const hasExpectedContent = await page.evaluate(() => {
                const text = document.body.textContent || '';
                return text.includes('Teilnahmeunterlagen') || 
                       text.includes('Leistungsbeschreibungen') ||
                       text.includes('Vertragsbedingungen') ||
                       text.includes('Anschreiben') ||
                       text.includes('Vom Unternehmen auszufüllende Dokumente') ||
                       text.includes('Sonstiges') ||
                       text.includes('Alle Dokumente als ZIP-Datei herunterladen');
            });
            
            if (hasExpectedContent) {
                contentLoaded = true;
                console.log(`Page content loaded after ${(i + 1) * 2} seconds`);
                break;
            }
            console.log(`Waiting for content... attempt ${i + 1}/10`);
        }
        
        if (!contentLoaded) {
            console.log('Content did not load within expected time, proceeding anyway...');
        }
        
        // Set up download capture before clicking any download buttons
        page.on('response', async (response: any) => {
            try {
                const url = response.url();
                const headers = response.headers();
                const contentType = headers['content-type'] || '';
                const contentDisposition = headers['content-disposition'] || '';
                
                // Check if this is a file download
                if (contentDisposition.includes('attachment') || 
                    contentType.includes('application/pdf') ||
                    contentType.includes('application/msword') ||
                    contentType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') ||
                    contentType.includes('application/zip') ||
                    url.includes('.pdf') ||
                    url.includes('.docx') ||
                    url.includes('.doc') ||
                    url.includes('.zip')) {
                    
                    console.log(`Capturing download: ${url}`);
                    const buffer = await response.buffer();
                    
                    // Extract filename from content-disposition or URL
                    let fileName = 'download';
                    if (contentDisposition) {
                        const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                        if (match) {
                            fileName = match[1].replace(/['"]/g, '');
                        }
                    } else {
                        // Extract filename from URL path
                        const urlPath = new URL(url).pathname;
                        fileName = urlPath.split('/').pop() || 'download';
                        
                        // Clean up filename (remove session IDs, etc.)
                        fileName = fileName.replace(/;jsessionid=[^;]*/, '');
                        fileName = fileName.replace(/[?&].*$/, '');
                    }
                    
                    // Skip platform documents and empty files
                    if (buffer.length > 0 && 
                        !fileName.includes('AGB') && 
                        !fileName.includes('Datenschutz') &&
                        !fileName.includes('Impressum') &&
                        !fileName.includes('DTVP') &&
                        !fileName.includes('subreport')) {
                        console.log(`Successfully captured: ${fileName} (${buffer.length} bytes, Content-Type: ${contentType})`);
                        documents.set(fileName, buffer);
                    } else {
                        console.log(`Skipped platform document or empty file: ${fileName}`);
                    }
                }
            } catch (error) {
                // Ignore errors in response processing
            }
        });
        
        // Look for the "Alle Dokumente als ZIP-Datei herunterladen" button first
        console.log('Looking for ZIP download button...');
        const zipButton = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('button, a, input[type="button"]'));
            for (let i = 0; i < elements.length; i++) {
                const el = elements[i];
                const text = (el.textContent || el.getAttribute('value') || '').toLowerCase().trim();
                if (text.includes('alle dokumente als zip') || 
                    text.includes('zip-datei herunterladen') ||
                    text.includes('download all documents')) {
                    return { index: i, text: text, found: true };
                }
            }
            return { found: false };
        });
        
        if (zipButton.found) {
            console.log(`Found ZIP download button: "${zipButton.text}", clicking...`);
            try {
                await page.evaluate((index: number) => {
                    const elements = Array.from(document.querySelectorAll('button, a, input[type="button"]'));
                    const el = elements[index] as HTMLElement;
                    if (el) {
                        el.click();
                    }
                }, zipButton.index);
                
                console.log('ZIP download button clicked successfully');
                
                // Wait for download to process
                await new Promise(resolve => setTimeout(resolve, 5000));
                
            } catch (error) {
                console.log('Error clicking ZIP download button:', error);
            }
        }
        
        // If no ZIP or individual documents needed, look for individual document download buttons
        if (documents.size === 0) {
            console.log('Looking for individual document download buttons...');
            
            // Look for download buttons in each section
            const downloadButtons = await page.evaluate(() => {
                const results: Array<{text: string, index: number, section: string, href?: string}> = [];
                
                // Find all download buttons and links on the page
                const allElements = Array.from(document.querySelectorAll('button, a'));
                
                for (let i = 0; i < allElements.length; i++) {
                    const el = allElements[i];
                    const text = (el.textContent || '').toLowerCase().trim();
                    const href = (el as HTMLAnchorElement).href;
                    
                    if (text === 'download' || text === 'herunterladen' || 
                        (href && (href.includes('.pdf') || href.includes('.docx') || href.includes('.doc')))) {
                        
                        // Find the section this button belongs to
                        let section = 'Unknown';
                        let currentElement = el.parentElement;
                        
                        // Look for section headers
                        while (currentElement && currentElement !== document.body) {
                            const sectionText = currentElement.textContent || '';
                            if (sectionText.includes('Anschreiben')) {
                                section = 'Anschreiben';
                                break;
                            } else if (sectionText.includes('Leistungsbeschreibungen')) {
                                section = 'Leistungsbeschreibungen';
                                break;
                            } else if (sectionText.includes('Vom Unternehmen auszufüllende Dokumente')) {
                                section = 'Vom Unternehmen auszufüllende Dokumente';
                                break;
                            } else if (sectionText.includes('Vertragsbedingungen')) {
                                section = 'Vertragsbedingungen';
                                break;
                            } else if (sectionText.includes('Sonstiges')) {
                                section = 'Sonstiges';
                                break;
                            }
                            currentElement = currentElement.parentElement;
                        }
                        
                        results.push({
                            text: `Download from ${section}`,
                            index: i,
                            section: section,
                            href: href
                        });
                    }
                }
                
                return results;
            });
            
            console.log('Found individual download buttons:', downloadButtons);
            
            // Click each download button
            for (const btn of downloadButtons) {
                try {
                    console.log(`Clicking download for: ${btn.text}`);
                    
                    await page.evaluate((buttonIndex: number) => {
                        const elements = Array.from(document.querySelectorAll('button, a'));
                        const el = elements[buttonIndex] as HTMLElement;
                        if (el) {
                            el.click();
                        }
                    }, btn.index);
                    
                    // Wait for download to process
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                } catch (error) {
                    console.log(`Failed to download ${btn.text}:`, error);
                }
            }
            
            // Wait a bit more for all downloads to complete
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
    } catch (error) {
        console.log('Special DTVP handling failed:', error);
    }
    
    return documents;
}
