const loginTab = document.getElementById("loginTab");
const registerTab = document.getElementById("registerTab");
const authForm = document.getElementById("authForm");
const nickInput = document.getElementById("nickInput");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const submitBtn = document.getElementById("submitBtn");
const statusEl = document.getElementById("status");
const authOnlineEl = document.getElementById("authOnline");

let mode = "login";

function setMode(next) {
  mode = next;
  const isRegister = mode === "register";
  nickInput.parentElement.style.display = isRegister ? "block" : "none";
  nickInput.required = isRegister;
  loginTab.classList.toggle("active", !isRegister);
  registerTab.classList.toggle("active", isRegister);
  submitBtn.textContent = isRegister ? "Zarejestruj" : "Zaloguj";
  statusEl.textContent = "";
  statusEl.className = "status";
}

function setStatus(message, type = "error") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

async function trySession() {
  const response = await fetch("/api/me", { credentials: "include" });
  if (response.ok) {
    location.href = "/game";
  }
}

async function refreshOnline() {
  try {
    const response = await fetch("/api/online-count");
    const data = await response.json();
    authOnlineEl.textContent = `Online: ${data.online ?? 0}`;
  } catch {
    authOnlineEl.textContent = "Online: ?";
  }
}

loginTab.addEventListener("click", () => setMode("login"));
registerTab.addEventListener("click", () => setMode("register"));

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    email: emailInput.value.trim(),
    password: passwordInput.value
  };
  if (mode === "register") {
    payload.nick = nickInput.value.trim();
  }

  const endpoint = mode === "register" ? "/api/register" : "/api/login";
  submitBtn.disabled = true;
  setStatus("Ladowanie...", "ok");
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Nie udalo sie.");
      return;
    }
    setStatus("Sukces! Przechodze do gry...", "ok");
    location.href = "/game";
  } catch (error) {
    setStatus("Blad polaczenia z serwerem.");
  } finally {
    submitBtn.disabled = false;
  }
});

setMode("login");
trySession();
refreshOnline();
setInterval(refreshOnline, 5000);
