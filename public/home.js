const onlineEl = document.getElementById("homeOnline");

async function refreshOnline() {
  try {
    const response = await fetch("/api/online-count");
    const data = await response.json();
    onlineEl.textContent = `Online: ${data.online ?? 0}`;
  } catch {
    onlineEl.textContent = "Online: ?";
  }
}

refreshOnline();
setInterval(refreshOnline, 5000);
