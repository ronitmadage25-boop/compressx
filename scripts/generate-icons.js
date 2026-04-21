// Generate PWA icons from SVG logo
const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');

async function generateIcons() {
  try {
    // Read the SVG logo
    const svgContent = fs.readFileSync('./public/logo.svg', 'utf8');
    
    // Create a simple fallback icon if SVG processing fails
    const sizes = [192, 512];
    
    for (const size of sizes) {
      // Create canvas
      const canvas = createCanvas(size, size);
      const ctx = canvas.getContext('2d');
      
      // Create gradient background
      const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
      gradient.addColorStop(0, '#00ffb3');
      gradient.addColorStop(1, '#009977');
      
      // Fill background
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      
      // Add "CX" text
      ctx.fillStyle = '#000000';
      ctx.font = `bold ${size * 0.4}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('CX', size/2, size/2);
      
      // Save regular icon
      const buffer = canvas.toBuffer('image/png');
      fs.writeFileSync(`./public/logo-${size}.png`, buffer);
      
      // Create maskable version (with padding)
      const maskableCanvas = createCanvas(size, size);
      const maskableCtx = maskableCanvas.getContext('2d');
      
      // Fill entire canvas with gradient
      const maskableGradient = maskableCtx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
      maskableGradient.addColorStop(0, '#00ffb3');
      maskableGradient.addColorStop(1, '#009977');
      
      maskableCtx.fillStyle = maskableGradient;
      maskableCtx.fillRect(0, 0, size, size);
      
      // Add "CX" text (smaller for maskable)
      maskableCtx.fillStyle = '#000000';
      maskableCtx.font = `bold ${size * 0.3}px Arial`;
      maskableCtx.textAlign = 'center';
      maskableCtx.textBaseline = 'middle';
      maskableCtx.fillText('CX', size/2, size/2);
      
      // Save maskable icon
      const maskableBuffer = maskableCanvas.toBuffer('image/png');
      fs.writeFileSync(`./public/logo-${size}-maskable.png`, maskableBuffer);
    }
    
    console.log('✅ PWA icons generated successfully');
  } catch (error) {
    console.error('❌ Error generating icons:', error.message);
    console.log('Creating simple fallback icons...');
    
    // Create simple fallback without canvas dependency
    const sizes = [192, 512];
    for (const size of sizes) {
      // Create a simple SVG icon as fallback
      const svgIcon = `
        <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="grad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" style="stop-color:#00ffb3;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#009977;stop-opacity:1" />
            </radialGradient>
          </defs>
          <rect width="${size}" height="${size}" fill="url(#grad)" />
          <text x="50%" y="50%" font-family="Arial" font-size="${size * 0.4}" font-weight="bold" 
                text-anchor="middle" dominant-baseline="middle" fill="#000000">CX</text>
        </svg>
      `;
      
      fs.writeFileSync(`./public/logo-${size}.svg`, svgIcon);
      fs.writeFileSync(`./public/logo-${size}-maskable.svg`, svgIcon);
    }
    
    console.log('✅ Fallback SVG icons created');
  }
}

generateIcons();