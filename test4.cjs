const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173');
  
  const fileInput = await page.$('input[type="file"]');
  await fileInput.uploadFile('/Users/bugva/ÇÖZHOCAM/sample.pdf');
  
  await new Promise(r => setTimeout(r, 5000));
  
  const isBlank = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return 'No canvas found';
    
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let hasContent = false;
    for (let i = 0; i < data.length; i += 4) {
      // Not white and not transparent
      const isWhite = data[i] === 255 && data[i+1] === 255 && data[i+2] === 255;
      const isTransparent = data[i+3] === 0;
      if (!isWhite && !isTransparent) {
        hasContent = true;
        break;
      }
    }
    return !hasContent ? 'Canvas is entirely white/transparent' : 'Canvas has real content (non-white pixels)';
  });
  
  console.log('CANVAS STATUS:', isBlank);
  
  await browser.close();
})();
