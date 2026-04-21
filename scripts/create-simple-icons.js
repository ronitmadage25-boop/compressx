// Create simple SVG icons and convert to PNG using existing tools
const fs = require('fs');

function createIcons() {
  const sizes = [192, 512];
  
  for (const size of sizes) {
    // Create SVG icon
    const svgIcon = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="grad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:#00ffb3;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#009977;stop-opacity:1" />
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#grad)" rx="20" />
  <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="${size * 0.35}" font-weight="bold" 
        text-anchor="middle" dominant-baseline="middle" fill="#000000">CX</text>
</svg>`;
    
    // Save SVG (browsers can use SVG as icons)
    fs.writeFileSync(`./public/logo-${size}.svg`, svgIcon);
    
    // Create maskable version (full bleed)
    const maskableSvg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="grad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:#00ffb3;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#009977;stop-opacity:1" />
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#grad)" />
  <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="${size * 0.3}" font-weight="bold" 
        text-anchor="middle" dominant-baseline="middle" fill="#000000">CX</text>
</svg>`;
    
    fs.writeFileSync(`./public/logo-${size}-maskable.svg`, maskableSvg);
  }
  
  console.log('✅ SVG icons created successfully');
  console.log('Note: Modern browsers support SVG icons in PWA manifests');
}

createIcons();