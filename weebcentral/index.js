const { JSDOM } = require('jsdom');

const BASE_URL = 'https://weebcentral.com';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 600;

async function fetchPage(url, retries = 2) {
    const now = Date.now();
    const timeSinceLast = now - lastRequestTime;
    if (timeSinceLast < MIN_REQUEST_INTERVAL) {
        await delay(MIN_REQUEST_INTERVAL - timeSinceLast);
    }
    lastRequestTime = Date.now();

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Referer': BASE_URL + '/',
            },
        });

        if (response.status === 429) {
            if (retries > 0) {
                console.warn(`Rate limited on ${url}, waiting 2s...`);
                await delay(2000 + Math.random() * 1000);
                return fetchPage(url, retries - 1);
            }
            throw new Error('HTTP 429: Too Many Requests');
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response.text();
    } catch (error) {
        if (error.cause && (error.cause.code === 'ECONNRESET' || error.cause.code === 'ETIMEDOUT')) {
            if (retries > 0) {
                await delay(1000);
                return fetchPage(url, retries - 1);
            }
        }
        throw error;
    }
}

function parseHTML(html) {
    const dom = new JSDOM(html);
    return dom.window.document;
}

function parseMangaList(doc) {
    const items = [];
    const seenIds = new Set();

    const mangaArticles = doc.querySelectorAll('article.bg-base-300, article');

    for (const article of mangaArticles) {
        try {
            const sectionLink = article.querySelector('section a[href*="/series/"]');
            const directLink = article.querySelector('a[href*="/series/"]');
            const link = sectionLink || directLink;

            if (!link) continue;

            const href = link.href || link.getAttribute('href') || '';
            const match = href.match(/\/series\/([^/]+)/);
            if (!match) continue;

            const id = match[1];
            if (seenIds.has(id)) continue;
            seenIds.add(id);

            let title = '';
            const titleEl = article.querySelector('a.link-hover, section:nth-child(2) a');
            if (titleEl) {
                title = titleEl.textContent?.trim() || '';
            }
            if (!title) {
                const anyLink = article.querySelector('a');
                title = anyLink?.getAttribute('title') || anyLink?.textContent?.trim() || '';
            }
            if (!title) {
                title = `Series ${id}`;
            }

            const img = article.querySelector('img');
            let coverUrl = img?.src || img?.getAttribute('data-src') || '';

            if (coverUrl.startsWith('//')) {
                coverUrl = 'https:' + coverUrl;
            }

            if (title && title.length > 2) {
                items.push({
                    id,
                    title: title.replace(/\s+/g, ' ').trim(),
                    coverUrl,
                    url: href.startsWith('http') ? href : BASE_URL + href,
                });
            }
        } catch (e) {
            console.error('Error parsing manga item:', e);
        }
    }

    return items;
}

