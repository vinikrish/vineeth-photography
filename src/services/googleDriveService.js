class GoogleDriveService {
  constructor() {
    this.apiKey = process.env.REACT_APP_GOOGLE_DRIVE_API_KEY;
    this.galleriesFolderId = process.env.REACT_APP_GOOGLE_DRIVE_FOLDER_ID;
    this.slideshowFolderId = process.env.REACT_APP_GOOGLE_DRIVE_SLIDESHOW_FOLDER_ID;
    this.isConfigured = !!(this.apiKey && this.slideshowFolderId);
    this.baseUrl = 'https://www.googleapis.com/drive/v3';
    this._folderCache = new Map();
    
    // Debug logging
    console.log('🔧 Google Drive Service Configuration:');
    console.log('API Key:', this.apiKey ? `${this.apiKey.substring(0, 10)}...` : 'NOT SET');
    console.log('API Key Length:', this.apiKey ? this.apiKey.length : 0);
    console.log('Full API Key (for debugging):', this.apiKey);
    console.log('Galleries Folder ID:', this.galleriesFolderId || 'NOT SET');
    console.log('Slideshow Folder ID:', this.slideshowFolderId || 'NOT SET');
    console.log('Full Slideshow Folder ID (for debugging):', this.slideshowFolderId);
    console.log('Is Configured:', this.isConfigured);
    console.log('Environment variables:', {
      REACT_APP_GOOGLE_DRIVE_API_KEY: process.env.REACT_APP_GOOGLE_DRIVE_API_KEY ? 'SET' : 'NOT SET',
      REACT_APP_GOOGLE_DRIVE_FOLDER_ID: process.env.REACT_APP_GOOGLE_DRIVE_FOLDER_ID ? 'SET' : 'NOT SET',
      REACT_APP_GOOGLE_DRIVE_SLIDESHOW_FOLDER_ID: process.env.REACT_APP_GOOGLE_DRIVE_SLIDESHOW_FOLDER_ID ? 'SET' : 'NOT SET'
    });
  }

  /**
   * Get images from the Slideshow folder for the homepage slideshow
   */
  async getSlideshowImages() {
    console.log('🎬 Fetching slideshow images from Google Drive...');
    
    if (!this.isConfigured) {
      console.log('❌ Google Drive not configured');
      return null;
    }

    try {
      // Use the direct Slideshow folder ID
      console.log('📁 Using direct Slideshow folder ID:', this.slideshowFolderId);
      const images = await this.getImagesFromFolder(this.slideshowFolderId);
      return images;
    } catch (error) {
      console.error('❌ Error fetching slideshow images:', error);
      return null;
    }
  }

  /**
   * Get images from a specific gallery folder (for future galleries feature)
   */
  async getGalleryImages(galleryName) {
    if (!this.isConfigured) {
      console.log('Google Drive API not configured');
      return [];
    }

    try {
      console.log(`Fetching images for gallery: ${galleryName}`);
      
      const galleryFolderId = await this.findSubfolder(galleryName);
      if (!galleryFolderId) {
        console.log(`Gallery folder "${galleryName}" not found`);
        return [];
      }

      const images = await this.getImagesFromFolder(galleryFolderId);
      console.log(`✅ Found ${images.length} images in ${galleryName} gallery`);
      return images;
    } catch (error) {
      console.error(`❌ Error fetching images for gallery ${galleryName}:`, error);
      return [];
    }
  }



  /**
   * Get all image files from a specific folder
   */
  async getImagesFromFolder(folderId) {
    try {
      console.log(`🖼️ Fetching images from folder: ${folderId}`);
      
      // First, verify the folder exists
      const folderCheckUrl = `${this.baseUrl}/files/${folderId}?key=${this.apiKey}`;
      console.log(`🔍 Checking folder exists: ${folderCheckUrl}`);
      
      const folderResponse = await fetch(folderCheckUrl, {
        referrerPolicy: 'origin',
        headers: {
          'Referer': window.location.origin
        }
      });
      
      console.log(`📁 Folder check status: ${folderResponse.status}`);
      
      if (!folderResponse.ok) {
        const folderError = await folderResponse.text();
        console.error(`❌ Folder check failed:`, folderError);
        throw new Error(`Folder not accessible: ${folderResponse.status}`);
      }
      
      const folderData = await folderResponse.json();
      console.log(`✅ Folder found:`, folderData);
      
      const url = `${this.baseUrl}/files?` + new URLSearchParams({
        q: `'${folderId}' in parents and (mimeType contains 'image/')`,
        fields: 'files(id,name,mimeType,size,createdTime)',
        orderBy: 'name',
        key: this.apiKey
      });

      console.log(`📡 Images API URL: ${url}`);

      console.log(`🌐 Current window location: ${window.location.href}`);
      console.log(`🔗 Request referrer: ${document.referrer}`);
      
      const response = await fetch(url, {
        referrerPolicy: 'origin',
        headers: {
          'Referer': window.location.origin
        }
      });
      console.log(`📊 Images Response status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Images API Error Response:`, errorText);
        throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`📋 Images API Response data:`, data);
      
      if (data.files && data.files.length > 0) {
        const images = data.files.map(file => ({
          id: file.id,
          name: file.name,
          // Primary: Drive UC view URL (works in production and locally in most cases)
          src: `https://drive.google.com/uc?export=view&id=${file.id}`,
          alt: file.name.replace(/\.[^/.]+$/, ''),
          // Fallbacks used in Home.js error handling
          ucUrl: `https://drive.google.com/uc?export=view&id=${file.id}`,
          thumbnailUrl: `https://drive.google.com/thumbnail?id=${file.id}&sz=w2048`,
          mimeType: file.mimeType,
          size: file.size,
          createdTime: file.createdTime
        }));
        
        console.log(`🖼️ Generated image objects:`, images);
        console.log(`✅ Found ${images.length} images in Google Drive folder`);
        return images;
      }

      console.log(`📂 No images found in folder ${folderId}`);
      return [];
    } catch (error) {
      console.error('❌ Error fetching images from folder:', error);
      return [];
    }
  }

  /**
   * Get all gallery folders (for future galleries page)
   */
  async getGalleryFolders() {
    if (!this.isConfigured) {
      return [];
    }

    try {
      const url = `${this.baseUrl}/files?` + new URLSearchParams({
        q: `'${this.galleriesFolderId}' in parents and mimeType='application/vnd.google-apps.folder'`,
        fields: 'files(id,name,createdTime)',
        orderBy: 'name',
        key: this.apiKey
      });

      const response = await fetch(url, {
        referrerPolicy: 'origin',
        headers: { 'Referer': window.location.origin }
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.files && data.files.length > 0) {
        return data.files.map(folder => ({
          id: folder.id,
          name: folder.name,
          createdTime: folder.createdTime
        }));
      }

      return [];
    } catch (error) {
      console.error('Error fetching gallery folders:', error);
      return [];
    }
  }

  // List immediate subfolders under a parent by ID (exported helper)
  async getSubfolders(parentId) {
    try {
      const params = new URLSearchParams({
        q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder'`,
        fields: 'nextPageToken,files(id,name)',
        orderBy: 'name',
        pageSize: '200',
        key: this.apiKey
      });
      const url = `${this.baseUrl}/files?${params.toString()}`;
      const resp = await fetch(url, { referrerPolicy: 'origin', headers: { 'Referer': window.location.origin } });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`List subfolders failed: ${resp.status} ${resp.statusText} - ${txt}`);
      }
      const data = await resp.json();
      return data.files || [];
    } catch (err) {
      console.warn('getSubfolders error', err);
      return [];
    }
  }

  // Resolve a nested path of names (e.g., ['Birds','Buntings']) to a Drive folder ID
  async resolveFolderIdByPath(pathParts = []) {
    if (!this.galleriesFolderId) return null;
    let currentId = this.galleriesFolderId;
    for (const name of pathParts) {
      const subs = await this.getSubfolders(currentId);
      const match = subs.find(f => (f.name || '').toLowerCase() === name.toLowerCase());
      if (!match) return null;
      currentId = match.id;
    }
    return currentId;
  }

  // Build a single-level structure for a given folder ID
  async buildOneLevelStructure(folderId) {
    try {
      const [subs, imgs] = await Promise.all([
        this.getSubfolders(folderId),
        this.getImagesFromFolder(folderId)
      ]);
      const node = {};
      for (const img of imgs) {
        node[img.name] = `https://drive.google.com/uc?export=view&id=${img.id}`;
      }
      for (const f of subs) {
        if ((f.name || '').toLowerCase() === 'slideshow') continue;
        node[f.name] = {};
      }
      return node;
    } catch (err) {
      console.warn('buildOneLevelStructure error', err);
      return {};
    }
  }

  /**
   * Build a recursive gallery tree from the configured root galleries folder.
   * Mirrors the local galleryStructure shape: { FolderName: { ... }, "file.jpg": "https://..." }
   * Excludes the configured slideshow folder and any folder named 'slideshow'.
   */
  async getDriveGalleryStructure() {
    if (!this.apiKey || !this.galleriesFolderId) {
      console.log('❌ Drive galleries not configured: missing API key or galleries root folder ID');
      return null;
    }

    try {
      console.log('📚 Building Drive galleries tree from root:', this.galleriesFolderId);
      const skipIds = new Set([this.slideshowFolderId].filter(Boolean));
      const tree = await this._buildTree(this.galleriesFolderId, skipIds);
      console.log('✅ Built Drive galleries tree');
      return tree;
    } catch (err) {
      console.error('❌ Failed to build Drive galleries tree:', err);
      return null;
    }
  }

  async _buildTree(folderId, skipIds) {
    if (skipIds && skipIds.has(folderId)) {
      return {}; // Skip slideshow folder by ID
    }

    // List children (folders + images) for this folder
    const { folders, images } = await this._listFolderChildren(folderId);
    const node = {};

    // Add images as filename -> URL string (uc view)
    for (const file of images) {
      node[file.name] = `https://drive.google.com/uc?export=view&id=${file.id}`;
    }

    // Recurse into subfolders
    for (const folder of folders) {
      if (skipIds && skipIds.has(folder.id)) {
        continue;
      }
      if ((folder.name || '').toLowerCase() === 'slideshow') {
        // Safety: skip any folder named slideshow
        continue;
      }
      node[folder.name] = await this._buildTree(folder.id, skipIds);
    }

    return node;
  }

  async _listFolderChildren(parentId) {
    const cached = this._folderCache.get(parentId);
    if (cached) return cached;

    let folders = [];
    let images = [];
    try {
      folders = await this._listFolders(parentId);
    } catch (err) {
      console.warn(`⚠️ Failed to list folders under ${parentId}:`, err);
      folders = [];
    }
    try {
      images = await this._listImages(parentId);
    } catch (err) {
      console.warn(`⚠️ Failed to list images under ${parentId}:`, err);
      images = [];
    }

    const result = { folders, images };
    this._folderCache.set(parentId, result);
    return result;
  }

  async _listFolders(parentId) {
    const results = [];
    let pageToken = undefined;
    do {
      const params = new URLSearchParams({
        q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder'`,
        fields: 'nextPageToken,files(id,name)',
        orderBy: 'name',
        pageSize: '200',
        key: this.apiKey
      });
      if (pageToken) params.set('pageToken', pageToken);

      const url = `${this.baseUrl}/files?${params.toString()}`;
      const resp = await fetch(url, { referrerPolicy: 'origin', headers: { 'Referer': window.location.origin } });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`List folders failed: ${resp.status} ${resp.statusText} - ${txt}`);
      }
      const data = await resp.json();
      results.push(...(data.files || []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return results;
  }

  async _listImages(parentId) {
    const results = [];
    let pageToken = undefined;
    do {
      const params = new URLSearchParams({
        q: `'${parentId}' in parents and (mimeType contains 'image/')`,
        fields: 'nextPageToken,files(id,name,mimeType)',
        orderBy: 'name',
        pageSize: '200',
        key: this.apiKey
      });
      if (pageToken) params.set('pageToken', pageToken);

      const url = `${this.baseUrl}/files?${params.toString()}`;
      const resp = await fetch(url, { referrerPolicy: 'origin', headers: { 'Referer': window.location.origin } });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`List images failed: ${resp.status} ${resp.statusText} - ${txt}`);
      }
      const data = await resp.json();
      results.push(...(data.files || []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return results;
  }

  // Get a single preview image (fast) from a folder
  async getFirstImageFromFolder(folderId) {
    try {
      const url = `${this.baseUrl}/files?` + new URLSearchParams({
        q: `'${folderId}' in parents and (mimeType contains 'image/')`,
        fields: 'files(id,name,mimeType,size,createdTime)',
        orderBy: 'createdTime desc',
        pageSize: '1',
        key: this.apiKey
      });
      const response = await fetch(url, {
        referrerPolicy: 'origin',
        headers: { 'Referer': window.location.origin }
      });
      if (!response.ok) {
        const txt = await response.text();
        throw new Error(`Preview list failed: ${response.status} ${response.statusText} - ${txt}`);
      }
      const data = await response.json();
      const f = (data.files || [])[0] || null;
      return f ? {
        id: f.id,
        name: f.name,
        ucUrl: `https://drive.google.com/uc?export=view&id=${f.id}`,
        thumbUrl: `https://drive.google.com/thumbnail?id=${f.id}&sz=w1024`
      } : null;
    } catch (err) {
      console.warn('getFirstImageFromFolder error', err);
      return null;
    }
  }

  // Find a preview image up to a limited depth (fast BFS)
  async getFirstImageInTree(folderId, maxDepth = 2) {
    try {
      // Try immediate images first
      const own = await this.getFirstImageFromFolder(folderId);
      if (own) return own;

      // BFS 1–2 levels, stop on first hit
      const queue = [{ id: folderId, depth: 0 }];
      const visited = new Set();
      while (queue.length > 0) {
        const { id, depth } = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);

        // Skip re-checking root we already tried
        if (depth > 0) {
          const hit = await this.getFirstImageFromFolder(id);
          if (hit) return hit;
        }

        if (depth >= maxDepth) continue;
        const subs = await this.getSubfolders(id);
        for (const s of subs) {
          queue.push({ id: s.id, depth: depth + 1 });
        }
      }
      return null;
    } catch (err) {
      console.warn('getFirstImageInTree error', err);
      return null;
    }
  }

  // Method to get images from a public Google Drive folder (future implementation)
  async getPublicFolderImages(folderId) {
    // This would require the folder to be publicly accessible
    // For now, returning empty to use local fallback
    return [];
  }

  // Method to check if service is available
  isAvailable() {
    return this.initialized;
  }
}

// Export a singleton instance
const googleDriveService = new GoogleDriveService();
export default googleDriveService;