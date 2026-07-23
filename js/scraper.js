const https = require('https');
const { URL } = require('url');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'MyComicReader/1.0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

async function getMangaDexPopular(offset = 0) {
  const data = await httpsGet(`https://api.mangadex.org/manga?limit=20&offset=${offset}&includes[]=cover_art&order[followedCount]=desc`);
  const json = JSON.parse(data);
  
  return json.data.map(manga => {
    const id = manga.id;
    const title = manga.attributes.title.en || Object.values(manga.attributes.title)[0];
    const coverFile = manga.relationships.find(r => r.type === 'cover_art');
    const cover = coverFile ? `https://uploads.mangadex.org/covers/${id}/${coverFile.attributes.fileName}.256.jpg` : null;
    const lastChapter = manga.attributes.lastChapter || null;
    const year = manga.attributes.year;
    
    return {
      id: `mangadex-${id}`,
      source: 'MangaDex',
      title,
      cover,
      url: `https://mangadex.org/title/${id}`,
      lastChapter,
      year
    };
  });
}

async function getMangaDexUpdated(offset = 0) {
  const now = Date.now();
  const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
  
  const data = await httpsGet(`https://api.mangadex.org/manga?limit=20&offset=${offset}&includes[]=cover_art&order[latestUploadedChapter]=desc&createdAt[gte]=${new Date(oneWeekAgo).toISOString()}`);
  const json = JSON.parse(data);
  
  return json.data.map(manga => {
    const id = manga.id;
    const title = manga.attributes.title.en || Object.values(manga.attributes.title)[0];
    const coverFile = manga.relationships.find(r => r.type === 'cover_art');
    const cover = coverFile ? `https://uploads.mangadex.org/covers/${id}/${coverFile.attributes.fileName}.256.jpg` : null;
    const lastChapter = manga.attributes.lastChapter || null;
    const year = manga.attributes.year;
    
    return {
      id: `mangadex-${id}`,
      source: 'MangaDex',
      title,
      cover,
      url: `https://mangadex.org/title/${id}`,
      lastChapter,
      year
    };
  });
}

async function getMangaDexCategories() {
  const data = await httpsGet(`https://api.mangadex.org/tag?limit=100`);
  const json = JSON.parse(data);
  
  const genreTags = json.data.filter(t => t.attributes.group === 'genre');
  const themeTags = json.data.filter(t => t.attributes.group === 'theme');
  
  return {
    genres: genreTags.map(t => ({
      id: t.id,
      name: t.attributes.name.en || t.attributes.name
    })),
    themes: themeTags.map(t => ({
      id: t.id,
      name: t.attributes.name.en || t.attributes.name
    }))
  };
}

async function getMangaDexByCategory(categoryId, limit = 20) {
  const data = await httpsGet(`https://api.mangadex.org/manga?limit=${limit}&includes[]=cover_art&includedTags[]=${categoryId}&order[followedCount]=desc`);
  const json = JSON.parse(data);
  
  return json.data.map(manga => {
    const id = manga.id;
    const title = manga.attributes.title.en || Object.values(manga.attributes.title)[0];
    const coverFile = manga.relationships.find(r => r.type === 'cover_art');
    const cover = coverFile ? `https://uploads.mangadex.org/covers/${id}/${coverFile.attributes.fileName}.256.jpg` : null;
    const lastChapter = manga.attributes.lastChapter || null;
    const year = manga.attributes.year;
    
    return {
      id: `mangadex-${id}`,
      source: 'MangaDex',
      title,
      cover,
      url: `https://mangadex.org/title/${id}`,
      lastChapter,
      year
    };
  });
}

async function searchMangaDex(query, offset = 0) {
  const data = await httpsGet(`https://api.mangadex.org/manga?limit=20&offset=${offset}&title=${encodeURIComponent(query)}&includes[]=cover_art`);
  const json = JSON.parse(data);
  
  return json.data.map(manga => {
    const id = manga.id;
    const title = manga.attributes.title.en || Object.values(manga.attributes.title)[0];
    const coverFile = manga.relationships.find(r => r.type === 'cover_art');
    const cover = coverFile ? `https://uploads.mangadex.org/covers/${id}/${coverFile.attributes.fileName}.256.jpg` : null;
    
    return {
      id: `mangadex-${id}`,
      source: 'MangaDex',
      title,
      cover,
      url: `https://mangadex.org/title/${id}`
    };
  });
}

