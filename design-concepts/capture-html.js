const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const htmlPath = process.argv[2];
const outputPath = process.argv[3];

if (!htmlPath || !outputPath) {
  console.error('用法：electron capture-html.js <html文件> <png输出>');
  process.exit(1);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1380,
    height: 900,
    show: false,
    backgroundColor: '#08100e',
    webPreferences: {
      backgroundThrottling: false
    }
  });

  await win.loadFile(path.resolve(htmlPath));
  await new Promise((resolve) => setTimeout(resolve, 700));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.resolve(outputPath), image.toPNG());
  await app.quit();
});
