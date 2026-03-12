const { app, BrowserWindow } = require("electron");
const path = require("node:path");

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 640,
    height: 480,
    show: true
  });
  window.webContents.once("did-finish-load", () => {
    console.log("fixture-main-ready", { surface: "main" });
    setTimeout(() => {
      console.log("fixture-main-delayed", { surface: "main-delayed" });
    }, 50);
  });
  window.loadFile(path.join(__dirname, "fixture-window.html"));
});

app.on("window-all-closed", () => {
  app.quit();
});
