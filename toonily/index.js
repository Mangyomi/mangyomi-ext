

const { JSDOM } = require('jsdom');

const BASE_URL = 'https://toonily.me';


const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));


let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 600; // ms


async function fetchPage(url, retries = 2, customHeaders = {}) {
    // Rate limit
    const now = Date.now();
    const timeSinceLast = now - lastRequestTime;
    if (timeSinceLast < MIN_REQUEST_INTERVAL) {
        await delay(MIN_REQUEST_INTERVAL - timeSinceLast);
    }
    lastRequestTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Connection': 'keep-alive',
                'Referer': BASE_URL + '/',
                ...customHeaders
            },
        });
        clearTimeout(timeoutId);

        if (response.status === 429) {
            if (retries > 0) {
                console.warn(`Rate limited on ${url}, waiting 2s...`);
                await delay(2000 + Math.random() * 1000);
                return fetchPage(url, retries - 1, customHeaders);
            }
            throw new Error('HTTP 429: Too Many Requests (Rate Limit Exceeded)');
        }

        if (response.status === 503 || response.status === 504) {
            if (retries > 0) {
                console.warn(`Gateway/Service error ${response.status} on ${url}, waiting 1s...`);
                await delay(1000);
                return fetchPage(url, retries - 1, customHeaders);
            }
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response.text();
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError' || (error.cause && (error.cause.code === 'ECONNRESET' || error.cause.code === 'ETIMEDOUT'))) {
            if (retries > 0) {
                console.warn(`Timeout/Network error on ${url}, retrying...`);
                await delay(1000);
                return fetchPage(url, retries - 1, customHeaders);
            }
        }
        throw error;
    }
}


function parseHTML(html) {
    const dom = new JSDOM(html);
    return dom.window.document;
}


function checkHasNextPage(doc) {
    // Check for 'next' link in pagination
    const nextLink = doc.querySelector('.paginator a[rel="next"]');
    return !!nextLink;
}

