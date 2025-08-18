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
        

        
        // Step 1: Find the display button
        const displayButton = await page.evaluate(() => {
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
                            
                            // Check if this is a file download - be more liberal with detection
                            if (contentDisposition.includes('attachment') || 
                                contentType.includes('application/pdf') ||
                                contentType.includes('application/msword') ||
                                contentType.includes('application/zip') ||
                                contentType.includes('application/octet-stream') ||
                                url.includes('securedownload') ||
                                url.includes('.pdf') ||
                                url.includes('download')) {
                                
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
                                    !fileName.toLowerCase().includes('impressum')) {
                                    
                                    try {
                                        const buffer = await response.buffer();
                                        if (buffer.length > 1000) { // Only include files larger than 1KB
                                            console.log(`Successfully captured: ${fileName} (${buffer.length} bytes)`);
                                            documents.set(fileName, buffer);
                                        }
                                    } catch (bufferError: any) {
                                        // Skip if we can't get the buffer (common with preflight requests)
                                        console.log(`Skipped response buffer capture for ${fileName}: ${bufferError.message || 'Unknown error'}`);
                                    }
                                }
                            }
                        } catch (error) {
                            // Skip response processing errors silently
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
                            
                                                        for (let attempt = 0; attempt < 15 && !popupHandled; attempt++) {
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                
                                // Enhanced popup detection
                                const popupInfo = await page.evaluate(() => {
                                    
                                    // Look for elements that contain download-related text
                                    const visibleElements = Array.from(document.querySelectorAll('*')).filter(el => {
                                        const style = getComputedStyle(el);
                                        return style.display !== 'none' && style.visibility !== 'hidden';
                                    });
                                    
                                    const downloadElements = visibleElements.filter(el => {
                                        const text = (el.textContent || '').toLowerCase();
                                        return text.includes('download') || text.includes('herunterladen') || 
                                               text.includes('login') || text.includes('anmelden') ||
                                               text.includes('registr') || text.includes('ohne');
                                    });
                                    
                                    // Look for various popup/modal/overlay containers with extensive selectors
                                    const popupSelectors = [
                                        '.modal', '.popup', '.dialog', '[role="dialog"]', '.overlay', '.ui-dialog',
                                        '.MuiDialog-root', '.ant-modal', '.modal-dialog', '.popup-content',
                                        '.lightbox', '.fancybox', '.colorbox', '.thickbox', '.nyromodal',
                                        'div[style*="position: fixed"]', 'div[style*="z-index"]',
                                        'div[style*="position: absolute"]', '[aria-modal="true"]',
                                        '.ui-widget-overlay', '.ui-front', '.modal-backdrop',
                                        // Add more specific selectors for the subreport popup
                                        'div[class*="popup"]', 'div[class*="modal"]', 'div[class*="dialog"]',
                                        'div[class*="overlay"]', 'div[class*="lightbox"]',
                                        // Specific selector for the subreport popup
                                        '#x-auto-6'
                                    ];
                                    
                                    let popup = null;
                                    let popupSelector = '';
                                    
                                    // First, try to find the specific popup by ID
                                    const specificPopup = document.getElementById('x-auto-6');
                                    if (specificPopup) {
                                        const style = getComputedStyle(specificPopup);
                                        if (style.display !== 'none' && style.visibility !== 'hidden') {
                                            console.log('Found specific popup with ID x-auto-6');
                                            popup = specificPopup;
                                            popupSelector = '#x-auto-6';
                                        }
                                    }
                                    
                                    // If specific popup not found, try other selectors
                                    if (!popup) {
                                        for (const selector of popupSelectors) {
                                            const elements = document.querySelectorAll(selector);
                                            for (const element of elements) {
                                                const style = getComputedStyle(element);
                                                if (style.display !== 'none' && style.visibility !== 'hidden') {
                                                    popup = element;
                                                    popupSelector = selector;
                                                    break;
                                                }
                                            }
                                            if (popup) break;
                                        }
                                    }
                                    
                                    // Enhanced fallback: look for any element that appeared with high z-index or overlay properties
                                    if (!popup) {
                                        console.log('No standard popup found, checking for custom overlays...');
                                        const allDivs = Array.from(document.querySelectorAll('div, section, aside, article'));
                                        
                                        for (const div of allDivs) {
                                            const style = getComputedStyle(div);
                                            const zIndex = parseInt(style.zIndex) || 0;
                                            
                                            // Check for overlay-like properties
                                            if ((style.position === 'fixed' || style.position === 'absolute') && 
                                                (zIndex > 100 || style.zIndex === 'auto') &&
                                                style.display !== 'none' && style.visibility !== 'hidden') {
                                                
                                                const text = (div.textContent || '').toLowerCase();
                                                console.log(`Checking overlay candidate: z-index=${zIndex}, position=${style.position}, text="${text.substring(0, 100)}"`);
                                                
                                                // Look for the specific popup content from the image description
                                                if (text.includes('hinweis') || text.includes('achtung') ||
                                                    text.includes('download') || text.includes('herunterladen') ||
                                                    text.includes('login') || text.includes('anmelden') ||
                                                    text.includes('registr') || text.includes('ohne') ||
                                                    text.includes('anmeldung') || text.includes('registration') ||
                                                    (zIndex > 999 && text.length > 10)) { // High z-index with content
                                                
                                                    console.log('Found custom popup/overlay!');
                                                    popup = div;
                                                    popupSelector = 'custom-overlay';
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                    
                                    const results = [];
                                    
                                    if (popup) {
                                        // Look for clickable elements within the popup
                                        const clickableElements = Array.from(popup.querySelectorAll('button, a, input[type="button"], span, div, td, th'));
                                        
                                        // Enhanced detection: Look specifically for the orange download button with icon
                                        const orangeDownloadButtons = Array.from(popup.querySelectorAll('button, a, input[type="button"]')).filter(btn => {
                                            const style = getComputedStyle(btn);
                                            const text = (btn.textContent || '').toLowerCase().trim();
                                            
                                            // Check for orange background (common CSS patterns)
                                            const backgroundColor = style.backgroundColor || '';
                                            const color = style.color || '';
                                            const className = btn.className || '';
                                            
                                            return (text === 'download' || text === 'herunterladen') &&
                                                   (backgroundColor.includes('orange') || 
                                                    backgroundColor.includes('rgb(255, 165, 0)') ||
                                                    backgroundColor.includes('rgb(255, 140, 0)') ||
                                                    className.includes('orange') ||
                                                    className.includes('download') ||
                                                    className.includes('btn-primary') ||
                                                    className.includes('btn-download'));
                                        });
                                        
                                        for (let i = 0; i < clickableElements.length; i++) {
                                            const btn = clickableElements[i];
                                            const text = (btn.textContent || btn.getAttribute('value') || '').toLowerCase().trim();
                                            const href = btn.getAttribute('href');
                                            const onclick = btn.getAttribute('onclick');
                                            const style = getComputedStyle(btn);
                                            const backgroundColor = style.backgroundColor || '';
                                            const className = btn.className || '';
                                            
                                            // Check if this is an orange download button (based on the image description)
                                            const isOrangeButton = (text === 'download' || text === 'herunterladen') &&
                                                (backgroundColor.includes('orange') || 
                                                 backgroundColor.includes('rgb(255, 165, 0)') ||
                                                 backgroundColor.includes('rgb(255, 140, 0)') ||
                                                 backgroundColor.includes('rgb(255, 69, 0)') ||
                                                 backgroundColor.includes('rgb(255, 99, 71)') ||
                                                 className.includes('orange') ||
                                                 className.includes('download') ||
                                                 className.includes('btn-primary') ||
                                                 className.includes('btn-download') ||
                                                 className.includes('btn-orange'));
                                            
                                            // Also check for buttons with download icons (white downward arrow)
                                            const hasDownloadIcon = btn.querySelector('i, span, img') && 
                                                (btn.innerHTML.includes('arrow') || 
                                                 btn.innerHTML.includes('download') ||
                                                 btn.innerHTML.includes('↓') ||
                                                 btn.innerHTML.includes('&#8595;'));
                                            
                                            // Look for download buttons with broader matching - prioritize exact "Download" button
                                            if (text === 'download' || text === 'herunterladen' || 
                                                text.includes('ohne anmeldung') || text.includes('without registration') ||
                                                text.includes('download') || text.includes('herunterladen') ||
                                                href?.includes('download') || onclick?.includes('download')) {
                                                
                                                results.push({
                                                    text: text,
                                                    tagName: btn.tagName,
                                                    href: href,
                                                    onclick: onclick,
                                                    className: btn.className,
                                                    id: btn.id,
                                                    isDownload: true,
                                                    isOrangeButton: isOrangeButton,
                                                    hasDownloadIcon: hasDownloadIcon,
                                                    globalIndex: Array.from(document.querySelectorAll('*')).indexOf(btn)
                                                });
                                            }
                                        }
                                    } else {
                                        console.log('=== NO POPUP FOUND ===');
                                        
                                        // Final fallback: look for ANY download buttons that appeared recently
                                        console.log('Checking all page elements for download buttons...');
                                        const allButtons = Array.from(document.querySelectorAll('button, a, input[type="button"], span, div'));
                                        let foundButtons = 0;
                                        
                                        for (const btn of allButtons) {
                                            const text = (btn.textContent || btn.getAttribute('value') || '').toLowerCase().trim();
                                            const style = getComputedStyle(btn);
                                            const href = btn.getAttribute('href');
                                            const onclick = btn.getAttribute('onclick');
                                            
                                            if ((text.includes('download') || text.includes('herunterladen') || 
                                                text.includes('ohne anmeldung') || text.includes('without registration') ||
                                                href?.includes('download') || onclick?.includes('download')) &&
                                                style.display !== 'none' && style.visibility !== 'hidden') {
                                                
                                                foundButtons++;
                                                console.log(`Found standalone download button: "${text}" (${btn.tagName})`);
                                            
                                            results.push({
                                                text: text,
                                                    tagName: btn.tagName,
                                                    href: href,
                                                    onclick: onclick,
                                                    className: btn.className,
                                                    id: btn.id,
                                                    isDownload: true,
                                                    globalIndex: Array.from(document.querySelectorAll('*')).indexOf(btn)
                                                });
                                            }
                                        }
                                        
                                        console.log(`Found ${foundButtons} standalone download buttons`);
                                    }
                                    
                                    console.log(`=== DETECTION RESULT: ${results.length} download options found ===`);
                                    return results;
                                });
                                
                                if (popupInfo.length > 0) {
                                    
                                    // Find the best download button - prioritize orange download buttons with icons first
                                    let downloadButton = popupInfo.find((btn: any) => 
                                        btn.isOrangeButton === true && btn.hasDownloadIcon === true
                                    );
                                    
                                    // Fallback to any orange download button
                                    if (!downloadButton) {
                                        downloadButton = popupInfo.find((btn: any) => 
                                            btn.isOrangeButton === true
                                        );
                                    }
                                    
                                    // Fallback to buttons with download icons
                                    if (!downloadButton) {
                                        downloadButton = popupInfo.find((btn: any) => 
                                            btn.hasDownloadIcon === true
                                        );
                                    }
                                    
                                    // Fallback to exact download text
                                    if (!downloadButton) {
                                        downloadButton = popupInfo.find((btn: any) => 
                                            btn.text === 'download' || btn.text === 'herunterladen'
                                        );
                                    }
                                    
                                    // Fallback to buttons with download-related text
                                    if (!downloadButton) {
                                        downloadButton = popupInfo.find((btn: any) => 
                                            btn.text.includes('ohne anmeldung') || btn.text.includes('without registration') ||
                                            btn.text.includes('download') || btn.text.includes('herunterladen') ||
                                            btn.href?.includes('download') || btn.onclick?.includes('download')
                                        );
                                    }
                                    
                                    if (downloadButton) {
                                        console.log(`Clicking download button: "${downloadButton.text}"`);
                                        
                                        // Enhanced click logic with multiple fallback methods
                                        const clickSuccess = await page.evaluate((buttonInfo: any) => {
                                            try {
                                                // Method 1: Try to find by global index first
                                                const allElements = Array.from(document.querySelectorAll('*'));
                                                let targetButton = allElements[buttonInfo.globalIndex];
                                                
                                                if (!targetButton) {
                                                    
                                                    // Method 2: Find by exact text and tag name
                                                    const exactMatch = Array.from(document.querySelectorAll('button, a, input[type="button"], span, div')).find((btn: any) => {
                                                        const text = (btn.textContent || btn.getAttribute('value') || '').toLowerCase().trim();
                                                        return text === buttonInfo.text.toLowerCase() && btn.tagName === buttonInfo.tagName;
                                                    });
                                                    
                                                    if (exactMatch) {
                                                        targetButton = exactMatch;
                                                    } else {
                                                        // Method 3: Find by class name (for GWT buttons)
                                                        if (buttonInfo.className) {
                                                            const classMatch = document.querySelector(`.${buttonInfo.className.split(' ')[0]}`);
                                                            if (classMatch) {
                                                                targetButton = classMatch;
                                                            }
                                                        }
                                                        
                                                        // Method 4: Find any button with download text
                                                        if (!targetButton) {
                                                            const downloadButtons = Array.from(document.querySelectorAll('button, a, input[type="button"]')).filter((btn: any) => {
                                                                const text = (btn.textContent || '').toLowerCase().trim();
                                                                return text === 'download' || text === 'herunterladen';
                                                            });
                                                            
                                                            if (downloadButtons.length > 0) {
                                                                targetButton = downloadButtons[0];
                                                            }
                                                        }
                                                        
                                                        // Method 5: Specific handling for GWT buttons (common in subreport)
                                                        if (!targetButton) {
                                                            const gwtButtons = Array.from(document.querySelectorAll('button.gwt-Button, div.gwt-Button')).filter((btn: any) => {
                                                                const text = (btn.textContent || '').toLowerCase().trim();
                                                                return text === 'download' || text === 'herunterladen';
                                                            });
                                                            
                                                            if (gwtButtons.length > 0) {
                                                                targetButton = gwtButtons[0];
                                                                console.log('Found GWT download button:', targetButton);
                                                            }
                                                        }
                                                        
                                                        // Method 6: Target the specific popup structure from the HTML
                                                        if (!targetButton) {
                                                            // Look for the popup with ID x-auto-6
                                                            const popup = document.getElementById('x-auto-6');
                                                            if (popup) {
                                                                console.log('Found popup with ID x-auto-6');
                                                                
                                                                // Look for the download button with specific classes and positioning
                                                                const downloadBtn = popup.querySelector('button.gwt-Button[style*="left: 185px"]');
                                                                if (downloadBtn) {
                                                                    targetButton = downloadBtn;
                                                                    console.log('Found download button by specific positioning:', targetButton);
                                                                } else {
                                                                    // Fallback: look for button containing "Download" text in the popup
                                                                    const buttons = popup.querySelectorAll('button.gwt-Button');
                                                                    for (const btn of buttons) {
                                                                        const text = (btn.textContent || '').toLowerCase().trim();
                                                                        if (text === 'download') {
                                                                            targetButton = btn;
                                                                            console.log('Found download button by text in popup:', targetButton);
                                                                            break;
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                        
                                                        // Method 7: Look for download buttons inside containers (common in popups)
                                                        if (!targetButton) {
                                                            const containers = Array.from(document.querySelectorAll('div, span, td')).filter((container: any) => {
                                                                const text = (container.textContent || '').toLowerCase();
                                                                return text.includes('download') && text.includes('login') && text.includes('registrierung');
                                                            });
                                                            
                                                            for (const container of containers) {
                                                                const downloadBtn = container.querySelector('button, a, input[type="button"]');
                                                                if (downloadBtn) {
                                                                    const text = (downloadBtn.textContent || '').toLowerCase().trim();
                                                                    if (text === 'download' || text === 'herunterladen') {
                                                                        targetButton = downloadBtn;
                                                                        console.log('Found download button inside container:', targetButton);
                                                                        break;
                                                                    }
                                                                }
                                                            }
                                                        }
                                                        
                                                        // Method 8: Direct targeting using the exact HTML structure
                                                        if (!targetButton) {
                                                            // Try to find the button by the exact structure from the HTML
                                                            const exactButton = document.querySelector('button.gwt-Button.GIVH1UACAK.GIVH1UACKK[style*="left: 185px"]');
                                                            if (exactButton) {
                                                                targetButton = exactButton;
                                                                console.log('Found exact download button by CSS selector:', targetButton);
                                                            } else {
                                                                // Try finding by the specific class combination
                                                                const buttons = document.querySelectorAll('button.gwt-Button.GIVH1UACAK.GIVH1UACKK');
                                                                for (const btn of buttons) {
                                                                    const text = (btn.textContent || '').toLowerCase().trim();
                                                                    if (text === 'download') {
                                                                        targetButton = btn;
                                                                        console.log('Found download button by class combination:', targetButton);
                                                                        break;
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                                
                                                if (targetButton) {
                                                    console.log('Target button found, attempting to click...');
                                                    
                                                    // Try multiple click methods
                                                    let clickSuccess = false;
                                                    
                                                    // Method 1: Direct click
                                                    try {
                                                        if (typeof (targetButton as any).click === 'function') {
                                                            (targetButton as HTMLElement).click();
                                                            console.log('Direct click performed successfully');
                                                            clickSuccess = true;
                                                        }
                                                    } catch (e) {
                                                        console.log('Direct click failed:', e);
                                                    }
                                                    
                                                    // Method 2: Dispatch click event if direct click didn't work
                                                    if (!clickSuccess) {
                                                        try {
                                                            const clickEvent = new MouseEvent('click', {
                                                                view: window,
                                                                bubbles: true,
                                                                cancelable: true
                                                            });
                                                            targetButton.dispatchEvent(clickEvent);
                                                            console.log('Click event dispatched successfully');
                                                            clickSuccess = true;
                                                        } catch (e) {
                                                            console.log('Click event dispatch failed:', e);
                                                        }
                                                    }
                                                    
                                                    // Method 3: Try mousedown + mouseup events
                                                    if (!clickSuccess) {
                                                        try {
                                                            const mouseDownEvent = new MouseEvent('mousedown', {
                                                                view: window,
                                                                bubbles: true,
                                                                cancelable: true
                                                            });
                                                            const mouseUpEvent = new MouseEvent('mouseup', {
                                                                view: window,
                                                                bubbles: true,
                                                                cancelable: true
                                                            });
                                                            targetButton.dispatchEvent(mouseDownEvent);
                                                            targetButton.dispatchEvent(mouseUpEvent);
                                                            console.log('Mouse events dispatched successfully');
                                                            clickSuccess = true;
                                                        } catch (e) {
                                                            console.log('Mouse events failed:', e);
                                                        }
                                                    }
                                                    
                                                    // Method 4: If it's a link with href, handle navigation
                                                    if (!clickSuccess && targetButton.tagName === 'A' && buttonInfo.href) {
                                                        console.log('Opening link in new tab:', buttonInfo.href);
                                                        if (buttonInfo.href !== '#' && buttonInfo.href !== 'javascript:void(0)') {
                                                            window.open(buttonInfo.href, '_blank');
                                                            clickSuccess = true;
                                                        }
                                                    }
                                                    
                                                    // Method 5: If it has onclick, try to execute it
                                                    if (!clickSuccess && buttonInfo.onclick) {
                                                        try {
                                                            console.log('Executing onclick:', buttonInfo.onclick);
                                                            eval(buttonInfo.onclick);
                                                            clickSuccess = true;
                                                        } catch (e) {
                                                            console.log('Onclick execution failed:', e);
                                                        }
                                                    }
                                                    
                                                    return clickSuccess;
                                                } else {
                                                    console.log('No target button found with any method');
                                                    return false;
                                                }
                                            } catch (error) {
                                                console.log('Error in click logic:', error);
                                                return false;
                                            }
                                        }, downloadButton);
                        
                                        if (clickSuccess) {
                                            console.log('Popup download button clicked successfully');
                                            
                                            // Wait a bit for the download to process
                                            await new Promise(resolve => setTimeout(resolve, 3000));
                                            
                                            popupHandled = true;
                                            break;
                                        } else {
                                            console.log('Failed to click popup button, trying next attempt...');
                                            
                                            // Additional retry: try clicking with a small delay
                                            if (attempt < 3) {
                                                console.log('Attempting retry with delay...');
                                                await new Promise(resolve => setTimeout(resolve, 1000));
                                                
                                                // Try clicking again with a different approach
                                                const retryClick = await page.evaluate(() => {
                                                    const downloadButtons = Array.from(document.querySelectorAll('button, a, input[type="button"]')).filter((btn: any) => {
                                                        const text = (btn.textContent || '').toLowerCase().trim();
                                                        return text === 'download' || text === 'herunterladen';
                                                    });
                                                    
                                                    if (downloadButtons.length > 0) {
                                                        const btn = downloadButtons[0];
                                                        try {
                                                            (btn as HTMLElement).click();
                                                            return true;
                                                        } catch (e) {
                                                            return false;
                                                        }
                                                    }
                                                    return false;
                                                });
                                                
                                                if (retryClick) {
                                                    console.log('Retry click successful');
                                                    await new Promise(resolve => setTimeout(resolve, 3000));
                                                    popupHandled = true;
                                                    break;
                                                }
                                            }
                                        }
                                    } else {
                                        console.log('No suitable download button found in popup options');
                                    }
                                } else {
                                    console.log(`No popup download options found on attempt ${attempt + 1}`);
                                    
                                    // Additional debugging: check what's actually on the page
                                    if (attempt < 3) {
                                        const pageContent = await page.evaluate(() => {
                                            const allText = document.body.textContent || '';
                                            const hasNewContent = allText.includes('download') || allText.includes('herunterladen') || 
                                                                allText.includes('login') || allText.includes('anmelden') ||
                                                                allText.includes('ohne') || allText.includes('registr');
                                            
                                            // Count visible clickable elements
                                            const clickables = Array.from(document.querySelectorAll('button, a, input[type="button"]'))
                                                .filter(el => {
                                                    const style = getComputedStyle(el);
                                                    return style.display !== 'none' && style.visibility !== 'hidden';
                                                });
                                            
                                            return {
                                                hasDownloadText: hasNewContent,
                                                clickableCount: clickables.length,
                                                bodyTextLength: allText.length,
                                                sampleText: allText.substring(0, 500)
                                            };
                                        });
                                        
                                        console.log(`Page analysis attempt ${attempt + 1}:`, pageContent);
                                        
                                        // Try a more direct approach - look for any recently added elements
                                        const directDownloadAttempt = await page.evaluate(() => {
                                            // Look for any element that might be a download button that appeared recently
                                            const allElements = Array.from(document.querySelectorAll('*'));
                                            const possibleDownloads = [];
                                            
                                            for (const el of allElements) {
                                                const text = (el.textContent || '').toLowerCase();
                                                const href = el.getAttribute('href') || '';
                                                const onclick = el.getAttribute('onclick') || '';
                                                
                                                if ((text.includes('download') || text.includes('herunterladen') ||
                                                    href.includes('download') || href.includes('securedownload') ||
                                                    onclick.includes('download')) && 
                                                    getComputedStyle(el).display !== 'none') {
                                                    
                                                    possibleDownloads.push({
                                                        tagName: el.tagName,
                                                        text: text.substring(0, 100),
                                                        href: href,
                                                        onclick: onclick.substring(0, 100),
                                                        className: el.className,
                                                        id: el.id
                                                    });
                                                }
                                            }
                                            
                                            return possibleDownloads;
                                        });
                                        
                                        console.log(`Direct download search found ${directDownloadAttempt.length} possibilities:`, directDownloadAttempt);
                                        
                                        // If we found direct download elements, try clicking them
                                        if (directDownloadAttempt.length > 0) {
                                            console.log('Attempting direct download click...');
                                            const clickResult = await page.evaluate((downloads: any[]) => {
                                                for (const download of downloads) {
                                                    // Find and click the element
                                                    const elements = Array.from(document.querySelectorAll('*'));
                                                    for (const el of elements) {
                                                        if (el.tagName === download.tagName && 
                                                            el.className === download.className &&
                                                            el.id === download.id) {
                                                            
                                                            try {
                                                                (el as HTMLElement).click();
                                                                console.log('Clicked direct download element:', el);
                                                                return true;
                                                            } catch (e) {
                                                                console.log('Click failed:', e);
                                                            }
                                                        }
                                                    }
                                                }
                                                return false;
                                            }, directDownloadAttempt);
                                            
                                            if (clickResult) {
                                                console.log('Direct download click succeeded, waiting for response...');
                                                await new Promise(resolve => setTimeout(resolve, 3000));
                                                popupHandled = true;
                                                break;
                                            }
                                        }
                                    }
                                }
                                
                                if (attempt === 14) {
                                    console.log('No popup download button found after 15 seconds, continuing...');
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
