import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';

export async function getDocumentLinks(url: string): Promise<string[]> {
    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        const links: string[] = [];

        // Select all anchor tags that have an href attribute
        $('a[href]').each((index, element) => {
            const href = $(element).attr('href');
            if (href) {
                // Construct absolute URL if it's a relative path
                const absoluteUrl = new URL(href, url).href;
                links.push(absoluteUrl);
                console.log(`Found potential link: ${absoluteUrl}`); // Log all links for inspection
            }
        });
        return links;
    } catch (error) {
        console.error(`Error fetching document links from ${url}:`, error);
        return [];
    }
}

export async function downloadDocument(url: string): Promise<Buffer | null> {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        return Buffer.from(response.data);
    } catch (error) {
        console.error(`Error downloading document from ${url}:`, error);
        return null;
    }
}

export async function getZipDocumentLink(url: string): Promise<string | null> {
    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        let zipLink: string | null = null;

        // Find the link that contains "Alle Dokumente als ZIP-Datei herunterladen"
        $('a[href]').each((index, element) => {
            const href = $(element).attr('href');
            const text = $(element).text();
            if (href && text.includes('Alle Dokumente als ZIP-Datei herunterladen')) {
                zipLink = new URL(href, url).href;
                return false; // Stop iterating once found
            }
        });
        if (!zipLink) {
            const zipA = $('a[href*=".zip"]').first();
            if (zipA.length) {
                const href = zipA.attr('href');
                if (href) zipLink = new URL(href, url).href;
            }
        }
        return zipLink;
    } catch (error) {
        console.error(`Error fetching ZIP document link from ${url}:`, error);
        return null;
    }
}

