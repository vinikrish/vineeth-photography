class GoogleDriveService {
  constructor() {
    this.apiKey = process.env.REACT_APP_GOOGLE_DRIVE_API_KEY;
    this.galleriesFolderId = process.env.REACT_APP_GOOGLE_DRIVE_FOLDER_ID;
    this.slideshowFolderId = process.env.REACT_APP_GOOGLE_DRIVE_SLIDESHOW_FOLDER_ID;
    this.isConfigured = !!(this.apiKey && this.slideshowFolderId);
    this.baseUrl = 'https://www.googleapis.com/drive/v3';
    
    // Debug logging
    console.log('🔧 Google Drive Service Configuration:');
    console.log('API Key:', this.apiKey ? `${this.apiKey.substring(0, 10)}...` : 'NOT SET');
    console.log('API Key Length:', this.apiKey ? this.apiKey.length : 0);
    console.log('Galleries Folder ID:', this.galleriesFolderId || 'NOT SET');
    console.log('Slideshow Folder ID:', this.slideshowFolderId || 'NOT SET');
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
          src: `https://lh3.googleusercontent.com/d/${file.id}=w2000-h2000`, // Using Google's image serving URL
          alt: file.name.replace(/\.[^/.]+$/, ''), // Remove file extension for alt text
          thumbnailUrl: `https://drive.google.com/thumbnail?id=${file.id}&sz=w400`,
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
        referrerPolicy: 'origin'
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