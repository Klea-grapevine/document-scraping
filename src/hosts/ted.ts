import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';

export function isTedNoticeUrl(url: string): boolean {
    try {
        const u = new URL(url);
        return /(^|\.)ted\.europa\.eu$/i.test(u.hostname) && /\/notice\//i.test(u.pathname);
    } catch {
        return false;
    }
}

export async function extractDocumentsBaseUrlFromTed(tedUrl: string): Promise<string | null> {
    try {
        const response = await axios.get(tedUrl);
        const $ = cheerio.load(response.data);

        const labelPatterns: RegExp[] = [
            /Internetadresse der Auftragsunterlagen\s*:?/i,
            /Internet address(?:es)? of the procurement documents?\s*:?/i,
            /Adresse\s+internet\s+des\s+documents\s+de\s+march[ée]\s*:?/i,
            /Indirizzo\s+internet\s+dei\s+documenti\s+di\s+gara\s*:?/i,
            /Dirección\s+de\s+internet\s+de\s+los\s+documentos\s+de\s+la\s+contratación\s*:?/i,
            /Internetová\s+adresa\s+zadávací\s+dokumentace\s*:?/i,
            /Internet address of the tender documents\s*:?/i,
            /Adresse internet des documents de soumission\s*:?/i,
            /Indirizzo internet dei documenti di gara\s*:?/i,
            /Dirección de internet de los documentos de licitación\s*:?/i
        ];

        const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
        const resolveHref = (href: string) => new URL(href, tedUrl).href;

        const tryFollowRedirect = async (absUrl: string): Promise<string> => {
            try {
                const resp = await axios.get(absUrl, { maxRedirects: 5, validateStatus: () => true });
                const finalUrl = (resp as any)?.request?.res?.responseUrl;
                return finalUrl || absUrl;
            } catch {
                return absUrl;
            }
        };

        const getNearbyHref = (el: any): string | null => {
            const dt = $(el).closest('dt');
            if (dt.length) {
                const dd = dt.next('dd');
                const href = dd.find('a[href]').first().attr('href');
                if (href && !href.startsWith('mailto:')) return resolveHref(href);
            }
            const th = $(el).closest('th');
            if (th.length) {
                const td = th.next('td');
                const href = td.find('a[href]').first().attr('href');
                if (href && !href.startsWith('mailto:')) return resolveHref(href);
            }
            let href = $(el).find('a[href]').first().attr('href');
            if (href && !href.startsWith('mailto:')) return resolveHref(href);
            href = $(el).nextAll().find('a[href]').first().attr('href');
            if (href && !href.startsWith('mailto:')) return resolveHref(href);
            href = $(el).parent().find('a[href]').first().attr('href');
            if (href && !href.startsWith('mailto:')) return resolveHref(href);
            return null;
        };

        let explicitHref: string | null = null;
        $('dt, th, strong, b, label, span, div').each((_, el) => {
            const text = normalize($(el).text());
            if (labelPatterns.some((re) => re.test(text))) {
                explicitHref = getNearbyHref(el);
                if (explicitHref) return false;
            }
        });
        if (explicitHref) return await tryFollowRedirect(explicitHref);

        const anchorTextHints = /(Auftragsunterlagen|Vergabeunterlagen|Unterlagen|Documents?|Dokumente)/i;
        let hintedHref: string | null = null;
        $('a[href]').each((_, a) => {
            const text = normalize($(a).text());
            if (anchorTextHints.test(text)) {
                const href = $(a).attr('href');
                if (href && !href.startsWith('mailto:')) {
                    hintedHref = resolveHref(href);
                    return false;
                }
            }
        });
        if (hintedHref) return await tryFollowRedirect(hintedHref);

        const knownHostHints = [
            'dtvp.de',
            'evergabe',
            'cosinex',
            'vergabemarktplatz',
            'subreport',
            'e-vergabe',
            'vergabe24',
            'bund.de',
            'bieteportal',
            'bieterportal',
            'b2g',
            'vergabe.niedersachsen.de',
            'vergabekooperation.berlin'
        ];
        let candidate: string | null = null;
        $('a[href]').each((_, a) => {
            const href = $(a).attr('href');
            if (!href || href.startsWith('mailto:')) return;
            const abs = resolveHref(href);
            if (knownHostHints.some((h) => abs.toLowerCase().includes(h))) {
                candidate = abs;
                return false;
            }
        });
        if (candidate) return await tryFollowRedirect(candidate);

        // Dynamic fallback using a headless browser
        try {
            const browser = await puppeteer.launch({ headless: true });
            const page = await browser.newPage();
            await page.goto(tedUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            const result: string | null = await page.evaluate(() => {
                const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
                const anchorTextHints = /(Auftragsunterlagen|Vergabeunterlagen|Unterlagen|Documents?|Dokumente)/i;
                const knownHostHints = [
                    'dtvp.de', 'evergabe', 'cosinex', 'vergabemarktplatz', 'subreport', 'e-vergabe', 'vergabe24', 'bund.de', 'bieteportal', 'bieterportal', 'b2g', 'vergabe.niedersachsen.de'
                ];
                const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
                for (const a of anchors) {
                    const href = a.getAttribute('href');
                    if (!href) continue;
                    const abs = new URL(href, location.href).href;
                    const text = normalize(a.textContent || '');
                    if (anchorTextHints.test(text)) return abs;
                }
                for (const a of anchors) {
                    const href = a.getAttribute('href');
                    if (!href) continue;
                    const abs = new URL(href, location.href).href;
                    if (knownHostHints.some(h => abs.toLowerCase().includes(h))) return abs;
                }
                return null;
            });
            await browser.close();
            if (result) return await tryFollowRedirect(result);
        } catch {}

        return null;
    } catch (error) {
        console.error(`Error extracting documents URL from TED notice ${tedUrl}:`, error);
        return null;
    }
}