async function getMangaDexDetails(id) {
  const mangaId = id.replace('mangadex-', '');
  
  const mangaData = await httpsGet(`https://api.mangadex.org/manga/${mangaId}?includes[]=cover_art&includes[]=author&includes[]=artist`);
  const manga = JSON.parse(mangaData).data;
  
  const title = manga.attributes.title.en || Object.values(manga.attributes.title)[0];
  const description = Object.values(manga.attributes.description || {})[0] || 'No description';
  
  const coverFile = manga.relationships.find(r => r.type === 'cover_art');
  const cover = coverFile ? `https://uploads.mangadex.org/covers/${mangaId}/${coverFile.attributes.fileName}.256.jpg` : null;
  
  const authors = manga.relationships.filter(r => r.type === 'author').map(a => a.attributes.name);
  
  const chaptersData = await httpsGet(`https://api.mangadex.org/manga/${mangaId}/feed?limit=100&includes[]=scanlation_group&order[chapter]=desc`);
  const chaptersJson = JSON.parse(chaptersData);
  
  const chapters = chaptersJson.data.map(ch => {
    const group = ch.relationships.find(r => r.type === 'scanlation_group');
    return {
      id: `mangadex-ch-${ch.chapter}`,
      chapter: ch.attributes.chapter,
      title: ch.attributes.title || '',
      group: group ? group.attributes.name : 'Unknown',
      uploaded: ch.attributes.publishAt
    };
  });
  
  return {
    id: `mangadex-${mangaId}`,
    source: 'MangaDex',
    title,
    description,
    cover,
    authors,
    chapters: chapters.filter((c, i, arr) => arr.findIndex(x => x.chapter === c.chapter) === i)
  };
}

async function getMangaDexChapterPages(id, chapter) {
  const mangaId = id.replace('mangadex-', '');
  
  const atHomeData = await httpsGet(`https://api.mangadex.org/at-home/server/${mangaId}`);
  const atHome = JSON.parse(atHomeData.data);
  
  const chapterId = chapter.replace('mangadex-ch-', '');
  
  const chapterData = await httpsGet(`https://api.mangadex.org/chapter/${chapterId}?includes[]=scanlation_group`);
  const ch = JSON.parse(chapterData).data;
  
  const baseUrl = atHome.baseUrl;
  const chapterHash = atHome.chapter.hash;
  const pages = atHome.chapter.data.map(page => `${baseUrl}/data/${chapterHash}/${page}`);
  
  return pages.map((url, i) => ({
    url,
    index: i + 1
  }));
}

async function scrapeSource(source, action, params) {
  const sourceLower = source.toLowerCase();
  
  switch (sourceLower) {
    case 'mangadex':
      if (action === 'search') return searchMangaDex(params.query, params.offset || 0);
      if (action === 'details') return getMangaDexDetails(params.id);
      if (action === 'pages') return getMangaDexChapterPages(params.id, params.chapter);
      if (action === 'popular') return getMangaDexPopular(params.offset || 0);
      if (action === 'updated') return getMangaDexUpdated(params.offset || 0);
      if (action === 'categories') return getMangaDexCategories();
      if (action === 'byCategory') return getMangaDexByCategory(params.categoryId, params.limit);
      break;
    case 'ehentai':
      if (action === 'search') return searchEHentai(params.query);
      if (action === 'details') return getEHentaiDetails(params.id);
      if (action === 'pages') return getEHentaiPages(params.id);
      if (action === 'popular') return getEHentaiPopular(params.offset || 0);
      if (action === 'updated') return getEHentaiUpdated(params.offset || 0);
      break;
  }
  throw new Error(`Unknown source or action: ${source}/${action}`);
}

async function searchEHentai(query) {
  try {
    const data = await httpsGet(`https://e-hentai.org/?f_search=${encodeURIComponent(query)}`);
    
    const results = [];
    const galleryMatches = data.match(/<a href="https:\/\/e-hentai\.org\/g\/(\d+)\/([a-z0-9]+)\/"/g);
    
    if (galleryMatches) {
      for (let i = 0; i < Math.min(galleryMatches.length, 20); i++) {
        const match = galleryMatches[i].match(/g\/(\d+)\/([a-z0-9]+)/);
        if (match) {
          results.push({
            id: `ehentai-${match[1]}-${match[2]}`,
            source: 'E-Hentai',
            title: `Gallery ${match[1]}`,
            cover: null,
            url: `https://e-hentai.org/g/${match[1]}/${match[2]}/`
          });
        }
      }
    }
    
    return results;
  } catch (err) {
    console.error('searchEHentai error:', err);
    throw err;
  }
}

async function getEHentaiDetails(id) {
  try {
    const match = id.replace('ehentai-', '').match(/(\d+)-([a-z0-9]+)/);
    if (!match) throw new Error('Invalid e-hentai ID');
    
    const galleryId = match[1];
    const token = match[2];
    
    const data = await httpsGet(`https://e-hentai.org/g/${galleryId}/${token}/`);
    
    const titleMatch = data.match(/<h1[^>]*id="gn"[^>]*>([^<]+)/);
    const title = titleMatch ? titleMatch[1].trim() : `Gallery ${galleryId}`;
    
    const imgMatch = data.match(/<img[^>]+id="img0"[^>]+src="([^"]+)"/);
    const cover = imgMatch ? imgMatch[1].replace('t.jpg', 'jpg').replace('t.png', 'png') : null;
    
    const pageMatch = data.match(/of <b>(\d+)<\/b>/);
    const pageCount = pageMatch ? parseInt(pageMatch[1]) : 0;
    
    const chapters = [];
    for (let i = 0; i < Math.max(pageCount, 1); i++) {
      chapters.push({
        id: `ehentai-ch-${i}`,
        chapter: `Page ${i + 1}`,
        title: '',
        group: '',
        uploaded: ''
      });
    }
    
    return {
      id: `ehentai-${galleryId}-${token}`,
      source: 'E-Hentai',
      title,
      description: 'E-Hentai gallery',
      cover,
      authors: [],
      category: 'Hentai',
      pageCount,
      chapters
    };
  } catch (err) {
    console.error('getEHentaiDetails error:', err);
    throw err;
  }
}

