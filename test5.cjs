const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173');
  
  const version = await page.evaluate(() => {
    return window.pdfjsLib ? window.pdfjsLib.version : 'pdfjsLib not on window';
  });
  console.log('PDFJS VERSION:', version);
  
  await browser.close();
})();
