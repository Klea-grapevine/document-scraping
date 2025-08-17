import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export async function handleVergabekooperationBerlin(page: any, url: string): Promise<Map<string, Buffer>> {
    const documents = new Map<string, Buffer>();

    try {
        console.log('Detected Vergabekooperation Berlin - applying special handling...');

        // Wait for the page to load completely
        console.log('Waiting for page to fully load...');
        await page.waitForSelector('body', { timeout: 15000 });

        // Wait for content to appear
        let contentLoaded = false;
        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const hasExpectedContent = await page.evaluate(() => {
                const text = document.body.textContent || '';
                return text.includes('Teilnahmewettbewerbsunterlagen') ||
                       text.includes('Download') ||
                       text.includes('Version') ||
                       text.includes('Nachrichten') ||
                       text.includes('Ausschreibung');
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

        // Set up temporary download directory and enable downloads
        console.log('Setting up temporary download handling...');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'berlin-docs-'));
        console.log(`Using temporary directory: ${tempDir}`);
        
        let downloadCaptured = false;

        // Enable downloads to temporary directory
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: tempDir
        });

        // Monitor for file creation in temp directory
        const checkForDownloads = async (): Promise<boolean> => {
            try {
                const files = fs.readdirSync(tempDir);
                const zipFiles = files.filter(file => file.endsWith('.zip'));
                
                if (zipFiles.length > 0) {
                    for (const fileName of zipFiles) {
                        const filePath = path.join(tempDir, fileName);
                        const stats = fs.statSync(filePath);
                        
                        // Check if file is complete (not being written to)
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        const statsAfter = fs.statSync(filePath);
                        
                        if (stats.size === statsAfter.size && stats.size > 0) {
                            console.log(`Found completed download: ${fileName} (${stats.size} bytes)`);
                            
                            // Read file into memory and add to documents
                            const buffer = fs.readFileSync(filePath);
                            documents.set(fileName, buffer);
                            
                            // Clean up temp file
                            fs.unlinkSync(filePath);
                            console.log(`Successfully captured and cleaned up: ${fileName} (${buffer.length} bytes)`);
                            
                            return true;
                        }
                    }
                }
                return false;
            } catch (error) {
                console.log(`Error checking for downloads: ${error}`);
                return false;
            }
        };

        // Set up download event listener as backup
        page.on('download', async (download: any) => {
            try {
                const fileName = download.suggestedFilename();
                console.log(`Download event detected: ${fileName}`);
                downloadCaptured = true;
            } catch (error) {
                console.log(`Error processing download event:`, error);
            }
        });

        // Look for the download button in the Teilnahmewettbewerbsunterlagen table
        console.log('Looking for download button in Teilnahmewettbewerbsunterlagen table...');
        const downloadButton = await page.evaluate(() => {
            const tables = Array.from(document.querySelectorAll('table'));

            for (const table of tables) {
                const tableText = table.textContent || '';
                if (tableText.includes('Teilnahmewettbewerbsunterlagen') || tableText.includes('Version')) {
                    // Look for download button or icon in this table
                    const downloadElements = table.querySelectorAll('a, button, [onclick]');
                    for (let i = 0; i < downloadElements.length; i++) {
                        const el = downloadElements[i];
                        const text = (el.textContent || '').toLowerCase().trim();
                        const hasDownloadIcon = el.innerHTML.includes('download') ||
                                               el.innerHTML.includes('arrow') ||
                                               el.innerHTML.includes('↓') ||
                                               el.getAttribute('title')?.toLowerCase().includes('download');

                        if (text === 'download' || text === '' && hasDownloadIcon || el.getAttribute('onclick')) {
                            return { index: i, text: text || 'download icon', found: true, element: 'download' };
                        }
                    }
                }
            }
            return { found: false };
        });

        if (downloadButton.found) {
            console.log(`Found download button: "${downloadButton.text}", clicking to open popup...`);

            // Click the download button to open the popup
            await page.evaluate((buttonIndex: number) => {
                const tables = Array.from(document.querySelectorAll('table'));
                for (const table of tables) {
                    const tableText = table.textContent || '';
                    if (tableText.includes('Teilnahmewettbewerbsunterlagen') || tableText.includes('Version')) {
                        const downloadElements = table.querySelectorAll('a, button, [onclick]');
                        const el = downloadElements[buttonIndex] as HTMLElement;
                        if (el) {
                            el.click();
                            return true;
                        }
                    }
                }
                return false;
            }, downloadButton.index);

            console.log('Download button clicked, waiting for popup...');

            // Wait for popup to appear and look for the selection buttons
            let popupHandled = false;
            for (let attempt = 0; attempt < 10 && !popupHandled; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Debug: Let's see what's in the popup first
                if (attempt === 0) {
                    const popupInfo = await page.evaluate(() => {
                        // Look for modal or popup elements
                        const modals = Array.from(document.querySelectorAll('.modal, .popup, .dialog, [role="dialog"], .overlay'));
                        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
                        const allButtons = Array.from(document.querySelectorAll('button, a, input[type="button"], span, div'));
                        
                        // Get buttons specifically from the modal
                        const modal = modals.length > 0 ? modals[0] : null;
                        const modalButtons = modal ? Array.from(modal.querySelectorAll('button, a, input[type="button"], span, div, [onclick]')) : [];
                        
                        return {
                            modalCount: modals.length,
                            checkboxCount: checkboxes.length,
                            visibleText: document.body.textContent?.includes('Bestandteile der Teilnahmewettbewerbsunterlagen'),
                            hasCloseButton: allButtons.some(btn => (btn.textContent || '').includes('×')),
                            modalButtonTexts: modalButtons.map(btn => {
                                const text = (btn.textContent || '').trim();
                                const onclick = btn.getAttribute('onclick') || '';
                                const id = btn.getAttribute('id') || '';
                                const className = btn.getAttribute('class') || '';
                                return {
                                    text: text.length < 50 ? text : text.substring(0, 50) + '...',
                                    onclick: onclick.substring(0, 100),
                                    id: id,
                                    className: className,
                                    tagName: btn.tagName
                                };
                            }).slice(0, 25), // Include all buttons, not just ones with text
                            buttonTexts: allButtons.map(btn => (btn.textContent || '').trim()).filter(text => text.length > 0 && text.length < 50).slice(0, 20)
                        };
                    });
                                        console.log('Popup analysis:', popupInfo);
                    
                    // Also look for any buttons at the bottom of the modal
                    const modalFooterButtons = await page.evaluate(() => {
                        // Look for buttons that might be in the footer area or have specific classes
                        const footerButtons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], .btn, .button'));
                        return footerButtons.map(btn => {
                            const text = (btn.textContent || '').trim();
                            const onclick = btn.getAttribute('onclick') || '';
                            const id = btn.getAttribute('id') || '';
                            const className = btn.getAttribute('class') || '';
                            const value = btn.getAttribute('value') || '';
                            return {
                                text: text.length < 50 ? text : text.substring(0, 50) + '...',
                                onclick: onclick.substring(0, 100),
                                id: id,
                                className: className,
                                value: value,
                                tagName: btn.tagName
                            };
                        }).filter(info => info.text.length > 0 || info.onclick.length > 0 || info.value.length > 0);
                    });
                    console.log('Footer/button elements:', modalFooterButtons);
                }
                
                // First, try to select all checkboxes if they exist
                const checkboxesSelected = await page.evaluate(() => {
                    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
                    if (checkboxes.length > 0) {
                        console.log(`Found ${checkboxes.length} checkboxes, selecting all`);
                        checkboxes.forEach(checkbox => {
                            if (!checkbox.checked) {
                                checkbox.click();
                            }
                        });
                        return true;
                    }
                    return false;
                });

                if (checkboxesSelected) {
                    console.log('Selected all checkboxes in popup');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // After selecting checkboxes, look for "Alles auswählen" button that might appear
                    const selectAllAfterCheckboxes = await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], .btn, .button, [onclick]'));
                        for (const btn of buttons) {
                            const text = (btn.textContent || '').toLowerCase().trim();
                            const value = (btn.getAttribute('value') || '').toLowerCase().trim();
                            const title = btn.getAttribute('title') || '';
                            const onclick = btn.getAttribute('onclick') || '';
                            
                            if (text === 'alles auswählen' || 
                                value === 'alles auswählen' ||
                                text.includes('alles auswählen') || 
                                text.includes('select all') || 
                                text.includes('alle auswählen') ||
                                title.toLowerCase().includes('alles auswählen') ||
                                onclick.includes('selectAll') ||
                                onclick.includes('SelectAll')) {
                                (btn as HTMLElement).click();
                                return { found: true, text: text || value || title || 'onclick action' };
                            }
                        }
                        return { found: false };
                    });
                    
                    if (selectAllAfterCheckboxes.found) {
                        console.log(`Found and clicked "Alles auswählen" button: "${selectAllAfterCheckboxes.text}"`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }

                // Now look for download button - be very specific for this popup
                const downloadSelectionFound = await page.evaluate(() => {
                    // Look specifically for buttons with "Auswahl herunterladen" text
                    const allButtons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], .btn, .button, [onclick]'));
                    
                    // First priority: exact text matches for download buttons
                    for (const btn of allButtons) {
                        const text = (btn.textContent || '').toLowerCase().trim();
                        const value = (btn.getAttribute('value') || '').toLowerCase().trim();
                        const title = btn.getAttribute('title') || '';
                        
                        if (text === 'auswahl herunterladen' || 
                            value === 'auswahl herunterladen' ||
                            text === 'download selection' ||
                            value === 'download selection') {
                            (btn as HTMLElement).click();
                            return { found: true, text: text || value || 'exact match', location: 'exact' };
                        }
                    }
                    
                    // Second priority: partial matches for download-related buttons
                    for (const btn of allButtons) {
                        const text = (btn.textContent || '').toLowerCase().trim();
                        const value = (btn.getAttribute('value') || '').toLowerCase().trim();
                        const onclick = btn.getAttribute('onclick') || '';
                        const id = btn.getAttribute('id') || '';
                        
                        if (text.length > 100) continue; // Skip very long text
                        
                        if (text.includes('herunterladen') ||
                            value.includes('herunterladen') ||
                            text.includes('download') ||
                            value.includes('download') ||
                            onclick.includes('download') ||
                            onclick.includes('zip') ||
                            id.toLowerCase().includes('download')) {
                            (btn as HTMLElement).click();
                            return { found: true, text: text || value || id || 'partial match', location: 'partial' };
                        }
                    }
                    
                    // Third priority: submit buttons that might trigger download
                    for (const btn of allButtons) {
                        const type = btn.getAttribute('type') || '';
                        const onclick = btn.getAttribute('onclick') || '';
                        const text = (btn.textContent || '').toLowerCase().trim();
                        
                        if (type === 'submit' || 
                            onclick.includes('submit') ||
                            onclick.includes('window.open') ||
                            onclick.includes('location.href')) {
                            (btn as HTMLElement).click();
                            return { found: true, text: text || type || 'submit action', location: 'submit' };
                        }
                    }
                    
                    return { found: false };
                });

                if (downloadSelectionFound.found) {
                    console.log(`Found and clicked download button: "${downloadSelectionFound.text}" (${downloadSelectionFound.location})`);
                    popupHandled = true;
                    
                                        // Wait for document download to complete
                    console.log('Waiting for document download to complete...');
                    
                    // Poll for downloads with timeout
                    let downloadFound = false;
                    const maxAttempts = 20; // 20 attempts = ~20 seconds
                    
                    for (let attempt = 0; attempt < maxAttempts && !downloadFound; attempt++) {
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between checks
                        downloadFound = await checkForDownloads();
                        
                        if (downloadFound) {
                            console.log('Document download completed successfully');
                            downloadCaptured = true;
                            break;
                        } else if (attempt % 5 === 0) {
                            console.log(`Checking for downloads... attempt ${attempt + 1}/${maxAttempts}`);
                        }
                    }
                    
                    if (!downloadFound) {
                        console.log('No document downloaded within timeout period');
                        }
                } else {
                    console.log(`Attempt ${attempt + 1}: Download button not found`);
                    
                    // If we're past attempt 3 and still can't find buttons, try alternative approach
                    if (attempt >= 3) {
                        console.log('Trying alternative approach: look for any clickable element that might trigger download');
                        const alternativeDownloadTriggered = await page.evaluate(() => {
                            // Look for elements that might trigger a download
                            const elements = Array.from(document.querySelectorAll('*[onclick], a[href*="download"], button, input[type="submit"]'));
                            for (const el of elements) {
                                const onclick = el.getAttribute('onclick') || '';
                                const href = el.getAttribute('href') || '';
                                const text = (el.textContent || '').toLowerCase();
                                
                                if (onclick.includes('zip') || 
                                    onclick.includes('download') || 
                                    href.includes('download') ||
                                    text.includes('download') ||
                                    onclick.includes('export')) {
                                    (el as HTMLElement).click();
                                    return true;
                                }
                            }
                            return false;
                        });
                        
                        if (alternativeDownloadTriggered) {
                            console.log('Alternative download approach triggered');
                            popupHandled = true;
                            await new Promise(resolve => setTimeout(resolve, 5000));
                        }
                    }
                }
            }

            if (!popupHandled) {
                console.log('Could not handle popup within expected time - trying alternative approaches...');
                
                // Alternative approach: look for any clickable element that might trigger download
                const alternativeDownload = await page.evaluate(() => {
                    // Look for any element that might trigger a download
                    const clickables = Array.from(document.querySelectorAll('*[onclick], a[href], button, input[type="button"]'));
                    for (const el of clickables) {
                        const text = (el.textContent || '').toLowerCase();
                        const onclick = el.getAttribute('onclick') || '';
                        const href = el.getAttribute('href') || '';
                        
                        if (text.includes('herunterladen') || 
                            text.includes('download') || 
                            onclick.includes('download') ||
                            href.includes('download')) {
                            (el as HTMLElement).click();
                            return true;
                        }
                    }
                    return false;
                });

                if (alternativeDownload) {
                    console.log('Triggered alternative download approach');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }

        } else {
            console.log('Download button not found in table, trying to find download links directly...');
            
            // Alternative approach: look for direct download links
            const directDownloadFound = await page.evaluate(() => {
                const allLinks = Array.from(document.querySelectorAll('a[href], button, [onclick]'));
                for (const link of allLinks) {
                    const href = link.getAttribute('href') || '';
                    const onclick = link.getAttribute('onclick') || '';
                    const text = (link.textContent || '').toLowerCase();
                    
                    if (href.includes('download') || 
                        onclick.includes('download') || 
                        text.includes('download') ||
                        text.includes('herunterladen')) {
                        (link as HTMLElement).click();
                        return true;
                    }
                }
                return false;
            });
            
            if (directDownloadFound) {
                console.log('Found and clicked direct download link');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        // Final wait to ensure any downloads are completed
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Clean up temporary directory
        try {
            if (fs.existsSync(tempDir)) {
                const remainingFiles = fs.readdirSync(tempDir);
                for (const file of remainingFiles) {
                    fs.unlinkSync(path.join(tempDir, file));
                }
                fs.rmdirSync(tempDir);
                console.log('Cleaned up temporary directory');
            }
        } catch (error) {
            console.log('Error cleaning up temporary directory:', error);
        }

        if (documents.size === 0) {
            console.log('No documents were captured. This could be due to:');
            console.log('- The download requires authentication or login');
            console.log('- The popup interaction failed');
            console.log('- The download method is not captured by file monitoring');
            console.log('- The page structure has changed');
            console.log('- The download uses a different mechanism or location');
        } else {
            console.log(`Successfully captured ${documents.size} document(s) from Vergabekooperation Berlin`);
        }

    } catch (error) {
        console.log('Special Vergabekooperation Berlin handling failed:', error);
    }

    return documents;
}
