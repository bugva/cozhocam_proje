const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err));
  
  await page.goto('http://localhost:5173');
  
  const fileInput = await page.$('input[type="file"]');
  await fileInput.uploadFile('/Users/bugva/ÇÖZHOCAM/sample.pdf');
  
  await new Promise(r => setTimeout(r, 5000));
  await browser.close();
})();
