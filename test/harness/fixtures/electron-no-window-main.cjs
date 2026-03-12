const { app } = require("electron");

app.whenReady().then(() => {
  console.log("fixture-main-ready", { surface: "main-no-window" });
});

setInterval(() => {}, 1000);