async function getEHentaiPages(id) {
  try {
    const match = id.replace('ehentai-', '').match(/(\d+)-([a-z0-9]+)/);
    if (!match) throw new Error('Invalid e-hentai ID');
    
    const galleryId = match[1];
    const token = match[2];
    
    const data = await httpsGet(`https://e-hentai.org/g/${galleryId}/${token}/?p=0`);
    
    const pages = [];
    const imgMatches = data.match(/<img[^>]+src="([^"]+\.(?:jpg|png|gif))"[^>]*id="img\d+"/g);
    
    if (imgMatches) {
      for (let i = 0; i < imgMatches.length; i++) {
        const urlMatch = imgMatches[i].match(/src="([^"]+)"/);
        if (urlMatch) {
          const url = urlMatch[1].replace('t.jpg', 'jpg').replace('t.png', 'png').replace('t.gif', 'gif');
          pages.push({ url, index: i + 1 });
        }
      }
    }
    
    const pageMatch = data.match(/of <b>(\d+)<\/b>/);
    const pageCount = pageMatch ? parseInt(pageMatch[1]) : pages.length;
    
    if (pages.length < pageCount && pageCount > 0) {
      for (let p = 1; p < Math.min(Math.ceil(pageCount / 40), 5); p++) {
        const pageData = await httpsGet(`https://e-hentai.org/g/${galleryId}/${token}/?p=${p}`);
        const moreMatches = pageData.match(/<img[^>]+src="([^"]+\.(?:jpg|png|gif))"[^>]*id="img\d+"/g);
        
        if (moreMatches) {
          for (let i = 0; i < moreMatches.length; i++) {
            const urlMatch = moreMatches[i].match(/src="([^"]+)"/);
            if (urlMatch) {
              const url = urlMatch[1].replace('t.jpg', 'jpg').replace('t.png', 'png').replace('t.gif', 'gif');
              pages.push({ url, index: pages.length + 1 });
            }
          }
        }
      }
    }
    
return pages;
  } catch (err) {
    console.error('getEHentaiPages error:', err);
    throw err;
  }
}

async function getEHentaiPopular(offset = 0) {
  try {
    const pageNum = Math.floor(offset / 25);
    const data = await httpsGet(`https://e-hentai.org/?page=${pageNum}&f_search=`);
    
    const results = [];
    const galleryMatches = data.match(/<a href="https:\/\/e-hentai\.org\/g\/(\d+)\/([a-z0-9]+)\/"/g);
    
    if (galleryMatches) {
      for (let i = 0; i < Math.min(galleryMatches.length, 25); i++) {
        const match = galleryMatches[i].match(/g\/(\d+)\/([a-z0-9]+)/);
        if (match) {
          results.push({
            id: `ehentai-${match[1]}-${match[2]}`,
            source: 'E-Hentai',
            title: `Gallery ${match[1]}`,
            cover: null,
            url: `https://e-hentai.org/g/${match[1]}/${match[2]}/`
          });
        }
      }
    }
    
    return results;
  } catch (err) {
    console.error('getEHentaiPopular error:', err);
    return [];
  }
}

async function getEHentaiUpdated(offset = 0) {
  try {
    const pageNum = Math.floor(offset / 25);
    const data = await httpsGet(`https://e-hentai.org/?page=${pageNum}&f_search=`);
    
    const results = [];
    const galleryMatches = data.match(/<a href="https:\/\/e-hentai\.org\/g\/(\d+)\/([a-z0-9]+)\/"/g);
    
    if (galleryMatches) {
      for (let i = 0; i < Math.min(galleryMatches.length, 25); i++) {
        const match = galleryMatches[i].match(/g\/(\d+)\/([a-z0-9]+)/);
        if (match) {
          results.push({
            id: `ehentai-${match[1]}-${match[2]}`,
            source: 'E-Hentai',
            title: `Gallery ${match[1]}`,
            cover: null,
            url: `https://e-hentai.org/g/${match[1]}/${match[2]}/`
          });
        }
      }
    }
    
    return results;
  } catch (err) {
    console.error('getEHentaiUpdated error:', err);
    return [];
  }
}

module.exports = { scrapeSource, searchMangaDex, getMangaDexDetails, getMangaDexPopular, getMangaDexUpdated, getMangaDexCategories, getMangaDexByCategory, searchEHentai, getEHentaiDetails, getEHentaiPages, getEHentaiPopular, getEHentaiUpdated };
