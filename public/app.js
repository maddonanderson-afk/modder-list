const peopleEl = document.querySelector("#people");
const accountEl = document.querySelector("#account");
const addButton = document.querySelector("#addButton");
const removeButton = document.querySelector("#removeButton");
const logoutButton = document.querySelector("#logoutButton");
const profileButton = document.querySelector("#profileButton");
const messageEl = document.querySelector("#message");

let me = null;
let people = [];
let profileAudio = null;
let audioUnlocked = false;

function setMessage(text) {
  messageEl.textContent = text || "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[ch]));
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""), location.origin);
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch {}
  return "";
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function renderAccount() {
  if (!me) {
    accountEl.classList.add("hidden");
    removeButton.classList.add("hidden");
    logoutButton.classList.add("hidden");
    profileButton.classList.add("hidden");
    addButton.classList.remove("hidden");
    addButton.textContent = "ADD YOURSELF";
    return;
  }

  accountEl.classList.remove("hidden");
  logoutButton.classList.remove("hidden");
  profileButton.classList.remove("hidden");

  accountEl.innerHTML = `
    <img src="${escapeHtml(safeUrl(me.picture))}" alt="">
    <div>
      <strong>${escapeHtml(me.name)}</strong>
      <span>Signed in with Google</span>
    </div>
  `;

  if (me.added) {
    addButton.classList.add("hidden");
    removeButton.classList.remove("hidden");
  } else {
    addButton.classList.remove("hidden");
    removeButton.classList.add("hidden");
    addButton.textContent = "ADD YOURSELF";
  }
}

function stopProfileMusic() {
  if (profileAudio) {
    profileAudio.pause();
    profileAudio.currentTime = 0;
    profileAudio = null;
  }
}

function playProfileMusic(url) {
  stopProfileMusic();
  if (!audioUnlocked || !url) return;
  profileAudio = new Audio(url);
  profileAudio.volume = 0.45;
  profileAudio.loop = true;
  profileAudio.play().catch(() => {});
}

function renderPeople(list) {
  people = list || [];
  if (!people.length) {
    peopleEl.innerHTML = `<div class="empty">Nobody has added themselves yet.</div>`;
    return;
  }

  peopleEl.innerHTML = people.map((person, index) => {
    const picture = safeUrl(person.picture);
    return `
      <article class="person" data-person-index="${index}">
        <img class="avatar" src="${escapeHtml(picture)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <div class="person-info">
          <div class="person-name">${escapeHtml(person.name)}</div>
          <div class="person-hint">${person.music ? "Hover for profile music" : ""}</div>
        </div>
      </article>
    `;
  }).join("");

  peopleEl.querySelectorAll(".person").forEach(card => {
    const person = people[Number(card.dataset.personIndex)];
    card.addEventListener("mouseenter", () => playProfileMusic(person.music));
    card.addEventListener("mouseleave", stopProfileMusic);
  });
}

async function unlockAudio() {
  audioUnlocked = true;
}

async function load() {
  try {
    const [peopleData, meData] = await Promise.all([
      api("/api/people"),
      api("/api/me")
    ]);
    me = meData.user;
    renderPeople(peopleData.people);
    renderAccount();
  } catch (error) {
    setMessage(error.message);
  }
}

addButton.addEventListener("click", async () => {
  await unlockAudio();
  if (!me) {
    window.location.href = "/auth/google";
    return;
  }

  const name = prompt("Choose the display name you want shown on the list:", me.name || "");
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) {
    setMessage("Display name cannot be empty.");
    return;
  }
  if (trimmed.length > 32) {
    setMessage("Display name must be 32 characters or fewer.");
    return;
  }

  addButton.disabled = true;
  setMessage("Adding you...");
  try {
    await api("/api/add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed })
    });
    setMessage("You were added!");
    await load();
  } catch (error) {
    setMessage(error.message);
  } finally {
    addButton.disabled = false;
  }
});

profileButton.addEventListener("click", async () => {
  await unlockAudio();
  if (!me) return;

  const name = prompt("Display name:", me.name || "");
  if (name === null) return;
  const picture = prompt("Profile picture URL (https://...):", me.picture || "");
  if (picture === null) return;
  const music = prompt("Profile music URL (direct .mp3/.ogg/.wav URL):", me.music || "");
  if (music === null) return;

  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > 32) {
    setMessage("Display name must be 1–32 characters.");
    return;
  }

  profileButton.disabled = true;
  setMessage("Saving profile...");
  try {
    await api("/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmedName, picture: picture.trim(), music: music.trim() })
    });
    setMessage("Profile saved!");
    await load();
  } catch (error) {
    setMessage(error.message);
  } finally {
    profileButton.disabled = false;
  }
});

removeButton.addEventListener("click", async () => {
  removeButton.disabled = true;
  setMessage("Removing you...");
  try {
    await api("/api/remove", { method: "POST" });
    setMessage("You were removed.");
    await load();
  } catch (error) {
    setMessage(error.message);
  } finally {
    removeButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  stopProfileMusic();
  try {
    await api("/auth/logout", { method: "POST" });
    me = null;
    renderAccount();
    setMessage("Logged out.");
    await load();
  } catch (error) {
    setMessage(error.message);
  } finally {
    logoutButton.disabled = false;
  }
});

// Browsers block autoplay until the visitor interacts with the page.
window.addEventListener("pointerdown", unlockAudio, { once: true });
window.addEventListener("keydown", unlockAudio, { once: true });

const params = new URLSearchParams(location.search);
if (params.get("added") === "1") {
  history.replaceState({}, "", "/");
  setMessage("You were added!");
}

load();