module.exports = {
    name: "Toonily",
    lang: "en",
    baseUrl: BASE_URL,
    url: BASE_URL,
    icon: "https://toonily.me/static/sites/toonily/icons/apple-touch-icon.png",

    getImageHeaders() {
        return {
            'Referer': BASE_URL + '/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };
    },


    async searchManga(query, page) {
        if (!query) {
            return this.getLatestManga(page);
        }

        const encodedQuery = encodeURIComponent(query).replace(/%20/g, '+');
        // Likely pagination structure: /page/2/?s=query...
        const url = page > 1
            ? `${this.baseUrl}/search/?q=${encodedQuery}&status=all&sort=views&page=${page}`
            : `${this.baseUrl}/search?q=${encodedQuery}&status=all&sort=views`;

        const html = await fetchPage(url);
        const doc = parseHTML(html);

        const mangaList = [];
        // Toonily search results use .book-item (same as latest/popular)
        const items = doc.querySelectorAll('.book-item');

        items.forEach(element => {
            const titleEl = element.querySelector('.meta .title h3 a');
            if (!titleEl) return;

            const href = titleEl.getAttribute('href');
            // Handle trailing slashes safely
            const id = href.split('/').filter(Boolean).pop();
            const title = titleEl.textContent.trim();
            const coverEl = element.querySelector('.thumb img');
            const coverUrl = coverEl ? (coverEl.getAttribute('data-src') || coverEl.src) : '';

            // Fix double slashes in cover URL if present and missing protocol
            const formattedCoverUrl = coverUrl.startsWith('//') ? 'https:' + coverUrl : coverUrl;

            mangaList.push({
                id,
                title,
                coverUrl: formattedCoverUrl
            });
        });

        return {
            manga: mangaList,
            hasNextPage: checkHasNextPage(doc)
        };
    },


    async getLatestManga(page) {
        const url = `${this.baseUrl}/latest?page=${page}`;
        const html = await fetchPage(url);
        const doc = parseHTML(html);

        const mangaList = [];
        const items = doc.querySelectorAll('.book-item');

        items.forEach(element => {
            const titleEl = element.querySelector('.meta .title h3 a');
            if (!titleEl) return;

            const href = titleEl.getAttribute('href');
            // Handle trailing slashes safely
            const id = href.split('/').filter(Boolean).pop();
            const title = titleEl.textContent.trim();
            const coverEl = element.querySelector('.thumb img');
            const coverUrl = coverEl ? (coverEl.getAttribute('data-src') || coverEl.src) : '';

            // Fix double slashes in cover URL if present and missing protocol
            const formattedCoverUrl = coverUrl.startsWith('//') ? 'https:' + coverUrl : coverUrl;

            mangaList.push({
                id,
                title,
                coverUrl: formattedCoverUrl
            });
        });

        return {
            manga: mangaList,
            hasNextPage: checkHasNextPage(doc)
        };
    },

    async getPopularManga(page) {
        // Toonily popular page
        const url = `${this.baseUrl}/popular?page=${page}`;
        const html = await fetchPage(url);
        const doc = parseHTML(html);

        const mangaList = [];
        const items = doc.querySelectorAll('.book-item');

        items.forEach(element => {
            const titleEl = element.querySelector('.meta .title h3 a');
            if (!titleEl) return;

            const href = titleEl.getAttribute('href');
            const id = href.split('/').filter(Boolean).pop();
            const title = titleEl.textContent.trim();
            const coverEl = element.querySelector('.thumb img');
            const coverUrl = coverEl ? (coverEl.getAttribute('data-src') || coverEl.src) : '';
            const formattedCoverUrl = coverUrl.startsWith('//') ? 'https:' + coverUrl : coverUrl;

            mangaList.push({
                id,
                title,
                coverUrl: formattedCoverUrl
            });
        });

        return {
            manga: mangaList,
            hasNextPage: checkHasNextPage(doc)
        };
    },


    async getMangaDetails(mangaId) {
        const url = `${this.baseUrl}/${mangaId}`;
        const html = await fetchPage(url);
        const doc = parseHTML(html);

        const title = doc.querySelector('.name.box h1')?.textContent.trim() || 'Unknown';
        const coverEl = doc.querySelector('.cover img');
        let coverUrl = coverEl ? (coverEl.getAttribute('data-src') || coverEl.src) : '';
        if (coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;

        const description = doc.querySelector('.section.box.summary .content')?.textContent.trim() || '';

        let author = 'Unknown';
        const authorEl = Array.from(doc.querySelectorAll('.meta.box p')).find(p => p.textContent.includes('Authors'));
        if (authorEl) {
            const authorLink = authorEl.querySelector('a');
            if (authorLink) author = authorLink.textContent.trim();
        }

        let status = 'unknown';
        const statusEl = Array.from(doc.querySelectorAll('.meta.box p')).find(p => p.textContent.includes('Status'));
        if (statusEl) {
            const statusText = statusEl.textContent.toLowerCase();
            if (statusText.includes('ongoing')) status = 'ongoing';
            else if (statusText.includes('completed')) status = 'completed';
        }

        const genres = [];
        const genreEl = Array.from(doc.querySelectorAll('.meta.box p')).find(p => p.textContent.includes('Genres'));
        if (genreEl) {
            genreEl.querySelectorAll('a').forEach(a => genres.push(a.textContent.trim()));
        }

        return {
            id: mangaId,
            title,
            coverUrl,
            author,
            artist: author, // Toonily often groups them
            description,
            status,
            genres
        };
    },


    async getChapterList(mangaId) {
        const url = `${this.baseUrl}/${mangaId}`;
        const html = await fetchPage(url);
        const doc = parseHTML(html);

        const chapters = [];
        const chapterItems = doc.querySelectorAll('#chapter-list li');

        chapterItems.forEach(el => {
            const link = el.querySelector('a');
            if (!link) return;

            const href = link.getAttribute('href');
            // Extract from href: "/relationship-reversal/chapter-88" -> "relationship-reversal/chapter-88"
            const id = href.startsWith('/') ? href.substring(1) : href;

            const titleEl = link.querySelector('.chapter-title');
            const title = titleEl ? titleEl.textContent.trim() : 'Chapter';

            // Extract chapter number
            let chapterNumber = 0;
            const match = title.match(/Chapter\s+(\d+(\.\d+)?)/i);
            if (match) {
                chapterNumber = parseFloat(match[1]);
            }

            // Date
            const timeEl = link.querySelector('.chapter-update');
            const dateStr = timeEl ? timeEl.textContent.trim() : '';

            chapters.push({
                id: id,
                title: title,
                chapterNumber: chapterNumber,
                language: 'en',
                date: dateStr,
                url: href.startsWith('http') ? href : this.baseUrl + (href.startsWith('/') ? '' : '/') + href
            });
        });

        // Ensure proper order (listing is usually desc, no need to reverse if App handles it, but typically we return desc)
        return chapters;
    },


    async getChapterPages(mangaId, chapterId) {
        // Handle case where only 1 argument is passed (chapterId)
        if (!chapterId) {
            chapterId = mangaId;
            // Extract mangaId from "manga-slug/chapter-slug"
            mangaId = chapterId.split('/')[0];
        }

        // chapterId here is "manga-slug/chapter-slug"
        const url = `${this.baseUrl}/${chapterId}`;
        const html = await fetchPage(url, 2, {
            'Referer': `${this.baseUrl}/${mangaId}`
        });
        const doc = parseHTML(html);

        const pages = [];
        // Toonily uses .chapter-image for page containers
        const images = doc.querySelectorAll('.chapter-image img');

        images.forEach(img => {
            // Prioritize data-src for lazy loaded images
            let src = img.getAttribute('data-src') || img.src;
            if (src && !src.includes('loading.svg')) {
                if (src.startsWith('//')) src = 'https:' + src;
                pages.push(src.trim());
            }
        });

        return pages;
    }
};