module.exports = {

    getImageHeaders() {
        return {
            'Referer': BASE_URL + '/',
        };
    },

    async getPopularManga(page) {
        try {
            const offset = (page - 1) * 32;
            const url = `${BASE_URL}/search/data?limit=32&offset=${offset}&sort=Popularity&order=Descending&official=Any&display_mode=Full+Display`;
            const html = await fetchPage(url);
            const doc = parseHTML(html);

            const manga = parseMangaList(doc);
            return {
                manga,
                hasNextPage: manga.length >= 32,
            };
        } catch (e) {
            console.error('getPopularManga failed:', e);
            throw e;
        }
    },

    async getLatestManga(page) {
        try {
            const offset = (page - 1) * 32;
            const url = `${BASE_URL}/search/data?limit=32&offset=${offset}&sort=Latest+Updates&order=Descending&official=Any&display_mode=Full+Display`;
            const html = await fetchPage(url);
            const doc = parseHTML(html);

            const manga = parseMangaList(doc);
            return {
                manga,
                hasNextPage: manga.length >= 32,
            };
        } catch (e) {
            console.error('getLatestManga failed:', e);
            throw e;
        }
    },

    async searchManga(query, page) {
        const offset = (page - 1) * 32;
        const searchQuery = encodeURIComponent(query);
        const url = `${BASE_URL}/search/data?limit=32&offset=${offset}&text=${searchQuery}&sort=Best+Match&order=Descending&official=Any&display_mode=Full+Display`;
        const html = await fetchPage(url);
        const doc = parseHTML(html);

        const manga = parseMangaList(doc);
        return {
            manga,
            hasNextPage: manga.length >= 32,
        };
    },

    async getMangaDetails(mangaId) {
        const url = `${BASE_URL}/series/${mangaId}`;
        const html = await fetchPage(url);
        const doc = parseHTML(html);

        let title = doc.querySelector('h1')?.textContent?.trim() || '';
        if (!title) {
            title = doc.querySelector('meta[property="og:title"]')?.content?.split('|')[0]?.trim() || mangaId;
        }

        let coverUrl = doc.querySelector('meta[property="og:image"]')?.content || '';
        if (!coverUrl) {
            const coverImg = doc.querySelector('picture img, img[src*="cover"]');
            coverUrl = coverImg?.src || '';
        }
        if (coverUrl.startsWith('//')) {
            coverUrl = 'https:' + coverUrl;
        }

        let author = '';
        const authorLink = doc.querySelector('a[href*="author="]');
        if (authorLink) {
            author = authorLink.textContent?.trim() || '';
        }

        let description = '';
        const allStrong = doc.querySelectorAll('strong, h3, h2');
        for (const el of allStrong) {
            if (el.textContent?.trim() === 'Description') {
                const descP = el.nextElementSibling;
                if (descP) {
                    description = descP.textContent?.trim() || '';
                }
                break;
            }
        }
        if (!description) {
            const descMeta = doc.querySelector('meta[property="og:description"]');
            if (descMeta) {
                description = descMeta.content || '';
            }
        }

        let status = 'unknown';
        const statusText = doc.body?.textContent?.toLowerCase() || '';
        if (statusText.includes('status') && statusText.includes('ongoing')) {
            status = 'ongoing';
        } else if (statusText.includes('status') && statusText.includes('completed')) {
            status = 'completed';
        }

        const genres = [];
        const tagLinks = doc.querySelectorAll('a[href*="tag="]');
        for (const tag of tagLinks) {
            const genre = tag.textContent?.trim();
            if (genre) {
                genres.push(genre);
            }
        }

        return {
            id: mangaId,
            title,
            coverUrl,
            author: author || 'Unknown',
            artist: author || 'Unknown',
            description,
            status,
            genres,
            url,
        };
    },

    async getChapterList(mangaId) {
        const url = `${BASE_URL}/series/${mangaId}/full-chapter-list`;
        const html = await fetchPage(url);
        const doc = parseHTML(html);

        const chapters = [];
        const chapterLinks = doc.querySelectorAll('a[href*="/chapters/"]');
        const seenIds = new Set();

        for (const link of chapterLinks) {
            const href = link.href || link.getAttribute('href') || '';
            const match = href.match(/\/chapters\/([^\/\?]+)/);
            if (!match) continue;
            const chapterId = match[1];
            if (seenIds.has(chapterId)) continue;
            seenIds.add(chapterId);

            let text = '';
            const allSpans = link.querySelectorAll('span');
            for (const span of allSpans) {
                const className = span.className || span.getAttribute('class') || '';
                if (className.includes('grow')) {
                    const firstChild = span.querySelector('span');
                    if (firstChild) {
                        text = firstChild.textContent?.trim() || '';
                        break;
                    }
                }
            }

            const chapterMatch = text.match(/chapter\s*([\d.]+)/i);
            const chapterNumber = chapterMatch ? parseFloat(chapterMatch[1]) : chapters.length + 1;

            chapters.push({
                id: chapterId,
                title: text || `Chapter ${chapterNumber}`,
                chapterNumber,
                url: href.startsWith('http') ? href : BASE_URL + href,
            });
        }

        chapters.sort((a, b) => b.chapterNumber - a.chapterNumber);

        return chapters;
    },

    async getChapterPages(chapterId) {
        const url = `${BASE_URL}/chapters/${chapterId}/images?reading_style=long_strip`;
        const html = await fetchPage(url);
        const doc = parseHTML(html);

        const pages = [];

        const images = doc.querySelectorAll('img[alt^="Page"], img');

        for (const img of images) {
            let src = img.src || img.getAttribute('src') || '';
            const alt = img.alt || img.getAttribute('alt') | '';

            if (!alt.startsWith('Page') && !src.includes('planeptune')) continue;

            if (src.startsWith('//')) {
                src = 'https:' + src;
            }

            if (src && src.includes('http')) {
                pages.push(src);
            }
        }

        return pages;
    },
};
