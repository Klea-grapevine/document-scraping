import puppeteer from 'puppeteer';

export async function handleSubreportElvis(page: any, url: string): Promise<Map<string, Buffer>> {
    const documents = new Map<string, Buffer>();
    
    try {
        console.log('Detected subreport-elvis.de - applying special handling...');
        
        // Wait for the page to load completely - subreport pages are JavaScript-heavy
        console.log('Waiting for page to fully load...');
        await page.waitForSelector('button, input[type="button"], a', { timeout: 15000 });
        
        // Wait for content to appear - look for specific text that indicates the page is loaded
        let contentLoaded = false;
        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const hasExpectedContent = await page.evaluate(() => {
                const text = document.body.textContent || '';
                return text.includes('Call for tenders') || 
                       text.includes('Auftragsbekanntmachung') ||
                       text.includes('Access to the tender documents') ||
                       text.includes('display') ||
                       text.includes('anzeigen');
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
        
        // Debug: Let's see what interactive elements are available
        const allInteractiveElements = await page.$$eval('button, input[type="button"], a', (elements: Element[]) => {
            return elements.map((el: Element) => ({
                text: (el.textContent || el.getAttribute('value') || '').trim(),
                tagName: el.tagName.toLowerCase(),
                className: el.className,
                id: el.id
            }));
        });
        console.log('Found interactive elements:', allInteractiveElements);
        
        // Debug: Log all text content to see what's available
        const pageTextContent = await page.evaluate(() => {
            return document.body.textContent;
        });
        console.log('Page text content sample:', pageTextContent?.substring(0, 1000));
        
        // Look for all unique button/clickable text to understand what's available
        const allClickableTexts = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('button, input[type="button"], a, span, div'));
            const texts = new Set<string>();
            elements.forEach(el => {
                const text = (el.textContent || el.getAttribute('value') || '').trim();
                if (text && text.length > 0 && text.length < 100) {
                    texts.add(text);
                }
            });
            return Array.from(texts).sort();
        });
        console.log('All available clickable texts:', allClickableTexts);
        
        // Debug: Look for clickable elements containing "anzeigen" text
        const displayRelatedElements = await page.evaluate(() => {
            const clickableElements = Array.from(document.querySelectorAll('button, input[type="button"], a, span, div'));
            const results: Array<{tagName: string, text: string, className: string, id: string, index: number}> = [];
            
            for (let i = 0; i < clickableElements.length; i++) {
                const el = clickableElements[i];
                const text = (el.textContent || el.getAttribute('value') || '').toLowerCase().trim();
                if (text.includes('anzeigen') || text.includes('display')) {
                    results.push({
                        tagName: el.tagName.toLowerCase(),
                        text: (el.textContent || el.getAttribute('value') || '').trim().substring(0, 100),
                        className: el.className || '',
                        id: el.id || '',
                        index: i
                    });
                }
            }
            return results;
        });
        console.log('Clickable elements containing display/anzeigen:', displayRelatedElements);
        
        // Step 1: Use the debug info to find the display button
        let displayButton: any = { found: false };
        if (displayRelatedElements.length > 0) {
            // Prioritize actual buttons over divs - look for button with "anzeigen" text
            const actualButton = displayRelatedElements.find((el: any) => 
                el.tagName === 'button' && el.text.toLowerCase().trim() === 'anzeigen'
            );
            
            if (actualButton) {
                displayButton = {
                    index: actualButton.index,
                    text: actualButton.text,
                    found: true,
                    tagName: actualButton.tagName
                };
                console.log('Using actual anzeigen button:', displayButton);
            } else {
                // Fallback to first element that contains "anzeigen"
                displayButton = {
                    index: displayRelatedElements[0].index,
                    text: displayRelatedElements[0].text,
                    found: true,
                    tagName: displayRelatedElements[0].tagName
                };
                console.log('Using first display-related element:', displayButton);
            }
        } else {
            // Fallback to original detection
            displayButton = await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('button, input[type="button"], a, span, div'));
                for (let i = 0; i < elements.length; i++) {
                    const el = elements[i];
                    const text = (el.textContent || el.getAttribute('value') || '').toLowerCase().trim();
                    const title = el.getAttribute('title') || '';
                    
                    // Look for German display button patterns first, then English
                    if (text === 'anzeigen' || 
                        text === 'display' ||
                        text.includes('anzeigen ohne') || 
                        text.includes('ohne anmeldung') ||
                        text.includes('display without') ||
                        title.toLowerCase().includes('anzeigen') ||
                        title.toLowerCase().includes('display') ||
                        (text.includes('anzeigen') && text.length < 30)) { // Allow longer anzeigen text
                        return { index: i, text: text, found: true, tagName: el.tagName };
                    }
                }
                return { found: false };
            });
        }
        
        console.log('Looking for display button:', displayButton);

        if (displayButton.found) {
            console.log(`Found display button: "${displayButton.text}", clicking...`);
            try {
                // Add timeout and better error handling
                                    await Promise.race([
                        page.evaluate((index: number) => {
                        const elements = Array.from(document.querySelectorAll('button, input[type="button"], a, span, div'));
                        const el = elements[index] as HTMLElement;
                        if (el) {
                            el.click();
                            return true;
                        }
                        return false;
                    }, (displayButton as any).index),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Click timeout')), 10000))
                ]);
                
                console.log('Display button clicked successfully');
                
                // Step 2: Wait for the German document list "Liste der Dokumente innerhalb dieser Vergabeunterlagen" to appear
                console.log('Waiting for document list "Liste der Dokumente innerhalb dieser Vergabeunterlagen" to appear...');
                let documentListLoaded = false;
                
                for (let i = 0; i < 15; i++) { // Wait up to 30 seconds
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    const documentListFound = await page.evaluate(() => {
                        const pageText = document.body.textContent || '';
                        return pageText.includes('Liste der Dokumente innerhalb dieser Vergabeunterlagen') ||
                               pageText.includes('List of the documents comprising these tender documents') ||
                               pageText.includes('Liste der Dokumente') ||
                               pageText.includes('Dokumente innerhalb') ||
                               pageText.includes('tender documents');
                    });
                    
                    if (documentListFound) {
                        documentListLoaded = true;
                        console.log(`Document list appeared after ${(i + 1) * 2} seconds`);
                        break;
                    }
                    console.log(`Waiting for document list... attempt ${i + 1}/15`);
                }
                
                console.log('Document list section found:', documentListLoaded);
                
                if (documentListLoaded) {
                    // Look specifically for tender documents in the "Liste der Dokumente innerhalb dieser Vergabeunterlagen" section
                    console.log('Looking for actual tender documents in the document list...');
                    
                    // Set up download capture before clicking any download buttons
                    const downloadPromises: Promise<{ fileName: string; buffer: Buffer }>[] = [];
                    
                    // Enhanced response listener to catch download files
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
                                contentType.includes('application/zip')) {
                                
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
                                    // For secure download URLs, use a more descriptive filename
                                    if (url.includes('securedownload.pl')) {
                                        // Try to find document ID and create meaningful filename
                                        const docIdMatch = url.match(/DokumentID=(\d+)/);
                                        if (docIdMatch) {
                                            fileName = `tender_document_${docIdMatch[1]}.pdf`;
                                        } else {
                                            fileName = 'tender_document.pdf';
                                        }
                                    } else {
                                        fileName = url.split('/').pop() || 'download';
                                    }
                                }
                                
                                // Skip platform documents
                                if (!fileName.includes('subreport') && 
                                    !fileName.includes('AGB') && 
                                    !fileName.includes('Datenschutz') &&
                                    !fileName.includes('Impressum')) {
                                    console.log(`Successfully captured: ${fileName} (${buffer.length} bytes, Content-Type: ${contentType})`);
                                    documents.set(fileName, buffer);
                                } else {
                                    console.log(`Skipped platform document: ${fileName}`);
                                }
                            }
                        } catch (error) {
                            // Ignore errors in response processing
                        }
                    });
                    
                    // Look for tender document download buttons in the list
                    const tenderDocuments = await page.evaluate(() => {
                        const results: Array<{text: string, index: number, buttonIndex: number}> = [];
                        
                        // Find all download buttons on the page
                        const allButtons = Array.from(document.querySelectorAll('button, a'));
                        
                        for (let i = 0; i < allButtons.length; i++) {
                            const btn = allButtons[i];
                            const text = (btn.textContent || '').toLowerCase().trim();
                            
                            if (text === 'download' || text === 'herunterladen') {
                                // Find the document name by looking at the row or container
                                let documentName = '';
                                
                                // Try to find the parent row or container
                                const possibleParents = [
                                    btn.closest('tr'),
                                    btn.closest('div'),
                                    btn.closest('td'),
                                    btn.parentElement,
                                    btn.parentElement?.parentElement
                                ].filter(Boolean);
                                
                                for (const parent of possibleParents) {
                                    if (parent) {
                                        const parentText = (parent.textContent || '').trim();
                                        // Look for text that contains D20 (tender number) and .pdf
                                        if (parentText.includes('D20') && parentText.includes('.pdf')) {
                                            documentName = parentText;
                                            break;
                                        }
                                        // Also look for files with common tender document patterns
                                        if (parentText.includes('.pdf') && 
                                            (parentText.includes('Gestaltung') || parentText.includes('Stellenanz'))) {
                                            documentName = parentText;
                                            break;
                                        }
                                    }
                                }
                                
                                // Skip if it's platform documents or if no proper document name found
                                if (documentName && 
                                    !documentName.includes('AGB') && 
                                    !documentName.includes('Datenschutz') &&
                                    !documentName.includes('Impressum') &&
                                    !documentName.includes('subreport') &&
                                    documentName.includes('.pdf')) {
                                    
                                    results.push({
                                        text: documentName,
                                        index: i,
                                        buttonIndex: i
                                    });
                                }
                            }
                        }
                        
                        return results;
                    });
                    
                    console.log('Found tender documents for download:', tenderDocuments);
                    
                    // Click each tender document download button
                    for (const doc of tenderDocuments) {
                        try {
                            console.log(`Clicking download for: ${doc.text}`);
                            
                            await page.evaluate((buttonIndex: number) => {
                                const buttons = Array.from(document.querySelectorAll('button, a'));
                                const btn = buttons[buttonIndex] as HTMLElement;
                                if (btn) {
                                    btn.click();
                                }
                            }, doc.buttonIndex);
                            
                            // Wait for download to process
                            await new Promise(resolve => setTimeout(resolve, 3000));
                            
                        } catch (error) {
                            console.log(`Failed to download ${doc.text}:`, error);
                        }
                    }
                    
                    // Wait a bit more for all downloads to complete
                    await new Promise(resolve => setTimeout(resolve, 5000));
                } else {
                    console.log('Document list did not appear within the expected time');
                }
            } catch (error) {
                console.log('Error in display button click process:', error);
            }
        } else {
            console.log('Display button not found, trying alternative approach...');
        }
    } catch (error) {
        console.log('Special subreport handling failed, continuing with general approach:', error);
    }
    
    return documents;
}
