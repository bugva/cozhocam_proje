const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:5173');
  
  const fileInput = await page.$('input[type="file"]');
  await fileInput.uploadFile('/Users/bugva/ÇÖZHOCAM/sample.pdf');
  
  await new Promise(r => setTimeout(r, 3000));
  
  const html = await page.evaluate(() => document.body.innerHTML);
  console.log('DOM CONTENT:', html);
  
  await browser.close();
})();