export function isSupportedDocLink(href: string): boolean {
    return /\.(pdf|docx?|zip)(?:[?#].*)?$/i.test(href);
}

export async function collectStaticDocumentLinks(url: string): Promise<string[]> {
    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        const links: string[] = [];
        $('a[href]').each((_, el) => {
            const href = ($(el).attr('href') || '').trim();
            if (!href) return;
            const abs = new URL(href, url).href;
            if (isSupportedDocLink(abs)) links.push(abs);
        });
        return Array.from(new Set(links));
    } catch (error) {
        console.error(`Error collecting static document links from ${url}:`, error);
        return [];
    }
}

export async function fetchFileBufferViaPage(page: any, fileUrl: string): Promise<{ fileName: string; buffer: Buffer } | null> {
    try {
        const result = await page.evaluate(async (u: string) => {
            function arrayBufferToBase64(buf: ArrayBuffer): string {
                let binary = '';
                const bytes = new Uint8Array(buf);
                const chunkSize = 0x8000;
                for (let i = 0; i < bytes.length; i += chunkSize) {
                    const sub = bytes.subarray(i, i + chunkSize);
                    binary += String.fromCharCode.apply(null, Array.from(sub) as unknown as number[]);
                }
                return btoa(binary);
            }
            const res = await fetch(u, { credentials: 'include' });
            const ab = await res.arrayBuffer();
            const base64 = arrayBufferToBase64(ab);
            const urlObj = new URL(u, location.href);
            const nameGuess = urlObj.pathname.split('/').filter(Boolean).pop() || 'download';
            return { base64, nameGuess };
        }, fileUrl);
        return { fileName: result.nameGuess, buffer: Buffer.from(result.base64, 'base64') };
    } catch (error) {
        console.error(`Error fetching file via page from ${fileUrl}:`, error);
        return null;
    }
}

export async function collectDocumentsViaPuppeteer(url: string): Promise<Map<string, Buffer>> {
    const documents = new Map<string, Buffer>();
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7' });

        // Navigate robustly for hash-based SPAs
        const u = new URL(url);
        const baseUrl = `${u.origin}${u.pathname}`;
        try {
            await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
            if (u.hash) {
                await page.evaluate((hash) => { location.hash = hash; }, u.hash);
            }
        } catch {}

        // As a fallback, try direct goto
        if (page.url() === 'about:blank') {
            try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }); } catch {}
        }

        // Attempt to dismiss cookie banners
        const acceptTexts = ['Akzeptieren', 'Einverstanden', 'OK', 'Okay', 'Accept', 'I agree'];
        for (const text of acceptTexts) {
            try {
                const btns = await page.$$('button');
                for (const b of btns) {
                    const label = (await page.evaluate(el => el.textContent || '', b)).trim();
                    if (label.includes(text)) { await b.click(); break; }
                }
            } catch {}
        }

        // Response catcher to download files triggered by clicks or XHRs
        type Captured = { fileName: string; buffer: Buffer };
        const captured: Captured[] = [];
        const contentTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument',
            'application/zip'
        ];
        const guessName = (respUrl: string, headers: Record<string, string>): string => {
            const cd = headers['content-disposition'] || headers['Content-Disposition'];
            if (cd) {
                const m = /filename\*?=([^;]+)/i.exec(cd);
                if (m) return decodeURIComponent(m[1].replace(/UTF-8''/i, '').replace(/"/g, '').trim());
            }
            const urlObj = new URL(respUrl);
            const pathName = urlObj.pathname.split('/').filter(Boolean).pop() || 'download';
            return pathName;
        };
        page.on('response', async (resp) => {
            try {
                const headers = resp.headers() as Record<string, string>;
                const ct = (headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
                const urlStr = resp.url();
                if (contentTypes.some(t => ct.includes(t)) || /\.(pdf|docx?|zip)(?:[?#].*)?$/i.test(urlStr)) {
                    const buffer = await resp.buffer();
                    const name = guessName(urlStr, headers);
                    captured.push({ fileName: name, buffer });
                }
            } catch {}
        });

        // Give JS-driven pages time to render anchors
        try { 
            await page.waitForSelector('a[href], button', { timeout: 15000 }); 
            console.log('Page loaded, found interactive elements');
        } catch {
            console.log('Timeout waiting for interactive elements, continuing...');
        }

        // Gather candidate links
        const candidateLinks: string[] = await page.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
            const candidates: string[] = [];
            for (const a of anchors) {
                const href = a.getAttribute('href') || '';
                const abs = new URL(href, location.href).href;
                if (/\.(pdf|docx?|zip)(?:[?#].*)?$/i.test(abs)) {
                    candidates.push(abs);
                }
                const txt = (a.textContent || '').toLowerCase();
                // Enhanced patterns for subreport-elvis and other German platforms
                if (/download|herunterladen|unterlagen|dokumente|documents|bekanntmachung|ausschreibung|vergabe/.test(txt)) {
                    candidates.push(abs);
                }
                // Check for subreport-specific action patterns, but filter out platform documents
                if (location.hostname.includes('subreport-elvis.de')) {
                    const fileName = abs.split('/').pop() || '';
                    // Skip general platform documents
                    if (txt.includes('agb') || txt.includes('datenschutz') || 
                        txt.includes('vereinbarung') || fileName.includes('subreport') ||
                        txt.includes('terms') || txt.includes('privacy')) {
                        continue; // Skip this iteration
                    }
                    
                    if (/action.*download|action.*display|show|anzeigen/.test(abs) || 
                        txt.includes('download') || txt.includes('anzeigen')) {
                        candidates.push(abs);
                    }
                }
            }
            return Array.from(new Set(candidates));
        });

        // Direct fetch via page to preserve session cookies
        for (const link of candidateLinks) {
            const fetched = await fetchFileBufferViaPage(page, link);
            if (fetched) documents.set(fetched.fileName, fetched.buffer);
        }

        // Skip platform documents in general collection
        const platformDocuments = ['AGB_subreport.pdf', 'Datenschutzerklaerung_subreport.pdf', 'Vereinbarung_Auftragsdatenverarbeitung_subreport.pdf'];
        for (const platDoc of platformDocuments) {
            if (documents.has(platDoc)) {
                console.log(`Removing platform document: ${platDoc}`);
                documents.delete(platDoc);
            }
        }
        
        // Try clicking buttons/anchors that trigger downloads (only if subreport handling didn't work)
        if (!url.includes('subreport-elvis.de') || documents.size === 0) {
            const clickSelectors = ['a', 'button', 'div[role="button"]', 'input[type="button"]', 'input[type="submit"]'];
            for (const sel of clickSelectors) {
                const els = await page.$$(sel);
                for (const el of els) {
                    const txt = (await page.evaluate(e => (e.textContent || e.getAttribute('value') || '').toLowerCase(), el)) as string;
                    // Enhanced patterns for German procurement platforms
                    if (/download|herunterladen|unterlagen|dokumente|bekanntmachung|anzeigen|display/.test(txt)) {
                        try { 
                            console.log(`Clicking element with text: ${txt}`);
                            await Promise.race([
                                el.click(),
                                new Promise((_, reject) => setTimeout(() => reject(new Error('Click timeout')), 5000))
                            ]);
                            await new Promise(r => setTimeout(r, 2000)); // Increased wait time
                        } catch (error) {
                            console.log(`Failed to click element: ${error}`);
                        }
                    }
                }
            }
        }

        // Consolidate captured responses into documents map
        for (const c of captured) {
            if (!documents.has(c.fileName)) documents.set(c.fileName, c.buffer);
        }

        return documents;
    } finally {
        await browser.close();
    }
}
