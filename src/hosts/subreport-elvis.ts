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
                            
                            console.log(`Response: ${url} | Content-Type: ${contentType} | Content-Disposition: ${contentDisposition}`);
                            
                            // Check if this is a file download - be more liberal with detection
                            if (contentDisposition.includes('attachment') || 
                                contentType.includes('application/pdf') ||
                                contentType.includes('application/msword') ||
                                contentType.includes('application/zip') ||
                                contentType.includes('application/octet-stream') ||
                                url.includes('securedownload') ||
                                url.includes('.pdf') ||
                                url.includes('download')) {
                                
                                console.log(`Attempting to capture download: ${url}`);
                                const buffer = await response.buffer();
                                console.log(`Buffer size: ${buffer.length} bytes`);
                                
                                // Extract filename from content-disposition or URL
                                let fileName = 'download.pdf';
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
                                    } else if (url.includes('.pdf')) {
                                        // Extract filename from URL if it contains .pdf
                                        const urlParts = url.split('/');
                                        const possibleFile = urlParts[urlParts.length - 1];
                                        if (possibleFile.includes('.pdf')) {
                                            fileName = possibleFile;
                                        }
                                    } else {
                                        fileName = url.split('/').pop() || 'download.pdf';
                                    }
                                }
                                
                                // Only skip obviously platform documents, be more inclusive
                                if (!fileName.toLowerCase().includes('agb') && 
                                    !fileName.toLowerCase().includes('datenschutz') &&
                                    !fileName.toLowerCase().includes('impressum') &&
                                    buffer.length > 1000) { // Only include files larger than 1KB
                                    console.log(`Successfully captured: ${fileName} (${buffer.length} bytes, Content-Type: ${contentType})`);
                                    documents.set(fileName, buffer);
                                } else {
                                    console.log(`Skipped document: ${fileName} (${buffer.length} bytes)`);
                                }
                            }
                        } catch (error) {
                            console.log(`Error processing response: ${error}`);
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
                            
                            // After clicking the download button, wait for popup and handle it
                            console.log('Waiting for download popup to appear...');
                            let popupHandled = false;
                            
                            for (let attempt = 0; attempt < 10 && !popupHandled; attempt++) {
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                
                                // Look for popup with download, login, and registrirung buttons
                                const popupButtons = await page.evaluate(() => {
                                    // Look for modal or popup elements
                                    const modals = Array.from(document.querySelectorAll('.modal, .popup, .dialog, [role="dialog"], .overlay, .ui-dialog'));
                                    const allButtons = Array.from(document.querySelectorAll('button, a, input[type="button"], span, div'));
                                    
                                    // Get buttons from modal if found, otherwise check all visible buttons
                                    let buttonsToCheck = allButtons;
                                    if (modals.length > 0) {
                                        const modal = modals[0];
                                        const modalButtons = Array.from(modal.querySelectorAll('button, a, input[type="button"], span, div'));
                                        if (modalButtons.length > 0) {
                                            buttonsToCheck = modalButtons;
                                        }
                                    }
                                    
                                    const results: Array<{text: string, index: number, isDownload: boolean}> = [];
                                    
                                    for (let i = 0; i < buttonsToCheck.length; i++) {
                                        const btn = buttonsToCheck[i];
                                        const text = (btn.textContent || btn.getAttribute('value') || '').toLowerCase().trim();
                                        
                                        // Look for download, login, or registrirung buttons
                                        if (text === 'download' || text === 'herunterladen' || 
                                            text === 'login' || text === 'anmelden' ||
                                            text === 'registrirung' || text === 'registrierung') {
                                            
                                            // Find the global index of this button
                                            const globalIndex = Array.from(document.querySelectorAll('button, a, input[type="button"], span, div')).indexOf(btn);
                                            
                                            results.push({
                                                text: text,
                                                index: globalIndex,
                                                isDownload: text === 'download' || text === 'herunterladen'
                                            });
                                        }
                                    }
                                    
                                    return results;
                                });
                                
                                if (popupButtons.length > 0) {
                                    console.log('Found popup buttons:', popupButtons);
                                    
                                    // Find the download button in the popup
                                    const downloadButton = popupButtons.find((btn: {text: string, index: number, isDownload: boolean}) => btn.isDownload);
                                    
                                    if (downloadButton) {
                                        console.log(`Clicking popup download button: "${downloadButton.text}"`);
                                        
                                                                // Set up listener for new tabs/windows that might open for downloads
                        const newPagePromise = new Promise<any>((resolve) => {
                            page.browser().on('targetcreated', async (target: any) => {
                                if (target.type() === 'page') {
                                    const newPage = await target.page();
                                    if (newPage) {
                                        console.log('New page/tab detected for download');
                                        resolve(newPage);
                                    }
                                }
                            });
                            
                            // Timeout after 10 seconds if no new page opens
                            setTimeout(() => resolve(null), 10000);
                        });
                        
                        await page.evaluate((buttonIndex: number) => {
                            const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"], span, div'));
                            const btn = buttons[buttonIndex] as HTMLElement;
                            if (btn) {
                                btn.click();
                                return true;
                            }
                            return false;
                        }, downloadButton.index);
                        
                        console.log('Popup download button clicked successfully');
                        
                        // Wait to see if a new page opens for the download
                        const newPage = await newPagePromise;
                        if (newPage) {
                            console.log('New page/tab opened - monitoring for PDF content...');
                            
                            let pdfCaptured = false;
                            
                            // Set up response listener for the new page to capture PDF content
                            newPage.on('response', async (response: any) => {
                                try {
                                    const url = response.url();
                                    const headers = response.headers();
                                    const contentType = headers['content-type'] || '';
                                    const contentDisposition = headers['content-disposition'] || '';
                                    
                                    console.log(`New page response: ${url} | Content-Type: ${contentType}`);
                                    
                                    // Check if this is a PDF or document file
                                    if (contentType.includes('application/pdf') ||
                                        contentType.includes('application/msword') ||
                                        contentType.includes('application/zip') ||
                                        contentType.includes('application/octet-stream') ||
                                        url.includes('securedownload') ||
                                        url.includes('.pdf') ||
                                        url.includes('download')) {
                                        
                                        console.log(`Capturing PDF content from new page: ${url}`);
                                        const buffer = await response.buffer();
                                        console.log(`PDF file size: ${buffer.length} bytes`);
                                        
                                        let fileName = 'tender_document.pdf';
                                        
                                        // Try to extract filename from content-disposition
                                        if (contentDisposition && contentDisposition.includes('filename')) {
                                            const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                                            if (match) {
                                                fileName = match[1].replace(/['"]/g, '');
                                            }
                                        } else if (url.includes('securedownload.pl')) {
                                            // Extract document ID for meaningful filename
                                            const docIdMatch = url.match(/DokumentID=(\d+)/);
                                            if (docIdMatch) {
                                                fileName = `tender_document_${docIdMatch[1]}.pdf`;
                                            } else {
                                                fileName = 'tender_document.pdf';
                                            }
                                        } else if (url.includes('.pdf')) {
                                            // Try to get filename from URL
                                            const urlParts = url.split('/');
                                            const possibleFile = urlParts[urlParts.length - 1];
                                            if (possibleFile.includes('.pdf')) {
                                                fileName = possibleFile.split('?')[0]; // Remove query parameters
                                            }
                                        }
                                        
                                        if (buffer.length > 1000) { // Only capture files larger than 1KB
                                            console.log(`Successfully captured PDF: ${fileName} (${buffer.length} bytes)`);
                                            documents.set(fileName, buffer);
                                            pdfCaptured = true;
                                        }
                                    }
                                } catch (error) {
                                    console.log(`Error processing new page response: ${error}`);
                                }
                            });
                            
                            // Wait for the page to load and PDF to be captured
                            console.log('Waiting for PDF to load in new tab...');
                            for (let i = 0; i < 15; i++) { // Wait up to 15 seconds
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                if (pdfCaptured) {
                                    console.log('PDF successfully captured from new tab!');
                                    break;
                                }
                                if (i === 14) {
                                    console.log('PDF capture timeout - trying alternative method...');
                                    
                                    // Alternative: try to get the URL and fetch directly
                                    try {
                                        const currentUrl = newPage.url();
                                        console.log(`New page URL: ${currentUrl}`);
                                        
                                        if (currentUrl.includes('securedownload') || currentUrl.includes('.pdf')) {
                                            console.log('Attempting direct fetch of PDF from URL...');
                                            
                                            // Try to get the content directly via evaluate
                                            const pdfBuffer = await newPage.evaluate(async () => {
                                                try {
                                                    const response = await fetch(window.location.href);
                                                    const arrayBuffer = await response.arrayBuffer();
                                                    return Array.from(new Uint8Array(arrayBuffer));
                                                } catch (error) {
                                                    return null;
                                                }
                                            });
                                            
                                            if (pdfBuffer && pdfBuffer.length > 1000) {
                                                const buffer = Buffer.from(pdfBuffer);
                                                const fileName = `tender_document_${Date.now()}.pdf`;
                                                console.log(`Successfully fetched PDF directly: ${fileName} (${buffer.length} bytes)`);
                                                documents.set(fileName, buffer);
                                            }
                                        }
                                    } catch (error) {
                                        console.log('Direct fetch failed:', error);
                                    }
                                }
                            }
                            
                            try {
                                await newPage.close();
                                console.log('New tab closed');
                            } catch (error) {
                                console.log('Error closing new page:', error);
                            }
                        }
                        
                        popupHandled = true;
                        break;
                                    }
                                }
                                
                                if (attempt === 9) {
                                    console.log('No popup detected after 10 seconds, continuing...');
                                }
                            }
                            
                            // Wait for download to process after popup handling
                            await new Promise(resolve => setTimeout(resolve, 5000));
                            
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
